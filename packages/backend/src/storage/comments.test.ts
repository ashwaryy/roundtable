import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createThread } from './threads'
import { listComments, addComment, addAgentComment } from './comments'
import { NotFoundError } from './errors'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-comments-'))
  createThread(dataDir, { title: 'T', body: 'body' })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('addComment', () => {
  it('creates a top-level discussion point with discussion_id === id', () => {
    const c = addComment(dataDir, 'thread-1', { body: 'first point' })
    expect(c.id).toBe('c001')
    expect(c.parent_id).toBeNull()
    expect(c.discussion_id).toBe('c001')
    expect(c.author).toBe('human')
    expect(c.type).toBe('comment')
  })

  it('defaults to type "comment" but accepts an explicit type', () => {
    const c = addComment(dataDir, 'thread-1', { body: 'q', type: 'question' })
    expect(c.type).toBe('question')
  })

  it('stores a reply as a direct child of the discussion root', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    const reply = addComment(dataDir, 'thread-1', {
      body: 'reply',
      reply_to: root.id,
    })
    expect(reply.id).toBe('c002')
    expect(reply.discussion_id).toBe(root.id)
    expect(reply.parent_id).toBe(root.id)
  })

  it('collapses a reply-to-a-reply onto the discussion root (one level deep)', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    const reply = addComment(dataDir, 'thread-1', {
      body: 'reply',
      reply_to: root.id,
    })
    const nested = addComment(dataDir, 'thread-1', {
      body: 'nested',
      reply_to: reply.id,
    })
    expect(nested.discussion_id).toBe(root.id)
    expect(nested.parent_id).toBe(root.id)
  })

  it('throws NotFoundError for a missing thread', () => {
    expect(() => addComment(dataDir, 'thread-999', { body: 'x' })).toThrow(
      NotFoundError,
    )
  })

  it('throws NotFoundError when reply_to does not exist', () => {
    expect(() =>
      addComment(dataDir, 'thread-1', { body: 'x', reply_to: 'c999' }),
    ).toThrow(NotFoundError)
  })
})

describe('addAgentComment', () => {
  it('creates an agent-authored top-level discussion point', () => {
    const c = addAgentComment(dataDir, 'thread-1', {
      author: 'claude',
      body: 'agent point',
      type: 'critique',
    })
    expect(c.id).toBe('c001')
    expect(c.author).toBe('claude')
    expect(c.type).toBe('critique')
    expect(c.parent_id).toBeNull()
  })

  it('creates an agent-authored reply under the discussion root', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    const reply = addAgentComment(dataDir, 'thread-1', {
      author: 'codex',
      body: 'agent reply',
      reply_to: root.id,
    })
    expect(reply.id).toBe('c002')
    expect(reply.author).toBe('codex')
    expect(reply.discussion_id).toBe(root.id)
    expect(reply.parent_id).toBe(root.id)
  })
})

describe('listComments', () => {
  it('returns [] for a thread with no comments', () => {
    expect(listComments(dataDir, 'thread-1')).toEqual([])
  })

  it('returns comments in insertion order', () => {
    addComment(dataDir, 'thread-1', { body: 'one' })
    addComment(dataDir, 'thread-1', { body: 'two' })
    expect(listComments(dataDir, 'thread-1').map((c) => c.id)).toEqual([
      'c001',
      'c002',
    ])
  })
})
