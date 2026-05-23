import { describe, it, expect } from 'vitest'
import type { Comment } from '@roundtable/shared'
import { groupComments } from './commentTree'

function comment(id: string, parent_id: string | null, discussion_id: string): Comment {
  return {
    id,
    thread_id: 'thread-1',
    discussion_id,
    parent_id,
    author: 'human',
    type: 'comment',
    body: id,
    origin_discussion_id: null,
    origin_comment_id: null,
    approved_from_pending_id: null,
    created_at: '2026-05-23T00:00:00Z',
  }
}

describe('groupComments', () => {
  it('returns [] for no comments', () => {
    expect(groupComments([])).toEqual([])
  })

  it('groups replies under their discussion root', () => {
    const comments = [
      comment('c001', null, 'c001'),
      comment('c002', 'c001', 'c001'),
      comment('c003', null, 'c003'),
    ]
    const groups = groupComments(comments)
    expect(groups).toHaveLength(2)
    expect(groups[0].root.id).toBe('c001')
    expect(groups[0].replies.map((r) => r.id)).toEqual(['c002'])
    expect(groups[1].root.id).toBe('c003')
    expect(groups[1].replies).toEqual([])
  })

  it('orders roots and replies by id', () => {
    const comments = [
      comment('c003', null, 'c003'),
      comment('c001', null, 'c001'),
      comment('c004', 'c001', 'c001'),
      comment('c002', 'c001', 'c001'),
    ]
    const groups = groupComments(comments)
    expect(groups.map((g) => g.root.id)).toEqual(['c001', 'c003'])
    expect(groups[0].replies.map((r) => r.id)).toEqual(['c002', 'c004'])
  })
})
