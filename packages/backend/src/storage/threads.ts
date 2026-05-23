import fs from 'node:fs'
import type { Thread, ThreadDetail, CreateThreadInput } from '@roundtable/shared'
import {
  threadsDir,
  threadDir,
  threadJsonPath,
  threadMdPath,
  commentsPath,
} from './paths'
import { nextThreadId } from './ids'

export function createThread(dataDir: string, input: CreateThreadInput): Thread {
  const id = nextThreadId(dataDir)
  fs.mkdirSync(threadDir(dataDir, id), { recursive: true })

  const thread: Thread = {
    id,
    title: input.title,
    status: 'open',
    parent_thread_id: null,
    created_from_consolidation_id: null,
    created_at: new Date().toISOString(),
    archived_at: null,
  }

  fs.writeFileSync(threadJsonPath(dataDir, id), JSON.stringify(thread, null, 2))
  fs.writeFileSync(threadMdPath(dataDir, id), input.body)
  fs.writeFileSync(commentsPath(dataDir, id), '')

  return thread
}

function threadNumber(id: string): number {
  const match = /^thread-(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export function listThreads(dataDir: string): Thread[] {
  const dir = threadsDir(dataDir)
  if (!fs.existsSync(dir)) return []

  const threads: Thread[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const jsonPath = threadJsonPath(dataDir, entry.name)
    if (!fs.existsSync(jsonPath)) continue
    threads.push(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Thread)
  }

  threads.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) ||
      threadNumber(b.id) - threadNumber(a.id),
  )
  return threads
}

export function getThread(dataDir: string, threadId: string): ThreadDetail | null {
  const jsonPath = threadJsonPath(dataDir, threadId)
  if (!fs.existsSync(jsonPath)) return null

  const thread = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Thread
  const body = fs.readFileSync(threadMdPath(dataDir, threadId), 'utf8')
  return { ...thread, body }
}
