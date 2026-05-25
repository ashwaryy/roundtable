import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createApp } from './server'
import { createStorage } from './storage'
import type { AgentRoom, BoundedJob, RoomPreflight } from '@roundtable/shared'
import type { RoomManager } from './rooms/manager'

let dataDir: string
let broadcast: ReturnType<typeof vi.fn>
let app: ReturnType<typeof createApp>

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-server-'))
  broadcast = vi.fn()
  app = createApp({ storage: createStorage(dataDir), broadcast })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('GET /api/health', () => {
  it('reports backend readiness without thread data access', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('agent catalogue and roster routes', () => {
  it('supports import JSON with generated ids and unique names', async () => {
    const first = await request(app).post('/api/agents/import-json').send({
      json: JSON.stringify({ name: 'Architect', runtime: 'codex', color: 'teal' }),
    })
    const second = await request(app).post('/api/agents/import-json').send({
      json: JSON.stringify({ name: 'Architect', runtime: 'codex', color: 'rose' }),
    })
    expect(first.status).toBe(201)
    expect(first.body[0].id).toMatch(/^agent-/)
    expect(second.body[0].name).toBe('Architect (2)')
  })

  it('lists, adds, overrides, reorders, and removes thread invites', async () => {
    const persona = (await request(app).post('/api/agents').send({
      name: 'Reviewer', runtime: 'claude', color: 'blue',
    })).body
    await request(app).post('/api/threads').send({ title: 'A', body: 'a' })
    expect((await request(app).get('/api/threads/thread-1/agents')).body).toHaveLength(2)
    await request(app).post('/api/threads/thread-1/agents').send({ agent_id: persona.id })
    const overridden = await request(app).patch(`/api/threads/thread-1/agents/${persona.id}`).send({ model: 'review-model' })
    expect(overridden.body[2].model).toBe('review-model')
    const ordered = await request(app).put('/api/threads/thread-1/agents/order').send({
      agent_ids: [persona.id, 'codex', 'claude'],
    })
    expect(ordered.body[0].agent_id).toBe(persona.id)
    const removed = await request(app).delete(`/api/threads/thread-1/agents/${persona.id}`)
    expect(removed.body).toHaveLength(2)
  })
})

describe('POST /api/threads', () => {
  it('creates a thread and broadcasts thread_created', async () => {
    const res = await request(app)
      .post('/api/threads')
      .send({ title: 'Queue', body: '# Plan' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('thread-1')
    expect(broadcast).toHaveBeenCalledWith({
      type: 'thread_created',
      thread_id: 'thread-1',
    })
  })

  it('rejects an empty title with 400', async () => {
    const res = await request(app).post('/api/threads').send({ title: '', body: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/threads', () => {
  it('lists created threads', async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: 'a' })
    const res = await request(app).get('/api/threads')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('A')
  })
})

describe('GET /api/threads/:id', () => {
  it('returns the thread with its body', async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: '# H' })
    const res = await request(app).get('/api/threads/thread-1')
    expect(res.status).toBe(200)
    expect(res.body.body).toBe('# H')
  })

  it('returns 404 for a missing thread', async () => {
    const res = await request(app).get('/api/threads/thread-999')
    expect(res.status).toBe(404)
  })

  it('returns 404 for a malformed id without touching the filesystem', async () => {
    const res = await request(app).get('/api/threads/not-a-thread')
    expect(res.status).toBe(404)
  })

  it('rejects a path-traversal id (encoded slashes) with 404', async () => {
    const res = await request(app).get('/api/threads/..%2f..%2fsecret')
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/threads/:id', () => {
  it('deletes a thread and broadcasts thread_deleted', async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: '# H' })

    const res = await request(app).delete('/api/threads/thread-1')
    expect(res.status).toBe(204)
    expect(broadcast).toHaveBeenCalledWith({
      type: 'thread_deleted',
      thread_id: 'thread-1',
    })

    const get = await request(app).get('/api/threads/thread-1')
    expect(get.status).toBe(404)
    const list = await request(app).get('/api/threads')
    expect(list.body).toEqual([])
  })

  it('returns 404 for a missing thread', async () => {
    const res = await request(app).delete('/api/threads/thread-999')
    expect(res.status).toBe(404)
  })
})

describe('comments routes', () => {
  beforeEach(async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: 'a' })
  })

  it('adds a top-level comment and broadcasts comment_created', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/comments')
      .send({ body: 'a point' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('c001')
    expect(res.body.parent_id).toBeNull()
    expect(broadcast).toHaveBeenCalledWith({
      type: 'comment_created',
      thread_id: 'thread-1',
    })
  })

  it('adds a reply under the discussion root', async () => {
    await request(app).post('/api/threads/thread-1/comments').send({ body: 'root' })
    const res = await request(app)
      .post('/api/threads/thread-1/comments')
      .send({ body: 'reply', reply_to: 'c001' })
    expect(res.status).toBe(201)
    expect(res.body.parent_id).toBe('c001')
  })

  it('lists comments', async () => {
    await request(app).post('/api/threads/thread-1/comments').send({ body: 'one' })
    const res = await request(app).get('/api/threads/thread-1/comments')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('returns 404 when commenting on a missing thread', async () => {
    const res = await request(app)
      .post('/api/threads/thread-999/comments')
      .send({ body: 'x' })
    expect(res.status).toBe(404)
  })

  it('returns 404 when reply_to does not exist', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/comments')
      .send({ body: 'x', reply_to: 'c999' })
    expect(res.status).toBe(404)
  })

  it('returns 400 for an empty body', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/comments')
      .send({ body: '   ' })
    expect(res.status).toBe(400)
  })

  it('deletes a comment and broadcasts comment_deleted', async () => {
    await request(app).post('/api/threads/thread-1/comments').send({ body: 'root' })

    const res = await request(app).delete('/api/threads/thread-1/comments/c001')

    expect(res.status).toBe(204)
    expect(broadcast).toHaveBeenCalledWith({
      type: 'comment_deleted',
      thread_id: 'thread-1',
    })

    const list = await request(app).get('/api/threads/thread-1/comments')
    expect(list.body).toEqual([])
  })

  it('returns 404 when deleting a missing comment', async () => {
    const res = await request(app).delete('/api/threads/thread-1/comments/c999')
    expect(res.status).toBe(404)
  })
})

