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

  const buckets = new Map<string | null, Comment[]>()
  for (const comment of comments) {
    const bucket = buckets.get(comment.parent_id) ?? []
    bucket.push(comment)
    buckets.set(comment.parent_id, bucket)
  }

  for (const bucket of buckets.values()) bucket.sort(byId)

  const roots = [...(buckets.get(null) ?? [])].sort(byRootOrder)

  return roots.map((root) => ({
    root,
    replies: buckets.get(root.id) ?? [],
  }))
}
