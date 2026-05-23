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
} from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { CommentForm } from '../components/CommentForm'
import { CommentTree } from '../components/CommentTree'
import { PendingDiscussionQueue } from '../components/PendingDiscussionQueue'
import { ThreadContextPanel } from '../components/ThreadContextPanel'
import { RoomPanel } from '../components/RoomPanel'

export function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [pendingDiscussions, setPendingDiscussions] = useState<PendingDiscussion[]>([])
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [room, setRoom] = useState<AgentRoom | null>(null)
  const [roomPreflight, setRoomPreflight] = useState<RoomPreflight | null>(null)

  const refresh = useCallback(() => {
    if (!id) return
    getThread(id).then(setThread)
    listComments(id).then(setComments)
    listPendingDiscussions(id).then(setPendingDiscussions)
    getThreadContext(id).then(setThreadContext)
    getRoom(id).then(setRoom)
    getRoomPreflight(id).then(setRoomPreflight)
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
          <section className="panel thread-body" aria-label="thread-body">
            <Markdown remarkPlugins={[remarkGfm]}>{thread.body}</Markdown>
          </section>

          <section className="panel">
            <div className="section-heading">
              <h2>Discussion</h2>
              <span>{comments.length} comments</span>
            </div>
            <CommentForm label="Add discussion point" onSubmit={addTopLevel} />
            <CommentTree
              comments={comments}
              onReply={addReply}
              onAskDiscussion={askDiscussion}
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
            onUpdate={refresh}
          />

          <RoomPanel
            threadId={thread.id}
            room={room}
            preflight={roomPreflight}
            onUpdate={refresh}
          />
        </aside>
      </div>
    </main>
  )
}
