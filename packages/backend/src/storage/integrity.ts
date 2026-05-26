import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { IntegrityIssue, IntegrityReport } from '@roundtable/shared'
import {
  attachmentsDir,
  consolidationsDir,
  contextItemsPath,
  threadAgentsPath,
  integrityPath,
  pendingDiscussionsPath,
  commentsPath,
  projectSnapshotDir,
  projectSnapshotJsonPath,
  projectSnapshotManifestPath,
  projectSnapshotReportsDir,
  roundtableInternalDir,
  savedConsolidationDir,
  threadJsonPath,
  threadMdPath,
} from './paths'
import { NotFoundError } from './errors'
import type { CanonicalTouched } from './touched'
import { validateAllMonotonicCounters } from './counters'

interface IntegrityState {
  version: 1
  baseline: Record<string, BaselineEntry> | Record<string, string>
  report: IntegrityReport
}

interface BaselineEntry {
  hash: string
  mtime_ms: number
  size_bytes: number
}

interface Scan {
  baseline: Record<string, BaselineEntry>
  invalid: IntegrityIssue[]
}

type Fingerprints = Record<string, Omit<BaselineEntry, 'hash'>>

function hash(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function toLabel(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function scanJson(filePath: string, label: string, invalid: IntegrityIssue[]): void {
  try {
    const contents = fs.readFileSync(filePath, 'utf8')
    if (label.endsWith('.jsonl')) {
      for (const line of contents.split('\n').filter(Boolean)) JSON.parse(line)
    } else {
      JSON.parse(contents)
    }
  } catch {
    invalid.push({
      kind: 'invalid',
      path: label,
      message: `${label} contains malformed structured data`,
      detected_at: new Date().toISOString(),
    })
  }
}

function addFile(
  root: string,
  filePath: string,
  baseline: Record<string, BaselineEntry>,
  invalid: IntegrityIssue[],
  labelOverride?: string,
): void {
  if (!fs.existsSync(filePath)) return
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return
  const label = labelOverride ?? toLabel(root, filePath)
  baseline[label] = {
    hash: hash(filePath),
    mtime_ms: stat.mtimeMs,
    size_bytes: stat.size,
  }
  if (label.endsWith('.json') || label.endsWith('.jsonl')) {
    scanJson(filePath, label, invalid)
  }
}

function addTree(
  root: string,
  dir: string,
  baseline: Record<string, BaselineEntry>,
  invalid: IntegrityIssue[],
): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) addTree(root, target, baseline, invalid)
    if (entry.isFile()) addFile(root, target, baseline, invalid)
  }
}

function addFileFingerprint(
  root: string,
  filePath: string,
  fingerprints: Fingerprints,
): void {
  if (!fs.existsSync(filePath)) return
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return
  fingerprints[toLabel(root, filePath)] = {
    mtime_ms: stat.mtimeMs,
    size_bytes: stat.size,
  }
}

function addTreeFingerprints(
  root: string,
  dir: string,
  fingerprints: Fingerprints,
): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) addTreeFingerprints(root, target, fingerprints)
    if (entry.isFile()) addFileFingerprint(root, target, fingerprints)
  }
}

