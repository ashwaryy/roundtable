import express from 'express'
import formidable, { type File as FormidableFile } from 'formidable'
import {
  createThreadInputSchema,
  createCommentInputSchema,
  createPendingDiscussionInputSchema,
  createProposalRevisionInputSchema,
  editPendingDiscussionInputSchema,
  createProjectSnapshotInputSchema,
  createUrlContextInputSchema,
  askAgentInputSchema,
  requestIdleSuggestionInputSchema,
  helperCommentInputSchema,
  helperPendingDiscussionInputSchema,
  helperProposalInputSchema,
  helperReviewInputSchema,
  nudgeRoomInputSchema,
  readyInputSchema,
  requestProposalReviewInputSchema,
  requestProposalRevisionInputSchema,
  snapshotPreflightInputSchema,
  extendAutoDiscussionInputSchema,
  sendRoomInputResponseInputSchema,
  startAutoDiscussionInputSchema,
  startConsolidationInputSchema,
  startRoomInputSchema,
  createAgentPersonaInputSchema,
  updateAgentPersonaInputSchema,
  importAgentPersonasInputSchema,
  inviteAgentInputSchema,
  updateThreadAgentInviteInputSchema,
  reorderThreadAgentsInputSchema,
  type AgentRoom,
  type ConsolidationProposal,
  type RoundtableEvent,
  type Thread,
  type ThreadDisplayStatus,
  type ThreadListItem,
} from '@roundtable/shared'
import {
  BadRequestError,
  ConfirmationRequiredError,
  ConflictError,
  IntegrityStorageError,
  NotFoundError,
  type Storage,
} from './storage'
import type { RoomManager } from './rooms/manager'
import { openTerminalForTmux } from './terminal'

const THREAD_ID_RE = /^thread-\d+$/
const COMMENT_ID_RE = /^c\d+$/
const PENDING_ID_RE = /^pd\d+$/
const JOB_ID_RE = /^job-\d+$/
const PROPOSAL_ID_RE = /^consolidation-\d+$/
const SAVED_ID_RE = /^thread-\d+-consolidation-\d+$/
const AGENT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

function flattenFiles(files: Record<string, FormidableFile | FormidableFile[]>): FormidableFile[] {
  return Object.values(files).flatMap((file) => (Array.isArray(file) ? file : [file]))
}

function parseMultipartFiles(req: express.Request): Promise<FormidableFile[]> {
  const form = formidable({ multiples: true })
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) {
        reject(err)
        return
      }
      resolve(flattenFiles(files))
    })
  })
}

function handleStorageError(err: unknown, res: express.Response): boolean {
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message })
    return true
  }
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.message })
    return true
  }
  if (err instanceof ConfirmationRequiredError) {
    res.status(409).json({ error: err.message, confirmation_required: true })
    return true
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message })
    return true
  }
  if (err instanceof IntegrityStorageError || err instanceof SyntaxError) {
    res.status(409).json({ error: 'canonical storage contains malformed structured data' })
    return true
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  ) {
    res.status(409).json({ error: 'canonical storage is missing a required artifact' })
    return true
  }
  return false
}

