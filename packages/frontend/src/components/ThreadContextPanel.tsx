import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { SnapshotPreflight, SnapshotReport, ThreadContext, ThreadStatus } from '@roundtable/shared'
import {
  addUrlContextItem,
  createProjectSnapshot,
  preflightProjectSnapshot,
  refreshProjectSnapshot,
  uploadAttachmentFiles,
} from '../api'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const keep = maxLength - 1
  const front = Math.ceil(keep * 0.58)
  const back = keep - front
  return `${value.slice(0, front)}…${value.slice(value.length - back)}`
}

export function ThreadContextPanel({
  threadId,
  threadStatus,
  context,
  reports = [],
  summary,
  onSnapshotSelectionChange,
  onUpdate,
}: {
  threadId: string
  threadStatus: ThreadStatus
  context: ThreadContext | null
  reports?: SnapshotReport[]
  summary?: string
  onSnapshotSelectionChange?: (selected: boolean) => void
  onUpdate: () => void
}) {
  const [sourcePath, setSourcePath] = useState('')
  const [preflight, setPreflight] = useState<SnapshotPreflight | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const isThreadOpen = threadStatus === 'open'

  async function handlePreflight(event: FormEvent) {
    event.preventDefault()
    if (!isThreadOpen) return
    if (!sourcePath.trim()) return
    setMessage(null)
    const result = await preflightProjectSnapshot(threadId, { source_path: sourcePath })
    setPreflight(result)
    setSourcePath(result.source_path)
    onSnapshotSelectionChange?.(true)
  }

  async function handleCreateSnapshot(confirmed: boolean) {
    if (!isThreadOpen) return
    if (!preflight) return
    await createProjectSnapshot(threadId, {
      source_path: preflight.source_path,
      confirmed,
    })
    setPreflight(null)
    onSnapshotSelectionChange?.(false)
    setMessage('Snapshot updated.')
    onUpdate()
  }

  async function handleRefreshSnapshot() {
    if (!isThreadOpen) return
    await refreshProjectSnapshot(threadId)
    setMessage('Snapshot refreshed.')
    onUpdate()
  }

  const addedFiles = [
    ...(context?.snapshot?.added_since_last_refresh ?? []),
    ...(context?.workspace_added_files.map((file) => file.path) ?? []),
  ]
  const snapshotSourcePath = context?.snapshot?.source_path ?? ''
  const displaySourcePath = truncateMiddle(snapshotSourcePath, 38)

  return (
    <div className="rail-form context-rail-form">
      {!isThreadOpen ? (
        <p className="rail-hint" style={{ padding: 0 }}>Thread is {threadStatus}; context controls are disabled.</p>
      ) : null}

      {context?.snapshot ? (
        <div className="kv-list">
          <div className="kv-row"><span className="k">working dir</span><span className="v" title={snapshotSourcePath}>{displaySourcePath}</span></div>
          <div className="kv-row"><span className="k">snapshot</span><span className="v">{context.snapshot.mode} · {context.snapshot.file_count} files</span></div>
          <div className="kv-row"><span className="k">size</span><span className="v">{formatBytes(context.snapshot.total_bytes)}</span></div>
          <div className="kv-row"><span className="k">thread.md</span><span className="v">{summary ?? 'thread.md'}</span></div>
          <div className="kv-row"><span className="k">reports</span><span className="v">{reports.length}</span></div>
        </div>
      ) : (
        <p className="rail-hint" style={{ padding: 0 }}>No project snapshot.</p>
      )}

      {addedFiles.length > 0 ? (
        <div className="snapshot-changes">
          <div className="eyebrow tight" style={{ marginTop: 10, marginBottom: 4 }}>Added since last refresh</div>
          {addedFiles.slice(0, 8).map((file) => (
            <div key={file} className="snapshot-change">
              <span>+</span>
              <span className="mono" title={file}>{file}</span>
            </div>
          ))}
        </div>
      ) : null}

      <button type="button" className="btn sm" onClick={handleRefreshSnapshot} disabled={!isThreadOpen || !context?.snapshot}>
        Refresh snapshot
      </button>

      <form onSubmit={handlePreflight} aria-label="snapshot-preflight" className="rail-row">
        <input
          className="rail-input"
          aria-label="Project path"
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
          placeholder="/path/to/project"
          disabled={!isThreadOpen}
        />
        <button type="submit" className="btn sm" disabled={!isThreadOpen}>Check</button>
      </form>

      {preflight ? (
        <div role="status" className="snap-preflight">
          <div className="snap-preflight-head">
            <b>{preflight.mode}</b>
            <span>{preflight.file_count} files</span>
            <span>{formatBytes(preflight.total_bytes)}</span>
          </div>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => handleCreateSnapshot(preflight.requires_confirmation)}
            disabled={!isThreadOpen}
          >
            {preflight.requires_confirmation ? 'Confirm Snapshot' : 'Create Snapshot'}
          </button>
        </div>
      ) : null}

      {message ? <p className="rail-hint" style={{ padding: 0 }}>{message}</p> : null}
    </div>
  )
}

export function ThreadAttachmentsPanel({
  threadId,
  threadStatus,
  context,
  onUpdate,
}: {
  threadId: string
  threadStatus: ThreadStatus
  context: ThreadContext | null
  onUpdate: () => void
}) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const isThreadOpen = threadStatus === 'open'

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!isThreadOpen) return
    const files = event.target.files
    if (!files || files.length === 0) return
    await uploadAttachmentFiles(threadId, files)
    event.target.value = ''
    onUpdate()
  }

  async function handleAddUrl(event: FormEvent) {
    event.preventDefault()
    if (!isThreadOpen || !url.trim()) return
    await addUrlContextItem(threadId, { url, label: label || null })
    setUrl('')
    setLabel('')
    onUpdate()
  }

  return (
    <div className="attach-list-rail">
      {context && context.items.length > 0 ? (
        context.items.map((item) => (
          <div key={item.id} className="attach">
            <span className="name">
              {item.kind === 'file' ? item.original_name : (item.label ?? item.url)}
            </span>
            {item.kind === 'file' ? <span className="sz">{formatBytes(item.size_bytes)}</span> : null}
          </div>
        ))
      ) : (
        <p className="rail-hint" style={{ padding: 0 }}>No attachments yet.</p>
      )}

      <label className="btn sm ghost" style={{ justifyContent: 'flex-start' }}>
        Add file
        <input type="file" multiple onChange={handleUpload} disabled={!isThreadOpen} style={{ display: 'none' }} />
      </label>

      <form onSubmit={handleAddUrl} aria-label="add-url-context" className="rail-form" style={{ padding: 0 }}>
        <input className="rail-input" aria-label="URL" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" disabled={!isThreadOpen} />
        <input className="rail-input" aria-label="URL label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Optional label" disabled={!isThreadOpen} />
        <button type="submit" className="btn sm" disabled={!isThreadOpen || !url.trim()}>Add URL</button>
      </form>
    </div>
  )
}
