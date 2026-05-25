import { useCallback, useEffect, useState } from 'react'
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

  return (
    <main className="page-shell page-shell--narrow">
      <header className="page-header">
        <div>
          <p className="eyebrow">Local forum</p>
          <h1>Roundtable</h1>
        </div>
      </header>

      <section className="panel">
        <h2>New thread</h2>
        <NewThreadForm onCreated={refresh} />
      </section>

      <section className="panel">
        <h2>Threads</h2>
        {threads.length > 0 ? (
          <ul className="thread-list">
            {threads.map((thread) => (
              <li key={thread.id}>
                <div>
                  <Link to={`/threads/${thread.id}`}>{thread.title}</Link>
                  {thread.recovery_action_label ? (
                    <p className="thread-card-action">
                      {thread.recovery_action_label}
                    </p>
                  ) : null}
                </div>
                <span className={`status-pill status-pill--${thread.display_status}`}>
                  {displayStatusLabel(thread.display_status)}
                  {thread.pending_count > 0 &&
                  thread.display_status !== 'needs_attention' &&
                  thread.display_status !== 'error'
                    ? ` · ${thread.pending_count} pending`
                    : ''}
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
