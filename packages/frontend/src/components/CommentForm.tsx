import { useEffect, useRef, useState } from 'react'
import type { CommentType } from '@roundtable/shared'

const TYPES: CommentType[] = ['comment', 'proposal', 'critique', 'question', 'decision']

function draftKey(threadId: string, ctx: string) {
  return `rt:draft:${threadId}:${ctx}`
}

export function CommentForm({
  label,
  threadId,
  draftContext = 'root',
  compact = false,
  onSubmit,
}: {
  label: string
  threadId: string
  draftContext?: string
  compact?: boolean
  onSubmit: (input: { body: string; type: CommentType }) => Promise<void>
}) {
  const key = draftKey(threadId, draftContext)

  const [body, setBody] = useState(() => {
    try { return localStorage.getItem(key) ?? '' } catch { return '' }
  })
  const [type, setType] = useState<CommentType>('comment')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      if (body) { localStorage.setItem(key, body) }
      else { localStorage.removeItem(key) }
    } catch {}
  }, [key, body])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ body, type })
      setBody('')
      setType('comment')
      try { localStorage.removeItem(key) } catch {}
    } finally {
      setSubmitting(false)
    }
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} aria-label={label} style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            style={{ minHeight: 32, maxHeight: 120 }}
            aria-label={`${label} body`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Reply…"
            rows={1}
          />
          <button type="submit" disabled={submitting || !body.trim()} className="composer-submit">
            {submitting
              ? <span className="button-loading"><span className="button-spinner" aria-hidden="true" />…</span>
              : 'Send'
            }
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`composer-type-chip composer-type-chip--${t} ${type === t ? 'composer-type-chip--active' : ''}`}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} aria-label={label} className="composer-form">
      <div className="composer-type-row">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`composer-type-chip composer-type-chip--${t} ${type === t ? 'composer-type-chip--active' : ''}`}
            onClick={() => setType(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="composer-row">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          aria-label={`${label} body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a discussion point…"
          rows={1}
        />
        <button type="submit" disabled={submitting || !body.trim()} className="composer-submit">
          {submitting ? (
            <span className="button-loading">
              <span className="button-spinner" aria-hidden="true" />
              Sending
            </span>
          ) : (
            label
          )}
        </button>
      </div>
    </form>
  )
}
