import { useState } from 'react'
import type { AgentName, Comment, CommentType } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { groupComments } from '../lib/commentTree'
import { CommentForm } from './CommentForm'

const commentTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function CommentTimestamp({ createdAt }: { createdAt: string }) {
  return (
    <time dateTime={createdAt}>
      {commentTimestampFormatter.format(new Date(createdAt))}
    </time>
  )
}

export function CommentTree({
  comments,
  onReply,
  onAskDiscussion,
  readOnly = false,
}: {
  comments: Comment[]
  onReply: (
    replyTo: string,
    input: { body: string; type: CommentType },
  ) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  readOnly?: boolean
}) {
  const groups = groupComments(comments)
  const [openReply, setOpenReply] = useState<string | null>(null)

  if (groups.length === 0) {
    return <p>No discussion yet.</p>
  }

  return (
    <ul>
      {groups.map(({ root, replies }) => (
        <li key={root.id}>
          <article>
            <header>
              {root.author} - {root.type} - <CommentTimestamp createdAt={root.created_at} />
            </header>
            <Markdown remarkPlugins={[remarkGfm]}>{root.body}</Markdown>
          </article>

          <ul>
            {replies.map((reply) => (
              <li key={reply.id}>
                <article>
                  <header>
                    {reply.author} - {reply.type} -{' '}
                    <CommentTimestamp createdAt={reply.created_at} />
                  </header>
                  <Markdown remarkPlugins={[remarkGfm]}>{reply.body}</Markdown>
                </article>
              </li>
            ))}
          </ul>

          {!readOnly && openReply === root.id ? (
            <CommentForm
              label="Reply"
              onSubmit={async (input) => {
                await onReply(root.id, input)
                setOpenReply(null)
              }}
            />
          ) : null}
          {!readOnly && openReply !== root.id ? (
            <button onClick={() => setOpenReply(root.id)}>Reply</button>
          ) : null}
          {!readOnly ? (
            <>
              <button onClick={() => onAskDiscussion(root.id, 'claude')}>
                Ask Claude
              </button>
              <button onClick={() => onAskDiscussion(root.id, 'codex')}>
                Ask Codex
              </button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
