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
  ThreadContext,
} from '@roundtable/shared'
import {
  getThread,
  listComments,
  createComment,
  listPendingDiscussions,
  getThreadContext,
} from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { CommentForm } from '../components/CommentForm'
import { CommentTree } from '../components/CommentTree'
import { PendingDiscussionQueue } from '../components/PendingDiscussionQueue'
import { ThreadContextPanel } from '../components/ThreadContextPanel'

export function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [pendingDiscussions, setPendingDiscussions] = useState<PendingDiscussion[]>([])
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)

  const refresh = useCallback(() => {
    if (!id) return
    getThread(id).then(setThread)
    listComments(id).then(setComments)
    listPendingDiscussions(id).then(setPendingDiscussions)
    getThreadContext(id).then(setThreadContext)
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

  if (!thread) return <p>Loading...</p>

  return (
    <main>
      <p>
        <Link to="/">All threads</Link>
      </p>
      <h1>{thread.title}</h1>
      <section aria-label="thread-body">
        <Markdown remarkPlugins={[remarkGfm]}>{thread.body}</Markdown>
      </section>

      <h2>Discussion</h2>
      <CommentForm label="Add discussion point" onSubmit={addTopLevel} />
      <CommentTree comments={comments} onReply={addReply} />

      <h2>Pending Discussions</h2>
      <PendingDiscussionQueue
        threadId={thread.id}
        discussions={pendingDiscussions}
        onUpdate={refresh}
      />

      <ThreadContextPanel
        threadId={thread.id}
        context={threadContext}
        onUpdate={refresh}
      />
    </main>
  )
}
