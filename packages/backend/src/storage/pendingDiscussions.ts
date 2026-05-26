import fs from 'node:fs'
import type {
  PendingDiscussion,
  Comment,
  CreatePendingDiscussionInput,
  EditPendingDiscussionInput,
} from '@roundtable/shared'
import { pendingDiscussionsPath, threadJsonPath, commentsPath } from './paths'
import { nextPendingDiscussionId, nextCommentId } from './ids'
import { appendJsonl, atomicRewriteJsonl } from './jsonl'
import { NotFoundError } from './errors'
import { listComments } from './comments'

export function listPendingDiscussions(
  dataDir: string,
  threadId: string,
): PendingDiscussion[] {
  const file = pendingDiscussionsPath(dataDir, threadId)
  if (!fs.existsSync(file)) return []

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PendingDiscussion)
}

export function countPendingDiscussions(dataDir: string, threadId: string): number {
  const file = pendingDiscussionsPath(dataDir, threadId)
  if (!fs.existsSync(file)) return 0

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .reduce((count, line) => count + (line.trim().length > 0 ? 1 : 0), 0)
}

export function addPendingDiscussion(
  dataDir: string,
  threadId: string,
  input: CreatePendingDiscussionInput,
): PendingDiscussion {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const id = nextPendingDiscussionId(dataDir, threadId)

  const discussion: PendingDiscussion = {
    id,
    thread_id: threadId,
    author: input.author,
    type: input.type ?? 'comment',
    body: input.body,
    origin_discussion_id: input.origin_discussion_id ?? null,
    origin_comment_id: input.origin_comment_id ?? null,
    created_at: new Date().toISOString(),
  }

  appendJsonl(pendingDiscussionsPath(dataDir, threadId), discussion)
  return discussion
}

export function approvePendingDiscussion(
  dataDir: string,
  threadId: string,
  pendingId: string,
): Comment {
  let discussions = listPendingDiscussions(dataDir, threadId)
  let item = discussions.find((discussion) => discussion.id === pendingId)
  if (!item) throw new NotFoundError(`pending discussion ${pendingId} not found`)

  const existing = listComments(dataDir, threadId)
  const alreadyApproved = existing.find(
    (comment) =>
      comment.parent_id === null && comment.approved_from_pending_id === pendingId,
  )

  if (alreadyApproved && isApprovedCopy(alreadyApproved, item)) {
    atomicRewriteJsonl(
      pendingDiscussionsPath(dataDir, threadId),
      discussions.filter((discussion) => discussion.id !== pendingId),
    )
    return alreadyApproved
  }

  if (alreadyApproved) {
    const reassignedId = nextPendingDiscussionId(dataDir, threadId)
    const reassignedItem: PendingDiscussion = { ...item, id: reassignedId }
    item = reassignedItem
    discussions = discussions.map((discussion) =>
      discussion.id === pendingId ? reassignedItem : discussion,
    )
    atomicRewriteJsonl(pendingDiscussionsPath(dataDir, threadId), discussions)
  }

  const id = nextCommentId(existing)
  const comment: Comment = {
    id,
    thread_id: threadId,
    discussion_id: id,
    parent_id: null,
    author: item.author,
    type: item.type,
    body: item.body,
    origin_discussion_id: item.origin_discussion_id,
    origin_comment_id: item.origin_comment_id,
    approved_from_pending_id: item.id,
    created_at: new Date().toISOString(),
  }

  appendJsonl(commentsPath(dataDir, threadId), comment)
  atomicRewriteJsonl(
    pendingDiscussionsPath(dataDir, threadId),
    discussions.filter((discussion) => discussion.id !== item.id),
  )

  return comment
}

function isApprovedCopy(comment: Comment, pending: PendingDiscussion): boolean {
  return (
    comment.author === pending.author &&
    comment.type === pending.type &&
    comment.body === pending.body &&
    comment.origin_discussion_id === pending.origin_discussion_id &&
    comment.origin_comment_id === pending.origin_comment_id
  )
}

export function editPendingDiscussion(
  dataDir: string,
  threadId: string,
  pendingId: string,
  input: EditPendingDiscussionInput,
): PendingDiscussion {
  const discussions = listPendingDiscussions(dataDir, threadId)
  const item = discussions.find((discussion) => discussion.id === pendingId)
  if (!item) throw new NotFoundError(`pending discussion ${pendingId} not found`)

  const updated: PendingDiscussion = {
    ...item,
    body: input.body ?? item.body,
    type: input.type ?? item.type,
  }

  atomicRewriteJsonl(
    pendingDiscussionsPath(dataDir, threadId),
    discussions.map((discussion) =>
      discussion.id === pendingId ? updated : discussion,
    ),
  )

  return updated
}

export function rejectPendingDiscussion(
  dataDir: string,
  threadId: string,
  pendingId: string,
): void {
  const discussions = listPendingDiscussions(dataDir, threadId)
  const item = discussions.find((discussion) => discussion.id === pendingId)
  if (!item) throw new NotFoundError(`pending discussion ${pendingId} not found`)

  atomicRewriteJsonl(
    pendingDiscussionsPath(dataDir, threadId),
    discussions.filter((discussion) => discussion.id !== pendingId),
  )
}
