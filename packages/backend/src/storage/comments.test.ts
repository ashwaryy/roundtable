import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createThread } from './threads'
import { listComments, addComment, addAgentComment, deleteComment } from './comments'
import { NotFoundError } from './errors'
import { commentsPath } from './paths'

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

  it('reuses the in-memory reply cache after the first reply lookup', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    const filePath = commentsPath(dataDir, 'thread-1')
    const originalReadFileSync = fs.readFileSync
    let commentFileReads = 0
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((file, options) => {
      if (file === filePath) commentFileReads += 1
      return originalReadFileSync.call(fs, file as Parameters<typeof fs.readFileSync>[0], options as Parameters<typeof fs.readFileSync>[1])
    }) as typeof fs.readFileSync)

    try {
      const reply = addComment(dataDir, 'thread-1', { body: 'reply', reply_to: root.id })
      expect(commentFileReads).toBe(1)

      const nested = addComment(dataDir, 'thread-1', {
        body: 'nested',
        reply_to: reply.id,
      })

      expect(commentFileReads).toBe(1)
      expect(nested.discussion_id).toBe(root.id)
    } finally {
      readSpy.mockRestore()
    }
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

describe('deleteComment', () => {
  it('deletes a reply without deleting the discussion root', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    const reply = addComment(dataDir, 'thread-1', {
      body: 'reply',
      reply_to: root.id,
    })

    deleteComment(dataDir, 'thread-1', reply.id)

    expect(listComments(dataDir, 'thread-1').map((c) => c.id)).toEqual([root.id])
  })

  it('deletes a top-level discussion and its replies', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    addComment(dataDir, 'thread-1', { body: 'reply', reply_to: root.id })
    const other = addComment(dataDir, 'thread-1', { body: 'other root' })

    deleteComment(dataDir, 'thread-1', root.id)

    expect(listComments(dataDir, 'thread-1').map((c) => c.id)).toEqual([other.id])
  })

  it('clears the reply cache on delete so later replies rebuild against disk', () => {
    const root = addComment(dataDir, 'thread-1', { body: 'root' })
    const reply = addComment(dataDir, 'thread-1', { body: 'reply', reply_to: root.id })
    deleteComment(dataDir, 'thread-1', reply.id)

    const filePath = commentsPath(dataDir, 'thread-1')
    const originalReadFileSync = fs.readFileSync
    let commentFileReads = 0
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((file, options) => {
      if (file === filePath) commentFileReads += 1
      return originalReadFileSync.call(fs, file as Parameters<typeof fs.readFileSync>[0], options as Parameters<typeof fs.readFileSync>[1])
    }) as typeof fs.readFileSync)

    try {
      const rebuilt = addAgentComment(dataDir, 'thread-1', {
        author: 'codex',
        body: 'rebuilt',
        reply_to: root.id,
      })

      expect(commentFileReads).toBe(1)
      expect(rebuilt.discussion_id).toBe(root.id)
    } finally {
      readSpy.mockRestore()
    }
  })

  it('throws NotFoundError for a missing comment', () => {
    expect(() => deleteComment(dataDir, 'thread-1', 'c999')).toThrow(NotFoundError)
  })
})
