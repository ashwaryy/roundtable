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
  listConsolidations,
  getIntegrity,
  listSavedOutputs,
  listSnapshotReports,
} from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { CommentForm } from '../components/CommentForm'
import { CommentTree } from '../components/CommentTree'
import { PendingDiscussionQueue } from '../components/PendingDiscussionQueue'
import { ThreadContextPanel } from '../components/ThreadContextPanel'
import { RoomPanel } from '../components/RoomPanel'
import { ConsolidationPanel } from '../components/ConsolidationPanel'
import { IntegrityPanel } from '../components/IntegrityPanel'

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

  if (!thread) return <p>Loading...</p>

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <Link to="/" className="back-link">
            All threads
          </Link>
          <h1>{thread.title}</h1>
        </div>
        {room ? <span className={`status-pill status-pill--${room.status}`}>{room.status}</span> : null}
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

          <section className="panel">
            <div className="section-heading">
              <h2>Discussion</h2>
              <span>{comments.length} comments</span>
            </div>
            {thread.status === 'open' ? (
              <CommentForm label="Add discussion point" onSubmit={addTopLevel} />
            ) : null}
            <CommentTree
              comments={comments}
              onReply={addReply}
              onAskDiscussion={askDiscussion}
              disableAgentActions={room?.auto?.status === 'running'}
              readOnly={thread.status !== 'open'}
            />
          </section>
        </div>

        <aside className="thread-sidebar">
          <section className="panel">
            <h2>Pending Discussions</h2>
            <PendingDiscussionQueue
              threadId={thread.id}
              discussions={pendingDiscussions}
              onUpdate={refresh}
            />
          </section>

          <ThreadContextPanel
            threadId={thread.id}
            context={threadContext}
            reports={snapshotReports}
            onUpdate={refresh}
          />

          <RoomPanel
            threadId={thread.id}
            room={room}
            preflight={roomPreflight}
            onUpdate={refresh}
          />

          {thread.status === 'open' ? (
            <ConsolidationPanel
              threadId={thread.id}
              room={room}
              proposals={proposals}
              onUpdate={refresh}
            />
          ) : null}
        </aside>
      </div>
    </main>
  )
}
