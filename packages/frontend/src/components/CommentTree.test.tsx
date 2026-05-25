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
    approved_from_pending_id: null,
    created_at: '2026-05-23T00:00:00Z',
  }
}

describe('CommentTree', () => {
  it('renders discussion roots with their replies', () => {
    const comments = [
      comment('c001', null, '**root** point'),
      comment('c002', 'c001', '- a reply'),
    ]
    render(
      <CommentTree
        threadId="thread-1"
        comments={comments}
        onPendingUpdate={vi.fn()}
        onReply={vi.fn()}
        onAskDiscussion={vi.fn()}
      />,
    )
    expect(screen.getByText('root')).toHaveProperty('tagName', 'STRONG')
    expect(screen.getByText('a reply')).toHaveProperty('tagName', 'LI')
    const expectedTimestamp = new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date('2026-05-23T00:00:00Z'))
    const timestamps = screen.getAllByText(expectedTimestamp)
    expect(timestamps).toHaveLength(2)
    expect(timestamps[0]).toHaveAttribute('datetime', '2026-05-23T00:00:00Z')
  })

  it('shows an empty-state message when there are no comments', () => {
    render(
      <CommentTree
        threadId="thread-1"
        comments={[]}
        onPendingUpdate={vi.fn()}
        onReply={vi.fn()}
        onAskDiscussion={vi.fn()}
      />,
    )
    expect(screen.getByText(/no discussion yet/i)).toBeInTheDocument()
  })

  it('disables agent actions during auto discussion while keeping reply available', () => {
    render(
      <CommentTree
        threadId="thread-1"
        comments={[comment('c001', null, 'root point')]}
        onPendingUpdate={vi.fn()}
        onReply={vi.fn()}
        onAskDiscussion={vi.fn()}
        disableAgentActions
      />,
    )

    expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ask Claude' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ask Codex' })).toBeDisabled()
  })
})
