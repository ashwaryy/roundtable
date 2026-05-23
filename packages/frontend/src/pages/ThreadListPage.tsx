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
    <main>
      <h1>Roundtable</h1>
      <NewThreadForm onCreated={refresh} />
      <ul>
        {threads.map((thread) => (
          <li key={thread.id}>
            <Link to={`/threads/${thread.id}`}>{thread.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
