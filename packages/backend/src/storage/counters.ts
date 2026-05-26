import fs from 'node:fs'
import path from 'node:path'
import {
  commentsPath,
  consolidationsDir,
  contextItemsPath,
  counterFilePath,
  jobsDir,
  pendingDiscussionsPath,
  projectSnapshotReportsDir,
  revisionsDir,
  reviewsDir,
  threadsDir,
} from './paths'

interface CounterState {
  namespace: string
  value: number
  updated_at: string
}

function readCounterState(dataDir: string, namespace: string): CounterState | null {
  const filePath = counterFilePath(dataDir, namespace)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CounterState
}

function writeCounterState(dataDir: string, namespace: string, value: number): void {
  const filePath = counterFilePath(dataDir, namespace)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        namespace,
        value,
        updated_at: new Date().toISOString(),
      } satisfies CounterState,
      null,
      2,
    ),
  )
  fs.renameSync(tmp, filePath)
}

export function reserveMonotonicCounter(
  dataDir: string,
  namespace: string,
  scanOnDiskMax: () => number,
): number {
  const onDiskMax = scanOnDiskMax()
  const current = readCounterState(dataDir, namespace)?.value ?? onDiskMax
  const next = Math.max(current, onDiskMax) + 1
  writeCounterState(dataDir, namespace, next)
  return next
}

export function ensureCounterAhead(
  dataDir: string,
  namespace: string,
  onDiskMax: number,
): { repaired: boolean; oldValue: number | null; newValue: number } {
  const existing = readCounterState(dataDir, namespace)
  if (!existing) {
    writeCounterState(dataDir, namespace, onDiskMax)
    return { repaired: true, oldValue: null, newValue: onDiskMax }
  }
  if (existing.value >= onDiskMax) {
    return { repaired: false, oldValue: existing.value, newValue: existing.value }
  }
  writeCounterState(dataDir, namespace, onDiskMax)
  return { repaired: true, oldValue: existing.value, newValue: onDiskMax }
}

