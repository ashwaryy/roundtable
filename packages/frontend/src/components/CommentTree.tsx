import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { AgentColorPreset, AgentName, Comment, CommentType, PendingDiscussion, ThreadAgentInvite } from '@roundtable/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { groupComments, type CommentSortOrder } from '../lib/commentTree'
import { CommentForm } from './CommentForm'
import { PendingDiscussionModerationCard } from './PendingDiscussionQueue'
import { Avatar, AgentTag, Icon, TypeBadge } from './primitives'
import { useGlobalDismiss } from '../useGlobalDismiss'

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
  disabledReason,
  deleting,
  activeAgent,
  onDelete,
  onReply,
  onAsk,
  roster,
}: {
  disabled: boolean
  disabledReason?: string | null
  deleting: boolean
  activeAgent: AgentName | null
  onDelete?: () => void
  onReply: () => void
  onAsk: (agent: AgentName) => void
  roster: ThreadAgentInvite[]
}) {
  return (
    <div className="cmt-actions">
      <button type="button" className="cmt-action" onClick={onReply}>
        <Icon name="reply" className="ic-sm" /> Reply
      </button>
      {roster.map((agent) => {
        const isActive = activeAgent === agent.agent_id
        return (
          <button
            key={agent.agent_id}
            type="button"
            className="cmt-action ask"
            disabled={disabled}
            aria-busy={isActive}
            onClick={() => onAsk(agent.agent_id)}
          >
            {isActive ? (
              <span className="button-spinner cmt-action-spinner" aria-hidden="true" />
            ) : (
              <Avatar author={agent.agent_id} agent={agent} size={14} />
            )}
            {isActive ? `${agent.name} working` : `Ask ${agent.name}`}
          </button>
        )
      })}
      {disabled && disabledReason ? (
        <span className="cmt-action-guidance">{disabledReason}</span>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="cmt-action danger"
          disabled={deleting}
          onClick={onDelete}
        >
          <Icon name="trash" className="ic-sm" /> {deleting ? 'Deleting' : 'Delete'}
        </button>
      ) : null}
    </div>
  )
}

const EMPTY_PENDING_DISCUSSIONS: PendingDiscussion[] = []

const COMMENT_ACCENT_BY_COLOR: Record<AgentColorPreset, string> = {
  blue: '#2563eb',
  green: '#16a34a',
  amber: '#d97706',
  rose: '#e11d48',
  violet: '#7c3aed',
  teal: '#0f766e',
}

function commentAccentStyle(color?: AgentColorPreset): CSSProperties | undefined {
  if (!color) return undefined
  return { '--comment-accent': COMMENT_ACCENT_BY_COLOR[color] } as CSSProperties
}