function scanCanonical(dataDir: string, threadId: string): Scan {
  const root = path.dirname(threadJsonPath(dataDir, threadId))
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
  const baseline: Record<string, BaselineEntry> = {}
  const invalid: IntegrityIssue[] = []
  for (const filePath of [
    threadJsonPath(dataDir, threadId),
    threadMdPath(dataDir, threadId),
    commentsPath(dataDir, threadId),
    pendingDiscussionsPath(dataDir, threadId),
    contextItemsPath(dataDir, threadId),
    threadAgentsPath(dataDir, threadId),
  ]) {
    if (!fs.existsSync(filePath)) {
      const label = toLabel(root, filePath)
      invalid.push({
        kind: 'invalid',
        path: label,
        message: `${label} is a required canonical artifact but is missing`,
        detected_at: new Date().toISOString(),
      })
    }
    addFile(root, filePath, baseline, invalid)
  }
  for (const filePath of [
    projectSnapshotJsonPath(dataDir, threadId),
    projectSnapshotManifestPath(dataDir, threadId),
  ]) {
    addFile(root, filePath, baseline, invalid)
  }
  for (const dir of [
    attachmentsDir(dataDir, threadId),
    projectSnapshotDir(dataDir, threadId),
    projectSnapshotReportsDir(dataDir, threadId),
    consolidationsDir(dataDir, threadId),
  ]) {
    addTree(root, dir, baseline, invalid)
  }

  const proposalsDir = consolidationsDir(dataDir, threadId)
  if (fs.existsSync(proposalsDir)) {
    for (const entry of fs.readdirSync(proposalsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const proposalPath = path.join(proposalsDir, entry.name, 'proposal.json')
      try {
        const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8')) as {
          saved_artifact_id?: string | null
        }
        if (proposal.saved_artifact_id) {
          addTree(
            root,
            savedConsolidationDir(dataDir, proposal.saved_artifact_id),
            baseline,
            invalid,
          )
        }
      } catch {
        // The proposal file itself has already been reported as invalid.
      }
    }
  }
  return { baseline, invalid }
}

function currentFingerprints(dataDir: string, threadId: string): Fingerprints {
  const root = path.dirname(threadJsonPath(dataDir, threadId))
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
  const fingerprints: Fingerprints = {}
  for (const filePath of [
    threadJsonPath(dataDir, threadId),
    threadMdPath(dataDir, threadId),
    commentsPath(dataDir, threadId),
    pendingDiscussionsPath(dataDir, threadId),
    contextItemsPath(dataDir, threadId),
    threadAgentsPath(dataDir, threadId),
    projectSnapshotJsonPath(dataDir, threadId),
    projectSnapshotManifestPath(dataDir, threadId),
  ]) {
    addFileFingerprint(root, filePath, fingerprints)
  }
  for (const dir of [
    attachmentsDir(dataDir, threadId),
    projectSnapshotDir(dataDir, threadId),
    projectSnapshotReportsDir(dataDir, threadId),
    consolidationsDir(dataDir, threadId),
  ]) {
    addTreeFingerprints(root, dir, fingerprints)
  }

  const proposalsDir = consolidationsDir(dataDir, threadId)
  if (fs.existsSync(proposalsDir)) {
    for (const entry of fs.readdirSync(proposalsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const proposalPath = path.join(proposalsDir, entry.name, 'proposal.json')
      try {
        const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8')) as {
          saved_artifact_id?: string | null
        }
        if (proposal.saved_artifact_id) {
          addTreeFingerprints(
            root,
            savedConsolidationDir(dataDir, proposal.saved_artifact_id),
            fingerprints,
          )
        }
      } catch {
        // The full scan handles malformed proposal files.
      }
    }
  }
  return fingerprints
}

function removeBaselinePath(
  root: string,
  baseline: Record<string, BaselineEntry>,
  absolutePath: string,
): void {
  delete baseline[toLabel(root, absolutePath)]
}

function removeBaselineRoot(
  root: string,
  baseline: Record<string, BaselineEntry>,
  absolutePath: string,
): void {
  const label = toLabel(root, absolutePath)
  for (const filePath of Object.keys(baseline)) {
    if (filePath === label || filePath.startsWith(`${label}/`)) {
      delete baseline[filePath]
    }
  }
}

function addTouchedEntries(
  root: string,
  baseline: Record<string, BaselineEntry>,
  invalid: IntegrityIssue[],
  previous: Record<string, BaselineEntry>,
  touched: CanonicalTouched,
): void {
  for (const filePath of touched.filesAddedOrUpdated ?? []) {
    if (!fs.existsSync(filePath)) continue
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) continue
    const label = toLabel(root, filePath)
    const existing = previous[label]
    baseline[label] =
      existing &&
      existing.mtime_ms === stat.mtimeMs &&
      existing.size_bytes === stat.size
        ? existing
        : {
            hash: hash(filePath),
            mtime_ms: stat.mtimeMs,
            size_bytes: stat.size,
          }
    if (label.endsWith('.json') || label.endsWith('.jsonl')) {
      scanJson(filePath, label, invalid)
    }
  }

  for (const dir of touched.rootsAddedOrUpdated ?? []) {
    addTree(root, dir, baseline, invalid)
  }
}

