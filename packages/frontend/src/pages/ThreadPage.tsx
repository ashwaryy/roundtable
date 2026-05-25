import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ThreadDetail,
  Comment,
  CommentType,
  PendingDiscussion,
  RoundtableEvent,
  AgentRoom,
  RoomPreflight,
  ThreadContext,
  AgentName,
  ConsolidationProposal,
  IntegrityReport,
  SavedConsolidation,
  SnapshotReport,
  ThreadDisplayStatus,
} from '@roundtable/shared'
import {
  getThread,
  listComments,
  createComment,
  listPendingDiscussions,
  getThreadContext,
  getRoom,
  getRoomPreflight,
  askAgent,
  getConsolidation,
  listConsolidations,
  getIntegrity,
  listSavedOutputs,
  listSnapshotReports,
  restartRoom,
  retryTurn,
  sendRoomInputResponse,
  skipTurn,
} from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { CommentForm } from '../components/CommentForm'
import { CommentTree } from '../components/CommentTree'
import { ThreadContextPanel } from '../components/ThreadContextPanel'
import { RoomPanel } from '../components/RoomPanel'
import { ConsolidationPanel } from '../components/ConsolidationPanel'
import { IntegrityPanel } from '../components/IntegrityPanel'
import { NewCommentsPill } from '../components/NewCommentsPill'
import { ThreadSkeleton } from '../components/ThreadSkeleton'

// ── Helpers ────────────────────────────────────────────────────

function isActiveProposal(p: ConsolidationProposal) {
  return p.status === 'drafting' || p.status === 'review'
}

function displayStatusFor(
  thread: ThreadDetail,
  room: AgentRoom | null,
  proposals: ConsolidationProposal[],
): ThreadDisplayStatus {
  if (thread.status === 'closed') return 'closed'
  if (thread.status === 'archived') return 'archived'
  if (room?.status === 'error') return 'error'
  if (
    room?.status === 'needs_attention' ||
    room?.input_prompt ||
    room?.session_state === 'missing' ||
    room?.session_state === 'untracked'
  ) return 'needs_attention'
  if (proposals.some(isActiveProposal)) return 'consolidating'
  if (!room || room.status === 'not_started' || room.status === 'stopped') return 'setup'
  return 'discussing'
}

function basename(v: string) {
  return v.split(/[\\/]/).filter(Boolean).pop() ?? v
}

function contextSummary(context: ThreadContext | null): string {
  if (!context) return 'loading'
  if (context.snapshot) return basename(context.snapshot.source_path)
  const first = context.items[0]
  if (!first) return 'No context'
  return first.kind === 'file' ? first.original_name : (first.label ?? first.url)
}

function statusLabel(status: ThreadDisplayStatus): string {
  switch (status) {
    case 'setup': return 'Setup'
    case 'discussing': return 'Discussing'
    case 'consolidating': return 'Consolidating'
    case 'needs_attention': return 'Needs attention'
    case 'error': return 'Error'
    case 'closed': return 'Closed'
    case 'archived': return 'Archived'
    default: {
      const _: never = status
      return _
    }
  }
}

// ── Recovery sidebar card ─────────────────────────────────────

function RecoveryCard({
  room,
  displayStatus,
  onRecoveryInput,
  onRestartRoom,
  onRetryTurn,
  onSkipTurn,
}: {
  room: AgentRoom | null
  displayStatus: ThreadDisplayStatus
  onRecoveryInput: (r: 'yes' | 'no') => void
  onRestartRoom: () => void
  onRetryTurn: () => void
  onSkipTurn: () => void
}) {
  if (displayStatus !== 'needs_attention' && displayStatus !== 'error') return null
  return (
    <section className="panel recovery-card" aria-label="room-recovery">
      <div className="section-heading">
        <h2>Recovery</h2>
        <span>{statusLabel(displayStatus)}</span>
      </div>
      {room?.input_prompt ? (
        <>
          <p>{room.input_prompt.agent} is waiting for input.</p>
          <pre>{room.input_prompt.excerpt}</pre>
          <div className="inline-actions">
            <button type="button" onClick={() => onRecoveryInput('yes')}>Send Yes</button>
            <button type="button" onClick={() => onRecoveryInput('no')}>Send No</button>
          </div>
        </>
      ) : room?.session_state === 'missing' ? (
        <>
          <p>The room session is missing.</p>
          <button type="button" onClick={onRestartRoom}>Restart</button>
        </>
      ) : room?.active_job_id ? (
        <>
          <p>{room.last_error ?? 'The active turn needs a decision.'}</p>
          <div className="inline-actions">
            <button type="button" onClick={onRetryTurn}>Retry Turn</button>
            <button type="button" onClick={onSkipTurn}>Skip Turn</button>
          </div>
        </>
      ) : (
        <p>{room?.last_error ?? 'Open the room controls to recover.'}</p>
      )}
    </section>
  )
}

