import fs from 'node:fs'
import type {
  Comment,
  CommentAuthor,
  CommentType,
  CreateCommentInput,
} from '@roundtable/shared'
import { commentsPath, threadJsonPath } from './paths'
import { NotFoundError } from './errors'
import { appendJsonl, atomicRewriteJsonl } from './jsonl'

const replyDiscussionIdsByThread = new Map<string, Map<string, string>>()

export function listComments(dataDir: string, threadId: string): Comment[] {
  const file = commentsPath(dataDir, threadId)
  if (!fs.existsSync(file)) return []

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Comment)
}

function nextCommentIdAfter(comment: Comment | null): string {
  const match = comment ? /^c(\d+)$/.exec(comment.id) : null
  const next = match ? Number(match[1]) + 1 : 1
  return `c${String(next).padStart(3, '0')}`
}

function readLastJsonlRecord<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size === 0) return null

  const fd = fs.openSync(file, 'r')
  try {
    const chunkSize = 8192
    let position = stat.size
    let suffix = ''
    while (position > 0) {
      const readSize = Math.min(chunkSize, position)
      position -= readSize
      const buffer = Buffer.allocUnsafe(readSize)
      fs.readSync(fd, buffer, 0, readSize, position)
      suffix = `${buffer.toString('utf8')}${suffix}`
      const lines = suffix.split('\n').filter((line) => line.trim().length > 0)
      if (lines.length > 0 && (position === 0 || lines.length > 1)) {
        return JSON.parse(lines[lines.length - 1]) as T
      }
    }
    const line = suffix.trim()
    return line ? JSON.parse(line) as T : null
  } finally {
    fs.closeSync(fd)
  }
}

function nextTopLevelCommentId(dataDir: string, threadId: string): string {
  return nextCommentIdAfter(readLastJsonlRecord<Comment>(commentsPath(dataDir, threadId)))
}

function replyCacheKey(dataDir: string, threadId: string): string {
  return `${dataDir}:${threadId}`
}

function buildReplyDiscussionIds(dataDir: string, threadId: string): Map<string, string> {
  return new Map(
    listComments(dataDir, threadId).map((comment) => [comment.id, comment.discussion_id]),
  )
}

function getReplyDiscussionIds(dataDir: string, threadId: string): Map<string, string> {
  const key = replyCacheKey(dataDir, threadId)
  const cached = replyDiscussionIdsByThread.get(key)
  if (cached) return cached

  const built = buildReplyDiscussionIds(dataDir, threadId)
  replyDiscussionIdsByThread.set(key, built)
  return built
}

function clearReplyDiscussionIds(dataDir: string, threadId: string): void {
  replyDiscussionIdsByThread.delete(replyCacheKey(dataDir, threadId))
}

function addStoredComment(
  dataDir: string,
  threadId: string,
  input: {
    author: CommentAuthor
    body: string
    type?: CommentType
    reply_to?: string | null
  },
): Comment {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const id = nextTopLevelCommentId(dataDir, threadId)
  let parentId: string | null = null
  let discussionId = id

  if (input.reply_to != null) {
    const replyDiscussionIds = getReplyDiscussionIds(dataDir, threadId)
    const rootDiscussionId = replyDiscussionIds.get(input.reply_to)
    if (!rootDiscussionId) {
      throw new NotFoundError(`reply target ${input.reply_to} not found`)
    }
    discussionId = rootDiscussionId
    parentId = rootDiscussionId
  }

  const comment = buildComment({
    id,
    threadId,
    discussionId,
    parentId,
    author: input.author,
    type: input.type ?? 'comment',
    body: input.body,
  })

  appendJsonl(commentsPath(dataDir, threadId), comment)
  replyDiscussionIdsByThread
    .get(replyCacheKey(dataDir, threadId))
    ?.set(comment.id, comment.discussion_id)
  return comment
}

export function addComment(
  dataDir: string,
  threadId: string,
  input: CreateCommentInput,
): Comment {
  return addStoredComment(dataDir, threadId, {
    author: 'human',
    body: input.body,
    type: input.type,
    reply_to: input.reply_to,
  })
}

export function addAgentComment(
  dataDir: string,
  threadId: string,
  input: {
    author: Exclude<CommentAuthor, 'human' | 'system'>
    body: string
    type?: CommentType
    reply_to?: string | null
  },
): Comment {
  return addStoredComment(dataDir, threadId, {
    author: input.author,
    body: input.body,
    type: input.type,
    reply_to: input.reply_to,
  })
}

export function deleteComment(
  dataDir: string,
  threadId: string,
  commentId: string,
): void {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const comments = listComments(dataDir, threadId)
  const target = comments.find((c) => c.id === commentId)
  if (!target) {
    throw new NotFoundError(`comment ${commentId} not found`)
  }

  const kept =
    target.parent_id === null
      ? comments.filter((c) => c.discussion_id !== target.discussion_id)
      : comments.filter((c) => c.id !== target.id)

  atomicRewriteJsonl(commentsPath(dataDir, threadId), kept)
  clearReplyDiscussionIds(dataDir, threadId)
}

function buildComment(input: {
  id: string
  threadId: string
  discussionId: string
  parentId: string | null
  author: CommentAuthor
  type: CommentType
  body: string
}): Comment {
  return {
    id: input.id,
    thread_id: input.threadId,
    discussion_id: input.discussionId,
    parent_id: input.parentId,
    author: input.author,
    type: input.type,
    body: input.body,
    origin_discussion_id: null,
    origin_comment_id: null,
    approved_from_pending_id: null,
    created_at: new Date().toISOString(),
  }
}