function readState(dataDir: string, threadId: string): IntegrityState | null {
  const filePath = integrityPath(dataDir, threadId)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as IntegrityState
}

export function currentIntegrityIssueCount(dataDir: string, threadId: string): number {
  return readState(dataDir, threadId)?.report.issues.length ?? 0
}

function writeState(dataDir: string, threadId: string, state: IntegrityState): void {
  fs.mkdirSync(roundtableInternalDir(dataDir, threadId), { recursive: true })
  const filePath = integrityPath(dataDir, threadId)
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, filePath)
}

function normalizeBaseline(
  baseline: IntegrityState['baseline'],
): Record<string, BaselineEntry> | null {
  const normalized: Record<string, BaselineEntry> = {}
  for (const [filePath, entry] of Object.entries(baseline)) {
    if (typeof entry === 'string') return null
    normalized[filePath] = entry
  }
  return normalized
}

function baselineForComparison(
  baseline: IntegrityState['baseline'],
  scannedBaseline: Record<string, BaselineEntry>,
): Record<string, BaselineEntry> {
  const normalized = normalizeBaseline(baseline)
  if (normalized) return normalized

  const legacy: Record<string, BaselineEntry> = {}
  for (const [filePath, hash] of Object.entries(baseline)) {
    if (typeof hash !== 'string') continue
    const scanned = scannedBaseline[filePath]
    legacy[filePath] = {
      hash,
      mtime_ms: scanned?.mtime_ms ?? 0,
      size_bytes: scanned?.size_bytes ?? 0,
    }
  }
  return legacy
}

function fingerprintsUnchanged(
  baseline: Record<string, BaselineEntry>,
  fingerprints: Fingerprints,
): boolean {
  const baselinePaths = Object.keys(baseline)
  const currentPaths = Object.keys(fingerprints)
  if (baselinePaths.length !== currentPaths.length) return false
  for (const filePath of baselinePaths) {
    const current = fingerprints[filePath]
    if (!current) return false
    const previous = baseline[filePath]
    if (
      previous.mtime_ms !== current.mtime_ms ||
      previous.size_bytes !== current.size_bytes
    ) {
      return false
    }
  }
  return true
}

function baselineEquals(
  a: Record<string, BaselineEntry>,
  b: Record<string, BaselineEntry>,
): boolean {
  const aPaths = Object.keys(a)
  const bPaths = Object.keys(b)
  if (aPaths.length !== bPaths.length) return false
  for (const filePath of aPaths) {
    const right = b[filePath]
    if (!right) return false
    const left = a[filePath]
    if (
      left.hash !== right.hash ||
      left.mtime_ms !== right.mtime_ms ||
      left.size_bytes !== right.size_bytes
    ) {
      return false
    }
  }
  return true
}

function materiallySameReport(a: IntegrityReport, b: IntegrityReport): boolean {
  const normalizeIssues = (issues: IntegrityIssue[]) =>
    issues
      .map((issue) => `${issue.kind}:${issue.path}:${issue.message}`)
      .sort()
      .join('\n')
  return (
    a.thread_id === b.thread_id &&
    a.acknowledged_at === b.acknowledged_at &&
    normalizeIssues(a.issues) === normalizeIssues(b.issues)
  )
}

