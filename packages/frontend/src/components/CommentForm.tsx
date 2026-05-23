import { useState } from 'react'
import type { CommentType } from '@roundtable/shared'

const TYPES: CommentType[] = ['comment', 'proposal', 'critique', 'question', 'decision']

export function CommentForm({
  label,
  onSubmit,
}: {
  label: string
  onSubmit: (input: { body: string; type: CommentType }) => Promise<void>
}) {
  const [body, setBody] = useState('')
  const [type, setType] = useState<CommentType>('comment')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ body, type })
      setBody('')
      setType('comment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={label}>
      <textarea
        aria-label={`${label} body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <select
        aria-label={`${label} type`}
        value={type}
        onChange={(e) => setType(e.target.value as CommentType)}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button type="submit" disabled={submitting}>
        {label}
      </button>
    </form>
  )
}
