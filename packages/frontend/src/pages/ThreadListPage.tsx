import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Thread, RoundtableEvent } from '@roundtable/shared'
import { listThreads } from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { NewThreadForm } from '../components/NewThreadForm'

export function ThreadListPage() {
  const [threads, setThreads] = useState<Thread[]>([])

  const refresh = useCallback(() => {
    listThreads().then(setThreads)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onEvent = useCallback(
    (event: RoundtableEvent) => {
      if (event.type === 'thread_created') refresh()
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
                <Link to={`/threads/${thread.id}`}>{thread.title}</Link>
                <span>{thread.status}</span>
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
