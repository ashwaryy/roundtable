import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SnapshotPreflight, Thread } from '@roundtable/shared'
import {
  addUrlContextItem,
  createProjectSnapshot,
  createThread,
  preflightProjectSnapshotSource,
  uploadAttachmentFiles,
} from '../api'
import { AgentStack, Icon, type IconName } from './primitives'
import { useAgentCatalogue } from '../useAgentCatalogue'

interface DraftUrl {
  id: string
  url: string
  label: string | null
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function CtxSection({
  eyebrow,
  kicker,
  status,
  icon,
  count,
  children,
}: {
  eyebrow: string
  kicker: string
  status: 'set' | 'empty'
  icon: IconName
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="ctx-section" data-status={status}>
      <header className="ctx-section-head">
        <span className="ctx-section-icon">
          <Icon name={icon} />
        </span>
        <div className="ctx-section-titles">
          <h3 className="ctx-section-eyebrow">{eyebrow}</h3>
          <p className="ctx-section-kicker">{kicker}</p>
        </div>
        <span className="ctx-section-status">
          {status === 'set' ? (
            <span className="ctx-pip ctx-pip-on">
              <Icon name="check" className="ic-sm" />
              {count != null ? `${count} added` : 'set'}
            </span>
          ) : (
            <span className="ctx-pip">optional</span>
          )}
        </span>
      </header>
      <div className="ctx-section-body">{children}</div>
    </section>
  )
}

function DropZone({ onAdd }: { onAdd: (list: FileList | File[]) => void }) {
  const [over, setOver] = useState(false)
  return (
    <label
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onAdd(e.dataTransfer.files)
      }}
    >
      <input
        type="file"
        multiple
        onChange={(e) => {
          onAdd(e.target.files ?? [])
          e.target.value = ''
        }}
      />
      <span className="dropzone-icon">
        <Icon name="paperclip" />
      </span>
      <span className="dropzone-text">
        Drag files here, or <span className="dropzone-cta">browse</span>
      </span>
      <span className="dropzone-meta mono">.md · .png · .txt · .json · ≤ 25 MB</span>
    </label>
  )
}

