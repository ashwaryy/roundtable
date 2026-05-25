import type { Comment } from '@roundtable/shared'

export interface CommentGroup {
  root: Comment
  replies: Comment[]
}

export type CommentSortOrder = 'oldest' | 'newest'

export function groupComments(
  comments: Comment[],
  sortOrder: CommentSortOrder = 'oldest',
): CommentGroup[] {
  const byId = (a: Comment, b: Comment) => a.id.localeCompare(b.id)
  const byRootOrder =
    sortOrder === 'newest' ? (a: Comment, b: Comment) => byId(b, a) : byId

  const roots = comments.filter((c) => c.parent_id === null).sort(byRootOrder)

  return roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.parent_id === root.id).sort(byId),
  }))
}
