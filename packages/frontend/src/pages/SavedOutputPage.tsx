import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import { getSavedOutput, getThread } from '../api'
import { WorkspaceHeader } from '../components/AppHeader'
import { SavedOutputSkeleton } from '../components/SavedOutputSkeleton'
import { Icon } from '../components/primitives'
import { REMARK_PLUGINS } from '../lib/markdown'
import { roundtableQueryKeys } from '../query'
import { ThemeToggle } from '../components/ThemeToggle'
import { useLiveRefresh } from '../useLiveRefresh'

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
  const backendStatus = useLiveRefresh(() => {})
  const { savedId } = useParams<{ savedId: string }>()
  const { data: saved } = useQuery({
    queryKey: savedId
      ? roundtableQueryKeys.savedOutputs.detail(savedId)
      : roundtableQueryKeys.savedOutputs.detail('missing'),
    queryFn: () => getSavedOutput(savedId!),
    enabled: Boolean(savedId),
  })
  const { data: sourceThread } = useQuery({
    queryKey: saved
      ? roundtableQueryKeys.threads.detail(saved.source_thread_id)
      : roundtableQueryKeys.threads.detail('missing'),
    queryFn: () => getThread(saved!.source_thread_id),
    enabled: Boolean(saved?.source_thread_id),
  })

  if (!saved) {
    return <SavedOutputSkeleton />
  }

  const savedDate = formatSavedDate(saved.created_at)

  return (
    <div className="workspace-root saved-output-page saved-output-workspace">
      <WorkspaceHeader
        ariaLabel="saved output header"
        backTo={`/threads/${saved.source_thread_id}`}
        backLabel="Back to source thread"
        backTitle="Back to source thread"
        backendStatus={backendStatus}
        title={
          <div className="workspace-crumbs">
            <Link to="/">threads</Link>
            <span>/</span>
            <Link to={`/threads/${saved.source_thread_id}`}>
              {sourceThread?.title ?? saved.source_thread_id}
            </Link>
            <span>/</span>
            <strong>saved output</strong>
          </div>
        }
        actions={
          <ThemeToggle />
        }
      />

      <div className="workspace-body">
        <main className="workspace-main saved-output-main" aria-label="saved output">
          <article className="saved-output-shell">
            <section className="source saved-output-source">
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
              <div className="source-title-row">
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
            </section>

            <section className="source-body saved-output-body" aria-label="saved-output-body">
              <Markdown remarkPlugins={REMARK_PLUGINS}>{saved.body}</Markdown>
            </section>
          </article>
        </main>
      </div>
    </div>
  )
}
