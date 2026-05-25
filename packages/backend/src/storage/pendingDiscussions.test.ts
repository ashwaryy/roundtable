import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createThread } from './threads'
import { listComments } from './comments'
import { appendJsonl } from './jsonl'
import { commentsPath, pendingDiscussionsPath } from './paths'
import {
  listPendingDiscussions,
  addPendingDiscussion,
  approvePendingDiscussion,
  editPendingDiscussion,
  rejectPendingDiscussion,
} from './pendingDiscussions'
import { NotFoundError } from './errors'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pending-'))
  createThread(dataDir, { title: 'T', body: 'body' })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('listPendingDiscussions', () => {
  it('returns [] for a thread with no pending discussions', () => {
    expect(listPendingDiscussions(dataDir, 'thread-1')).toEqual([])
  })
})

describe('addPendingDiscussion', () => {
  it('creates a pending discussion with generated id and timestamp', () => {
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      type: 'critique',
      body: 'this needs a new root',
      origin_discussion_id: null,
      origin_comment_id: null,
    })
    expect(discussion.id).toBe('pd001')
    expect(discussion.thread_id).toBe('thread-1')
    expect(discussion.author).toBe('claude')
    expect(discussion.type).toBe('critique')
    expect(discussion.body).toBe('this needs a new root')
    expect(typeof discussion.created_at).toBe('string')
  })

  it('defaults type to "comment" when not provided', () => {
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'codex',
      body: 'a suggestion',
    })
    expect(discussion.type).toBe('comment')
  })

  it('assigns incrementing ids', () => {
    const a = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      body: 'a',
    })
    const b = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'codex',
      body: 'b',
    })
    expect(a.id).toBe('pd001')
    expect(b.id).toBe('pd002')
  })

  it('does not reuse an id after its pending discussion is approved', () => {
    const approved = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      body: 'approved',
    })
    approvePendingDiscussion(dataDir, 'thread-1', approved.id)

    const next = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'codex',
      body: 'new pending item',
    })

    expect(next.id).toBe('pd002')
  })

  it('throws NotFoundError for a missing thread', () => {
    expect(() =>
      addPendingDiscussion(dataDir, 'thread-999', { author: 'claude', body: 'x' }),
    ).toThrow(NotFoundError)
  })
})

