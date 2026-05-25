import fs from 'node:fs'
import type { Comment, PendingDiscussion } from '@roundtable/shared'
import { threadsDir } from './paths'

export function nextThreadId(dataDir: string): string {
  const dir = threadsDir(dataDir)
  let max = 0
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const match = /^thread-(\d+)$/.exec(entry.name)
      if (match) max = Math.max(max, Number(match[1]))
    }
  }
  return `thread-${max + 1}`
}

export function nextCommentId(comments: Comment[]): string {
  let max = 0
  for (const c of comments) {
    const match = /^c(\d+)$/.exec(c.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `c${String(max + 1).padStart(3, '0')}`
}

export function nextPendingDiscussionId(
  discussions: PendingDiscussion[],
  comments: Comment[] = [],
): string {
  let max = 0
  for (const discussion of discussions) {
    const match = /^pd(\d+)$/.exec(discussion.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  for (const comment of comments) {
    const match = /^pd(\d+)$/.exec(comment.approved_from_pending_id ?? '')
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `pd${String(max + 1).padStart(3, '0')}`
}
