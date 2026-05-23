import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createApp } from './server'
import { createStorage } from './storage'

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

  it('rejects a create with an invalid author (400)', async () => {
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

  it('preflights and creates a confirmed non-git snapshot', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-server-project-'))
    fs.writeFileSync(path.join(project, 'notes.md'), '# Notes\n')

    const preflight = await request(app)
      .post('/api/threads/thread-1/project-snapshot/preflight')
      .send({ source_path: project })
    expect(preflight.status).toBe(200)
    expect(preflight.body.mode).toBe('non-git')
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
})