function maxFromRegex(values: Iterable<string>, pattern: RegExp): number {
  let max = 0
  for (const value of values) {
    const match = pattern.exec(value)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

function scanThreadIdMax(dataDir: string): number {
  if (!fs.existsSync(threadsDir(dataDir))) return 0
  return maxFromRegex(
    fs.readdirSync(threadsDir(dataDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    /^thread-(\d+)$/,
  )
}

function scanPendingDiscussionMax(dataDir: string, threadId: string): number {
  let max = 0
  const pendingFile = pendingDiscussionsPath(dataDir, threadId)
  if (fs.existsSync(pendingFile)) {
    const lines = fs.readFileSync(pendingFile, 'utf8').split('\n').filter(Boolean)
    max = Math.max(
      max,
      maxFromRegex(
        lines.map((line) => (JSON.parse(line) as { id: string }).id),
        /^pd(\d+)$/,
      ),
    )
  }
  const commentsFile = commentsPath(dataDir, threadId)
  if (fs.existsSync(commentsFile)) {
    const lines = fs.readFileSync(commentsFile, 'utf8').split('\n').filter(Boolean)
    max = Math.max(
      max,
      maxFromRegex(
        lines
          .map((line) => (JSON.parse(line) as { approved_from_pending_id?: string | null }).approved_from_pending_id ?? ''),
        /^pd(\d+)$/,
      ),
    )
  }
  return max
}

function scanConsolidationMax(dataDir: string, threadId: string): number {
  const dir = consolidationsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return 0
  return maxFromRegex(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    /^consolidation-(\d+)$/,
  )
}

function scanRevisionMax(dataDir: string, threadId: string, proposalId: string): number {
  const dir = revisionsDir(dataDir, threadId, proposalId)
  if (!fs.existsSync(dir)) return 0
  return maxFromRegex(fs.readdirSync(dir), /^r(\d+)\.md$/)
}

function scanReviewMax(dataDir: string, threadId: string, proposalId: string): number {
  const dir = reviewsDir(dataDir, threadId, proposalId)
  if (!fs.existsSync(dir)) return 0
  return maxFromRegex(fs.readdirSync(dir), /^review-(\d+)\.md$/)
}

function scanContextItemMax(dataDir: string, threadId: string): number {
  const file = contextItemsPath(dataDir, threadId)
  if (!fs.existsSync(file)) return 0
  return maxFromRegex(
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { id: string }).id),
    /^ctx(\d+)$/,
  )
}

function scanSnapshotReportMax(dataDir: string, threadId: string): number {
  const dir = projectSnapshotReportsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return 0
  return maxFromRegex(fs.readdirSync(dir), /^snapshot-(\d+)\.json$/)
}

function scanJobMax(dataDir: string, threadId: string): number {
  const dir = jobsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return 0
  return maxFromRegex(fs.readdirSync(dir), /^job-(\d+)\.json$/)
}

function threadIds(dataDir: string): string[] {
  if (!fs.existsSync(threadsDir(dataDir))) return []
  return fs.readdirSync(threadsDir(dataDir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function proposalIds(dataDir: string, threadId: string): string[] {
  const dir = consolidationsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

export function threadCounterNamespace(): string {
  return 'threads'
}

export function pendingDiscussionCounterNamespace(threadId: string): string {
  return `thread:${threadId}:pending-discussions`
}

export function consolidationCounterNamespace(threadId: string): string {
  return `thread:${threadId}:consolidations`
}

export function revisionCounterNamespace(threadId: string, proposalId: string): string {
  return `thread:${threadId}:proposal:${proposalId}:revisions`
}

export function reviewCounterNamespace(threadId: string, proposalId: string): string {
  return `thread:${threadId}:proposal:${proposalId}:reviews`
}

export function contextItemCounterNamespace(threadId: string): string {
  return `thread:${threadId}:context-items`
}

export function snapshotReportCounterNamespace(threadId: string): string {
  return `thread:${threadId}:snapshot-reports`
}

export function jobCounterNamespace(threadId: string): string {
  return `thread:${threadId}:jobs`
}

export function nextThreadCounterValue(dataDir: string): number {
  return reserveMonotonicCounter(dataDir, threadCounterNamespace(), () => scanThreadIdMax(dataDir))
}

export function nextPendingDiscussionCounterValue(dataDir: string, threadId: string): number {
  return reserveMonotonicCounter(
    dataDir,
    pendingDiscussionCounterNamespace(threadId),
    () => scanPendingDiscussionMax(dataDir, threadId),
  )
}

export function nextConsolidationCounterValue(dataDir: string, threadId: string): number {
  return reserveMonotonicCounter(
    dataDir,
    consolidationCounterNamespace(threadId),
    () => scanConsolidationMax(dataDir, threadId),
  )
}

export function nextRevisionCounterValue(
  dataDir: string,
  threadId: string,
  proposalId: string,
): number {
  return reserveMonotonicCounter(
    dataDir,
    revisionCounterNamespace(threadId, proposalId),
    () => scanRevisionMax(dataDir, threadId, proposalId),
  )
}

export function nextReviewCounterValue(
  dataDir: string,
  threadId: string,
  proposalId: string,
): number {
  return reserveMonotonicCounter(
    dataDir,
    reviewCounterNamespace(threadId, proposalId),
    () => scanReviewMax(dataDir, threadId, proposalId),
  )
}

export function nextContextItemCounterValue(dataDir: string, threadId: string): number {
  return reserveMonotonicCounter(
    dataDir,
    contextItemCounterNamespace(threadId),
    () => scanContextItemMax(dataDir, threadId),
  )
}

export function nextSnapshotReportCounterValue(dataDir: string, threadId: string): number {
  return reserveMonotonicCounter(
    dataDir,
    snapshotReportCounterNamespace(threadId),
    () => scanSnapshotReportMax(dataDir, threadId),
  )
}

export function nextJobCounterValue(dataDir: string, threadId: string): number {
  return reserveMonotonicCounter(
    dataDir,
    jobCounterNamespace(threadId),
    () => scanJobMax(dataDir, threadId),
  )
}

export function validateAllMonotonicCounters(
  dataDir: string,
  logRepair: (message: string) => void = console.warn,
): void {
  const logResult = (namespace: string, oldValue: number | null, newValue: number): void => {
    logRepair(`counter repaired namespace=${namespace} old=${oldValue ?? 'missing'} new=${newValue}`)
  }

  const threadResult = ensureCounterAhead(dataDir, threadCounterNamespace(), scanThreadIdMax(dataDir))
  if (threadResult.repaired) logResult(threadCounterNamespace(), threadResult.oldValue, threadResult.newValue)

  for (const threadId of threadIds(dataDir)) {
    const pendingResult = ensureCounterAhead(
      dataDir,
      pendingDiscussionCounterNamespace(threadId),
      scanPendingDiscussionMax(dataDir, threadId),
    )
    if (pendingResult.repaired) {
      logResult(pendingDiscussionCounterNamespace(threadId), pendingResult.oldValue, pendingResult.newValue)
    }

    const consolidationResult = ensureCounterAhead(
      dataDir,
      consolidationCounterNamespace(threadId),
      scanConsolidationMax(dataDir, threadId),
    )
    if (consolidationResult.repaired) {
      logResult(consolidationCounterNamespace(threadId), consolidationResult.oldValue, consolidationResult.newValue)
    }

    const contextResult = ensureCounterAhead(
      dataDir,
      contextItemCounterNamespace(threadId),
      scanContextItemMax(dataDir, threadId),
    )
    if (contextResult.repaired) {
      logResult(contextItemCounterNamespace(threadId), contextResult.oldValue, contextResult.newValue)
    }

    const snapshotResult = ensureCounterAhead(
      dataDir,
      snapshotReportCounterNamespace(threadId),
      scanSnapshotReportMax(dataDir, threadId),
    )
    if (snapshotResult.repaired) {
      logResult(snapshotReportCounterNamespace(threadId), snapshotResult.oldValue, snapshotResult.newValue)
    }

    const jobResult = ensureCounterAhead(
      dataDir,
      jobCounterNamespace(threadId),
      scanJobMax(dataDir, threadId),
    )
    if (jobResult.repaired) {
      logResult(jobCounterNamespace(threadId), jobResult.oldValue, jobResult.newValue)
    }

    for (const proposalId of proposalIds(dataDir, threadId)) {
      const revisionResult = ensureCounterAhead(
        dataDir,
        revisionCounterNamespace(threadId, proposalId),
        scanRevisionMax(dataDir, threadId, proposalId),
      )
      if (revisionResult.repaired) {
        logResult(revisionCounterNamespace(threadId, proposalId), revisionResult.oldValue, revisionResult.newValue)
      }

      const reviewResult = ensureCounterAhead(
        dataDir,
        reviewCounterNamespace(threadId, proposalId),
        scanReviewMax(dataDir, threadId, proposalId),
      )
      if (reviewResult.repaired) {
        logResult(reviewCounterNamespace(threadId, proposalId), reviewResult.oldValue, reviewResult.newValue)
      }
    }
  }
}
