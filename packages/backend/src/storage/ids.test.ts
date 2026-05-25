import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Comment, PendingDiscussion } from '@roundtable/shared'
import { nextThreadId, nextCommentId, nextPendingDiscussionId } from './ids'
import { threadsDir } from './paths'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ids-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    thread_id: 'thread-1',
    discussion_id: id,
    parent_id: null,
    author: 'human',
    type: 'comment',
    body: 'b',
    origin_discussion_id: null,
    origin_comment_id: null,
    approved_from_pending_id: null,
    created_at: '2026-05-23T00:00:00Z',
    ...overrides,
  }
}

function pending(id: string): PendingDiscussion {
  return {
    id,
    thread_id: 'thread-1',
    author: 'claude',
    type: 'comment',
    body: 'b',
    origin_discussion_id: null,
    origin_comment_id: null,
    created_at: '2026-05-23T00:00:00Z',
  }
}

describe('nextThreadId', () => {
  it('returns thread-1 when no threads exist', () => {
    expect(nextThreadId(dataDir)).toBe('thread-1')
  })

  it('returns max + 1 based on existing thread dirs', () => {
    fs.mkdirSync(path.join(threadsDir(dataDir), 'thread-1'), { recursive: true })
    fs.mkdirSync(path.join(threadsDir(dataDir), 'thread-4'), { recursive: true })
    expect(nextThreadId(dataDir)).toBe('thread-5')
  })

  it('ignores non-matching directory names', () => {
    fs.mkdirSync(path.join(threadsDir(dataDir), 'thread-2'), { recursive: true })
    fs.mkdirSync(path.join(threadsDir(dataDir), 'notes'), { recursive: true })
    expect(nextThreadId(dataDir)).toBe('thread-3')
  })
})

describe('nextCommentId', () => {
  it('returns c001 for an empty list', () => {
    expect(nextCommentId([])).toBe('c001')
  })

  it('returns the next zero-padded id', () => {
    expect(nextCommentId([comment('c001'), comment('c002')])).toBe('c003')
  })
})

describe('nextPendingDiscussionId', () => {
  it('returns pd001 for an empty list', () => {
    expect(nextPendingDiscussionId([])).toBe('pd001')
  })

  it('returns the next zero-padded id', () => {
    expect(nextPendingDiscussionId([pending('pd001'), pending('pd002')])).toBe(
      'pd003',
    )
  })

  it('does not reuse ids referenced by approved comments', () => {
    expect(
      nextPendingDiscussionId([], [
        comment('c001', { approved_from_pending_id: 'pd004' }),
      ]),
    ).toBe('pd005')
  })
})
