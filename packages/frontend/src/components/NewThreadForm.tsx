import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Thread } from '@roundtable/shared'
import {
  addUrlContextItem,
  createProjectSnapshot,
  createThread,
  uploadAttachmentFiles,
} from '../api'

interface DraftUrl {
  id: string
  url: string
  label: string | null
}

export function NewThreadForm({ onCreated }: { onCreated: (thread: Thread) => void }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [files, setFiles] = useState<File[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [urls, setUrls] = useState<DraftUrl[]>([])
  const [snapshotPath, setSnapshotPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleStepOne(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setError(null)
    setStep(2)
  }

  function handleAddFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    if (selected.length > 0) {
      setFiles((current) => [...current, ...selected])
    }
    event.target.value = ''
  }

  function handleAddUrl(event: React.FormEvent) {
    event.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    setUrls((current) => [
      ...current,
      {
        id: `draft-url-${Date.now()}-${current.length}`,
        url: trimmedUrl,
        label: label.trim() || null,
      },
    ])
    setUrl('')
    setLabel('')
  }

  async function handleCreateThread(skipContext = false) {
    if (!title.trim() || !body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const thread = await createThread({ title: title.trim(), body })

      if (!skipContext) {
        if (files.length > 0) {
          await uploadAttachmentFiles(thread.id, files)
        }

        for (const item of urls) {
          await addUrlContextItem(thread.id, { url: item.url, label: item.label })
        }

        if (snapshotPath.trim()) {
          await createProjectSnapshot(thread.id, {
            source_path: snapshotPath.trim(),
            confirmed: true,
          })
        }
      }

      setTitle('')
      setBody('')
      setFiles([])
      setUrls([])
      setSnapshotPath('')
      setStep(1)
      onCreated(thread)
      navigate(`/threads/${thread.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 2) {
    return (
      <div className="setup-flow" aria-label="new-thread-context-draft">
        <div className="section-heading">
          <h3>Step 2: Add context</h3>
          <span>Thread not created yet</span>
        </div>

        <section className="draft-thread-summary" aria-label="draft source thread">
          <h4>{title}</h4>
          <p>{body.length > 180 ? `${body.slice(0, 177)}...` : body}</p>
          <button type="button" className="btn-ghost" onClick={() => setStep(1)} disabled={submitting}>
            Edit source
          </button>
        </section>

        <section className="draft-context-section">
          <h3>Attachments</h3>
          <label>
            Add files
            <input type="file" multiple onChange={handleAddFiles} disabled={submitting} />
          </label>
          {files.length > 0 ? (
            <ul>
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${index}`}>
                  {file.name}
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    disabled={submitting}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No files selected.</p>
          )}
        </section>

        <section className="draft-context-section">
          <h3>URLs</h3>
          <form onSubmit={handleAddUrl} aria-label="add-draft-url-context">
            <input
              aria-label="URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              disabled={submitting}
            />
            <input
              aria-label="URL label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional label"
              disabled={submitting}
            />
            <button type="submit" disabled={submitting || !url.trim()}>Add URL</button>
          </form>
          {urls.length > 0 ? (
            <ul>
              {urls.map((item) => (
                <li key={item.id}>
                  {item.label ?? item.url}
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setUrls((current) => current.filter((u) => u.id !== item.id))}
                    disabled={submitting}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No URLs added.</p>
          )}
        </section>

        <section className="draft-context-section">
          <h3>Project Snapshot</h3>
          <input
            aria-label="Project path"
            value={snapshotPath}
            onChange={(event) => setSnapshotPath(event.target.value)}
            placeholder="/path/to/project"
            disabled={submitting}
          />
          <p className="empty-state">
            Snapshot is created after you finish this step, so no thread files are written early.
          </p>
        </section>

        {error ? <p className="inline-error" role="alert">{error}</p> : null}

        <div className="setup-actions">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleCreateThread(false)}
          >
            {submitting ? 'Creating...' : 'Create thread'}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={submitting}
            onClick={() => handleCreateThread(true)}
          >
            Create without context
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleStepOne} aria-label="new-thread">
      <div className="section-heading">
        <h3>Step 1: Source thread</h3>
      </div>
      <input
        aria-label="title"
        placeholder="Thread title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        aria-label="body"
        placeholder="Body / plan / idea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button type="submit" disabled={submitting}>
        Continue to context
      </button>
    </form>
  )
}
