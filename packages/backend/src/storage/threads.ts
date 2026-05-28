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
import { NotFoundError } from './errors'

export type ThreadSummaryField = 'pending_count' | 'active_proposal_count'

export interface ThreadListRecord extends Thread {
  pending_count: number
  active_proposal_count: number
}

interface ThreadDirtyState {
  pending_count?: true
  active_proposal_count?: true
}

interface ThreadRecord extends Thread {
  pending_count?: number
  active_proposal_count?: number
  _dirty?: ThreadDirtyState
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, filePath)
}

function normalizeThread(thread: ThreadRecord): ThreadListRecord {
  return {
    ...thread,
    closed_at: thread.closed_at ?? null,
    pending_count: thread.pending_count ?? 0,
    active_proposal_count: thread.active_proposal_count ?? 0,
  }
}

function normalizeThreadRecord(thread: ThreadRecord): ThreadRecord {
  return {
    ...thread,
    closed_at: thread.closed_at ?? null,
    pending_count: thread.pending_count ?? 0,
    active_proposal_count: thread.active_proposal_count ?? 0,
    _dirty: thread._dirty ?? {},
  }
}

function readThreadRecord(dataDir: string, threadId: string): ThreadRecord | null {
  const jsonPath = threadJsonPath(dataDir, threadId)
  if (!fs.existsSync(jsonPath)) return null
  return normalizeThreadRecord(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ThreadRecord)
}

export function getThreadSummary(
  dataDir: string,
  threadId: string,
): {
  pending_count: number
  active_proposal_count: number
  dirty: ThreadDirtyState
} | null {
  const thread = readThreadRecord(dataDir, threadId)
  if (!thread) return null
  return {
    pending_count: thread.pending_count ?? 0,
    active_proposal_count: thread.active_proposal_count ?? 0,
    dirty: thread._dirty ?? {},
  }
}

export function setThreadSummaryDirty(
  dataDir: string,
  threadId: string,
  field: ThreadSummaryField,
): void {
  const thread = readThreadRecord(dataDir, threadId)
  if (!thread) throw new NotFoundError(`thread ${threadId} not found`)
  writeJsonAtomic(threadJsonPath(dataDir, threadId), {
    ...thread,
    _dirty: {
      ...(thread._dirty ?? {}),
      [field]: true,
    },
  })
}

export function updateThreadSummary(
  dataDir: string,
  threadId: string,
  patch: Partial<Pick<ThreadRecord, 'pending_count' | 'active_proposal_count'>>,
  clearDirty: ThreadSummaryField[] = [],
): void {
  const thread = readThreadRecord(dataDir, threadId)
  if (!thread) throw new NotFoundError(`thread ${threadId} not found`)
  const dirty = { ...(thread._dirty ?? {}) }
  for (const field of clearDirty) delete dirty[field]
  writeJsonAtomic(threadJsonPath(dataDir, threadId), {
    ...thread,
    ...patch,
    _dirty: dirty,
  })
}

export function repairDirtyThreadSummaries(
  dataDir: string,
  readers: {
    pendingCount: (threadId: string) => number
    activeProposalCount: (threadId: string) => number
  },
): string[] {
  const repaired: string[] = []
  const dir = threadsDir(dataDir)
  if (!fs.existsSync(dir)) return repaired
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const thread = readThreadRecord(dataDir, entry.name)
    if (!thread) continue
    const dirty = thread._dirty ?? {}
    if (!dirty.pending_count && !dirty.active_proposal_count) continue
    const patch: Partial<Pick<ThreadRecord, 'pending_count' | 'active_proposal_count'>> = {}
    const clearDirty: ThreadSummaryField[] = []
    if (dirty.pending_count) {
      patch.pending_count = readers.pendingCount(entry.name)
      clearDirty.push('pending_count')
    }
    if (dirty.active_proposal_count) {
      patch.active_proposal_count = readers.activeProposalCount(entry.name)
      clearDirty.push('active_proposal_count')
    }
    updateThreadSummary(dataDir, entry.name, patch, clearDirty)
    repaired.push(entry.name)
  }
  return repaired
}

export function createThread(dataDir: string, input: CreateThreadInput): Thread {
  const id = nextThreadId(dataDir)
  fs.mkdirSync(threadDir(dataDir, id), { recursive: true })

  const thread: ThreadRecord = {
    id,
    title: input.title,
    status: 'open',
    parent_thread_id: null,
    created_from_consolidation_id: null,
    created_at: new Date().toISOString(),
    archived_at: null,
    closed_at: null,
    pending_count: 0,
    active_proposal_count: 0,
    _dirty: {},
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

export function listThreads(dataDir: string): ThreadListRecord[] {
  const dir = threadsDir(dataDir)
  if (!fs.existsSync(dir)) return []

  const threads: ThreadListRecord[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const jsonPath = threadJsonPath(dataDir, entry.name)
    if (!fs.existsSync(jsonPath)) continue
      threads.push(normalizeThread(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ThreadRecord))
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

  const thread = normalizeThread(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ThreadRecord)
  const body = fs.readFileSync(threadMdPath(dataDir, threadId), 'utf8')
  return { ...thread, body }
}

export function deleteThread(dataDir: string, threadId: string): void {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
  fs.rmSync(threadDir(dataDir, threadId), { recursive: true, force: true })
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

  const thread: ThreadRecord = {
    id,
    title: input.title,
    status: 'open',
    parent_thread_id: input.parentThreadId,
    created_from_consolidation_id: input.consolidationId,
    created_at: new Date().toISOString(),
    archived_at: null,
    closed_at: null,
    pending_count: 0,
    active_proposal_count: 0,
    _dirty: {},
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
