import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Comment, PendingDiscussion } from '@roundtable/shared'
import { PendingDiscussionQueue } from './PendingDiscussionQueue'
import * as api from '../api'

vi.mock('../api')

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

function makePending(id: string, body: string): PendingDiscussion {
  return {
    id,
    thread_id: 'thread-1',
    author: 'claude',
    type: 'critique',
    body,
    origin_discussion_id: null,
    origin_comment_id: null,
    created_at: '2026-05-23T00:00:00Z',
  }
}

function makeComment(id: string): Comment {
  return {
    id,
    thread_id: 'thread-1',
    discussion_id: id,
    parent_id: null,
    author: 'claude',
    type: 'critique',
    body: 'approved body',
    origin_discussion_id: null,
    origin_comment_id: null,
    approved_from_pending_id: 'pd001',
    created_at: '2026-05-23T00:00:00Z',
  }
}

describe('PendingDiscussionQueue', () => {
  it('shows a no-pending message when the list is empty', () => {
    render(
      <PendingDiscussionQueue
        threadId="thread-1"
        discussions={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText(/no pending/i)).toBeInTheDocument()
  })

  it('renders each pending discussion body', () => {
    render(
      <PendingDiscussionQueue
        threadId="thread-1"
        discussions={[makePending('pd001', 'needs its own thread')]}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText('needs its own thread')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
  })

  it('calls approvePendingDiscussion and onUpdate when Approve is clicked', async () => {
    const onUpdate = vi.fn()
    mockedApi.approvePendingDiscussion.mockResolvedValue(makeComment('c001'))

    render(
      <PendingDiscussionQueue
        threadId="thread-1"
        discussions={[makePending('pd001', 'approve me')]}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(mockedApi.approvePendingDiscussion).toHaveBeenCalledWith(
      'thread-1',
      'pd001',
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('calls rejectPendingDiscussion and onUpdate when Reject is clicked', async () => {
    const onUpdate = vi.fn()
    mockedApi.rejectPendingDiscussion.mockResolvedValue(undefined)

    render(
      <PendingDiscussionQueue
        threadId="thread-1"
        discussions={[makePending('pd001', 'reject me')]}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(mockedApi.rejectPendingDiscussion).toHaveBeenCalledWith(
      'thread-1',
      'pd001',
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('shows an edit form when Edit is clicked', async () => {
    render(
      <PendingDiscussionQueue
        threadId="thread-1"
        discussions={[makePending('pd001', 'original body')]}
        onUpdate={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByRole('textbox', { name: /edit body/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('submits the edit form and calls onUpdate', async () => {
    const onUpdate = vi.fn()
    mockedApi.editPendingDiscussion.mockResolvedValue({
      ...makePending('pd001', 'original body'),
      body: 'revised body',
    })

    render(
      <PendingDiscussionQueue
        threadId="thread-1"
        discussions={[makePending('pd001', 'original body')]}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const textarea = screen.getByRole('textbox', { name: /edit body/i })
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'revised body')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(mockedApi.editPendingDiscussion).toHaveBeenCalledWith(
      'thread-1',
      'pd001',
      expect.objectContaining({ body: 'revised body' }),
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })
})
