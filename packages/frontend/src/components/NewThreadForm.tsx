import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SnapshotReport, Thread, ThreadContext } from '@roundtable/shared'
import { createThread, getThreadContext, listSnapshotReports } from '../api'
import { ThreadContextPanel } from './ThreadContextPanel'

export function NewThreadForm({ onCreated }: { onCreated: (thread: Thread) => void }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdThread, setCreatedThread] = useState<Thread | null>(null)
  const [context, setContext] = useState<ThreadContext | null>(null)
  const [reports, setReports] = useState<SnapshotReport[]>([])
  const [snapshotSelected, setSnapshotSelected] = useState(false)

  async function refreshContext(threadId: string) {
    const [nextContext, nextReports] = await Promise.all([
      getThreadContext(threadId),
      listSnapshotReports(threadId),
    ])
    setContext(nextContext)
    setReports(nextReports)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setSubmitting(true)
    try {
      const thread = await createThread({ title, body })
      setTitle('')
      setBody('')
      setCreatedThread(thread)
      onCreated(thread)
      await refreshContext(thread.id)
    } finally {
      setSubmitting(false)
    }
  }

  if (createdThread) {
    return (
      <div className="setup-flow" aria-label="add-context">
        <div className="section-heading">
          <h3>Step 2: Add context</h3>
          <span>Optional</span>
        </div>
        <ThreadContextPanel
          threadId={createdThread.id}
          threadStatus="open"
          context={context}
          reports={reports}
          onSnapshotSelectionChange={setSnapshotSelected}
          onUpdate={() => refreshContext(createdThread.id)}
        />
        {snapshotSelected && !context?.snapshot ? (
          <p className="empty-state">
            Confirm the project snapshot before continuing, or continue without context.
          </p>
        ) : null}
        <div className="setup-actions">
          <button
            type="button"
            disabled={snapshotSelected && !context?.snapshot}
            onClick={() => navigate(`/threads/${createdThread.id}`)}
          >
            Continue to thread
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => navigate(`/threads/${createdThread.id}`)}
          >
            Continue without context
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} aria-label="new-thread">
      <div className="section-heading">
        <h3>Step 1: Source thread</h3>
      </div>
      <input
        aria-label="title"
        placeholder="Thread title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        aria-label="body"
        placeholder="Body / plan / idea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button type="submit" disabled={submitting}>
        Create thread
      </button>
    </form>
  )
}
