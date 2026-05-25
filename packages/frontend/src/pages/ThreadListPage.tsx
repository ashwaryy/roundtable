import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  RoundtableEvent,
  ThreadDisplayStatus,
  ThreadListItem,
} from '@roundtable/shared'
import { listThreads } from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { NewThreadForm } from '../components/NewThreadForm'

function displayStatusLabel(status: ThreadDisplayStatus): string {
  switch (status) {
    case 'setup':
      return 'Setup'
    case 'discussing':
      return 'Discussing'
    case 'consolidating':
      return 'Consolidating'
    case 'needs_attention':
      return 'Needs attention'
    case 'error':
      return 'Error'
    case 'closed':
      return 'Closed'
    case 'archived':
      return 'Archived'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export function ThreadListPage() {
  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [filter, setFilter] = useState<ThreadDisplayStatus | 'all'>('all')

  const refresh = useCallback(() => {
    listThreads().then(setThreads)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onEvent = useCallback(
    (event: RoundtableEvent) => {
      if (
        event.type === 'thread_created' ||
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
  useLiveRefresh(onEvent)

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: threads.length }
    for (const thread of threads) {
      base[thread.display_status] = (base[thread.display_status] ?? 0) + 1
    }
    return base
  }, [threads])

  const visibleThreads = filter === 'all'
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

  return (
    <main className="home-wrap">
      <header className="home-head">
        <div>
          <p className="eyebrow eyebrow--tight">Local forum</p>
          <h1 className="h-display">Roundtable.</h1>
        </div>
        <div className="home-stats">
          <div className="home-stat">
            <span className="home-stat__number">{threads.length}</span>
            <span className="home-stat__label">threads</span>
          </div>
          <div className="home-stat">
            <span className="home-stat__number">{activeCount}</span>
            <span className="home-stat__label">active</span>
          </div>
          <div className="home-stat">
            <span className="home-stat__number">{totalPending}</span>
            <span className="home-stat__label">pending review</span>
          </div>
          {attentionCount > 0 ? (
            <div className="home-stat home-stat--warn">
              <span className="home-stat__number">{attentionCount}</span>
              <span className="home-stat__label">needs attention</span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="compose-panel">
        <NewThreadForm onCreated={refresh} />
      </section>

      <section className="threads-wrap">
        <div className="threads-head">
          <div className="threads-head-top">
            <h2 className="h-2">Threads</h2>
            <span className="threads-head-total">
              {visibleThreads.length} of {threads.length}
            </span>
          </div>
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
        </div>

        {visibleThreads.length > 0 ? (
          <ul className="threads-list">
            {visibleThreads.map((thread, index) => (
              <li key={thread.id} className="thread-row">
                <span className="num">#{String(index + 1).padStart(2, '0')}</span>
                <div className="thread-row__main">
                  <Link className="title" to={`/threads/${thread.id}`}>{thread.title}</Link>
                  <div className="row-meta">
                    <span className="ctx">thread.md</span>
                    {thread.pending_count > 0 ? (
                      <>
                        <span className="sep">·</span>
                        <span>{thread.pending_count} pending</span>
                      </>
                    ) : null}
                    {thread.recovery_action_label ? (
                      <>
                        <span className="sep">·</span>
                        <span className="err-hint">
                          {thread.recovery_action_label}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <span className={`status-pill pill status-pill--${thread.display_status}`}>
                  {displayStatusLabel(thread.display_status)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No threads yet.</p>
        )}
      </section>
    </main>
  )
}
