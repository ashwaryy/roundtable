import fs from 'node:fs'
import type {
  Comment,
  CommentAuthor,
  CommentType,
  CreateCommentInput,
} from '@roundtable/shared'
import { commentsPath, threadJsonPath } from './paths'
import { nextCommentId } from './ids'
import { NotFoundError } from './errors'
import { appendJsonl, atomicRewriteJsonl } from './jsonl'

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

export function addComment(
  dataDir: string,
  threadId: string,
  input: CreateCommentInput,
): Comment {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const comments = input.reply_to != null ? listComments(dataDir, threadId) : null
  const id = comments ? nextCommentId(comments) : nextTopLevelCommentId(dataDir, threadId)

  let parentId: string | null = null
  let discussionId = id

  if (input.reply_to != null) {
    const target = comments?.find((c) => c.id === input.reply_to)
    if (!target) {
      throw new NotFoundError(`reply target ${input.reply_to} not found`)
    }
    discussionId = target.discussion_id
    parentId = target.discussion_id
  }

  const comment = buildComment({
    id,
    threadId,
    discussionId,
    parentId,
    author: 'human',
    type: input.type ?? 'comment',
    body: input.body,
  })

  appendJsonl(commentsPath(dataDir, threadId), comment)
  return comment
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
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const comments = input.reply_to != null ? listComments(dataDir, threadId) : null
  const id = comments ? nextCommentId(comments) : nextTopLevelCommentId(dataDir, threadId)

  let parentId: string | null = null
  let discussionId = id

  if (input.reply_to != null) {
    const target = comments?.find((c) => c.id === input.reply_to)
    if (!target) {
      throw new NotFoundError(`reply target ${input.reply_to} not found`)
    }
    discussionId = target.discussion_id
    parentId = target.discussion_id
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
  return comment
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
