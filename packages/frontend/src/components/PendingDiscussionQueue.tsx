import { useState, type FormEvent } from 'react'
import type { CommentType, PendingDiscussion } from '@roundtable/shared'
import {
  approvePendingDiscussion,
  editPendingDiscussion,
  rejectPendingDiscussion,
} from '../api'

const TYPES: CommentType[] = ['comment', 'proposal', 'critique', 'question', 'decision']

export function PendingDiscussionQueue({
  threadId,
  discussions,
  onUpdate,
}: {
  threadId: string
  discussions: PendingDiscussion[]
  onUpdate: () => void
}) {
  if (discussions.length === 0) {
    return <p>No pending discussions.</p>
  }

  return (
    <ul>
      {discussions.map((discussion) => (
        <li key={discussion.id}>
          <PendingDiscussionModerationCard
            threadId={threadId}
            discussion={discussion}
            onUpdate={onUpdate}
          />
        </li>
      ))}
    </ul>
  )
}

export function PendingDiscussionModerationCard({
  threadId,
  discussion,
  originExcerpt,
  onUpdate,
}: {
  threadId: string
  discussion: PendingDiscussion
  originExcerpt?: string | null
  onUpdate: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editType, setEditType] = useState<CommentType>('comment')

  async function handleApprove(id: string) {
    await approvePendingDiscussion(threadId, id)
    onUpdate()
  }

  async function handleReject(id: string) {
    await rejectPendingDiscussion(threadId, id)
    onUpdate()
  }

  function startEdit(discussion: PendingDiscussion) {
    setEditing(discussion.id)
    setEditBody(discussion.body)
    setEditType(discussion.type)
  }

  async function handleEdit(event: FormEvent, id: string) {
    event.preventDefault()
    await editPendingDiscussion(threadId, id, { body: editBody, type: editType })
    setEditing(null)
    onUpdate()
  }

  return (
    <article className="pending-card" aria-label="pending new discussion moderation">
      <header>Pending new discussion</header>
      {originExcerpt ? (
        <p className="pending-origin">Proposed from: {originExcerpt}</p>
      ) : null}
      {editing === discussion.id ? (
        <form
          onSubmit={(event) => handleEdit(event, discussion.id)}
          aria-label={`edit ${discussion.id}`}
        >
          <textarea
            aria-label="edit body"
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
          />
          <select
            aria-label="edit type"
            value={editType}
            onChange={(event) => setEditType(event.target.value as CommentType)}
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button type="submit">Save</button>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <p>{discussion.body}</p>
          <small>
            {discussion.author} - {discussion.type}
          </small>
          <div className="inline-actions">
            <button type="button" onClick={() => handleApprove(discussion.id)}>
              Approve
            </button>
            <button type="button" onClick={() => startEdit(discussion)}>
              Edit
            </button>
            <button type="button" onClick={() => handleReject(discussion.id)}>
              Reject
            </button>
          </div>
        </>
      )}
    </article>
  )
}
