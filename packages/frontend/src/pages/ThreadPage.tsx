import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
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
  deleteComment,
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
import type { CommentSortOrder } from '../lib/commentTree'
import { ThreadAttachmentsPanel, ThreadContextPanel } from '../components/ThreadContextPanel'
import { RoomPanel } from '../components/RoomPanel'
import { ConsolidationPanel } from '../components/ConsolidationPanel'
import { IntegrityPanel } from '../components/IntegrityPanel'
import { NewCommentsPill } from '../components/NewCommentsPill'
import { ThreadSkeleton } from '../components/ThreadSkeleton'
import { AgentStack, Avatar, Icon, StatusPill } from '../components/primitives'
import { ThemeToggle } from '../components/ThemeToggle'
import {
  RAIL_COLLAPSED_STORAGE_KEY,
  readStoredBoolean,
  writeStoredBoolean,
} from '../lib/uiStorage'

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

function RailSection({
  label,
  count,
  defaultOpen = true,
  storageKey,
  right,
  children,
}: {
  label: string
  count?: number
  defaultOpen?: boolean
  storageKey?: string
  right?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(() =>
    storageKey ? readStoredBoolean(storageKey, defaultOpen) : defaultOpen,
  )

  useEffect(() => {
    if (!storageKey) return
    writeStoredBoolean(storageKey, open)
  }, [open, storageKey])

  return (
    <section className="rail-section" data-open={open ? '1' : '0'}>
      <button type="button" className="rail-section-head" onClick={() => setOpen((value) => !value)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="lbl">{label}</span>
          {count != null ? <span className="rail-section-count">{count}</span> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {right}
          <Icon name="chevronD" className="ic-sm chev" />
        </div>
      </button>
      <div className="rail-section-body">{children}</div>
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

      <div className={emphasizedSection === 'room' ? 'sidebar-section--active' : ''}>
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
        <RailSection
          label="Consolidate"
          defaultOpen={displayStatus === 'consolidating'}
          storageKey="roundtable.railSection.consolidate"
          right={proposals.length > 0 ? <span className="rail-section-count">{proposals.length} past</span> : null}
        >
          <div className={emphasizedSection === 'consolidation' ? 'sidebar-section--active' : ''}>
          <ConsolidationPanel
            threadId={thread.id}
            room={room}
            proposals={proposals}
            summary={consolidationSummary}
            onUpdate={onUpdate}
          />
          </div>
        </RailSection>
      ) : null}

      <RailSection
        label="Context"
        defaultOpen={false}
        storageKey="roundtable.railSection.context"
        right={<span className="mono rail-section-count">{contextChip}</span>}
      >
      <div className={emphasizedSection === 'context' ? 'sidebar-section--active' : ''}>
        <ThreadContextPanel
          threadId={thread.id}
          threadStatus={thread.status}
          context={threadContext}
          reports={snapshotReports}
          summary={contextChip}
          onUpdate={onUpdate}
        />
      </div>
      </RailSection>

      <RailSection label="Attachments" count={threadContext?.items.length ?? 0} defaultOpen={false}>
        <ThreadAttachmentsPanel
          threadId={thread.id}
          threadStatus={thread.status}
          context={threadContext}
          onUpdate={onUpdate}
        />
      </RailSection>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

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
  const [railCollapsed, setRailCollapsed] = useState(() =>
    readStoredBoolean(RAIL_COLLAPSED_STORAGE_KEY, false),
  )
  const [commentSortOrder, setCommentSortOrder] = useState<CommentSortOrder>('oldest')

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
    writeStoredBoolean(RAIL_COLLAPSED_STORAGE_KEY, railCollapsed)
  }, [railCollapsed])

  useEffect(() => {
    if (!thread?.parent_thread_id || !thread.created_from_consolidation_id) {
      setSourceThread(null); setSourceProposal(null); return
    }
    getThread(thread.parent_thread_id).then(setSourceThread).catch(() => setSourceThread(null))
    getConsolidation(thread.parent_thread_id, thread.created_from_consolidation_id)
      .then((d) => setSourceProposal(d.proposal))
      .catch(() => setSourceProposal(null))
  }, [thread?.created_from_consolidation_id, thread?.parent_thread_id])

  const onEvent = useCallback(
    (event: RoundtableEvent) => {
      if (event.thread_id !== id) return
      if (event.type === 'thread_deleted') {
        navigate('/')
        return
      }
      refresh()
    },
    [id, navigate, refresh],
  )
  const backendStatus = useLiveRefresh(onEvent)
  const backendStatusLabel = `Backend ${backendStatus}`

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

  async function removeComment(commentId: string) {
    if (!id) return
    await deleteComment(id, commentId)
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
  const primarySavedOutput = savedOutputs[0] ?? null

  const pendingCount = pendingDiscussions.length
  const commentCount = comments.length
  const threadCount = comments.filter((c) => !c.parent_id).length

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
    <div
      className="workspace-root"
      style={{ '--sidebar-w': railCollapsed ? '52px' : '340px' } as CSSProperties}
    >
      {/* ── Header strip ─────────────────────────────────────── */}
      <header className="workspace-header" aria-label="thread workspace header">
        <Link to="/" className="workspace-back" aria-label="All threads" title="All threads">
          <Icon name="arrowLeft" className="ic" />
        </Link>

        <Link to="/" className="workspace-brand" aria-label="Roundtable home">
          <span
            className="workspace-brand__dot"
            data-backend-status={backendStatus}
            aria-label={backendStatusLabel}
            title={backendStatusLabel}
          />
          <span>Roundtable</span>
        </Link>

        <div className="workspace-header__title">
          <div className="workspace-crumbs">
            <Link to="/">threads</Link>
            <span>/</span>
            <span className="workspace-crumbs__file mono">thread.md</span>
            <span>/</span>
            <strong>{thread.title}</strong>
          </div>
        </div>

        <div className="workspace-header__badges">
          {room?.auto?.status === 'running' ? (
            <span className="status-pill status-pill--running">
              <span className="button-spinner" style={{ width: 7, height: 7, marginRight: 4 }} aria-hidden="true" />
              Auto
            </span>
          ) : null}
          <StatusPill status={displayStatus} pendingCount={pendingCount} />
          <AgentStack agents={['claude', 'codex']} size={18} />
          <ThemeToggle />
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

          {/* Source thread (collapsible hero) */}
          <div className="thread-body-section">
            {bodyCollapsed ? (
              <button
                type="button"
                className="source-collapsed"
                onClick={() => setBodyCollapsed(false)}
                aria-label="Expand thread body"
              >
                <span className="source-collapsed-dot" aria-hidden="true" />
                <span className="source-collapsed-title">{thread.title}</span>
                <span className="source-collapsed-meta">
                  <Icon name="file" className="ic-sm" /> thread.md
                </span>
                <span className="source-collapsed-caret">
                  <Icon name="chevronD" className="ic-sm" /> expand
                </span>
              </button>
            ) : (
              <div className="source">
                <div className="source-eyebrow">
                  <span className="eyebrow tight">Source thread</span>
                  <span style={{ color: 'var(--rule-strong)' }}>·</span>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    thread.md
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(thread.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="source-title-row">
                  <h1 className="source-title">{thread.title}</h1>
                  {primarySavedOutput ? (
                    <Link
                      to={`/saved/${primarySavedOutput.id}`}
                      className="source-saved-link"
                      aria-label={`View saved output for ${thread.title}`}
                    >
                      <Icon name="file" className="ic-sm" />
                      Saved output
                      <Icon name="arrowRight" className="ic-sm" />
                    </Link>
                  ) : null}
                </div>
                <div className="source-body">
                  <Markdown remarkPlugins={[remarkGfm]}>{thread.body}</Markdown>
                </div>
                {sourceThread && thread.created_from_consolidation_id ? (
                  <div className="source-lineage">
                    <Icon name="link" className="ic-sm" />
                    Continued from{' '}
                    <Link
                      to={`/threads/${sourceThread.id}/consolidations/${thread.created_from_consolidation_id}`}
                    >
                      {sourceProposal?.summary ?? sourceThread.title}
                    </Link>
                  </div>
                ) : null}
                <div className="source-foot">
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setBodyCollapsed(true)}
                  >
                    <Icon name="collapse" className="ic-sm" /> Collapse source
                  </button>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(window.location.href)
                    }}
                  >
                    <Icon name="link" className="ic-sm" /> Copy link
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Comment stream */}
          <section
            className="comment-stream"
            aria-label="discussion"
            id="comment-stream"
          >
            <div className="discussion-head">
              <h2 className="h-2">Discussion</h2>
              <div className="discuss-tools">
                <span className="count">
                  {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                  {threadCount > 0 ? ` · ${threadCount} ${threadCount === 1 ? 'thread' : 'threads'}` : ''}
                  {pendingCount > 0 ? (
                    <>
                      {' · '}
                      <b style={{ color: 'var(--warn)' }}>{pendingCount} pending</b>
                    </>
                  ) : null}
                </span>
                <span style={{ color: 'var(--rule-strong)' }}>·</span>
                <button
                  type="button"
                  className="sort"
                  aria-label={`Sort discussion ${commentSortOrder === 'oldest' ? 'newest first' : 'oldest first'}`}
                  onClick={() =>
                    setCommentSortOrder((order) => (order === 'oldest' ? 'newest' : 'oldest'))
                  }
                >
                  <Icon name="filter" className="ic-sm" />
                  {commentSortOrder === 'oldest' ? 'oldest first' : 'newest first'}
                </button>
              </div>
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
                onDelete={removeComment}
                onAskDiscussion={askDiscussion}
                disableAgentActions={room?.auto?.status === 'running'}
                readOnly={thread.status !== 'open'}
                sortOrder={commentSortOrder}
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
              <div className="composer-card" style={{ maxWidth: 920, margin: '0 auto' }}>
                <CommentForm
                  label="Post"
                  threadId={thread.id}
                  draftContext="root"
                  onSubmit={addTopLevel}
                />
                {room?.auto?.status === 'running' ? (
                  <div className="composer-hint">
                    <Icon name="play" className="ic-sm" />
                    <span>
                      Auto-discussion is running ({room.auto.completed_turns}/
                      {room.auto.total_turns}). Your post is durable, but agents won't
                      react until the run completes.
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="composer-anchor">
              <div
                className="composer-card archived"
                style={{ maxWidth: 920, margin: '0 auto' }}
              >
                <div className="archived-banner">
                  <Icon name={thread.status === 'closed' ? 'check' : 'archive'} className="ic-sm" />{' '}
                  Thread is {thread.status} — no new comments.
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── Desktop side rail ─────────────────────────────── */}
        <aside className={`workspace-sidebar rail ${railCollapsed ? 'rail--collapsed' : ''}`} aria-label="thread details">
          {railCollapsed ? (
            <div className="rail-collapsed-strip">
              <button type="button" className="strip-icon" onClick={() => setRailCollapsed(false)} title="Expand rail">
                <Icon name="chevronL" className="ic-sm" />
              </button>
              <div className="strip-sep" />
              <div className="vlabel">Room</div>
              <Avatar author="claude" size={26} />
              <Avatar author="codex" size={26} />
              <span title={displayStatus} className="strip-state" data-state={displayStatus} />
              {room?.auto?.status === 'running' ? <span className="strip-auto" title="Auto running">A</span> : null}
              <div className="strip-sep" />
              <button type="button" className="strip-icon" title="Nudge"><Icon name="send" className="ic-sm" /></button>
              <button type="button" className="strip-icon" title="Ask"><Icon name="spark" className="ic-sm" /></button>
              <button type="button" className="strip-icon" title="Auto"><Icon name="play" className="ic-sm" /></button>
            </div>
          ) : (
            <>
              <div className="rail-head">
                <div className="title">
                  <Icon name="terminal" className="ic-sm" />
                  Agent Room
                </div>
                <button type="button" className="btn ghost icon" onClick={() => setRailCollapsed(true)} title="Collapse rail">
                  <Icon name="chevronR" className="ic-sm" />
                </button>
              </div>
              <div className="rail-body">
                <SideRailContent {...sideRailProps} />
              </div>
            </>
          )}
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
