import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SavedOutput } from '@roundtable/shared'
import { getSavedOutput } from '../api'

export function SavedOutputPage() {
  const { savedId } = useParams<{ savedId: string }>()
  const [saved, setSaved] = useState<SavedOutput | null>(null)

  useEffect(() => {
    if (savedId) getSavedOutput(savedId).then(setSaved)
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
        </div>
      </header>
      <section className="panel thread-body" aria-label="saved-output-body">
        <Markdown remarkPlugins={[remarkGfm]}>{saved.body}</Markdown>
      </section>
    </main>
  )
}
