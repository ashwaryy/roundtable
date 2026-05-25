import { useEffect, useState } from 'react'
import type { AgentName, Comment, CommentType, PendingDiscussion, ThreadAgentInvite } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { groupComments, type CommentSortOrder } from '../lib/commentTree'
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
  deleting,
  onDelete,
  onReply,
  onAsk,
  roster,
}: {
  disabled: boolean
  deleting: boolean
  onDelete: () => void
  onReply: () => void
  onAsk: (agent: AgentName) => void
  roster: ThreadAgentInvite[]
}) {
  return (
    <div className="cmt-actions">
      <button type="button" className="cmt-action" onClick={onReply}>
        <Icon name="reply" className="ic-sm" /> Reply
      </button>
      {roster.map((persona) => (
        <button key={persona.agent_id} type="button" className="cmt-action ask" disabled={disabled} onClick={() => onAsk(persona.agent_id)}>
          <Avatar author={persona.agent_id} persona={persona} size={14} /> Ask {persona.name}
        </button>
      ))}
      <button
        type="button"
        className="cmt-action danger"
        disabled={deleting}
        onClick={onDelete}
      >
        <Icon name="trash" className="ic-sm" /> {deleting ? 'Deleting' : 'Delete'}
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
  onDelete,
  onAskDiscussion,
  onPendingUpdate,
  roster,
}: {
  root: Comment
  replies: Comment[]
  pendings: PendingDiscussion[]
  threadId: string
  readOnly: boolean
  disableAgentActions: boolean
  originExcerpt: (pending: PendingDiscussion) => string | null
  onReply: (replyTo: string, input: { body: string; type: CommentType }) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  onPendingUpdate: () => void
  roster: ThreadAgentInvite[]
}) {
  const [openReply, setOpenReply] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const subClusters = replySubClusters(replies)
  const totalReplies = replies.length

  useEffect(() => {
    if (!openMenuId) return
    function closeMenu() {
      setOpenMenuId(null)
    }
    window.addEventListener('pointerdown', closeMenu)
    return () => window.removeEventListener('pointerdown', closeMenu)
  }, [openMenuId])

  async function deleteWithConfirm(comment: Comment) {
    const isRoot = comment.parent_id === null
    const message =
      isRoot && totalReplies > 0
        ? `Delete this discussion and its ${totalReplies} ${totalReplies === 1 ? 'reply' : 'replies'}?`
        : 'Delete this comment?'
    if (!window.confirm(message)) return
    setDeletingId(comment.id)
    setOpenMenuId(null)
    try {
      await onDelete(comment.id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="cmt-root" data-author={root.author} data-color={roster.find((agent) => agent.agent_id === root.author)?.color}>
      <div className="cmt cmt-root-row">
        <div className="cmt-row">
          <Avatar author={root.author} persona={roster.find((agent) => agent.agent_id === root.author)} size={28} />
          <div className="cmt-body">
            <div className="cmt-head">
              <AgentTag author={root.author} persona={roster.find((agent) => agent.agent_id === root.author)} />
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
                deleting={deletingId === root.id}
                onReply={() => setOpenReply((v) => !v)}
                onDelete={() => void deleteWithConfirm(root)}
                onAsk={(agent) => onAskDiscussion(root.id, agent)}
                roster={roster}
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
                  <Avatar author={sub.author} persona={roster.find((agent) => agent.agent_id === sub.author)} size={20} />
                  <AgentTag author={sub.author} persona={roster.find((agent) => agent.agent_id === sub.author)} />
                  {sub.comments[0].type !== 'comment' ? (
                    <TypeBadge type={sub.comments[0].type} />
                  ) : null}
                  <span className="time">{formatTs(sub.comments[0].created_at)}</span>
                </div>
                {sub.comments.map((reply) => (
                  <div key={reply.id} className="reply-item">
                    <div
                      id={reply.id}
                      className="cmt-text reply-bubble tinted comment-new-anchor"
                      data-author={reply.author}
                      tabIndex={-1}
                    >
                      <Markdown remarkPlugins={[remarkGfm]}>{reply.body}</Markdown>
                    </div>
                    {!readOnly ? (
                      <div
                        className="cmt-menu"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="cmt-action more"
                          aria-label={`Comment actions for ${reply.id}`}
                          aria-expanded={openMenuId === reply.id}
                          disabled={deletingId === reply.id}
                          onClick={() => setOpenMenuId((id) => (id === reply.id ? null : reply.id))}
                        >
                          <Icon name="more" className="ic-sm" />
                        </button>
                        {openMenuId === reply.id ? (
                          <div className="cmt-menu-popover">
                            <button
                              type="button"
                              className="cmt-menu-item danger"
                              disabled={deletingId === reply.id}
                              onClick={() => void deleteWithConfirm(reply)}
                            >
                              <Icon name="trash" className="ic-sm" />
                              {deletingId === reply.id ? 'Deleting' : 'Delete'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
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
                persona={roster.find((agent) => agent.agent_id === pending.author)}
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
  onDelete,
  onAskDiscussion,
  disableAgentActions = false,
  readOnly = false,
  sortOrder = 'oldest',
  roster = [],
}: {
  comments: Comment[]
  pendingDiscussions?: PendingDiscussion[]
  threadId: string
  onPendingUpdate: () => void
  onReply: (replyTo: string, input: { body: string; type: CommentType }) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  disableAgentActions?: boolean
  readOnly?: boolean
  sortOrder?: CommentSortOrder
  roster?: ThreadAgentInvite[]
}) {
  const groups = groupComments(comments, sortOrder)

  const commentsById = new Map(comments.map((c) => [c.id, c]))
  const pendingByDiscussion = new Map<string, PendingDiscussion[]>()
  const pendingWithoutOrigin: PendingDiscussion[] = []

  for (const pending of pendingDiscussions) {
    if (!pending.origin_discussion_id || !commentsById.has(pending.origin_discussion_id)) {
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
          onDelete={onDelete}
          onAskDiscussion={onAskDiscussion}
          onPendingUpdate={onPendingUpdate}
          roster={roster}
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
              persona={roster.find((agent) => agent.agent_id === pending.author)}
              onUpdate={onPendingUpdate}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
