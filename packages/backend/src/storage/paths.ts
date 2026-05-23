import os from 'node:os'
import path from 'node:path'

export function resolveDataDir(): string {
  return process.env.ROUNDTABLE_DATA_DIR ?? path.join(os.homedir(), '.roundtable')
}

export function threadsDir(dataDir: string): string {
  return path.join(dataDir, 'threads')
}

export function threadDir(dataDir: string, threadId: string): string {
  return path.join(threadsDir(dataDir), threadId)
}

export function threadJsonPath(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'thread.json')
}

export function threadMdPath(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'thread.md')
}

export function commentsPath(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'comments.jsonl')
}

export function pendingDiscussionsPath(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'pending-discussions.jsonl')
}

export function consolidationsDir(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'consolidations')
}

export function consolidationDir(
  dataDir: string,
  threadId: string,
  proposalId: string,
): string {
  return path.join(consolidationsDir(dataDir, threadId), proposalId)
}

export function proposalJsonPath(
  dataDir: string,
  threadId: string,
  proposalId: string,
): string {
  return path.join(consolidationDir(dataDir, threadId, proposalId), 'proposal.json')
}

export function revisionsDir(
  dataDir: string,
  threadId: string,
  proposalId: string,
): string {
  return path.join(consolidationDir(dataDir, threadId, proposalId), 'revisions')
}

export function revisionPath(
  dataDir: string,
  threadId: string,
  proposalId: string,
  revisionId: string,
): string {
  return path.join(revisionsDir(dataDir, threadId, proposalId), `${revisionId}.md`)
}

export function reviewsDir(
  dataDir: string,
  threadId: string,
  proposalId: string,
): string {
  return path.join(consolidationDir(dataDir, threadId, proposalId), 'reviews')
}

export function reviewPath(
  dataDir: string,
  threadId: string,
  proposalId: string,
  reviewId: string,
): string {
  return path.join(reviewsDir(dataDir, threadId, proposalId), `${reviewId}.md`)
}