export function NewThreadForm({
  onCreated,
  nextNum = 1,
}: {
  onCreated: (thread: Thread) => void
  nextNum?: number
}) {
  const navigate = useNavigate()
  const isMac = /Mac/i.test(navigator.userAgent)

  const [step, setStep] = useState<1 | 2>(1)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [step1Open, setStep1Open] = useState(false)

  const [files, setFiles] = useState<File[]>([])
  const [urls, setUrls] = useState<DraftUrl[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [urlLabel, setUrlLabel] = useState('')
  const [snapshotPath, setSnapshotPath] = useState('')
  const [snapStaged, setSnapStaged] = useState(false)
  const [snapshotPreflight, setSnapshotPreflight] = useState<SnapshotPreflight | null>(null)
  const [snapshotChecking, setSnapshotChecking] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agentIds, setAgentIds] = useState<string[]>(['claude', 'codex'])
  const catalogue = useAgentCatalogue()

  const titleRef = useRef<HTMLInputElement>(null)
  const stepRef = useRef(step)
  const finalizeRef = useRef(finalize)
  stepRef.current = step
  finalizeRef.current = finalize

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if ((e.key === 'n' || e.key === 'N') && !inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setComposing(true)
        titleRef.current?.focus()
        return
      }

      if (e.key === 'Alt' && stepRef.current === 2) {
        e.preventDefault()
        void finalizeRef.current(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const roomAgents = agentIds
  const ctxCount = (snapStaged ? 1 : 0) + files.length + urls.length
  const hasContext = ctxCount > 0

  function resetCompose() {
    setStep(1)
    setComposing(false)
    setTitle('')
    setBody('')
    setStep1Open(false)
    setFiles([])
    setUrls([])
    setUrlInput('')
    setUrlLabel('')
    setSnapshotPath('')
    setSnapStaged(false)
    setSnapshotPreflight(null)
    setError(null)
    setAgentIds(['claude', 'codex'])
  }

  function addFiles(list: FileList | File[]) {
    const added = Array.from(list)
    if (added.length > 0) setFiles((cur) => [...cur, ...added])
  }

  function addUrl(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setUrls((cur) => [
      ...cur,
      { id: `draft-url-${Date.now()}-${cur.length}`, url: trimmed, label: urlLabel.trim() || null },
    ])
    setUrlInput('')
    setUrlLabel('')
  }

  async function finalize(skipContext: boolean) {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const thread = await createThread({ title: title.trim(), body, agent_ids: agentIds })
      if (!skipContext) {
        if (files.length > 0) await uploadAttachmentFiles(thread.id, files)
        for (const u of urls) {
          await addUrlContextItem(thread.id, { url: u.url, label: u.label })
        }
        if (snapStaged && snapshotPath.trim()) {
          await createProjectSnapshot(thread.id, {
            source_path: snapshotPath.trim(),
            confirmed: true,
          })
        }
      }
      onCreated(thread)
      navigate(`/threads/${thread.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={`compose open ${step === 2 ? 'step2' : ''}`}>
      <div className="compose-head">
        <div className="step-meter">
          <span className={`step-dot ${step >= 1 ? 'done' : ''}`}>1</span>
          <span className="step-rail" />
          <span className={`step-dot ${step === 2 ? 'on' : ''}`}>2</span>
          <span className="step-label">{step === 1 ? 'Source thread' : 'Add context'}</span>
        </div>
        <span className="eyebrow tight" style={{ color: 'var(--muted)' }}>
          {step === 1 ? (
            <>
              <kbd className="kbd">N</kbd> to compose
            </>
          ) : (
            <><kbd className="kbd">{isMac ? '⌥' : 'Alt'}</kbd> continue without context</>

          )}
        </span>
      </div>

      {step === 1 ? (
        <>
          <input
            ref={titleRef}
            className="input"
            placeholder="Thread title — a question, a plan, a spec to refine"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setComposing(true)}
          />
          {composing ? (
            <>
              <textarea
                className="textarea"
                placeholder="Body / plan / idea. Markdown supported. This becomes thread.md — the durable source artifact the discussion revolves around."
                value={body}
                rows={4}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="compose-actions">
                <span style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-ui)' }}>
                  Step 2 (context) opens after create
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn ghost" onClick={resetCompose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!title.trim()}
                    onClick={() => setStep(2)}
                  >
                    Create thread
                    <Icon name="arrowRight" className="ic-sm" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="compose-actions">
              <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-ui)' }}>
                The thread is the source artifact. Discussion happens around it — and only you
                decide when it changes.
              </span>
              <button type="button" className="btn primary" onClick={() => { setComposing(true); titleRef.current?.focus() }}>
                <Icon name="plus" className="ic-sm" />
                Compose
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="step2">
          <div className={`step1-done ${step1Open ? 'open' : ''}`}>
            <button type="button" className="step1-done-row" onClick={() => setStep1Open((v) => !v)}>
              <span className="step1-check">
                <Icon name="check" className="ic-sm" />
              </span>
              <span className="step1-meta">
                <span className="step1-num">#{String(nextNum).padStart(2, '0')}</span>
                <span className="step1-title">{title || 'Untitled thread'}</span>
              </span>
              <span className="step1-path mono">thread.md</span>
              <span className="step1-agents">
                <AgentStack agents={roomAgents} size={16} />
              </span>
              <span className="step1-caret">
                <Icon name={step1Open ? 'chevronU' : 'chevronD'} className="ic-sm" />
              </span>
            </button>
            {step1Open ? (
              <div className="step1-done-body">
                {body ? (
                  <div className="step1-body-pre">{body}</div>
                ) : (
                  <div className="step1-body-empty">No body provided.</div>
                )}
                <button type="button" className="btn ghost sm" onClick={() => setStep(1)}>
                  <Icon name="chevronL" className="ic-sm" />
                  Edit step 1
                </button>
              </div>
            ) : null}
          </div>

          <div className="step2-intro">
            <p className="step2-lede">
              Give the agents something to <em>read</em>. None of this changes the thread — it's
              reference material attached on the side.
            </p>
          </div>
          <CtxSection eyebrow="Agents" kicker="Invite agents to this thread" status="set" icon="spark" count={agentIds.length}>
            <div className="invite-picker">
              {catalogue.map((agent) => (
                <label key={agent.id} className="invite-option">
                  <input
                    type="checkbox"
                    checked={agentIds.includes(agent.id)}
                    disabled={agentIds.includes(agent.id) && agentIds.length === 1}
                    onChange={(event) => setAgentIds((current) =>
                      event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))}
                  />
                  <AgentStack agents={[agent.id]} size={16} />
                  {agent.name}
                </label>
              ))}
            </div>
          </CtxSection>

          <CtxSection
            eyebrow="Project snapshot"
            kicker="Freeze a local repo so agents reference exactly what you saw."
            status={snapStaged ? 'set' : 'empty'}
            icon="terminal"
          >
            {!snapStaged ? (
              <form
                className="snap-form"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!snapshotPath.trim() || snapshotChecking) return
                  setError(null)
                  setSnapshotChecking(true)
                  try {
                    const result = await preflightProjectSnapshotSource({
                      source_path: snapshotPath.trim(),
                    })
                    setSnapshotPath(result.source_path)
                    setSnapshotPreflight(result)
                    setSnapStaged(true)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to inspect project path')
                  } finally {
                    setSnapshotChecking(false)
                  }
                }}
              >
                <span className="snap-prompt mono">$</span>
                <input
                  className="rail-input snap-input mono"
                  placeholder="/path/to/project"
                  value={snapshotPath}
                  onChange={(e) => {
                    setSnapshotPath(e.target.value)
                    setSnapshotPreflight(null)
                  }}
                  disabled={submitting || snapshotChecking}
                />
                <button type="submit" className="btn sm" disabled={!snapshotPath.trim() || snapshotChecking}>
                  {snapshotChecking ? 'Checking…' : 'Check'}
                  <Icon name="arrowRight" className="ic-sm" />
                </button>
              </form>
            ) : (
              <div className="snap-set">
                {snapshotPreflight ? (
                  <div className="snap-set-stat">
                    <span className="snap-set-dot" />
                    <span>
                      <b>{pluralize(snapshotPreflight.file_count, 'file')}</b>
                      {' · '}
                      {pluralize(snapshotPreflight.directory_count, 'directory', 'directories')}
                      {' · '}
                      {fmtBytes(snapshotPreflight.total_bytes)}
                    </span>
                  </div>
                ) : null}
                <div className="snap-set-path mono">{snapshotPath}</div>
                {snapshotPreflight?.warnings.length ? (
                  <ul className="snap-warnings">
                    {snapshotPreflight.warnings.map((warning) => (
                      <li key={warning}>
                        <Icon name="flag" className="ic-sm" />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="snap-set-actions">
                  <button
                    type="button"
                    className="cmt-action"
                    onClick={() => {
                      setSnapStaged(false)
                      setSnapshotPath('')
                      setSnapshotPreflight(null)
                    }}
                  >
                    <Icon name="close" className="ic-sm" />
                    Clear
                  </button>
                </div>
              </div>
            )}
          </CtxSection>

          <CtxSection
            eyebrow="Attachments"
            kicker="Drop in screenshots, specs, or logs. Read-only, copied into the thread."
            status={files.length ? 'set' : 'empty'}
            icon="paperclip"
            count={files.length}
          >
            <DropZone onAdd={addFiles} />
            {files.length > 0 ? (
              <ul className="ctx-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}-${i}`} className="ctx-item">
                    <Icon name="file" className="ic-sm" />
                    <span className="ctx-item-name mono">{f.name}</span>
                    <span className="ctx-item-sz">{fmtBytes(f.size)}</span>
                    <button
                      type="button"
                      className="ctx-item-x"
                      onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
                      title="Remove"
                    >
                      <Icon name="close" className="ic-sm" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CtxSection>

          <CtxSection
            eyebrow="Links"
            kicker="Reference URLs the agents can fetch if their tools allow."
            status={urls.length ? 'set' : 'empty'}
            icon="link"
            count={urls.length}
          >
            <form className="url-form" onSubmit={addUrl}>
              <input
                className="rail-input url-input mono"
                placeholder="https://"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <input
                className="rail-input url-label-input"
                placeholder="Label (optional)"
                value={urlLabel}
                onChange={(e) => setUrlLabel(e.target.value)}
              />
              <button type="submit" className="btn sm" disabled={!urlInput.trim()}>
                Add
              </button>
            </form>
            {urls.length > 0 ? (
              <ul className="ctx-list">
                {urls.map((u) => (
                  <li key={u.id} className="ctx-item">
                    <Icon name="link" className="ic-sm" />
                    <span className="ctx-item-name mono" title={u.url}>
                      {u.label || u.url}
                    </span>
                    <button
                      type="button"
                      className="ctx-item-x"
                      onClick={() => setUrls((cur) => cur.filter((x) => x.id !== u.id))}
                      title="Remove"
                    >
                      <Icon name="close" className="ic-sm" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CtxSection>

          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="step2-foot">
            <div className="step2-summary">
              {hasContext ? (
                <>
                  <span className="auto-dot" style={{ background: 'var(--good)' }} />
                  <span>
                    <b>{ctxCount}</b> item{ctxCount === 1 ? '' : 's'} attached
                  </span>
                </>
              ) : (
                <>
                  <span className="step2-empty-dot" />
                  <span>No context — agents will work from the thread body alone.</span>
                </>
              )}
            </div>
            <div className="step2-actions">
              <button type="button" className="btn ghost" onClick={resetCompose} disabled={submitting}>
                Discard thread
              </button>
              <button type="button" className="btn" onClick={() => finalize(true)} disabled={submitting}>
                Skip — go to thread
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => finalize(false)}
                disabled={submitting}
              >
                {submitting ? (
                  'Creating…'
                ) : (
                  <>
                    Open thread
                    <Icon name="arrowRight" className="ic-sm" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
