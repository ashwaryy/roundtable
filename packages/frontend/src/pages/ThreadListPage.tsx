import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type {
  RoundtableEvent,
  ThreadDisplayStatus,
  ThreadListItem,
} from '@roundtable/shared'
import { deleteThread, listThreads } from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { NewThreadForm } from '../components/NewThreadForm'
import { Icon, StatusPill } from '../components/primitives'
import { ThemeToggle } from '../components/ThemeToggle'

function ThreadListSkeleton() {
  return (
    <div className="threads-list" aria-label="Loading threads" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="thread-row thread-row--skeleton">
          <span className="sk" style={{ width: 24, height: 12, justifySelf: 'end' }} />
          <div>
            <span className="sk" style={{ width: `${item === 1 ? 44 : 58}%`, height: 19, marginBottom: 8 }} />
            <div className="row-meta">
              <span className="sk" style={{ width: 64, height: 11 }} />
              <span className="sk" style={{ width: 48, height: 11 }} />
              <span className="sk" style={{ width: 42, height: 11 }} />
            </div>
          </div>
          <span className="sk" style={{ width: 78, height: 24, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  )
}

function ThreadFiltersSkeleton() {
  return (
    <div className="threads-filters-row" aria-label="Loading thread filters" aria-busy="true">
      <div className="threads-filters">
        {[46, 72, 104].map((width) => (
          <span
            key={width}
            className="sk filter-tab-skeleton"
            style={{ width, height: 26, borderRadius: 5 }}
          />
        ))}
      </div>
      <span className="sk" style={{ width: 52, height: 12 }} />
    </div>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  return `${weeks}w ago`
}

export function ThreadListPage() {
  const navigate = useNavigate()
  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [threadsLoaded, setThreadsLoaded] = useState(false)
  const [filter, setFilter] = useState<ThreadDisplayStatus | 'all'>('all')
  const [openMenuThreadId, setOpenMenuThreadId] = useState<string | null>(null)
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    listThreads()
      .then(setThreads)
      .finally(() => setThreadsLoaded(true))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onEvent = useCallback(
    (event: RoundtableEvent) => {
      if (
        event.type === 'thread_created' ||
        event.type === 'thread_deleted' ||
        event.type === 'room_updated' ||
        event.type === 'consolidation_updated' ||
        event.type === 'pending_discussion_created' ||
        event.type === 'pending_discussion_updated'
      ) {
        refresh()
      }
    },
    [refresh],
  )
  const backendStatus = useLiveRefresh(onEvent)
  const backendStatusLabel = `Backend ${backendStatus}`

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: threads.length }
    for (const thread of threads) {
      base[thread.display_status] = (base[thread.display_status] ?? 0) + 1
    }
    return base
  }, [threads])

  const visibleThreads =
    filter === 'all'
      ? threads
      : threads.filter((thread) => thread.display_status === filter)
  const totalPending = threads.reduce((n, thread) => n + thread.pending_count, 0)
  const activeCount = (counts.discussing ?? 0) + (counts.consolidating ?? 0)
  const attentionCount = (counts.needs_attention ?? 0) + (counts.error ?? 0)

  const filters: Array<{ id: ThreadDisplayStatus | 'all'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'discussing', label: 'Discussing' },
    { id: 'consolidating', label: 'Consolidating' },
    { id: 'setup', label: 'Setup' },
    { id: 'needs_attention', label: 'Needs attention' },
    { id: 'error', label: 'Error' },
    { id: 'closed', label: 'Closed' },
    { id: 'archived', label: 'Archived' },
  ]

  async function onDeleteThread(thread: ThreadListItem) {
    const confirmed = window.confirm(`Delete "${thread.title}"? This removes its local thread files.`)
    if (!confirmed) return
    setDeletingThreadId(thread.id)
    setOpenMenuThreadId(null)
    try {
      await deleteThread(thread.id)
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete thread')
    } finally {
      setDeletingThreadId(null)
    }
  }

  return (
    <>
    <header className="topbar">
      <div className="brand">
        <span
          className="dot"
          data-backend-status={backendStatus}
          aria-label={backendStatusLabel}
          title={backendStatusLabel}
        />
        <span>Roundtable</span>
      </div>
      <div className="spacer" />
      <div className="meta">
        <ThemeToggle />
      </div>
    </header>
    <main className="home-wrap">
      <header className="home-head">
        <div>
          <div className="eyebrow tight">Local forum</div>
          <h1 className="h-display">Roundtable.</h1>
        </div>
        {threadsLoaded ? (
          <div className="home-stats">
            <div className="stat">
              <span className="stat-n">{threads.length}</span>
              <span className="stat-l">threads</span>
            </div>
            <div className="stat">
              <span className="stat-n">{activeCount}</span>
              <span className="stat-l">active</span>
            </div>
            <div className="stat">
              <span className="stat-n">{totalPending}</span>
              <span className="stat-l">pending review</span>
            </div>
            {attentionCount > 0 ? (
              <div className="stat warn">
                <span className="stat-n">{attentionCount}</span>
                <span className="stat-l">needs attention</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="home-stats" aria-label="Loading thread stats" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <div className="stat stat--skeleton" key={item}>
                <span className="sk" style={{ width: 28, height: 32, marginBottom: 4 }} />
                <span className="sk" style={{ width: item === 2 ? 88 : 54, height: 12 }} />
              </div>
            ))}
          </div>
        )}
      </header>

      <NewThreadForm onCreated={refresh} nextNum={threads.length + 1} />

      <section className="threads-wrap">
        <div className="threads-head">
          <div className="threads-head-top">
            <h2 className="h-2">Threads</h2>
          </div>
          {!threadsLoaded ? (
            <ThreadFiltersSkeleton />
          ) : (
            <div className="threads-filters-row">
              <div className="threads-filters" aria-label="thread filters">
                {filters.map((item) => {
                  const count = counts[item.id] ?? 0
                  if (item.id !== 'all' && count === 0) return null
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="filter-tab"
                      data-on={filter === item.id ? '1' : '0'}
                      onClick={() => setFilter(item.id)}
                    >
                      {item.label}
                      <span className="count">{count}</span>
                    </button>
                  )
                })}
              </div>
              <span className="threads-head-total">
                {visibleThreads.length} of {threads.length}
              </span>
            </div>
          )}
        </div>

        {!threadsLoaded ? (
          <ThreadListSkeleton />
        ) : visibleThreads.length > 0 ? (
          <div className="threads-list">
            {visibleThreads.map((thread) => {
              const num = threads.length - threads.indexOf(thread)
              const menuOpen = openMenuThreadId === thread.id
              const isDeleting = deletingThreadId === thread.id
              const open = () => navigate(`/threads/${thread.id}`)
              return (
                <div
                  key={thread.id}
                  className="thread-row"
                  role="link"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      open()
                    }
                  }}
                >
                  <div className="num">#{String(num).padStart(2, '0')}</div>
                  <div>
                    <Link
                      className="title"
                      to={`/threads/${thread.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {thread.title}
                    </Link>
                    <div className="row-meta">
                      <span className="ctx">thread.md</span>
                      {thread.pending_count > 0 ? (
                        <>
                          <span className="sep">·</span>
                          <span style={{ color: 'var(--accent)' }}>
                            {thread.pending_count} pending
                          </span>
                        </>
                      ) : null}
                      <span className="sep">·</span>
                      <span>{relativeTime(thread.created_at)}</span>
                      {thread.recovery_action_label ? (
                        <>
                          <span className="sep">·</span>
                          <span className="err-hint">
                            <Icon name="refresh" className="ic-sm" />
                            {thread.recovery_action_label}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="right">
                    <StatusPill
                      status={thread.display_status}
                      pendingCount={thread.pending_count}
                    />
                    <div className="thread-actions">
                      <button
                        type="button"
                        className="thread-actions__trigger"
                        aria-label={`Actions for ${thread.title}`}
                        aria-expanded={menuOpen}
                        disabled={isDeleting}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenMenuThreadId(menuOpen ? null : thread.id)
                        }}
                      >
                        <Icon name="more" className="ic-sm" />
                      </button>
                      {menuOpen ? (
                        <div
                          className="thread-actions__menu"
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="thread-actions__item danger"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onDeleteThread(thread)
                            }}
                          >
                            Delete thread
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="empty-state">No threads yet.</p>
        )}
      </section>

      <footer className="home-foot">
        <span>
          <span className="mono">roundtable</span>
          <span style={{ color: 'var(--rule-strong)', margin: '0 8px' }}>·</span>
          thread.json · comments.jsonl
        </span>
        <span>
          <kbd className="kbd">/</kbd> search · <kbd className="kbd">N</kbd> new thread
        </span>
      </footer>
    </main>
    </>
  )
}