describe('pending discussion routes', () => {
  beforeEach(async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: 'a' })
  })

  it('lists pending discussions (empty initially)', async () => {
    const res = await request(app).get('/api/threads/thread-1/pending-discussions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a pending discussion', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'claude', type: 'critique', body: 'needs its own root' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('pd001')
    expect(res.body.author).toBe('claude')
    expect(res.body.type).toBe('critique')
    expect(broadcast).toHaveBeenCalledWith({
      type: 'pending_discussion_created',
      thread_id: 'thread-1',
    })
  })

  it('rejects a create with an empty body (400)', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'claude', body: '  ' })
    expect(res.status).toBe(400)
  })

  it('rejects an uninvited persona id author (400)', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'robot', body: 'hi' })
    expect(res.status).toBe(400)
  })

  it('approves a pending discussion and returns a comment', async () => {
    await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'codex', body: 'approve me' })

    const res = await request(app).post(
      '/api/threads/thread-1/pending-discussions/pd001/approve',
    )
    expect(res.status).toBe(201)
    expect(res.body.author).toBe('codex')
    expect(res.body.body).toBe('approve me')
    expect(res.body.parent_id).toBeNull()
    expect(res.body.approved_from_pending_id).toBe('pd001')
    expect(broadcast).toHaveBeenCalledWith({
      type: 'pending_discussion_updated',
      thread_id: 'thread-1',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'comment_created',
      thread_id: 'thread-1',
    })
  })

  it('returns 404 when approving a missing pending discussion', async () => {
    const res = await request(app).post(
      '/api/threads/thread-1/pending-discussions/pd999/approve',
    )
    expect(res.status).toBe(404)
  })

  it('edits a pending discussion', async () => {
    await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'claude', body: 'original' })

    const res = await request(app)
      .patch('/api/threads/thread-1/pending-discussions/pd001')
      .send({ body: 'revised', type: 'question' })
    expect(res.status).toBe(200)
    expect(res.body.body).toBe('revised')
    expect(res.body.type).toBe('question')
    expect(broadcast).toHaveBeenCalledWith({
      type: 'pending_discussion_updated',
      thread_id: 'thread-1',
    })
  })

  it('returns 400 when editing with neither body nor type', async () => {
    await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'claude', body: 'original' })

    const res = await request(app)
      .patch('/api/threads/thread-1/pending-discussions/pd001')
      .send({})
    expect(res.status).toBe(400)
  })

  it('rejects (deletes) a pending discussion', async () => {
    await request(app)
      .post('/api/threads/thread-1/pending-discussions')
      .send({ author: 'codex', body: 'reject me' })

    const res = await request(app).delete(
      '/api/threads/thread-1/pending-discussions/pd001',
    )
    expect(res.status).toBe(204)
    expect(broadcast).toHaveBeenCalledWith({
      type: 'pending_discussion_updated',
      thread_id: 'thread-1',
    })

    const list = await request(app).get('/api/threads/thread-1/pending-discussions')
    expect(list.body).toHaveLength(0)
  })

  it('returns 404 for a malformed pending id', async () => {
    const res = await request(app).post(
      '/api/threads/thread-1/pending-discussions/not-a-pd/approve',
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when pending operations target a missing thread', async () => {
    const res = await request(app).get('/api/threads/thread-999/pending-discussions')
    expect(res.status).toBe(404)
  })
})

