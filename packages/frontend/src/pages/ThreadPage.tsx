import { useCallback, useEffect, useState } from 'react'
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

function isActiveProposal(proposal: ConsolidationProposal): boolean {
  return proposal.status === 'drafting' || proposal.status === 'review'
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
  ) {
    return 'needs_attention'
  }
  if (proposals.some(isActiveProposal)) return 'consolidating'
  if (!room || room.status === 'not_started' || room.status === 'stopped') return 'setup'
  return 'discussing'
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}

function contextSummary(context: ThreadContext | null): string {
  if (!context) return 'loading'
  if (context.snapshot) return basename(context.snapshot.source_path)
  const first = context.items[0]
  if (!first) return 'No context'
  return first.kind === 'file' ? first.original_name : first.label ?? first.url
}

function statusLabel(status: ThreadDisplayStatus): string {
  switch (status) {
    case 'setup':
      return 'Setup'
    case 'discussing':
      return 'Discussing'
    case 'consolidating':
      return 'Consolidating'
    case 'needs_attention':
      return 'Needs attention'
    case 'error':
      return 'Error'
    case 'closed':
      return 'Closed'
    case 'archived':
      return 'Archived'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
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

  const refresh = useCallback(() => {
    if (!id) return
    getThread(id).then(setThread)
    listComments(id).then(setComments)
    listPendingDiscussions(id).then(setPendingDiscussions)
    getThreadContext(id).then(setThreadContext)
    getRoom(id).then(setRoom)
    getRoomPreflight(id).then(setRoomPreflight)
    listConsolidations(id).then(setProposals)
    getIntegrity(id).then(setIntegrity)
    listSavedOutputs(id).then(setSavedOutputs)
    listSnapshotReports(id).then(setSnapshotReports)
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!thread?.parent_thread_id || !thread.created_from_consolidation_id) {
      setSourceThread(null)
      setSourceProposal(null)
      return
    }

    getThread(thread.parent_thread_id).then(setSourceThread)
    getConsolidation(
      thread.parent_thread_id,
      thread.created_from_consolidation_id,
    ).then((detail) => setSourceProposal(detail.proposal))
  }, [thread?.created_from_consolidation_id, thread?.parent_thread_id])

  const onEvent = useCallback(
    (event: RoundtableEvent) => {
      if (event.thread_id === id) refresh()
    },
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
    await sendRoomInputResponse(id, {
      agent: room.input_prompt.agent,
      response,
    })
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

  if (!thread) return <p>Loading...</p>

  const displayStatus = displayStatusFor(thread, room, proposals)
  const emphasizedSection =
    displayStatus === 'setup'
      ? 'context'
      : displayStatus === 'discussing'
        ? 'pending'
        : displayStatus === 'needs_attention' || displayStatus === 'error'
          ? 'room'
          : displayStatus === 'consolidating'
            ? 'consolidation'
            : null
  const contextChip = contextSummary(threadContext)
  const activeProposal = proposals.find(isActiveProposal)
  const pendingSummary =
    pendingDiscussions.length > 0 ? `${pendingDiscussions.length} pending` : 'none'
  const roomSummary = room?.status ? room.status.replaceAll('_', ' ') : 'loading'
  const consolidationSummary = activeProposal
    ? activeProposal.status
    : proposals.length > 0
      ? `${proposals.length} total`
      : 'none'

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <Link to="/" className="back-link">
            All threads
          </Link>
          <h1>{thread.title}</h1>
          <div className="metadata-row">
            <span>Context: {contextChip}</span>
            {sourceThread ? (
              <span>
                Continued from:{' '}
                <Link to={`/threads/${sourceThread.id}`}>{sourceThread.title}</Link>
              </span>
            ) : null}
            {sourceThread && thread.created_from_consolidation_id ? (
              <span>
                Created from consolidation:{' '}
                <Link
                  to={`/threads/${sourceThread.id}/consolidations/${thread.created_from_consolidation_id}`}
                >
                  {sourceProposal?.summary ?? thread.created_from_consolidation_id}
                </Link>
              </span>
            ) : null}
          </div>
        </div>
        <span className={`status-pill status-pill--${displayStatus}`}>
          {statusLabel(displayStatus)}
        </span>
      </header>

      <div className="thread-layout">
        <div className="thread-main">
          <IntegrityPanel threadId={thread.id} report={integrity} onUpdate={refresh} />
          <section className="panel thread-body" aria-label="thread-body">
            <Markdown remarkPlugins={[remarkGfm]}>{thread.body}</Markdown>
          </section>

          {thread.status === 'closed' && savedOutputs.length > 0 ? (
            <section className="panel" aria-label="saved-outputs">
              <h2>Saved Output</h2>
              {savedOutputs.map((saved) => (
                <p key={saved.id}>
                  <Link to={`/saved/${saved.id}`}>View final saved revision</Link>
                </p>
              ))}
            </section>
          ) : null}

          <section className="panel" id="pending-discussions">
            <div className="section-heading">
              <h2>Discussion</h2>
              <span>
                {comments.length} comments
                {pendingDiscussions.length > 0
                  ? ` · ${pendingDiscussions.length} pending`
                  : ''}
              </span>
            </div>
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
            {thread.status === 'open' ? (
              <div className="discussion-composer">
                <CommentForm label="Add discussion point" onSubmit={addTopLevel} />
              </div>
            ) : null}
          </section>
        </div>

        <aside className="thread-sidebar">
          <section
            className={`panel sidebar-section ${
              emphasizedSection === 'pending' ? 'sidebar-section--active' : ''
            }`}
          >
            <div className="section-heading">
              <h2>Pending Discussions</h2>
              <span>Pending: {pendingSummary}</span>
            </div>
            {pendingDiscussions.length > 0 ? (
              <p>
                <a href="#pending-discussions">Review pending discussion cards</a>
              </p>
            ) : (
              <p className="empty-state">No pending discussions.</p>
            )}
          </section>

          <div
            className={`sidebar-section ${
              emphasizedSection === 'context' ? 'sidebar-section--active' : ''
            }`}
          >
            <ThreadContextPanel
              threadId={thread.id}
              context={threadContext}
              reports={snapshotReports}
              summary={contextChip}
              onUpdate={refresh}
            />
          </div>

          <div
            className={`sidebar-section ${
              emphasizedSection === 'room' ? 'sidebar-section--active' : ''
            }`}
          >
            {displayStatus === 'needs_attention' || displayStatus === 'error' ? (
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
                      <button type="button" onClick={() => sendRecoveryInput('yes')}>
                        Send Yes
                      </button>
                      <button type="button" onClick={() => sendRecoveryInput('no')}>
                        Send No
                      </button>
                    </div>
                  </>
                ) : room?.session_state === 'missing' ? (
                  <>
                    <p>The room session is missing.</p>
                    <button type="button" onClick={restartRecoveryRoom}>
                      Restart
                    </button>
                  </>
                ) : room?.active_job_id ? (
                  <>
                    <p>{room.last_error ?? 'The active turn needs a decision.'}</p>
                    <div className="inline-actions">
                      <button type="button" onClick={retryRecoveryTurn}>
                        Retry Turn
                      </button>
                      <button type="button" onClick={skipRecoveryTurn}>
                        Skip Turn
                      </button>
                    </div>
                  </>
                ) : (
                  <p>{room?.last_error ?? 'Open the room controls to recover.'}</p>
                )}
              </section>
            ) : null}

            <RoomPanel
              threadId={thread.id}
              room={room}
              preflight={roomPreflight}
              hideRecoveryControls
              summary={roomSummary}
              onUpdate={refresh}
            />
          </div>

          {thread.status === 'open' ? (
            <div
              className={`sidebar-section ${
                emphasizedSection === 'consolidation' ? 'sidebar-section--active' : ''
              }`}
            >
              <ConsolidationPanel
                threadId={thread.id}
                room={room}
                proposals={proposals}
                summary={consolidationSummary}
                onUpdate={refresh}
              />
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  )
}
