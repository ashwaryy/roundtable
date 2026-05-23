import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Comment } from '@roundtable/shared'
import { CommentTree } from './CommentTree'

function comment(id: string, parent_id: string | null, body: string): Comment {
  return {
    id,
    thread_id: 'thread-1',
    discussion_id: parent_id ?? id,
    parent_id,
    author: 'human',
    type: 'comment',
    body,
    origin_discussion_id: null,
    origin_comment_id: null,
    created_at: '2026-05-23T00:00:00Z',
  }
}

describe('CommentTree', () => {
  it('renders discussion roots with their replies', () => {
    const comments = [
      comment('c001', null, 'root point'),
      comment('c002', 'c001', 'a reply'),
    ]
    render(<CommentTree comments={comments} onReply={vi.fn()} />)
    expect(screen.getByText('root point')).toBeInTheDocument()
    expect(screen.getByText('a reply')).toBeInTheDocument()
  })

  it('shows an empty-state message when there are no comments', () => {
    render(<CommentTree comments={[]} onReply={vi.fn()} />)
    expect(screen.getByText(/no discussion yet/i)).toBeInTheDocument()
  })
})
