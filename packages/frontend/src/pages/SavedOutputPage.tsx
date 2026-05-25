import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SavedOutput, ThreadDetail } from '@roundtable/shared'
import { getSavedOutput, getThread } from '../api'

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

  if (!saved) return <p>Loading...</p>

  return (
    <main className="page-shell page-shell--narrow">
      <Link to={`/threads/${saved.source_thread_id}`} className="back-link">
        Back to source thread
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Saved output</p>
          <h1>{saved.title}</h1>
          <p className="metadata-row">
            Source discussion:{' '}
            <Link to={`/threads/${saved.source_thread_id}`}>
              {sourceThread?.title ?? saved.source_thread_id}
            </Link>
          </p>
        </div>
      </header>
      <section className="panel thread-body" aria-label="saved-output-body">
        <Markdown remarkPlugins={[remarkGfm]}>{saved.body}</Markdown>
      </section>
    </main>
  )
}