const RootComment = memo(function RootComment({
  root,
  replies,
  pendings,
  threadId,
  readOnly,
  disableAgentActions,
  agentActionDisabledReason,
  activeAsk,
  originExcerpt,
  onReply,
  onDelete,
  onAskDiscussion,
  onPendingUpdate,
  onReplyOpenChange,
  roster,
  agentById,
}: {
  root: Comment
  replies: Comment[]
  pendings: PendingDiscussion[]
  threadId: string
  readOnly: boolean
  disableAgentActions: boolean
  agentActionDisabledReason?: string | null
  activeAsk: AgentName | null
  originExcerpt: (pending: PendingDiscussion) => string | null
  onReply: (replyTo: string, input: { body: string; type: CommentType }) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  onPendingUpdate: () => void
  onReplyOpenChange: (rootId: string, open: boolean) => void
  roster: ThreadAgentInvite[]
  agentById: Map<string, ThreadAgentInvite>
}) {
  const [openReply, setOpenReply] = useState(false)

  useEffect(() => {
    onReplyOpenChange(root.id, openReply)
    return () => onReplyOpenChange(root.id, false)
  }, [openReply, root.id, onReplyOpenChange])
  const [collapsed, setCollapsed] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const subClusters = replySubClusters(replies)
  const totalReplies = replies.length
  const latestReplyId = replies[replies.length - 1]?.id ?? null
  const controls = (
    <CommentActions
      disabled={disableAgentActions}
      disabledReason={agentActionDisabledReason}
      deleting={deletingId === root.id}
      activeAgent={activeAsk}
      onReply={() => setOpenReply((v) => !v)}
      onDelete={totalReplies === 0 ? () => void deleteWithConfirm(root) : undefined}
      onAsk={(agent) => onAskDiscussion(root.id, agent)}
      roster={roster}
    />
  )

  useGlobalDismiss(openMenuId !== null, () => setOpenMenuId(null), { pointerDown: true })

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
    <div
      className="cmt-root"
      data-author={root.author}
      data-color={agentById.get(root.author)?.color}
      style={commentAccentStyle(agentById.get(root.author)?.color)}
    >
      <div className="cmt cmt-root-row">
        <div className="cmt-row">
          <div className="cmt-body">
            <div className="cmt-head">
              <Avatar author={root.author} agent={agentById.get(root.author)} size={20} />
              <AgentTag author={root.author} agent={agentById.get(root.author)} />
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
            <div className="root-bubble-wrap">
              <div
                id={root.id}
                className="cmt-text root-bubble tinted comment-new-anchor"
                data-author={root.author}
                tabIndex={-1}
              >
                <Markdown remarkPlugins={[remarkGfm]}>{root.body}</Markdown>
              </div>
              {!readOnly && totalReplies > 0 ? (
                <div
                  className="cmt-menu root-menu"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="cmt-action more"
                    aria-label={`Discussion actions for ${root.id}`}
                    aria-expanded={openMenuId === root.id}
                    disabled={deletingId === root.id}
                    onClick={() => setOpenMenuId((id) => (id === root.id ? null : root.id))}
                  >
                    <Icon name="more" className="ic-sm" />
                  </button>
                  {openMenuId === root.id ? (
                    <div className="cmt-menu-popover">
                      <button
                        type="button"
                        className="cmt-menu-item danger"
                        disabled={deletingId === root.id}
                        onClick={() => void deleteWithConfirm(root)}
                      >
                        <Icon name="trash" className="ic-sm" />
                        {deletingId === root.id ? 'Deleting' : 'Delete'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!readOnly && totalReplies === 0 ? controls : null}
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
              data-color={agentById.get(sub.author)?.color}
              style={commentAccentStyle(agentById.get(sub.author)?.color)}
            >
              <div className="reply-cluster-rail" />
              <div className="reply-cluster-body">
                <div className="cmt-head">
                  <Avatar author={sub.author} agent={agentById.get(sub.author)} size={20} />
                  <AgentTag author={sub.author} agent={agentById.get(sub.author)} />
                  {sub.comments[0].type !== 'comment' ? (
                    <TypeBadge type={sub.comments[0].type} />
                  ) : null}
                </div>
                {sub.comments.map((reply) => {
                  const isLatestReply = reply.id === latestReplyId
                  return (
                    <div key={reply.id} className="reply-item">
                      <div className="reply-meta">
                        <span className="time">{formatTs(reply.created_at)}</span>
                        <span className="cmt-id mono">{reply.id}</span>
                      </div>
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
                      {!readOnly && isLatestReply ? controls : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {pendings.map((pending) => (
            <div key={pending.id} className="pending-indent">
              <PendingDiscussionModerationCard
                threadId={threadId}
                discussion={pending}
                originExcerpt={originExcerpt(pending)}
                agent={agentById.get(pending.author)}
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
})

export function CommentTree({
  comments,
  pendingDiscussions = [],
  threadId,
  onPendingUpdate,
  onReply,
  onDelete,
  onAskDiscussion,
  disableAgentActions = false,
  agentActionDisabledReason = null,
  activeAsk = null,
  readOnly = false,
  sortOrder = 'oldest',
  roster = [],
  onActiveReplyChange,
}: {
  comments: Comment[]
  pendingDiscussions?: PendingDiscussion[]
  threadId: string
  onPendingUpdate: () => void
  onReply: (replyTo: string, input: { body: string; type: CommentType }) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
  onAskDiscussion: (discussionId: string, agent: AgentName) => Promise<void>
  disableAgentActions?: boolean
  agentActionDisabledReason?: string | null
  activeAsk?: { discussionId: string; agent: AgentName } | null
  readOnly?: boolean
  sortOrder?: CommentSortOrder
  roster?: ThreadAgentInvite[]
  onActiveReplyChange?: (active: boolean) => void
}) {
  const [openReplyRoots, setOpenReplyRoots] = useState<Set<string>>(() => new Set())

  const handleReplyOpenChange = useCallback((rootId: string, open: boolean) => {
    setOpenReplyRoots((prev) => {
      if (open === prev.has(rootId)) return prev
      const next = new Set(prev)
      if (open) next.add(rootId)
      else next.delete(rootId)
      return next
    })
  }, [])

  useEffect(() => {
    onActiveReplyChange?.(openReplyRoots.size > 0)
  }, [openReplyRoots, onActiveReplyChange])
  const derived = useMemo(() => {
    const groups = groupComments(comments, sortOrder)
    const commentsById = new Map(comments.map((c) => [c.id, c]))
    const agentById = new Map(roster.map((agent) => [agent.agent_id, agent]))
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

    return { agentById, groups, commentsById, pendingByDiscussion, pendingWithoutOrigin }
  }, [comments, pendingDiscussions, roster, sortOrder])

  const originExcerpt = useCallback((pending: PendingDiscussion): string | null => {
    const origin =
      (pending.origin_comment_id && derived.commentsById.get(pending.origin_comment_id)) ||
      (pending.origin_discussion_id && derived.commentsById.get(pending.origin_discussion_id)) ||
      null
    return origin ? excerpt(origin.body) : null
  }, [derived.commentsById])

  if (derived.groups.length === 0 && pendingDiscussions.length === 0) {
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
      {derived.groups.map(({ root, replies }) => (
        <RootComment
          key={root.id}
          root={root}
          replies={replies}
          pendings={derived.pendingByDiscussion.get(root.id) ?? EMPTY_PENDING_DISCUSSIONS}
          threadId={threadId}
          readOnly={readOnly}
          disableAgentActions={disableAgentActions}
          agentActionDisabledReason={agentActionDisabledReason}
          activeAsk={activeAsk?.discussionId === root.id ? activeAsk.agent : null}
          originExcerpt={originExcerpt}
          onReply={onReply}
          onDelete={onDelete}
          onAskDiscussion={onAskDiscussion}
          onPendingUpdate={onPendingUpdate}
          onReplyOpenChange={handleReplyOpenChange}
          roster={roster}
          agentById={derived.agentById}
        />
      ))}

      {derived.pendingWithoutOrigin.length > 0 ? (
        <div className="orphan-pendings">
          <div className="orphan-pendings-head">
            <Icon name="eye" className="ic-sm" /> Pending top-level posts (
            {derived.pendingWithoutOrigin.length})
          </div>
          {derived.pendingWithoutOrigin.map((pending) => (
            <PendingDiscussionModerationCard
              key={pending.id}
              threadId={threadId}
              discussion={pending}
              originExcerpt={originExcerpt(pending)}
              agent={derived.agentById.get(pending.author)}
              onUpdate={onPendingUpdate}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