function distinct(issues: IntegrityIssue[]): IntegrityIssue[] {
  const result = new Map<string, IntegrityIssue>()
  for (const issue of issues) result.set(`${issue.kind}:${issue.path}`, issue)
  return [...result.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function inspectIntegrity(
  dataDir: string,
  threadId: string,
  options: { force?: boolean } = {},
): IntegrityReport {
  const existing = readState(dataDir, threadId)
  const existingBaseline = existing ? normalizeBaseline(existing.baseline) : null
  if (existing && existingBaseline && !options.force) {
    const fingerprints = currentFingerprints(dataDir, threadId)
    if (fingerprintsUnchanged(existingBaseline, fingerprints)) {
      return existing.report
    }
  }

  const scan = scanCanonical(dataDir, threadId)
  const checkedAt = new Date().toISOString()
  if (!existing) {
    const report: IntegrityReport = {
      thread_id: threadId,
      checked_at: checkedAt,
      acknowledged_at: null,
      issues: distinct(scan.invalid),
    }
    writeState(dataDir, threadId, { version: 1, baseline: scan.baseline, report })
    return report
  }

  const detected: IntegrityIssue[] = [...scan.invalid]
  const baseline = baselineForComparison(existing.baseline, scan.baseline)
  for (const [filePath, oldEntry] of Object.entries(baseline)) {
    if (!(filePath in scan.baseline)) {
      detected.push({
        kind: 'deleted',
        path: filePath,
        message: `${filePath} was removed outside Roundtable`,
        detected_at: checkedAt,
      })
    } else if (scan.baseline[filePath].hash !== oldEntry.hash) {
      detected.push({
        kind: 'modified',
        path: filePath,
        message: `${filePath} changed outside Roundtable`,
        detected_at: checkedAt,
      })
    }
  }
  for (const filePath of Object.keys(scan.baseline)) {
    if (!(filePath in baseline)) {
      detected.push({
        kind: 'added',
        path: filePath,
        message: `${filePath} was added outside Roundtable`,
        detected_at: checkedAt,
      })
    }
  }
  const report: IntegrityReport = {
    ...existing.report,
    checked_at: checkedAt,
    issues: distinct([...existing.report.issues, ...detected]),
  }
  if (
    !baselineEquals(baseline, scan.baseline) ||
    !materiallySameReport(existing.report, report)
  ) {
    writeState(dataDir, threadId, { version: 1, baseline: scan.baseline, report })
  }
  return report
}

export function acceptApplicationWrite(
  dataDir: string,
  threadId: string,
  touched?: CanonicalTouched,
): IntegrityReport {
  const existing = readState(dataDir, threadId)
  if (!existing || !touched) {
    const scan = scanCanonical(dataDir, threadId)
    const report: IntegrityReport = existing?.report ?? {
      thread_id: threadId,
      checked_at: new Date().toISOString(),
      acknowledged_at: null,
      issues: [],
    }
    writeState(dataDir, threadId, {
      version: 1,
      baseline: scan.baseline,
      report: { ...report, checked_at: new Date().toISOString() },
    })
    return report
  }

  const previousBaseline = normalizeBaseline(existing.baseline)
  if (!previousBaseline) {
    const scan = scanCanonical(dataDir, threadId)
    writeState(dataDir, threadId, {
      version: 1,
      baseline: scan.baseline,
      report: { ...existing.report, checked_at: new Date().toISOString() },
    })
    return existing.report
  }

  const root = path.dirname(threadJsonPath(dataDir, threadId))
  const baseline = { ...previousBaseline }
  const invalid: IntegrityIssue[] = []

  for (const filePath of touched.filesDeleted ?? []) {
    removeBaselinePath(root, baseline, filePath)
  }
  for (const dir of touched.rootsDeleted ?? []) {
    removeBaselineRoot(root, baseline, dir)
  }
  addTouchedEntries(root, baseline, invalid, previousBaseline, touched)

  const report: IntegrityReport = existing?.report ?? {
    thread_id: threadId,
    checked_at: new Date().toISOString(),
    acknowledged_at: null,
    issues: [],
  }
  writeState(dataDir, threadId, {
    version: 1,
    baseline,
    report: {
      ...report,
      checked_at: new Date().toISOString(),
      issues: invalid.length > 0 ? distinct([...report.issues, ...invalid]) : report.issues,
    },
  })
  return report
}

export function acknowledgeIntegrity(dataDir: string, threadId: string): IntegrityReport {
  const scan = scanCanonical(dataDir, threadId)
  validateAllMonotonicCounters(dataDir)
  const timestamp = new Date().toISOString()
  const report: IntegrityReport = {
    thread_id: threadId,
    checked_at: timestamp,
    acknowledged_at: timestamp,
    issues: distinct(scan.invalid),
  }
  writeState(dataDir, threadId, { version: 1, baseline: scan.baseline, report })
  return report
}
