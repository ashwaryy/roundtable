import { useEffect, useRef, useState } from 'react'
import type { CommentType } from '@roundtable/shared'
import { Icon } from './primitives'

const TYPES: CommentType[] = ['comment', 'proposal', 'critique', 'question', 'decision']

function draftKey(threadId: string, ctx: string) {
  return `rt:draft:${threadId}:${ctx}`
}

function placeholderFor(type: CommentType): string {
  switch (type) {
    case 'question':
      return 'Ask a question…'
    case 'proposal':
      return 'Propose a change…'
    case 'critique':
      return 'Push back on something…'
    case 'decision':
      return 'Record a decision…'
    default:
      return 'Add a discussion point…'
  }
}

function compactPlaceholder(): string {
  return 'Add a comment...'
}

export function CommentForm({
  label,
  threadId,
  draftContext = 'root',
  compact = false,
  autoFocus = false,
  onCancel,
  onSubmit,
}: {
  label: string
  threadId: string
  draftContext?: string
  compact?: boolean
  autoFocus?: boolean
  onCancel?: () => void
  onSubmit: (input: { body: string; type: CommentType }) => Promise<void>
}) {
  const key = draftKey(threadId, draftContext)

  const [body, setBody] = useState(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const [type, setType] = useState<CommentType>('comment')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      if (body) {
        localStorage.setItem(key, body)
      } else {
        localStorage.removeItem(key)
      }
    } catch {}
  }, [key, body])

  async function submit() {
    if (!body.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ body, type })
      setBody('')
      setType('comment')
      try {
        localStorage.removeItem(key)
      } catch {}
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submit()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={label}
      className={`composer ${compact ? 'compact' : ''}`}
    >
      {!compact ? (
        <div className="composer-type-row">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`composer-type-chip type-${t} ${type === t ? 'on' : ''}`}
              onClick={() => setType(t)}
              disabled={submitting}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="composer-textarea"
        aria-label={`${label} body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={compact ? compactPlaceholder() : placeholderFor(type)}
        autoFocus={autoFocus}
        disabled={submitting}
        rows={compact ? 2 : 3}
      />
      <div className="composer-foot">
        <div className="left">
          <span>
            posting as <b style={{ color: 'var(--you)' }}>you</b> · drafts saved locally
          </span>
        </div>
        <div className="right">
          <span style={{ color: 'var(--muted)' }}>
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd" style={{ marginLeft: 4 }}>↵</kbd>
            <span style={{ marginLeft: 6 }}>send</span>
          </span>
          {onCancel ? (
            <button type="button" className="btn sm ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="btn sm primary" disabled={submitting || !body.trim()}>
            {submitting ? (
              <span className="button-loading">
                <span className="button-spinner" aria-hidden="true" />
                Sending
              </span>
            ) : (
              <>
                <Icon name="send" className="ic-sm" /> {label}
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  )
}