function bearerToken(req: express.Request): string | null {
  const header = req.header('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

function isActiveProposal(proposal: ConsolidationProposal): boolean {
  return proposal.status === 'drafting' || proposal.status === 'review'
}

function computeDisplayStatus(input: {
  thread: Thread
  room: AgentRoom | null
  proposals: ConsolidationProposal[]
}): ThreadDisplayStatus {
  if (input.thread.status === 'closed') return 'closed'
  if (input.thread.status === 'archived') return 'archived'

  const { room } = input
  if (room?.status === 'error') return 'error'
  if (
    room?.status === 'needs_attention' ||
    room?.input_prompt ||
    room?.session_state === 'missing' ||
    room?.session_state === 'untracked'
  ) {
    return 'needs_attention'
  }

  if (input.proposals.some(isActiveProposal)) return 'consolidating'
  if (!room || room.status === 'not_started' || room.status === 'stopped') return 'setup'
  return 'discussing'
}

function recoveryActionLabel(room: AgentRoom | null): string | null {
  if (!room) return null
  if (room.input_prompt) return `Respond to ${room.input_prompt.agent}`
  if (room.session_state === 'missing') return 'Restart room'
  if (
    (room.status === 'needs_attention' || room.status === 'error') &&
    room.active_job_id
  ) {
    return 'Retry or skip turn'
  }
  if (room.status === 'needs_attention' || room.status === 'error') {
    return 'Open recovery'
  }
  return null
}

export function createApp(deps: {
  storage: Storage
  broadcast: (event: RoundtableEvent) => void
  rooms?: RoomManager
  terminalLauncher?: (sessionName: string) => void
}): express.Express {
  const { storage, broadcast, rooms, terminalLauncher = openTerminalForTmux } = deps
  const app = express()
  app.use(express.json())

  app.param('id', (_req, res, next, value: string) => {
    if (!THREAD_ID_RE.test(value)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    next()
  })

  app.param('pendingId', (_req, res, next, value: string) => {
    if (!PENDING_ID_RE.test(value)) {
      return res.status(404).json({ error: 'pending discussion not found' })
    }
    next()
  })

  app.param('commentId', (_req, res, next, value: string) => {
    if (!COMMENT_ID_RE.test(value)) {
      return res.status(404).json({ error: 'comment not found' })
    }
    next()
  })

  app.param('jobId', (_req, res, next, value: string) => {
    if (!JOB_ID_RE.test(value)) {
      return res.status(404).json({ error: 'job not found' })
    }
    next()
  })

  app.param('proposalId', (_req, res, next, value: string) => {
    if (!PROPOSAL_ID_RE.test(value)) {
      return res.status(404).json({ error: 'proposal not found' })
    }
    next()
  })

  app.param('agentId', (_req, res, next, value: string) => {
    if (!AGENT_ID_RE.test(value)) {
      return res.status(404).json({ error: 'agent not found' })
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/agents', (_req, res) => {
    res.json(storage.listAgents())
  })

  app.post('/api/agents', (req, res) => {
    const parsed = createAgentPersonaInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const agent = storage.createAgent(parsed.data)
    broadcast({ type: 'agents_updated' })
    res.status(201).json(agent)
  })

  app.post('/api/agents/import-json', (req, res) => {
    let input: unknown = req.body
    if (typeof req.body?.json === 'string') {
      try {
        input = JSON.parse(req.body.json)
      } catch {
        return res.status(400).json({ error: 'json must contain valid JSON' })
      }
    }
    const parsed = importAgentPersonasInputSchema.safeParse(input)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const imported = (Array.isArray(parsed.data) ? parsed.data : [parsed.data])
      .map((persona) => storage.createAgent(persona))
    broadcast({ type: 'agents_updated' })
    res.status(201).json(imported)
  })

  app.patch('/api/agents/:agentId', (req, res) => {
    const parsed = updateAgentPersonaInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    try {
      const agent = storage.updateAgent(req.params.agentId, parsed.data)
      broadcast({ type: 'agents_updated' })
      res.json(agent)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.delete('/api/agents/:agentId', (req, res) => {
    try {
      const archived = storage.deleteAgent(req.params.agentId)
      broadcast({ type: 'agents_updated' })
      if (archived) return res.json(archived)
      return res.status(204).end()
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads', (req, res) => {
    const parsed = createThreadInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }
    const thread = storage.createThread(parsed.data)
    broadcast({ type: 'thread_created', thread_id: thread.id })
    res.status(201).json(thread)
  })

  app.get('/api/threads', (_req, res) => {
    const items: ThreadListItem[] = storage.listThreads().map((thread) => {
      const room = rooms ? rooms.getRoom(thread.id) : null
      const proposals = storage.listProposals(thread.id)
      const display_status = computeDisplayStatus({ thread, room, proposals })
      return {
        ...thread,
        display_status,
        pending_count: storage.listPendingDiscussions(thread.id).length,
        recovery_action_label:
          display_status === 'needs_attention' || display_status === 'error'
            ? recoveryActionLabel(room)
            : null,
      }
    })
    res.json(items)
  })

  app.get('/api/threads/:id', (req, res) => {
    const thread = storage.getThread(req.params.id)
    if (!thread) return res.status(404).json({ error: 'thread not found' })
    res.json(thread)
  })

  function rosterEditable(threadId: string): boolean {
    if (!rooms) return true
    const room = rooms.getRoom(threadId)
    return room.status === 'not_started' || room.status === 'stopped' || room.status === 'idle'
  }

  app.get('/api/threads/:id/agents', (req, res) => {
    try {
      res.json(storage.listThreadAgents(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/agents', (req, res) => {
    const parsed = inviteAgentInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    try {
      if (!rosterEditable(req.params.id)) throw new ConflictError('room must be idle before changing its roster')
      const roster = storage.inviteAgent(req.params.id, parsed.data)
      rooms?.syncRoster(req.params.id)
      broadcast({ type: 'thread_agents_updated', thread_id: req.params.id })
      res.status(201).json(roster)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.patch('/api/threads/:id/agents/:agentId', (req, res) => {
    const parsed = updateThreadAgentInviteInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    try {
      if (!rosterEditable(req.params.id)) throw new ConflictError('room must be idle before changing its roster')
      const roster = storage.updateThreadAgent(req.params.id, req.params.agentId, parsed.data)
      rooms?.syncRoster(req.params.id)
      broadcast({ type: 'thread_agents_updated', thread_id: req.params.id })
      res.json(roster)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.delete('/api/threads/:id/agents/:agentId', (req, res) => {
    try {
      if (!rosterEditable(req.params.id)) throw new ConflictError('room must be idle before changing its roster')
      const roster = storage.removeThreadAgent(req.params.id, req.params.agentId)
      rooms?.syncRoster(req.params.id)
      broadcast({ type: 'thread_agents_updated', thread_id: req.params.id })
      res.json(roster)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.put('/api/threads/:id/agents/order', (req, res) => {
    const parsed = reorderThreadAgentsInputSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    try {
      if (!rosterEditable(req.params.id)) throw new ConflictError('room must be idle before changing its roster')
      const roster = storage.reorderThreadAgents(req.params.id, parsed.data)
      rooms?.syncRoster(req.params.id)
      broadcast({ type: 'thread_agents_updated', thread_id: req.params.id })
      res.json(roster)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.delete('/api/threads/:id', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    try {
      rooms?.stopRoom(req.params.id)
      storage.deleteThread(req.params.id)
      broadcast({ type: 'thread_deleted', thread_id: req.params.id })
      res.status(204).end()
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/comments', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    res.json(storage.listComments(req.params.id))
  })

  app.post('/api/threads/:id/comments', (req, res) => {
    const parsed = createCommentInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }
    try {
      const comment = storage.addComment(req.params.id, parsed.data)
      broadcast({ type: 'comment_created', thread_id: req.params.id })
      res.status(201).json(comment)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.delete('/api/threads/:id/comments/:commentId', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    try {
      storage.deleteComment(req.params.id, req.params.commentId)
      broadcast({ type: 'comment_deleted', thread_id: req.params.id })
      res.status(204).end()
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.get('/api/threads/:id/pending-discussions', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    res.json(storage.listPendingDiscussions(req.params.id))
  })

  app.post('/api/threads/:id/pending-discussions', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    const parsed = createPendingDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const discussion = storage.addPendingDiscussion(req.params.id, parsed.data)
      broadcast({ type: 'pending_discussion_created', thread_id: req.params.id })
      res.status(201).json(discussion)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.post(
    '/api/threads/:id/pending-discussions/:pendingId/approve',
    (req, res) => {
      if (!storage.getThread(req.params.id)) {
        return res.status(404).json({ error: 'thread not found' })
      }

      try {
        const comment = storage.approvePendingDiscussion(
          req.params.id,
          req.params.pendingId,
        )
        broadcast({
          type: 'pending_discussion_updated',
          thread_id: req.params.id,
        })
        broadcast({ type: 'comment_created', thread_id: req.params.id })
        res.status(201).json(comment)
      } catch (err) {
        if (err instanceof NotFoundError) {
          return res.status(404).json({ error: err.message })
        }
        throw err
      }
    },
  )

  app.patch('/api/threads/:id/pending-discussions/:pendingId', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    const parsed = editPendingDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const updated = storage.editPendingDiscussion(
        req.params.id,
        req.params.pendingId,
        parsed.data,
      )
      broadcast({
        type: 'pending_discussion_updated',
        thread_id: req.params.id,
      })
      res.status(200).json(updated)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.delete('/api/threads/:id/pending-discussions/:pendingId', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    try {
      storage.rejectPendingDiscussion(req.params.id, req.params.pendingId)
      broadcast({
        type: 'pending_discussion_updated',
        thread_id: req.params.id,
      })
      res.status(204).send()
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })
      }
      throw err
    }
  })

  app.get('/api/threads/:id/context', (req, res) => {
    try {
      res.json(storage.getThreadContext(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/attachments/urls', (req, res) => {
    const parsed = createUrlContextInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const item = storage.addUrlContextItem(req.params.id, parsed.data)
      broadcast({ type: 'thread_context_updated', thread_id: req.params.id })
      res.status(201).json(item)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/attachments/files', async (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }

    try {
      const files = await parseMultipartFiles(req)
      if (files.length === 0) {
        return res.status(400).json({ error: 'at least one file is required' })
      }
      const items = files.map((file) =>
        storage.addAttachmentFromFile(req.params.id, {
          tempPath: file.filepath,
          originalName: file.originalFilename ?? 'attachment',
          mediaType: file.mimetype,
          sizeBytes: file.size,
        }),
      )
      broadcast({ type: 'thread_context_updated', thread_id: req.params.id })
      res.status(201).json(items)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/project-snapshot/preflight', (req, res) => {
    const parsed = snapshotPreflightInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      res.json(storage.preflightProjectSnapshot(req.params.id, parsed.data.source_path))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.put('/api/threads/:id/project-snapshot', (req, res) => {
    const parsed = createProjectSnapshotInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const snapshot = storage.createProjectSnapshot(req.params.id, parsed.data)
      broadcast({ type: 'thread_context_updated', thread_id: req.params.id })
      res.status(201).json(snapshot)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/project-snapshot/refresh', (req, res) => {
    try {
      const snapshot = storage.refreshProjectSnapshot(req.params.id)
      broadcast({ type: 'thread_context_updated', thread_id: req.params.id })
      res.json(snapshot)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/project-snapshot/reports', (req, res) => {
    try {
      res.json(storage.listSnapshotReports(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/integrity', (req, res) => {
    try {
      res.json(storage.getIntegrity(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/integrity/acknowledge', (req, res) => {
    try {
      const report = storage.acknowledgeIntegrity(req.params.id)
      broadcast({ type: 'integrity_updated', thread_id: req.params.id })
      res.json(report)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/saved-outputs', (req, res) => {
    try {
      res.json(storage.listSavedOutputs(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/saved/:savedId', (req, res) => {
    if (!SAVED_ID_RE.test(req.params.savedId)) {
      return res.status(404).json({ error: 'saved output not found' })
    }
    try {
      const saved = storage.getSavedOutput(req.params.savedId)
      if (!saved) return res.status(404).json({ error: 'saved output not found' })
      res.json(saved)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/consolidations', (req, res) => {
    try {
      if (!storage.getThread(req.params.id)) {
        return res.status(404).json({ error: 'thread not found' })
      }
      res.json(storage.listProposals(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = startConsolidationInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.startConsolidation(req.params.id, parsed.data)
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: result.proposal.id,
      })
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/finish-and-start', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = startConsolidationInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const room = rooms.finishAndStartConsolidation(req.params.id, parsed.data)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/consolidations/:proposalId', (req, res) => {
    try {
      const detail = storage.getConsolidationDetail(
        req.params.id,
        req.params.proposalId,
      )
      if (!detail) return res.status(404).json({ error: 'proposal not found' })
      res.json(detail)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/:proposalId/revisions', (req, res) => {
    const parsed = createProposalRevisionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const revision = storage.addProposalRevision(
        req.params.id,
        req.params.proposalId,
        parsed.data.body,
        'human',
      )
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: req.params.proposalId,
      })
      res.status(201).json(revision)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/:proposalId/review', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = requestProposalReviewInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.requestProposalReview(
        req.params.id,
        req.params.proposalId,
        parsed.data,
      )
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: req.params.proposalId,
      })
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/:proposalId/revise', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = requestProposalRevisionInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.requestProposalRevision(
        req.params.id,
        req.params.proposalId,
        parsed.data,
      )
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: req.params.proposalId,
      })
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/:proposalId/reject', (req, res) => {
    try {
      const proposal = storage.rejectProposal(req.params.id, req.params.proposalId)
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: req.params.proposalId,
      })
      res.json(proposal)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/:proposalId/save', (req, res) => {
    try {
      const saved = storage.saveProposalOutput(req.params.id, req.params.proposalId)
      if (rooms) {
        rooms.stopRoom(req.params.id)
        broadcast({ type: 'room_updated', thread_id: req.params.id })
      }
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: req.params.proposalId,
      })
      broadcast({ type: 'thread_context_updated', thread_id: req.params.id })
      res.json(saved)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/consolidations/:proposalId/next-iteration', (req, res) => {
    try {
      const thread = storage.applyProposalNextIteration(req.params.id, req.params.proposalId)
      if (rooms) {
        rooms.stopRoom(req.params.id)
        broadcast({ type: 'room_updated', thread_id: req.params.id })
      }
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: req.params.proposalId,
      })
      broadcast({ type: 'thread_created', thread_id: thread.id })
      res.status(201).json(thread)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/room/preflight', (req, res) => {
    if (!storage.getThread(req.params.id)) {
      return res.status(404).json({ error: 'thread not found' })
    }
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    res.json(rooms.preflight(req.params.id))
  })

  app.get('/api/threads/:id/room', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      res.json(rooms.getRoom(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/start', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = startRoomInputSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const room = rooms.startRoom(req.params.id, parsed.data)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/restart', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const room = rooms.restartRoom(req.params.id)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/stop', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const room = rooms.stopRoom(req.params.id)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/open-terminal', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const room = rooms.getRoom(req.params.id)
      if (room.session_state !== 'connected' && room.session_state !== 'recovered') {
        return res.status(409).json({ error: 'room tmux session is not running' })
      }

      terminalLauncher(room.tmux_session)
      res.status(202).json({ ok: true })
    } catch (err) {
      if (handleStorageError(err, res)) return
      if (err instanceof Error) return res.status(409).json({ error: err.message })
      throw err
    }
  })

  app.post('/api/threads/:id/room/nudge', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = nudgeRoomInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const room = rooms.nudgeRoom(req.params.id, parsed.data)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/suggestion-request', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = requestIdleSuggestionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const room = rooms.requestIdleSuggestion(req.params.id, parsed.data)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/suggestion-request/cancel', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const room = rooms.cancelIdleSuggestion(req.params.id)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/ask', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = askAgentInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.askAgent(req.params.id, parsed.data)
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/auto/start', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = startAutoDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.startAutoDiscussion(req.params.id, parsed.data)
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/auto/pause', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const room = rooms.pauseAutoDiscussion(req.params.id)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/auto/extend', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = extendAutoDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.extendAutoDiscussion(req.params.id, parsed.data)
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/input-response', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = sendRoomInputResponseInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const room = rooms.sendInputResponse(req.params.id, parsed.data)
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/comment', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = helperCommentInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.submitComment(req.params.id, parsed.data, bearerToken(req))
      broadcast({ type: 'comment_created', thread_id: req.params.id })
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/pending-discussion', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = helperPendingDiscussionInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.submitPendingDiscussion(
        req.params.id,
        parsed.data,
        bearerToken(req),
      )
      broadcast({ type: 'pending_discussion_created', thread_id: req.params.id })
      if (result.job) {
        broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      }
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/proposal', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = helperProposalInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.submitProposal(req.params.id, parsed.data, bearerToken(req))
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: result.proposal.id,
      })
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/review', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = helperReviewInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const result = rooms.submitReview(req.params.id, parsed.data, bearerToken(req))
      broadcast({
        type: 'consolidation_updated',
        thread_id: req.params.id,
        proposal_id: result.proposal.id,
      })
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.status(201).json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/turn/retry', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const result = rooms.retryTurn(req.params.id)
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/turn/skip', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    try {
      const result = rooms.skipTurn(req.params.id)
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(result)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/jobs', (req, res) => {
    try {
      res.json(storage.listJobs(req.params.id))
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.get('/api/threads/:id/jobs/:jobId', (req, res) => {
    try {
      const job = storage.getJob(req.params.id, req.params.jobId)
      if (!job) return res.status(404).json({ error: 'job not found' })
      res.json(job)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.post('/api/threads/:id/room/ready', (req, res) => {
    if (!rooms) return res.status(501).json({ error: 'room manager not configured' })
    const parsed = readyInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() })
    }

    try {
      const room = rooms.markReady(
        req.params.id,
        parsed.data.agent,
        bearerToken(req),
      )
      broadcast({ type: 'room_updated', thread_id: req.params.id })
      res.json(room)
    } catch (err) {
      if (handleStorageError(err, res)) return
      throw err
    }
  })

  app.use((_err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (handleStorageError(_err, res)) return
    next(_err)
  })

  return app
}
