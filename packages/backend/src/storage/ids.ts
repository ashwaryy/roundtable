import {
  nextPendingDiscussionCounterValue,
  nextThreadCounterValue,
} from './counters'

export function nextThreadId(dataDir: string): string {
  return `thread-${nextThreadCounterValue(dataDir)}`
}

export function nextCommentId(comments: Comment[]): string {
  let max = 0
  for (const c of comments) {
    const match = /^c(\d+)$/.exec(c.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `c${String(max + 1).padStart(3, '0')}`
}

export function nextPendingDiscussionId(dataDir: string, threadId: string): string {
  return `pd${String(nextPendingDiscussionCounterValue(dataDir, threadId)).padStart(3, '0')}`
}
