import { useState } from 'react'
import type { AgentName, Comment, CommentType, PendingDiscussion } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { groupComments } from '../lib/commentTree'
import { CommentForm } from './CommentForm'
import { PendingDiscussionModerationCard } from './PendingDiscussionQueue'
import { Avatar, AgentTag, Icon, TypeBadge } from './primitives'

const tsFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatTs(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : tsFormatter.format(d)
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

function CommentActions({
  disabled,
  onReply,
  onAsk,
}: {
  disabled: boolean
  onReply: () => void
  onAsk: (agent: AgentName) => void
}) {
  return (
    <div className="cmt-actions">
      <button type="button" className="cmt-action" onClick={onReply}>
        <Icon name="reply" className="ic-sm" /> Reply
      </button>
      <button
        type="button"
        className="cmt-action ask"
        disabled={disabled}
        onClick={() => onAsk('claude')}
      >
        <Avatar author="claude" size={14} /> Ask Claude
      </button>
      <button
        type="button"
        className="cmt-action ask"
        disabled={disabled}
        onClick={() => onAsk('codex')}
      >
        <Avatar author="codex" size={14} /> Ask Codex
      </button>
    </div>
  )
}

function RootComment({
  root,
  replies,
  pendings,
  threadId,
  readOnly,
  disableAgentActions,
  originExcerpt,
  onReply,
  onAskDiscussion,
  onPendingUpdate,
}: {
  root: Comment
  replies: Comment[]
  pendings: PendingDiscussion[]
  threadId: string
  readOnly: boolean
  disableAgentActions: boolean
  originExcerpt: (pending: PendingDiscussion) => string | null
  onReply: (replyTo: string, input: { body: string; type: CommentType }) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  onPendingUpdate: () => void
}) {
  const [openReply, setOpenReply] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const subClusters = replySubClusters(replies)
  const totalReplies = replies.length

  return (
    <div className="cmt-root" data-author={root.author}>
      <div className="cmt cmt-root-row">
        <div className="cmt-row">
          <Avatar author={root.author} size={28} />
          <div className="cmt-body">
            <div className="cmt-head">
              <AgentTag author={root.author} />
              <TypeBadge type={root.type} />
              <span className="time">{formatTs(root.created_at)}</span>
              <span className="cmt-id mono">{root.id}</span>
              {totalReplies > 0 ? (
                <button
                  type="button"
                  className="cmt-action collapse-btn"
                  onClick={() => setCollapsed((v) => !v)}
                >
                  <Icon name={collapsed ? 'chevronR' : 'chevronD'} className="ic-sm" />
                  {collapsed ? `${totalReplies} hidden` : 'collapse'}
                </button>
              ) : null}
            </div>
            <div
              id={root.id}
              className="cmt-text root-bubble tinted comment-new-anchor"
              data-author={root.author}
              tabIndex={-1}
            >
              <Markdown remarkPlugins={[remarkGfm]}>{root.body}</Markdown>
            </div>
            {!readOnly ? (
              <CommentActions
                disabled={disableAgentActions}
                onReply={() => setOpenReply((v) => !v)}
                onAsk={(agent) => onAskDiscussion(root.id, agent)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {!collapsed ? (
        <>
          {subClusters.map((sub, si) => (
            <div
              key={`${root.id}-sub-${si}`}
              className="reply-cluster"
              data-author={sub.author}
            >
              <div className="reply-cluster-rail" />
              <div className="reply-cluster-body">
                <div className="cmt-head">
                  <Avatar author={sub.author} size={20} />
                  <AgentTag author={sub.author} />
                  {sub.comments[0].type !== 'comment' ? (
                    <TypeBadge type={sub.comments[0].type} />
                  ) : null}
                  <span className="time">{formatTs(sub.comments[0].created_at)}</span>
                </div>
                {sub.comments.map((reply) => (
                  <div
                    key={reply.id}
                    id={reply.id}
                    className="cmt-text reply-bubble tinted comment-new-anchor"
                    data-author={reply.author}
                    tabIndex={-1}
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{reply.body}</Markdown>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {pendings.map((pending) => (
            <div key={pending.id} className="pending-indent">
              <PendingDiscussionModerationCard
                threadId={threadId}
                discussion={pending}
                originExcerpt={originExcerpt(pending)}
                onUpdate={onPendingUpdate}
              />
            </div>
          ))}

          {!readOnly && openReply ? (
            <div className="inline-reply">
              <CommentForm
                compact
                autoFocus
                label="Reply"
                threadId={threadId}
                draftContext={`reply:${root.id}`}
                onCancel={() => setOpenReply(false)}
                onSubmit={async (input) => {
                  await onReply(root.id, input)
                  setOpenReply(false)
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
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
      {groups.map(({ root, replies }) => (
        <RootComment
          key={root.id}
          root={root}
          replies={replies}
          pendings={pendingByDiscussion.get(root.id) ?? []}
          threadId={threadId}
          readOnly={readOnly}
          disableAgentActions={disableAgentActions}
          originExcerpt={originExcerpt}
          onReply={onReply}
          onAskDiscussion={onAskDiscussion}
          onPendingUpdate={onPendingUpdate}
        />
      ))}

      {pendingWithoutOrigin.length > 0 ? (
        <div className="orphan-pendings">
          <div className="orphan-pendings-head">
            <Icon name="eye" className="ic-sm" /> Pending top-level posts (
            {pendingWithoutOrigin.length})
          </div>
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
