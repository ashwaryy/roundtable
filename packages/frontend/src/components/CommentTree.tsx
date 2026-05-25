import { useState } from 'react'
import type { AgentName, Comment, CommentType, PendingDiscussion } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { groupComments } from '../lib/commentTree'
import { CommentForm } from './CommentForm'
import { PendingDiscussionModerationCard } from './PendingDiscussionQueue'
import { AgentAvatar } from './AgentAvatar'

const tsFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

function CommentTimestamp({ createdAt }: { createdAt: string }) {
  return (
    <time className="comment-cluster__timestamp" dateTime={createdAt}>
      {tsFormatter.format(new Date(createdAt))}
    </time>
  )
}

function excerpt(body: string): string {
  const c = body.replace(/\s+/g, ' ').trim()
  return c.length > 96 ? `${c.slice(0, 93)}…` : c
}

/** Group consecutive replies from the same author into sub-clusters. */
function replySubClusters(replies: Comment[]): Array<{ author: string; comments: Comment[] }> {
  const clusters: Array<{ author: string; comments: Comment[] }> = []
  for (const reply of replies) {
    const last = clusters[clusters.length - 1]
    if (last && last.author === reply.author) {
      last.comments.push(reply)
    } else {
      clusters.push({ author: reply.author, comments: [reply] })
    }
  }
  return clusters
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
  onReply: (replyTo: string, input: { body: string; type: CommentType }) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  disableAgentActions?: boolean
  readOnly?: boolean
}) {
  const groups = groupComments(comments)
  const [openReply, setOpenReply] = useState<string | null>(null)

  const commentsById = new Map(comments.map((c) => [c.id, c]))
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
    return (
      <div className="empty-stream">
        <div className="empty-stream__icon">◌</div>
        <p className="empty-stream__title">No discussion yet</p>
        <p className="empty-stream__sub">Add a discussion point below to get started.</p>
      </div>
    )
  }

  return (
    <div>
      {groups.map(({ root, replies }) => {
        const subClusters = replySubClusters(replies)

        return (
          <div key={root.id}>
            {/* Root comment cluster */}
            <div
              className={`comment-cluster ${replies.length > 0 ? 'comment-cluster--multi' : ''}`}
            >
              <div className="comment-cluster__avatar-col">
                <AgentAvatar author={root.author} size={28} />
              </div>
              <div className="comment-cluster__body">
                <div className="comment-cluster__meta">
                  <span className={`comment-cluster__author comment-cluster__author--${root.author}`}>
                    {root.author}
                  </span>
                  {root.type !== 'comment' ? (
                    <span className={`type-badge type-badge--${root.type}`}>{root.type}</span>
                  ) : null}
                  <CommentTimestamp createdAt={root.created_at} />
                </div>

                {root.origin_discussion_id || root.origin_comment_id ? (
                  <div className="pending-block__origin" style={{ marginBottom: 6 }}>
                    Split from {root.origin_comment_id ?? root.origin_discussion_id}
                  </div>
                ) : null}

                <div
                  id={root.id}
                  className={`comment-bubble comment-bubble--${root.author} comment-new-anchor`}
                  tabIndex={-1}
                >
                  <div className="comment-bubble__body">
                    <Markdown remarkPlugins={[remarkGfm]}>{root.body}</Markdown>
                  </div>
                </div>

                {!readOnly ? (
                  <div className="comment-actions">
                    <button
                      type="button"
                      className="comment-action-btn"
                      onClick={() => setOpenReply(openReply === root.id ? null : root.id)}
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      className="comment-action-btn"
                      disabled={disableAgentActions}
                      onClick={() => onAskDiscussion(root.id, 'claude')}
                    >
                      Ask Claude
                    </button>
                    <button
                      type="button"
                      className="comment-action-btn"
                      disabled={disableAgentActions}
                      onClick={() => onAskDiscussion(root.id, 'codex')}
                    >
                      Ask Codex
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Reply sub-clusters */}
            {subClusters.length > 0 ? (
              <div className="reply-group">
                {subClusters.map((sub, si) => (
                  <div key={`${root.id}-sub-${si}`} className="reply-cluster">
                    <AgentAvatar author={sub.author} size={22} />
                    <div className="reply-cluster__body">
                      <div className="reply-cluster__meta">
                        <span className={`comment-cluster__author comment-cluster__author--${sub.author}`}
                          style={{ fontSize: '0.8125rem' }}>
                          {sub.author}
                        </span>
                        {sub.comments[0]?.type !== 'comment' ? (
                          <span className={`type-badge type-badge--${sub.comments[0].type}`}>
                            {sub.comments[0].type}
                          </span>
                        ) : null}
                        <time className="comment-cluster__timestamp" dateTime={sub.comments[0].created_at}>
                          {tsFormatter.format(new Date(sub.comments[0].created_at))}
                        </time>
                      </div>
                      {sub.comments.map((reply) => (
                        <div
                          key={reply.id}
                          id={reply.id}
                          className={`reply-bubble reply-bubble--${reply.author} comment-new-anchor`}
                          tabIndex={-1}
                        >
                          <div className="reply-bubble__body">
                            <Markdown remarkPlugins={[remarkGfm]}>{reply.body}</Markdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Reply form */}
            {!readOnly && openReply === root.id ? (
              <div className="reply-form-wrapper" style={{ marginLeft: 38 }}>
                <CommentForm
                  label="Reply"
                  threadId={threadId}
                  draftContext={`reply:${root.id}`}
                  compact
                  onSubmit={async (input) => {
                    await onReply(root.id, input)
                    setOpenReply(null)
                  }}
                />
              </div>
            ) : null}

            {/* Pending discussions associated with this root */}
            {pendingByDiscussion.get(root.id)?.map((pending) => (
              <div key={pending.id} style={{ paddingLeft: 38 }}>
                <PendingDiscussionModerationCard
                  threadId={threadId}
                  discussion={pending}
                  originExcerpt={originExcerpt(pending)}
                  onUpdate={onPendingUpdate}
                />
              </div>
            ))}
          </div>
        )
      })}

      {/* Pending discussions without an origin discussion */}
      {pendingWithoutOrigin.length > 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
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
    </div>
  )
}
