import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SavedOutput, ThreadDetail } from '@roundtable/shared'
import { getSavedOutput, getThread } from '../api'
import { Icon } from '../components/primitives'
import { ThemeToggle } from '../components/ThemeToggle'

function formatSavedDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function SavedOutputPage() {
  const { savedId } = useParams<{ savedId: string }>()
  const [saved, setSaved] = useState<SavedOutput | null>(null)
  const [sourceThread, setSourceThread] = useState<ThreadDetail | null>(null)

  useEffect(() => {
    if (!savedId) return
    getSavedOutput(savedId).then((next) => {
      setSaved(next)
      getThread(next.source_thread_id).then(setSourceThread)
    })
  }, [savedId])

  if (!saved) {
    return (
      <main className="saved-output-page">
        <div className="saved-output-shell" aria-label="Loading saved output" aria-busy="true">
          <span className="sk" style={{ width: 112, height: 12 }} />
          <span className="sk" style={{ width: '58%', height: 42 }} />
          <span className="sk" style={{ width: '100%', height: 280, borderRadius: 8 }} />
        </div>
      </main>
    )
  }

  const savedDate = formatSavedDate(saved.created_at)

  return (
    <div className="saved-output-page">
      <header className="workspace-header" aria-label="saved output header">
        <Link
          to={`/threads/${saved.source_thread_id}`}
          className="workspace-back"
          aria-label="Back to source thread"
          title="Back to source thread"
        >
          <Icon name="arrowLeft" className="ic" />
        </Link>

        <Link to="/" className="workspace-brand" aria-label="Roundtable home">
          <span className="workspace-brand__dot" />
          <span>Roundtable</span>
        </Link>

        <div className="workspace-header__title">
          <div className="workspace-crumbs">
            <Link to="/">threads</Link>
            <span>/</span>
            <Link to={`/threads/${saved.source_thread_id}`}>
              {sourceThread?.title ?? saved.source_thread_id}
            </Link>
            <span>/</span>
            <strong>saved output</strong>
          </div>
        </div>

        <div className="workspace-header__badges">
          <ThemeToggle />
        </div>
      </header>

      <main className="saved-output-main">
        <article className="saved-output-shell">
          <header className="saved-output-header">
            <div className="source-eyebrow">
              <span className="eyebrow tight">Saved output</span>
              <span style={{ color: 'var(--rule-strong)' }}>·</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                output.md
              </span>
              {savedDate ? (
                <>
                  <span style={{ color: 'var(--rule-strong)' }}>·</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{savedDate}</span>
                </>
              ) : null}
            </div>
            <div className="saved-output-title-row">
              <h1 className="source-title">{saved.title}</h1>
              <Link to={`/threads/${saved.source_thread_id}`} className="source-saved-link">
                <Icon name="arrowLeft" className="ic-sm" />
                Source thread
              </Link>
            </div>
            <p className="saved-output-subtitle">
              Final saved revision from{' '}
              <Link to={`/threads/${saved.source_thread_id}`}>
                {sourceThread?.title ?? saved.source_thread_id}
              </Link>
            </p>
          </header>

          <section className="saved-output-body" aria-label="saved-output-body">
            <Markdown remarkPlugins={[remarkGfm]}>{saved.body}</Markdown>
          </section>
        </article>
      </main>
    </div>
  )
}