describe('context routes', () => {
  beforeEach(async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: 'a' })
  })

  it('returns empty context initially', async () => {
    const res = await request(app).get('/api/threads/thread-1/context')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.snapshot).toBeNull()
    expect(res.body.workspace_added_files).toEqual([])
  })

  it('adds a URL context item and broadcasts context updates', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/attachments/urls')
      .send({ url: 'https://example.com/spec', label: 'Spec' })
    expect(res.status).toBe(201)
    expect(res.body.kind).toBe('url')
    expect(broadcast).toHaveBeenCalledWith({
      type: 'thread_context_updated',
      thread_id: 'thread-1',
    })
  })

  it('uploads file attachments', async () => {
    const source = path.join(dataDir, 'upload.txt')
    fs.writeFileSync(source, 'hello')

    const res = await request(app)
      .post('/api/threads/thread-1/attachments/files')
      .attach('files', source)
    expect(res.status).toBe(201)
    expect(res.body[0].kind).toBe('file')
    expect(res.body[0].path).toContain('attachments/')
  })

  it('preflights and creates a confirmed folder snapshot', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-server-project-'))
    fs.writeFileSync(path.join(project, 'notes.md'), '# Notes\n')

    const preflight = await request(app)
      .post('/api/threads/thread-1/project-snapshot/preflight')
      .send({ source_path: project })
    expect(preflight.status).toBe(200)
    expect(preflight.body.mode).toBe('folder')
    expect(preflight.body.requires_confirmation).toBe(true)

    const rejected = await request(app)
      .put('/api/threads/thread-1/project-snapshot')
      .send({ source_path: project })
    expect(rejected.status).toBe(409)
    expect(rejected.body.confirmation_required).toBe(true)

    const created = await request(app)
      .put('/api/threads/thread-1/project-snapshot')
      .send({ source_path: project, confirmed: true })
    expect(created.status).toBe(201)
    expect(created.body.file_count).toBe(1)
    expect(broadcast).toHaveBeenCalledWith({
      type: 'thread_context_updated',
      thread_id: 'thread-1',
    })
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('refreshes an existing snapshot', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-server-project-'))
    fs.writeFileSync(path.join(project, 'a.md'), 'a')
    await request(app)
      .put('/api/threads/thread-1/project-snapshot')
      .send({ source_path: project, confirmed: true })
    fs.writeFileSync(path.join(project, 'b.md'), 'b')

    const res = await request(app).post('/api/threads/thread-1/project-snapshot/refresh')
    expect(res.status).toBe(200)
    expect(res.body.added_since_last_refresh).toEqual(['b.md'])
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('returns 400 for invalid snapshot paths', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/project-snapshot/preflight')
      .send({ source_path: path.join(dataDir, 'missing') })
    expect(res.status).toBe(400)
  })

  it('returns immutable snapshot report history', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-server-project-'))
    fs.writeFileSync(path.join(project, 'a.md'), 'one')
    await request(app)
      .put('/api/threads/thread-1/project-snapshot')
      .send({ source_path: project, confirmed: true })
    fs.writeFileSync(path.join(project, 'a.md'), 'two')
    await request(app).post('/api/threads/thread-1/project-snapshot/refresh')

    const res = await request(app).get('/api/threads/thread-1/project-snapshot/reports')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[1].modified_paths).toEqual(['a.md'])
    fs.rmSync(project, { recursive: true, force: true })
  })
})

