import { useState, type FormEvent } from 'react'
import type { CommentType, PendingDiscussion } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  approvePendingDiscussion,
  editPendingDiscussion,
  rejectPendingDiscussion,
} from '../api'
import { AgentAvatar } from './AgentAvatar'

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
    return <p className="empty-state">No pending discussions.</p>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {discussions.map((discussion) => (
        <PendingDiscussionModerationCard
          key={discussion.id}
          threadId={threadId}
          discussion={discussion}
          onUpdate={onUpdate}
        />
      ))}
    </div>
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
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(discussion.body)
  const [editType, setEditType] = useState<CommentType>(discussion.type)
  const [confirmingReject, setConfirmingReject] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorAction, setErrorAction] = useState<'approve' | 'reject' | null>(null)

  async function handleApprove() {
    setError(null)
    try {
      await approvePendingDiscussion(threadId, discussion.id)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
      setErrorAction('approve')
    }
  }

  async function handleConfirmReject() {
    setError(null)
    try {
      await rejectPendingDiscussion(threadId, discussion.id)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject')
      setErrorAction('reject')
      setConfirmingReject(false)
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await editPendingDiscussion(threadId, discussion.id, { body: editBody, type: editType })
      setEditing(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <div
      className="pending-block"
      aria-label="pending discussion awaiting approval"
    >
      <div className="pending-block__label">
        <AgentAvatar author={discussion.author} size={20} />
        <span className="pending-block__author">{discussion.author}</span>
        <span className="pending-awaiting-badge">Awaiting approval</span>
        {discussion.type !== 'comment' ? (
          <span className={`type-badge type-badge--${discussion.type}`}>{discussion.type}</span>
        ) : null}
      </div>

      {originExcerpt ? (
        <div className="pending-block__origin">Proposed from: {originExcerpt}</div>
      ) : null}

      {editing ? (
        <form onSubmit={handleEdit} aria-label={`edit pending ${discussion.id}`}>
          <textarea
            aria-label="edit body"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <select
            aria-label="edit type"
            value={editType}
            onChange={(e) => setEditType(e.target.value as CommentType)}
            style={{ marginBottom: 8 }}
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="pending-block__actions">
            <button type="submit" className="btn-approve">Save</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div className="pending-block__body">
            <Markdown remarkPlugins={[remarkGfm]}>{discussion.body}</Markdown>
          </div>

          {confirmingReject ? (
            <div className="reject-confirm">
              <span className="reject-confirm__label">Remove this pending discussion?</span>
              <button type="button" className="btn-destructive" onClick={handleConfirmReject}>Remove</button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmingReject(false)}>Cancel</button>
            </div>
          ) : (
            <div className="pending-block__actions">
              <button type="button" className="btn-approve" onClick={handleApprove}>Approve</button>
              <button
                type="button"
                onClick={() => { setEditing(true); setError(null) }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-destructive"
                style={{ background: 'transparent', borderColor: 'transparent' }}
                onClick={() => setConfirmingReject(true)}
              >
                Reject
              </button>
            </div>
          )}
        </>
      )}

      {error ? (
        <div className="pending-block__error" role="alert">
          <span>{error}</span>
          {errorAction === 'approve' && (
            <button type="button" style={{ fontSize: '0.8125rem' }} onClick={handleApprove}>Retry</button>
          )}
          {errorAction === 'reject' && (
            <button type="button" style={{ fontSize: '0.8125rem' }} onClick={() => setConfirmingReject(true)}>Retry</button>
          )}
        </div>
      ) : null}
    </div>
  )
}
