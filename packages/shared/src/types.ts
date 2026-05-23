export type ThreadStatus = 'open' | 'archived'

export interface Thread {
  id: string
  title: string
  status: ThreadStatus
  parent_thread_id: string | null
  created_from_consolidation_id: string | null
  created_at: string
  archived_at: string | null
}

/** A thread plus its markdown body (read from thread.md). */
export interface ThreadDetail extends Thread {
  body: string
}

export type CommentAuthor = 'human' | 'claude' | 'codex' | 'system'

export type CommentType =
  | 'comment'
  | 'proposal'
  | 'critique'
  | 'question'
  | 'decision'

export interface Comment {
  id: string
  thread_id: string
  /** Root discussion comment id. Equals `id` for a top-level discussion point. */
  discussion_id: string
  /** null for a top-level discussion point; otherwise the discussion root id. */
  parent_id: string | null
  author: CommentAuthor
  type: CommentType
  body: string
  origin_discussion_id: string | null
  origin_comment_id: string | null
  created_at: string
}

export interface CreateThreadInput {
  title: string
  body: string
}

export interface CreateCommentInput {
  body: string
  type?: CommentType
  /** Id of the comment being replied to. Omit/null for a top-level discussion point. */
  reply_to?: string | null
}
