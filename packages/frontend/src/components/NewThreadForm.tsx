import { useState } from 'react'
import type { Thread } from '@roundtable/shared'
import { createThread } from '../api'

export function NewThreadForm({ onCreated }: { onCreated: (thread: Thread) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setSubmitting(true)
    try {
      const thread = await createThread({ title, body })
      setTitle('')
      setBody('')
      onCreated(thread)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="new-thread">
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
