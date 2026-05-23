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
