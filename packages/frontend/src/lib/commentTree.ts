import type { Comment } from '@roundtable/shared'

export interface CommentGroup {
  root: Comment
  replies: Comment[]
}

export function groupComments(comments: Comment[]): CommentGroup[] {
  const byId = (a: Comment, b: Comment) => a.id.localeCompare(b.id)

  const roots = comments.filter((c) => c.parent_id === null).sort(byId)

  return roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.parent_id === root.id).sort(byId),
  }))
}