describe('approvePendingDiscussion', () => {
  it('moves the pending discussion to comments and removes it from pending', () => {
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      type: 'critique',
      body: 'should be a new discussion root',
      origin_discussion_id: 'c001',
      origin_comment_id: 'c004',
    })

    const comment = approvePendingDiscussion(dataDir, 'thread-1', discussion.id)

    expect(comment.id).toBe('c001')
    expect(comment.author).toBe('claude')
    expect(comment.type).toBe('critique')
    expect(comment.body).toBe('should be a new discussion root')
    expect(comment.parent_id).toBeNull()
    expect(comment.discussion_id).toBe('c001')
    expect(comment.origin_discussion_id).toBe('c001')
    expect(comment.origin_comment_id).toBe('c004')
    expect(comment.approved_from_pending_id).toBe(discussion.id)
    expect(listPendingDiscussions(dataDir, 'thread-1')).toHaveLength(0)
    expect(listComments(dataDir, 'thread-1')).toHaveLength(1)
  })

  it('assigns the next comment id after existing comments', () => {
    addPendingDiscussion(dataDir, 'thread-1', { author: 'claude', body: 'first' })
    addPendingDiscussion(dataDir, 'thread-1', { author: 'codex', body: 'second' })
    approvePendingDiscussion(dataDir, 'thread-1', 'pd001')
    const second = approvePendingDiscussion(dataDir, 'thread-1', 'pd002')
    expect(second.id).toBe('c002')
  })

  it('is idempotent after an interrupted approval', () => {
    addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      body: 'almost approved',
    })
    appendJsonl(commentsPath(dataDir, 'thread-1'), {
      id: 'c001',
      thread_id: 'thread-1',
      discussion_id: 'c001',
      parent_id: null,
      author: 'claude',
      type: 'comment',
      body: 'almost approved',
      origin_discussion_id: null,
      origin_comment_id: null,
      approved_from_pending_id: 'pd001',
      created_at: '2026-05-23T00:00:00Z',
    })

    const result = approvePendingDiscussion(dataDir, 'thread-1', 'pd001')

    expect(result.id).toBe('c001')
    expect(listComments(dataDir, 'thread-1')).toHaveLength(1)
    expect(listPendingDiscussions(dataDir, 'thread-1')).toHaveLength(0)
  })

  it('remaps and approves a legacy pending item that reused an approved id', () => {
    const first = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      body: 'J1',
    })
    approvePendingDiscussion(dataDir, 'thread-1', first.id)
    appendJsonl(pendingDiscussionsPath(dataDir, 'thread-1'), {
      id: 'pd001',
      thread_id: 'thread-1',
      author: 'claude',
      type: 'question',
      body: 'J3',
      origin_discussion_id: 'c001',
      origin_comment_id: null,
      created_at: '2026-05-25T00:00:00Z',
    })

    const result = approvePendingDiscussion(dataDir, 'thread-1', 'pd001')

    expect(result.body).toBe('J3')
    expect(result.approved_from_pending_id).toBe('pd002')
    expect(listComments(dataDir, 'thread-1').map((comment) => comment.body)).toEqual([
      'J1',
      'J3',
    ])
    expect(listPendingDiscussions(dataDir, 'thread-1')).toHaveLength(0)
  })

  it('throws NotFoundError for a missing pending discussion id', () => {
    expect(() =>
      approvePendingDiscussion(dataDir, 'thread-1', 'pd999'),
    ).toThrow(NotFoundError)
  })
})

describe('editPendingDiscussion', () => {
  it('updates body and type in place', () => {
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'codex',
      type: 'comment',
      body: 'original body',
    })

    const updated = editPendingDiscussion(dataDir, 'thread-1', discussion.id, {
      body: 'revised body',
      type: 'question',
    })

    expect(updated.body).toBe('revised body')
    expect(updated.type).toBe('question')
    expect(updated.id).toBe(discussion.id)

    const list = listPendingDiscussions(dataDir, 'thread-1')
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('revised body')
  })

  it('updates body only when type is not provided', () => {
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      type: 'critique',
      body: 'original',
    })
    const updated = editPendingDiscussion(dataDir, 'thread-1', discussion.id, {
      body: 'changed',
    })
    expect(updated.body).toBe('changed')
    expect(updated.type).toBe('critique')
  })

  it('throws NotFoundError for a missing pending discussion id', () => {
    expect(() =>
      editPendingDiscussion(dataDir, 'thread-1', 'pd999', { body: 'x' }),
    ).toThrow(NotFoundError)
  })
})

describe('rejectPendingDiscussion', () => {
  it('removes the item from the queue', () => {
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'claude',
      body: 'to be rejected',
    })
    rejectPendingDiscussion(dataDir, 'thread-1', discussion.id)
    expect(listPendingDiscussions(dataDir, 'thread-1')).toHaveLength(0)
  })

  it('leaves other items intact', () => {
    addPendingDiscussion(dataDir, 'thread-1', { author: 'claude', body: 'keep' })
    const discussion = addPendingDiscussion(dataDir, 'thread-1', {
      author: 'codex',
      body: 'remove',
    })
    rejectPendingDiscussion(dataDir, 'thread-1', discussion.id)
    const remaining = listPendingDiscussions(dataDir, 'thread-1')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].body).toBe('keep')
  })

  it('throws NotFoundError for a missing pending discussion id', () => {
    expect(() =>
      rejectPendingDiscussion(dataDir, 'thread-1', 'pd999'),
    ).toThrow(NotFoundError)
  })
})
