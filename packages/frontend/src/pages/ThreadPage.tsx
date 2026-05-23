import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ThreadDetail,
  Comment,
  CommentType,
  RoundtableEvent,
} from '@roundtable/shared'
import { getThread, listComments, createComment } from '../api'
import { useLiveRefresh } from '../useLiveRefresh'
import { CommentForm } from '../components/CommentForm'
import { CommentTree } from '../components/CommentTree'

export function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])

  const refresh = useCallback(() => {
    if (!id) return
    getThread(id).then(setThread)
    listComments(id).then(setComments)
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
    </main>
  )
}
