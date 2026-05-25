import { useState } from 'react'
import type { AgentName, Comment, CommentType, PendingDiscussion } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { groupComments } from '../lib/commentTree'
import { CommentForm } from './CommentForm'
import { PendingDiscussionModerationCard } from './PendingDiscussionQueue'

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

function excerpt(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim()
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact
}

export function CommentTree({
  comments,
  pendingDiscussions = [],
  threadId,
  onPendingUpdate,
  onReply,
  onAskDiscussion,
  disableAgentActions = false,
  readOnly = false,
}: {
  comments: Comment[]
  pendingDiscussions?: PendingDiscussion[]
  threadId: string
  onPendingUpdate: () => void
  onReply: (
    replyTo: string,
    input: { body: string; type: CommentType },
  ) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  disableAgentActions?: boolean
  readOnly?: boolean
}) {
  const groups = groupComments(comments)
  const [openReply, setOpenReply] = useState<string | null>(null)
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]))
  const pendingByDiscussion = new Map<string, PendingDiscussion[]>()
  const pendingWithoutOrigin: PendingDiscussion[] = []

  for (const pending of pendingDiscussions) {
    if (!pending.origin_discussion_id) {
      pendingWithoutOrigin.push(pending)
      continue
    }
    const existing = pendingByDiscussion.get(pending.origin_discussion_id) ?? []
    existing.push(pending)
    pendingByDiscussion.set(pending.origin_discussion_id, existing)
  }

  function originExcerpt(pending: PendingDiscussion): string | null {
    const origin =
      (pending.origin_comment_id && commentsById.get(pending.origin_comment_id)) ||
      (pending.origin_discussion_id && commentsById.get(pending.origin_discussion_id)) ||
      null
    return origin ? excerpt(origin.body) : null
  }

  if (groups.length === 0 && pendingDiscussions.length === 0) {
    return <p>No discussion yet.</p>
  }

  return (
    <>
      <ul>
        {groups.map(({ root, replies }) => (
          <li key={root.id}>
            <article id={root.id}>
              <header>
                {root.author} - {root.type} - <CommentTimestamp createdAt={root.created_at} />
              </header>
              {root.origin_discussion_id || root.origin_comment_id ? (
                <p className="pending-origin">
                  Split from {root.origin_comment_id ?? root.origin_discussion_id}
                </p>
              ) : null}
              <Markdown remarkPlugins={[remarkGfm]}>{root.body}</Markdown>
            </article>

            <ul>
              {replies.map((reply) => (
                <li key={reply.id}>
                  <article id={reply.id}>
                    <header>
                      {reply.author} - {reply.type} -{' '}
                      <CommentTimestamp createdAt={reply.created_at} />
                    </header>
                    <Markdown remarkPlugins={[remarkGfm]}>{reply.body}</Markdown>
                  </article>
                </li>
              ))}
            </ul>

            {pendingByDiscussion.get(root.id)?.map((pending) => (
              <PendingDiscussionModerationCard
                key={pending.id}
                threadId={threadId}
                discussion={pending}
                originExcerpt={originExcerpt(pending)}
                onUpdate={onPendingUpdate}
              />
            ))}

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
              <button type="button" onClick={() => setOpenReply(root.id)}>Reply</button>
            ) : null}
            {!readOnly ? (
              <div className="discussion-actions">
                <button
                  type="button"
                  disabled={disableAgentActions}
                  onClick={() => onAskDiscussion(root.id, 'claude')}
                >
                  Ask Claude in this discussion
                </button>
                <button
                  type="button"
                  disabled={disableAgentActions}
                  onClick={() => onAskDiscussion(root.id, 'codex')}
                >
                  Ask Codex in this discussion
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {pendingWithoutOrigin.length > 0 ? (
        <div className="pending-inline">
          {pendingWithoutOrigin.map((pending) => (
            <PendingDiscussionModerationCard
              key={pending.id}
              threadId={threadId}
              discussion={pending}
              originExcerpt={originExcerpt(pending)}
              onUpdate={onPendingUpdate}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
