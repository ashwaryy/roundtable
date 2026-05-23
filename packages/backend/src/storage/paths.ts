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
