import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { SnapshotPreflight, SnapshotReport, ThreadContext } from '@roundtable/shared'
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

export function ThreadContextPanel({
  threadId,
  context,
  reports = [],
  summary,
  onSnapshotSelectionChange,
  onUpdate,
}: {
  threadId: string
  context: ThreadContext | null
  reports?: SnapshotReport[]
  summary?: string
  onSnapshotSelectionChange?: (selected: boolean) => void
  onUpdate: () => void
}) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [preflight, setPreflight] = useState<SnapshotPreflight | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) return
    await uploadAttachmentFiles(threadId, files)
    event.target.value = ''
    onUpdate()
  }

  async function handleAddUrl(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    await addUrlContextItem(threadId, { url, label: label || null })
    setUrl('')
    setLabel('')
    onUpdate()
  }

  async function handlePreflight(event: FormEvent) {
    event.preventDefault()
    if (!sourcePath.trim()) return
    setMessage(null)
    const result = await preflightProjectSnapshot(threadId, { source_path: sourcePath })
    setPreflight(result)
    setSourcePath(result.source_path)
    onSnapshotSelectionChange?.(true)
  }

  async function handleCreateSnapshot(confirmed: boolean) {
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
    await refreshProjectSnapshot(threadId)
    setMessage('Snapshot refreshed.')
    onUpdate()
  }

  return (
    <section aria-label="thread-context" className="room-card">
      <div className="section-heading">
        <h2>Context</h2>
        {summary ? <span>{summary}</span> : null}
      </div>

      <section>
        <h3>Attachments</h3>
        <label>
          Add files
          <input type="file" multiple onChange={handleUpload} />
        </label>
      </section>

      <section>
        <h3>URLs</h3>
        <form onSubmit={handleAddUrl} aria-label="add-url-context">
          <input
            aria-label="URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
          />
          <input
            aria-label="URL label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Optional label"
          />
          <button type="submit">Add URL</button>
        </form>
      </section>

      <section>
        <h3>Project Snapshot</h3>
        <form onSubmit={handlePreflight} aria-label="snapshot-preflight">
          <input
            aria-label="Project path"
            value={sourcePath}
            onChange={(event) => setSourcePath(event.target.value)}
            placeholder="/path/to/project"
          />
          <button type="submit">Check Snapshot</button>
        </form>

        {preflight ? (
          <div role="status">
            <p>
              {preflight.mode} snapshot: {preflight.file_count} files,{' '}
              {formatBytes(preflight.total_bytes)}, {preflight.excluded_count} excluded.
            </p>
            {preflight.warnings.length > 0 ? (
              <ul>
                {preflight.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <button onClick={() => handleCreateSnapshot(preflight.requires_confirmation)}>
              {preflight.requires_confirmation ? 'Confirm Snapshot' : 'Create Snapshot'}
            </button>
          </div>
        ) : null}

        {context?.snapshot ? (
          <div>
            <p>
              Latest: {context.snapshot.mode}, {context.snapshot.file_count} files,{' '}
              {formatBytes(context.snapshot.total_bytes)}.
            </p>
            <p className="context-path" title={context.snapshot.source_path}>
              {context.snapshot.source_path}
            </p>
            <button onClick={handleRefreshSnapshot}>Refresh Snapshot</button>
            {reports.length > 0 ? (
              <div aria-label="snapshot-report-history">
                <h3>Snapshot Changes</h3>
                {[...reports].reverse().slice(0, 4).map((report) => (
                  <p key={report.id}>
                    {report.id}: +{report.added_paths.length} changed{' '}
                    {report.modified_paths.length} removed {report.removed_paths.length}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p>No project snapshot.</p>
        )}
        {message ? <p>{message}</p> : null}
      </section>

      <section>
        <h3>Context Items</h3>
        {context && context.items.length > 0 ? (
          <ul>
            {context.items.map((item) => (
              <li key={item.id}>
                {item.kind === 'file'
                  ? `${item.original_name} (${item.path}, ${formatBytes(item.size_bytes)})`
                  : `${item.label ?? item.url} (${item.url})`}
              </li>
            ))}
          </ul>
        ) : (
          <p>No context items.</p>
        )}
      </section>

      <section>
        <h3>Added Files</h3>
        {context?.snapshot?.added_since_last_refresh.length ? (
          <>
            <p>Added in latest snapshot refresh:</p>
            <ul>
              {context.snapshot.added_since_last_refresh.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </>
        ) : null}

        {context && context.workspace_added_files.length > 0 ? (
          <ul>
            {context.workspace_added_files.map((file) => (
              <li key={file.path}>
                {file.path} ({formatBytes(file.size_bytes)})
              </li>
            ))}
          </ul>
        ) : (
          <p>No manually added files detected.</p>
        )}
      </section>
    </section>
  )
}
