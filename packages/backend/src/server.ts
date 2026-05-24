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
  type RoundtableEvent,
} from '@roundtable/shared'
import {
  BadRequestError,
  ConfirmationRequiredError,
  ConflictError,
  NotFoundError,
  type Storage,
} from './storage'
import type { RoomManager } from './rooms/manager'

const THREAD_ID_RE = /^thread-\d+$/
const PENDING_ID_RE = /^pd\d+$/
const JOB_ID_RE = /^job-\d+$/
const PROPOSAL_ID_RE = /^consolidation-\d+$/

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
  return false
}

function bearerToken(req: express.Request): string | null {
  const header = req.header('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

export function createApp(deps: {
  storage: Storage
  broadcast: (event: RoundtableEvent) => void
  rooms?: RoomManager
}): express.Express {
  const { storage, broadcast, rooms } = deps
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
    res.json(storage.listThreads())
  })

  app.get('/api/threads/:id', (req, res) => {
    const thread = storage.getThread(req.params.id)
    if (!thread) return res.status(404).json({ error: 'thread not found' })
    res.json(thread)
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
    res.json(rooms.preflight())
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
      broadcast({ type: 'job_updated', thread_id: req.params.id, job_id: result.job.id })
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

  return app
}
