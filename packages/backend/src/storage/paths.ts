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

export function contextItemsPath(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'context-items.jsonl')
}

export function attachmentsDir(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'attachments')
}

export function projectSnapshotDir(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'project-snapshot')
}

export function projectSnapshotJsonPath(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), 'project-snapshot.json')
}

export function projectSnapshotManifestPath(
  dataDir: string,
  threadId: string,
): string {
  return path.join(threadDir(dataDir, threadId), 'project-snapshot-manifest.json')
}

export function roundtableInternalDir(dataDir: string, threadId: string): string {
  return path.join(threadDir(dataDir, threadId), '.roundtable')
}

export function roundtableBinDir(dataDir: string, threadId: string): string {
  return path.join(roundtableInternalDir(dataDir, threadId), 'bin')
}

export function roomJsonPath(dataDir: string, threadId: string): string {
  return path.join(roundtableInternalDir(dataDir, threadId), 'room.json')
}

export function roomPromptPath(
  dataDir: string,
  threadId: string,
  agent: 'claude' | 'codex',
): string {
  return path.join(roundtableInternalDir(dataDir, threadId), `${agent}-startup.md`)
}

export function roundtableHelperPath(dataDir: string, threadId: string): string {
  return path.join(roundtableBinDir(dataDir, threadId), 'roundtable')
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
