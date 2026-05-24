import fs from 'node:fs'
import type { Thread, ThreadDetail, CreateThreadInput } from '@roundtable/shared'
import {
  threadsDir,
  threadDir,
  threadJsonPath,
  threadMdPath,
  commentsPath,
  pendingDiscussionsPath,
  contextItemsPath,
  attachmentsDir,
  projectSnapshotDir,
} from './paths'
import { nextThreadId } from './ids'

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, filePath)
}

function normalizeThread(thread: Thread): Thread {
  return {
    ...thread,
    closed_at: thread.closed_at ?? null,
  }
}

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
    closed_at: null,
  }

  writeJsonAtomic(threadJsonPath(dataDir, id), thread)
  fs.writeFileSync(threadMdPath(dataDir, id), input.body)
  fs.writeFileSync(commentsPath(dataDir, id), '')
  fs.writeFileSync(pendingDiscussionsPath(dataDir, id), '')
  fs.writeFileSync(contextItemsPath(dataDir, id), '')
  fs.mkdirSync(attachmentsDir(dataDir, id), { recursive: true })
  fs.mkdirSync(projectSnapshotDir(dataDir, id), { recursive: true })

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
    threads.push(normalizeThread(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Thread))
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

  const thread = normalizeThread(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Thread)
  const body = fs.readFileSync(threadMdPath(dataDir, threadId), 'utf8')
  return { ...thread, body }
}

export function createDerivedThread(
  dataDir: string,
  input: {
    title: string
    body: string
    parentThreadId: string
    consolidationId: string
  },
): Thread {
  const id = nextThreadId(dataDir)
  fs.mkdirSync(threadDir(dataDir, id), { recursive: true })

  const thread: Thread = {
    id,
    title: input.title,
    status: 'open',
    parent_thread_id: input.parentThreadId,
    created_from_consolidation_id: input.consolidationId,
    created_at: new Date().toISOString(),
    archived_at: null,
    closed_at: null,
  }

  writeJsonAtomic(threadJsonPath(dataDir, id), thread)
  fs.writeFileSync(threadMdPath(dataDir, id), input.body)
  fs.writeFileSync(commentsPath(dataDir, id), '')
  fs.writeFileSync(pendingDiscussionsPath(dataDir, id), '')
  fs.writeFileSync(contextItemsPath(dataDir, id), '')
  fs.mkdirSync(attachmentsDir(dataDir, id), { recursive: true })
  fs.mkdirSync(projectSnapshotDir(dataDir, id), { recursive: true })

  return thread
}

export function archiveThread(dataDir: string, threadId: string): Thread {
  const detail = getThread(dataDir, threadId)
  if (!detail) throw new Error(`thread ${threadId} not found`)
  const timestamp = new Date().toISOString()
  const thread: Thread = {
    ...detail,
    status: 'archived',
    archived_at: detail.archived_at ?? timestamp,
  }
  const { body: _body, ...metadata } = thread as ThreadDetail
  writeJsonAtomic(threadJsonPath(dataDir, threadId), metadata)
  return metadata
}

export function closeThread(dataDir: string, threadId: string): Thread {
  const detail = getThread(dataDir, threadId)
  if (!detail) throw new Error(`thread ${threadId} not found`)
  const timestamp = new Date().toISOString()
  const thread: Thread = {
    ...detail,
    status: 'closed',
    closed_at: detail.closed_at ?? timestamp,
  }
  const { body: _body, ...metadata } = thread as ThreadDetail
  writeJsonAtomic(threadJsonPath(dataDir, threadId), metadata)
  return metadata
}
