import fs from 'node:fs'
import type { Comment, CreateCommentInput } from '@roundtable/shared'
import { commentsPath, threadJsonPath } from './paths'
import { nextCommentId } from './ids'
import { NotFoundError } from './errors'
import { appendJsonl } from './jsonl'

export function listComments(dataDir: string, threadId: string): Comment[] {
  const file = commentsPath(dataDir, threadId)
  if (!fs.existsSync(file)) return []

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Comment)
}

export function addComment(
  dataDir: string,
  threadId: string,
  input: CreateCommentInput,
): Comment {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const comments = listComments(dataDir, threadId)
  const id = nextCommentId(comments)

  let parentId: string | null = null
  let discussionId = id

  if (input.reply_to != null) {
    const target = comments.find((c) => c.id === input.reply_to)
    if (!target) {
      throw new NotFoundError(`reply target ${input.reply_to} not found`)
    }
    discussionId = target.discussion_id
    parentId = target.discussion_id
  }

  const comment: Comment = {
    id,
    thread_id: threadId,
    discussion_id: discussionId,
    parent_id: parentId,
    author: 'human',
    type: input.type ?? 'comment',
    body: input.body,
    origin_discussion_id: null,
    origin_comment_id: null,
    approved_from_pending_id: null,
    created_at: new Date().toISOString(),
  }

  appendJsonl(commentsPath(dataDir, threadId), comment)
  return comment
}