// ── SideRail content ──────────────────────────────────────────

function SideRailContent({
  thread,
  room,
  roomPreflight,
  threadContext,
  snapshotReports,
  proposals,
  integrity,
  displayStatus,
  emphasizedSection,
  contextChip,
  roomSummary,
  consolidationSummary,
  onRecoveryInput,
  onRestartRoom,
  onRetryTurn,
  onSkipTurn,
  onUpdate,
}: {
  thread: ThreadDetail
  room: AgentRoom | null
  roomPreflight: RoomPreflight | null
  threadContext: ThreadContext | null
  snapshotReports: SnapshotReport[]
  proposals: ConsolidationProposal[]
  integrity: IntegrityReport | null
  displayStatus: ThreadDisplayStatus
  emphasizedSection: string | null
  contextChip: string
  roomSummary: string
  consolidationSummary: string
  onRecoveryInput: (r: 'yes' | 'no') => void
  onRestartRoom: () => void
  onRetryTurn: () => void
  onSkipTurn: () => void
  onUpdate: () => void
}) {
  return (
    <>
      <IntegrityPanel threadId={thread.id} report={integrity} onUpdate={onUpdate} />

      <RecoveryCard
        room={room}
        displayStatus={displayStatus}
        onRecoveryInput={onRecoveryInput}
        onRestartRoom={onRestartRoom}
        onRetryTurn={onRetryTurn}
        onSkipTurn={onSkipTurn}
      />

      <div className={`sidebar-section ${emphasizedSection === 'room' ? 'sidebar-section--active' : ''}`}>
        <RoomPanel
          threadId={thread.id}
          threadStatus={thread.status}
          room={room}
          preflight={roomPreflight}
          hideRecoveryControls
          summary={roomSummary}
          onUpdate={onUpdate}
        />
      </div>

      {thread.status === 'open' ? (
        <div className={`sidebar-section ${emphasizedSection === 'consolidation' ? 'sidebar-section--active' : ''}`}>
          <ConsolidationPanel
            threadId={thread.id}
            room={room}
            proposals={proposals}
            summary={consolidationSummary}
            onUpdate={onUpdate}
          />
        </div>
      ) : null}

      <div className={`sidebar-section ${emphasizedSection === 'context' ? 'sidebar-section--active' : ''}`}>
        <ThreadContextPanel
          threadId={thread.id}
          threadStatus={thread.status}
          context={threadContext}
          reports={snapshotReports}
          summary={contextChip}
          onUpdate={onUpdate}
        />
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function ThreadPage() {
  const { id } = useParams<{ id: string }>()

  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [pendingDiscussions, setPendingDiscussions] = useState<PendingDiscussion[]>([])
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [room, setRoom] = useState<AgentRoom | null>(null)
  const [roomPreflight, setRoomPreflight] = useState<RoomPreflight | null>(null)
  const [proposals, setProposals] = useState<ConsolidationProposal[]>([])
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [savedOutputs, setSavedOutputs] = useState<SavedConsolidation[]>([])
  const [snapshotReports, setSnapshotReports] = useState<SnapshotReport[]>([])
  const [sourceThread, setSourceThread] = useState<ThreadDetail | null>(null)
  const [sourceProposal, setSourceProposal] = useState<ConsolidationProposal | null>(null)

  // Layout state
  const [bodyCollapsed, setBodyCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Scroll / new-comments tracking
  const mainRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const prevCommentIdsRef = useRef<Set<string>>(new Set())
  const [newCommentCount, setNewCommentCount] = useState(0)
  const firstNewCommentIdRef = useRef<string | null>(null)

  // Track bottom state on scroll
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    function onScroll() {
      if (!el) return
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 100
      setIsAtBottom(atBottom)
      if (atBottom) {
        setNewCommentCount(0)
        firstNewCommentIdRef.current = null
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Detect new comments
  useEffect(() => {
    if (!commentsLoaded) return
    const prev = prevCommentIdsRef.current
    const newOnes = comments.filter((c) => !prev.has(c.id))
    if (prev.size > 0 && newOnes.length > 0 && !isAtBottom) {
      setNewCommentCount((n) => n + newOnes.length)
      if (!firstNewCommentIdRef.current && newOnes[0]) {
        firstNewCommentIdRef.current = newOnes[0].id
      }
    }
    prevCommentIdsRef.current = new Set(comments.map((c) => c.id))
  }, [comments, isAtBottom, commentsLoaded])

  const refresh = useCallback(() => {
    if (!id) return
    getThread(id).then(setThread)
    listComments(id).then((c) => { setComments(c); setCommentsLoaded(true) })
    listPendingDiscussions(id).then(setPendingDiscussions)
    getThreadContext(id).then(setThreadContext)
    getRoom(id).then(setRoom)
    getRoomPreflight(id).then(setRoomPreflight)
    listConsolidations(id).then(setProposals)
    getIntegrity(id).then(setIntegrity)
    listSavedOutputs(id).then(setSavedOutputs)
    listSnapshotReports(id).then(setSnapshotReports)
  }, [id])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!thread?.parent_thread_id || !thread.created_from_consolidation_id) {
      setSourceThread(null); setSourceProposal(null); return
    }
    getThread(thread.parent_thread_id).then(setSourceThread)
    getConsolidation(thread.parent_thread_id, thread.created_from_consolidation_id)
      .then((d) => setSourceProposal(d.proposal))
  }, [thread?.created_from_consolidation_id, thread?.parent_thread_id])

  const onEvent = useCallback(
    (event: RoundtableEvent) => { if (event.thread_id === id) refresh() },
    [id, refresh],
  )
  useLiveRefresh(onEvent)

  async function addTopLevel(input: { body: string; type: CommentType }) {
    if (!id) return
    await createComment(id, input)
    refresh()
  }

  async function addReply(replyTo: string, input: { body: string; type: CommentType }) {
    if (!id) return
    await createComment(id, { ...input, reply_to: replyTo })
    refresh()
  }

  async function askDiscussion(discussionId: string, agent: AgentName) {
    if (!id) return
    await askAgent(id, { agent, discussion_id: discussionId })
    refresh()
  }

  async function sendRecoveryInput(response: 'yes' | 'no') {
    if (!id || !room?.input_prompt) return
    await sendRoomInputResponse(id, { agent: room.input_prompt.agent, response })
    refresh()
  }

  async function restartRecoveryRoom() {
    if (!id) return
    await restartRoom(id)
    refresh()
  }

  async function retryRecoveryTurn() {
    if (!id) return
    await retryTurn(id)
    refresh()
  }

  async function skipRecoveryTurn() {
    if (!id) return
    await skipTurn(id)
    refresh()
  }

  if (!thread) return <ThreadSkeleton />

  const displayStatus = displayStatusFor(thread, room, proposals)
  const emphasizedSection =
    displayStatus === 'setup' ? 'context'
    : displayStatus === 'discussing' ? 'pending'
    : displayStatus === 'needs_attention' || displayStatus === 'error' ? 'room'
    : displayStatus === 'consolidating' ? 'consolidation'
    : null

  const contextChip = contextSummary(threadContext)
  const activeProposal = proposals.find(isActiveProposal)
  const roomSummary = room?.status ? room.status.replaceAll('_', ' ') : 'loading'
  const consolidationSummary = activeProposal
    ? activeProposal.status
    : proposals.length > 0 ? `${proposals.length} total` : 'none'

  const pendingCount = pendingDiscussions.length
  const commentCount = comments.length

  const sideRailProps = {
    thread,
    room,
    roomPreflight,
    threadContext,
    snapshotReports,
    proposals,
    integrity,
    displayStatus,
    emphasizedSection,
    contextChip,
    roomSummary,
    consolidationSummary,
    onRecoveryInput: sendRecoveryInput,
    onRestartRoom: restartRecoveryRoom,
    onRetryTurn: retryRecoveryTurn,
    onSkipTurn: skipRecoveryTurn,
    onUpdate: refresh,
  }

  return (
    <div className="workspace-root">
      {/* ── Header strip ─────────────────────────────────────── */}
      <header className="workspace-header" aria-label="thread workspace header">
        <Link to="/" className="workspace-back" aria-label="All threads" title="All threads">
          ←
        </Link>

        <div className="workspace-header__title">
          <h1>{thread.title}</h1>
          {(sourceThread || contextChip !== 'No context') ? (
            <div className="workspace-header__meta">
              {contextChip !== 'No context' && contextChip !== 'loading'
                ? `Context: ${contextChip}`
                : null}
              {sourceThread ? (
                <span>
                  {contextChip !== 'No context' ? ' · ' : ''}
                  Continued from{' '}
                  <Link to={`/threads/${sourceThread.id}`}>{sourceThread.title}</Link>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="workspace-header__badges">
          {room?.auto?.status === 'running' ? (
            <span className="status-pill status-pill--running">
              <span className="button-spinner" style={{ width: 7, height: 7, marginRight: 4 }} aria-hidden="true" />
              Auto
            </span>
          ) : null}
          <span className={`status-pill status-pill--${displayStatus}`}>
            {statusLabel(displayStatus)}
          </span>
        </div>

        {/* Mobile details trigger */}
        <button
          type="button"
          className="workspace-details-trigger btn-ghost"
          style={{ fontSize: '0.8125rem' }}
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-label="Thread details"
        >
          Details
        </button>
      </header>

      {/* ── Body split ───────────────────────────────────────── */}
      <div className="workspace-body">
        {/* ── Main column ──────────────────────────────────── */}
        <main className="workspace-main" ref={mainRef} aria-label="thread discussion">

          {/* Thread body (collapsible) */}
          <div className="thread-body-section">
            {bodyCollapsed ? (
              <button
                className="thread-body-collapsed-bar"
                onClick={() => setBodyCollapsed(false)}
                aria-label="Expand thread body"
                type="button"
              >
                <span className="thread-body-collapsed-bar__icon" aria-hidden="true">◉</span>
                <span className="thread-body-collapsed-bar__title">{thread.title}</span>
                <span className="thread-body-collapsed-bar__caret" aria-hidden="true">▼ expand</span>
              </button>
            ) : (
              <div className="thread-body-card">
                <div className="thread-body-card__content">
                  <Markdown remarkPlugins={[remarkGfm]}>{thread.body}</Markdown>
                </div>
                <div className="thread-body-card__footer">
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: '0.8125rem' }}
                    onClick={() => setBodyCollapsed(true)}
                  >
                    Collapse ↑
                  </button>
                  {sourceThread && thread.created_from_consolidation_id ? (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-3)' }}>
                      Created from{' '}
                      <Link
                        to={`/threads/${sourceThread.id}/consolidations/${thread.created_from_consolidation_id}`}
                      >
                        {sourceProposal?.summary ?? thread.created_from_consolidation_id}
                      </Link>
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Saved outputs (closed threads) */}
          {thread.status === 'closed' && savedOutputs.length > 0 ? (
            <div className="saved-outputs-section">
              <h2 style={{ marginBottom: '0.4rem' }}>Saved Output</h2>
              {savedOutputs.map((saved) => (
                <p key={saved.id} style={{ margin: '0.2rem 0' }}>
                  <Link to={`/saved/${saved.id}`}>View final saved revision</Link>
                </p>
              ))}
            </div>
          ) : null}

          {/* Comment stream */}
          <section
            className="comment-stream"
            aria-label="discussion"
            id="comment-stream"
          >
            <div className="comment-stream-header">
              <h2>Discussion</h2>
              <span>
                {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
              </span>
            </div>

            {!commentsLoaded ? (
              /* Comment skeleton while loading */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {[44, 28, 62].map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                    <span className="sk" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span className="sk" style={{ width: 88, height: 12 }} />
                      <span className="sk" style={{ height: h, borderRadius: 8 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <CommentTree
                threadId={thread.id}
                comments={comments}
                pendingDiscussions={pendingDiscussions}
                onPendingUpdate={refresh}
                onReply={addReply}
                onAskDiscussion={askDiscussion}
                disableAgentActions={room?.auto?.status === 'running'}
                readOnly={thread.status !== 'open'}
              />
            )}

            {/* New comments pill (sticky above composer) */}
            <NewCommentsPill
              count={newCommentCount}
              firstNewId={firstNewCommentIdRef.current}
              onDismiss={() => {
                setNewCommentCount(0)
                firstNewCommentIdRef.current = null
              }}
            />
          </section>

          {/* Sticky composer */}
          {thread.status === 'open' ? (
            <div className="composer-anchor" aria-label="add discussion point">
              <CommentForm
                label="Add"
                threadId={thread.id}
                draftContext="root"
                onSubmit={addTopLevel}
              />
            </div>
          ) : (
            <div
              style={{
                position: 'sticky', bottom: 0,
                padding: '8px clamp(20px, 5vw, 48px)',
                borderTop: '1px solid var(--border)',
                background: 'rgba(247,246,244,0.95)',
                backdropFilter: 'blur(10px)',
                fontSize: '0.8125rem',
                color: 'var(--text-3)',
              }}
            >
              Thread is {thread.status} — no new comments.
            </div>
          )}
        </main>

        {/* ── Desktop side rail ─────────────────────────────── */}
        <aside className="workspace-sidebar" aria-label="thread details">
          <SideRailContent {...sideRailProps} />
        </aside>
      </div>

      {/* ── Mobile details drawer ─────────────────────────────── */}
      {drawerOpen ? (
        <>
          <div
            className="details-drawer-overlay"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            className="details-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Thread details"
          >
            <div className="details-drawer__header">
              <span className="details-drawer__title">Thread Details</span>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close details"
              >
                ✕
              </button>
            </div>
            <SideRailContent {...sideRailProps} />
          </div>
        </>
      ) : null}
    </div>
  )
}