describe('integrity and saved output routes', () => {
  beforeEach(async () => {
    await request(app).post('/api/threads').send({ title: 'A', body: 'source' })
  })

  it('reports and acknowledges external canonical mutations without blocking writes', async () => {
    fs.writeFileSync(path.join(dataDir, 'threads', 'thread-1', 'thread.md'), 'external')
    const report = await request(app).get('/api/threads/thread-1/integrity')
    expect(report.status).toBe(200)
    expect(report.body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'modified', path: 'thread.md' })]),
    )

    const comment = await request(app)
      .post('/api/threads/thread-1/comments')
      .send({ body: 'operation continues' })
    expect(comment.status).toBe(201)

    const acknowledged = await request(app).post(
      '/api/threads/thread-1/integrity/acknowledge',
    )
    expect(acknowledged.body.issues).toEqual([])
  })

  it('returns a controlled error for malformed canonical JSONL', async () => {
    fs.writeFileSync(path.join(dataDir, 'threads', 'thread-1', 'comments.jsonl'), '{bad}\n')
    const report = await request(app).get('/api/threads/thread-1/integrity')
    expect(report.body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'invalid' })]),
    )
    const comments = await request(app).get('/api/threads/thread-1/comments')
    expect(comments.status).toBe(409)
  })

  it('lists and retrieves saved final output bodies', async () => {
    const storage = createStorage(dataDir)
    const proposal = storage.createProposal('thread-1', {})
    storage.addProposalRevision('thread-1', proposal.id, '# Final output', 'human')

    const saved = await request(app).post(
      `/api/threads/thread-1/consolidations/${proposal.id}/save`,
    )
    expect(saved.status).toBe(200)

    const list = await request(app).get('/api/threads/thread-1/saved-outputs')
    expect(list.body[0].id).toBe(saved.body.id)
    const detail = await request(app).get(`/api/saved/${saved.body.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.body).toBe('# Final output')
  })
})

function testRoom(status: AgentRoom['status'] = 'starting'): AgentRoom {
  return {
    thread_id: 'thread-1',
    status,
    tmux_session: 'roundtable-thread-1',
    attach_command: 'tmux attach -t roundtable-thread-1',
    claude_model: null,
    codex_model: null,
    agents: {
      claude: { ready_at: null },
      codex: { ready_at: null },
    },
    roster: [
      { agent_id: 'claude', name: 'Claude', runtime: 'claude', role_description: '', instructions: '', model: null, effort: null, color: 'amber', logo_url: null, order: 0 },
      { agent_id: 'codex', name: 'Codex', runtime: 'codex', role_description: '', instructions: '', model: null, effort: null, color: 'green', logo_url: null, order: 1 },
    ],
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
    started_at: null,
    stopped_at: null,
    last_error: null,
    active_job_id: null,
    auto: null,
    input_prompt: null,
    idle_suggestion_request: null,
    session_state: status === 'not_started' ? 'not_started' : 'connected',
  }
}

function testJob(status: BoundedJob['status'] = 'running'): BoundedJob {
  return {
    id: 'job-001',
    thread_id: 'thread-1',
    kind: 'agent_turn',
    status,
    agent: 'claude',
    started_at: '2026-05-23T00:00:00.000Z',
    timeout_at: '2026-05-23T00:10:00.000Z',
    completed_at: null,
    logs: [],
    result: null,
    failure_reason: null,
    turn: {
      id: 'job-001',
      thread_id: 'thread-1',
      agent: 'claude',
      kind: 'comment',
      scope: 'thread',
      discussion_id: null,
      instructions: null,
      proposal_id: null,
      revision_id: null,
      review_id: null,
      auto_revision_after_review: false,
      allow_direct_roots: true,
      pending_roots_only: false,
      auto_run_id: null,
      auto_turn_index: null,
      created_at: '2026-05-23T00:00:00.000Z',
      timeout_at: '2026-05-23T00:10:00.000Z',
    },
  }
}

function testPreflight(): RoomPreflight {
  return {
    ok: true,
    tools: {
      tmux: {
        name: 'tmux',
        available: true,
        path: '/usr/bin/tmux',
        version: 'tmux 3.6',
        error: null,
      },
      claude: {
        name: 'claude',
        available: true,
        path: '/usr/bin/claude',
        version: 'claude 1.0',
        error: null,
      },
      codex: {
        name: 'codex',
        available: true,
        path: '/usr/bin/codex',
        version: 'codex 1.0',
        error: null,
      },
    },
  }
}

describe('room routes', () => {
  let rooms: RoomManager
  let terminalLauncher: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    terminalLauncher = vi.fn()
    rooms = {
      preflight: vi.fn(() => testPreflight()),
      getRoom: vi.fn(() => testRoom('not_started')),
      startRoom: vi.fn(() => testRoom('starting')),
      syncRoster: vi.fn(() => testRoom('idle')),
      restartRoom: vi.fn(() => testRoom('starting')),
      stopRoom: vi.fn(() => testRoom('stopped')),
      nudgeRoom: vi.fn(() => testRoom('idle')),
      requestIdleSuggestion: vi.fn(() => testRoom('idle')),
      cancelIdleSuggestion: vi.fn(() => testRoom('idle')),
      markReady: vi.fn(() => testRoom('idle')),
      askAgent: vi.fn(() => ({ room: testRoom('running'), job: testJob() })),
      startAutoDiscussion: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob(),
      })),
      startConsolidation: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob(),
        proposal: {
          id: 'consolidation-001',
          thread_id: 'thread-1',
          status: 'drafting',
          summary: null,
          instructions: null,
          drafter_agent: 'codex',
          reviewer_agent: 'claude',
          reviser_agent: 'codex',
          created_at: '2026-05-23T00:00:00.000Z',
          updated_at: '2026-05-23T00:00:00.000Z',
          applied_thread_id: null,
          saved_artifact_id: null,
        },
      })),
      finishAndStartConsolidation: vi.fn(() => testRoom('running')),
      requestProposalReview: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob(),
        proposal: {
          id: 'consolidation-001',
          thread_id: 'thread-1',
          status: 'review',
          summary: null,
          instructions: null,
          drafter_agent: 'codex',
          reviewer_agent: 'claude',
          reviser_agent: 'codex',
          created_at: '2026-05-23T00:00:00.000Z',
          updated_at: '2026-05-23T00:00:00.000Z',
          applied_thread_id: null,
          saved_artifact_id: null,
        },
      })),
      requestProposalRevision: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob(),
        proposal: {
          id: 'consolidation-001',
          thread_id: 'thread-1',
          status: 'review',
          summary: null,
          instructions: null,
          drafter_agent: 'codex',
          reviewer_agent: 'claude',
          reviser_agent: 'codex',
          created_at: '2026-05-23T00:00:00.000Z',
          updated_at: '2026-05-23T00:00:00.000Z',
          applied_thread_id: null,
          saved_artifact_id: null,
        },
      })),
      pauseAutoDiscussion: vi.fn(() => testRoom('paused')),
      extendAutoDiscussion: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob(),
      })),
      sendInputResponse: vi.fn(() => testRoom('running')),
      submitComment: vi.fn(() => ({
        room: testRoom('idle'),
        job: testJob('completed'),
        comment: {
          id: 'c001',
          thread_id: 'thread-1',
          discussion_id: 'c001',
          parent_id: null,
          author: 'claude',
          type: 'comment',
          body: 'agent comment',
          origin_discussion_id: null,
          origin_comment_id: null,
          approved_from_pending_id: null,
          created_at: '2026-05-23T00:00:00.000Z',
        },
      })),
      submitPendingDiscussion: vi.fn(() => ({
        room: testRoom('idle'),
        job: {
          ...testJob('completed'),
          result: { pending_discussion_id: 'pd001' },
        },
        pending_discussion: {
          id: 'pd001',
          thread_id: 'thread-1',
          author: 'claude',
          type: 'comment',
          body: 'pending root',
          origin_discussion_id: null,
          origin_comment_id: null,
          created_at: '2026-05-23T00:00:00.000Z',
        },
      })),
      submitProposal: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob('completed'),
        proposal: {
          id: 'consolidation-001',
          thread_id: 'thread-1',
          status: 'drafting',
          summary: null,
          instructions: null,
          drafter_agent: 'codex',
          reviewer_agent: 'claude',
          reviser_agent: 'codex',
          created_at: '2026-05-23T00:00:00.000Z',
          updated_at: '2026-05-23T00:00:00.000Z',
          applied_thread_id: null,
          saved_artifact_id: null,
        },
        revision: {
          id: 'r001',
          proposal_id: 'consolidation-001',
          thread_id: 'thread-1',
          author: 'codex',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      })),
      submitReview: vi.fn(() => ({
        room: testRoom('running'),
        job: testJob('completed'),
        proposal: {
          id: 'consolidation-001',
          thread_id: 'thread-1',
          status: 'drafting',
          summary: null,
          instructions: null,
          drafter_agent: 'codex',
          reviewer_agent: 'claude',
          reviser_agent: 'codex',
          created_at: '2026-05-23T00:00:00.000Z',
          updated_at: '2026-05-23T00:00:00.000Z',
          applied_thread_id: null,
          saved_artifact_id: null,
        },
        review: {
          id: 'review-001',
          proposal_id: 'consolidation-001',
          thread_id: 'thread-1',
          author: 'claude',
          revision_id: 'r001',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      })),
      retryTurn: vi.fn(() => ({ room: testRoom('running'), job: testJob() })),
      skipTurn: vi.fn(() => ({ room: testRoom('idle'), job: testJob('skipped') })),
    }
    app = createApp({
      storage: createStorage(dataDir),
      rooms,
      broadcast,
      terminalLauncher,
    })
    await request(app).post('/api/threads').send({ title: 'A', body: 'a' })
  })

  it('returns room preflight status', async () => {
    const res = await request(app).get('/api/threads/thread-1/room/preflight')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(rooms.preflight).toHaveBeenCalled()
  })

  it('starts a room and broadcasts room_updated', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/start')
      .send({ claude_model: 'sonnet', codex_model: 'gpt-5' })

    expect(res.status).toBe(201)
    expect(rooms.startRoom).toHaveBeenCalledWith('thread-1', {
      claude_model: 'sonnet',
      codex_model: 'gpt-5',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'room_updated',
      thread_id: 'thread-1',
    })
  })

  it('stops a room', async () => {
    const res = await request(app).post('/api/threads/thread-1/room/stop')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('stopped')
    expect(rooms.stopRoom).toHaveBeenCalledWith('thread-1')
  })

  it('restarts a recoverable room', async () => {
    const res = await request(app).post('/api/threads/thread-1/room/restart')
    expect(res.status).toBe(200)
    expect(rooms.restartRoom).toHaveBeenCalledWith('thread-1')
  })

  it('opens a terminal attached to a running room tmux session', async () => {
    vi.mocked(rooms.getRoom).mockReturnValue(testRoom('idle'))

    const res = await request(app).post('/api/threads/thread-1/room/open-terminal')

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ ok: true })
    expect(terminalLauncher).toHaveBeenCalledWith('roundtable-thread-1')
  })

  it('does not open a terminal when the room tmux session is not running', async () => {
    const res = await request(app).post('/api/threads/thread-1/room/open-terminal')

    expect(res.status).toBe(409)
    expect(terminalLauncher).not.toHaveBeenCalled()
  })

  it('nudges an idle room', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/nudge')
      .send({ agent: 'codex', body: 'go' })

    expect(res.status).toBe(200)
    expect(rooms.nudgeRoom).toHaveBeenCalledWith('thread-1', {
      agent: 'codex',
      body: 'go',
    })
  })

  it('requests idle pending suggestions', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/suggestion-request')
      .send({ agent: 'codex', body: 'Find one performance topic.' })

    expect(res.status).toBe(200)
    expect(rooms.requestIdleSuggestion).toHaveBeenCalledWith('thread-1', {
      agent: 'codex',
      body: 'Find one performance topic.',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'room_updated',
      thread_id: 'thread-1',
    })
  })

  it('cancels an outstanding idle suggestion request', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/suggestion-request/cancel')

    expect(res.status).toBe(200)
    expect(rooms.cancelIdleSuggestion).toHaveBeenCalledWith('thread-1')
    expect(broadcast).toHaveBeenCalledWith({
      type: 'room_updated',
      thread_id: 'thread-1',
    })
  })

  it('marks an agent ready with the bearer token', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/ready')
      .set('authorization', 'Bearer token-123')
      .send({ agent: 'claude' })

    expect(res.status).toBe(200)
    expect(rooms.markReady).toHaveBeenCalledWith('thread-1', 'claude', 'token-123')
  })

  it('starts an ask turn and broadcasts job and room updates', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/ask')
      .send({ agent: 'claude', body: 'inspect this' })

    expect(res.status).toBe(201)
    expect(rooms.askAgent).toHaveBeenCalledWith('thread-1', {
      agent: 'claude',
      body: 'inspect this',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'job_updated',
      thread_id: 'thread-1',
      job_id: 'job-001',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'room_updated',
      thread_id: 'thread-1',
    })
  })

  it('starts, pauses, and extends auto discussion', async () => {
    const start = await request(app)
      .post('/api/threads/thread-1/room/auto/start')
      .send({ turn_count: 4, allow_direct_roots: true })
    const pause = await request(app).post('/api/threads/thread-1/room/auto/pause')
    const extend = await request(app)
      .post('/api/threads/thread-1/room/auto/extend')
      .send({ turn_count: 2 })

    expect(start.status).toBe(201)
    expect(pause.status).toBe(200)
    expect(extend.status).toBe(200)
    expect(rooms.startAutoDiscussion).toHaveBeenCalledWith('thread-1', {
      turn_count: 4,
      allow_direct_roots: true,
    })
    expect(rooms.pauseAutoDiscussion).toHaveBeenCalledWith('thread-1')
    expect(rooms.extendAutoDiscussion).toHaveBeenCalledWith('thread-1', {
      turn_count: 2,
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'job_updated',
      thread_id: 'thread-1',
      job_id: 'job-001',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'room_updated',
      thread_id: 'thread-1',
    })
  })

  it('sends yes/no input responses to the room pane', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/input-response')
      .send({ agent: 'codex', response: 'yes' })

    expect(res.status).toBe(200)
    expect(rooms.sendInputResponse).toHaveBeenCalledWith('thread-1', {
      agent: 'codex',
      response: 'yes',
    })
    expect(broadcast).toHaveBeenCalledWith({
      type: 'room_updated',
      thread_id: 'thread-1',
    })
  })

  it('accepts helper comment submissions with the bearer token', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/comment')
      .set('authorization', 'Bearer room-token')
      .send({ turn_id: 'job-001', agent: 'claude', body: 'agent comment' })

    expect(res.status).toBe(201)
    expect(rooms.submitComment).toHaveBeenCalledWith(
      'thread-1',
      { turn_id: 'job-001', agent: 'claude', body: 'agent comment' },
      'room-token',
    )
    expect(broadcast).toHaveBeenCalledWith({
      type: 'comment_created',
      thread_id: 'thread-1',
    })
  })

  it('accepts helper pending discussion submissions with the bearer token', async () => {
    const res = await request(app)
      .post('/api/threads/thread-1/room/pending-discussion')
      .set('authorization', 'Bearer room-token')
      .send({
        turn_id: 'job-001',
        agent: 'claude',
        body: 'pending root',
        type: 'critique',
        continue_turn: true,
      })

    expect(res.status).toBe(201)
    expect(rooms.submitPendingDiscussion).toHaveBeenCalledWith(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'claude',
        body: 'pending root',
        type: 'critique',
        continue_turn: true,
      },
      'room-token',
    )
    expect(broadcast).toHaveBeenCalledWith({
      type: 'pending_discussion_created',
      thread_id: 'thread-1',
    })
  })

  it('does not broadcast a job update for an idle pending discussion submission', async () => {
    vi.mocked(rooms.submitPendingDiscussion).mockReturnValueOnce({
      room: testRoom('idle'),
      pending_discussion: {
        id: 'pd002',
        thread_id: 'thread-1',
        author: 'codex',
        type: 'question',
        body: 'idle pending root',
        origin_discussion_id: null,
        origin_comment_id: null,
        created_at: '2026-05-23T00:00:00.000Z',
      },
    })

    const res = await request(app)
      .post('/api/threads/thread-1/room/pending-discussion')
      .set('authorization', 'Bearer room-token')
      .send({ agent: 'codex', body: 'idle pending root', type: 'question' })

    expect(res.status).toBe(201)
    expect(broadcast).toHaveBeenCalledWith({
      type: 'pending_discussion_created',
      thread_id: 'thread-1',
    })
    expect(broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_updated' }),
    )
  })

  it('retries and skips turns needing attention', async () => {
    const retry = await request(app).post('/api/threads/thread-1/room/turn/retry')
    const skip = await request(app).post('/api/threads/thread-1/room/turn/skip')

    expect(retry.status).toBe(200)
    expect(skip.status).toBe(200)
    expect(rooms.retryTurn).toHaveBeenCalledWith('thread-1')
    expect(rooms.skipTurn).toHaveBeenCalledWith('thread-1')
  })
})
