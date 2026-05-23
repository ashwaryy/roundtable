import { useState } from 'react'
import type { Comment, CommentType } from '@roundtable/shared'
import { groupComments } from '../lib/commentTree'
import { CommentForm } from './CommentForm'

export function CommentTree({
  comments,
  onReply,
}: {
  comments: Comment[]
  onReply: (
    replyTo: string,
    input: { body: string; type: CommentType },
  ) => Promise<void>
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
              {root.author} - {root.type}
            </header>
            <p>{root.body}</p>
          </article>

          <ul>
            {replies.map((reply) => (
              <li key={reply.id}>
                <article>
                  <header>
                    {reply.author} - {reply.type}
                  </header>
                  <p>{reply.body}</p>
                </article>
              </li>
            ))}
          </ul>

          {openReply === root.id ? (
            <CommentForm
              label="Reply"
              onSubmit={async (input) => {
                await onReply(root.id, input)
                setOpenReply(null)
              }}
            />
          ) : (
            <button onClick={() => setOpenReply(root.id)}>Reply</button>
          )}
        </li>
      ))}
    </ul>
  )
}
