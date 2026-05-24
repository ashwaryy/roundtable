import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { IntegrityIssue, IntegrityReport } from '@roundtable/shared'
import {
  attachmentsDir,
  consolidationsDir,
  contextItemsPath,
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

interface IntegrityState {
  version: 1
  baseline: Record<string, string>
  report: IntegrityReport
}

interface Scan {
  hashes: Record<string, string>
  invalid: IntegrityIssue[]
}

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
  hashes: Record<string, string>,
  invalid: IntegrityIssue[],
  labelOverride?: string,
): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return
  const label = labelOverride ?? toLabel(root, filePath)
  hashes[label] = hash(filePath)
  if (label.endsWith('.json') || label.endsWith('.jsonl')) {
    scanJson(filePath, label, invalid)
  }
}

function addTree(
  root: string,
  dir: string,
  hashes: Record<string, string>,
  invalid: IntegrityIssue[],
): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) addTree(root, target, hashes, invalid)
    if (entry.isFile()) addFile(root, target, hashes, invalid)
  }
}

function scanCanonical(dataDir: string, threadId: string): Scan {
  const root = path.dirname(threadJsonPath(dataDir, threadId))
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
  const hashes: Record<string, string> = {}
  const invalid: IntegrityIssue[] = []
  for (const filePath of [
    threadJsonPath(dataDir, threadId),
    threadMdPath(dataDir, threadId),
    commentsPath(dataDir, threadId),
    pendingDiscussionsPath(dataDir, threadId),
    contextItemsPath(dataDir, threadId),
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
    addFile(root, filePath, hashes, invalid)
  }
  for (const filePath of [
    projectSnapshotJsonPath(dataDir, threadId),
    projectSnapshotManifestPath(dataDir, threadId),
  ]) {
    addFile(root, filePath, hashes, invalid)
  }
  for (const dir of [
    attachmentsDir(dataDir, threadId),
    projectSnapshotDir(dataDir, threadId),
    projectSnapshotReportsDir(dataDir, threadId),
    consolidationsDir(dataDir, threadId),
  ]) {
    addTree(root, dir, hashes, invalid)
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
            hashes,
            invalid,
          )
        }
      } catch {
        // The proposal file itself has already been reported as invalid.
      }
    }
  }
  return { hashes, invalid }
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

function distinct(issues: IntegrityIssue[]): IntegrityIssue[] {
  const result = new Map<string, IntegrityIssue>()
  for (const issue of issues) result.set(`${issue.kind}:${issue.path}`, issue)
  return [...result.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function inspectIntegrity(dataDir: string, threadId: string): IntegrityReport {
  const scan = scanCanonical(dataDir, threadId)
  const existing = readState(dataDir, threadId)
  const checkedAt = new Date().toISOString()
  if (!existing) {
    const report: IntegrityReport = {
      thread_id: threadId,
      checked_at: checkedAt,
      acknowledged_at: null,
      issues: distinct(scan.invalid),
    }
    writeState(dataDir, threadId, { version: 1, baseline: scan.hashes, report })
    return report
  }

  const detected: IntegrityIssue[] = [...scan.invalid]
  for (const [filePath, oldHash] of Object.entries(existing.baseline)) {
    if (!(filePath in scan.hashes)) {
      detected.push({
        kind: 'deleted',
        path: filePath,
        message: `${filePath} was removed outside Roundtable`,
        detected_at: checkedAt,
      })
    } else if (scan.hashes[filePath] !== oldHash) {
      detected.push({
        kind: 'modified',
        path: filePath,
        message: `${filePath} changed outside Roundtable`,
        detected_at: checkedAt,
      })
    }
  }
  for (const filePath of Object.keys(scan.hashes)) {
    if (!(filePath in existing.baseline)) {
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
  writeState(dataDir, threadId, { ...existing, report })
  return report
}

export function acceptApplicationWrite(dataDir: string, threadId: string): IntegrityReport {
  const scan = scanCanonical(dataDir, threadId)
  const existing = readState(dataDir, threadId)
  const report: IntegrityReport = existing?.report ?? {
    thread_id: threadId,
    checked_at: new Date().toISOString(),
    acknowledged_at: null,
    issues: [],
  }
  writeState(dataDir, threadId, {
    version: 1,
    baseline: scan.hashes,
    report: { ...report, checked_at: new Date().toISOString() },
  })
  return report
}

export function acknowledgeIntegrity(dataDir: string, threadId: string): IntegrityReport {
  const scan = scanCanonical(dataDir, threadId)
  const timestamp = new Date().toISOString()
  const report: IntegrityReport = {
    thread_id: threadId,
    checked_at: timestamp,
    acknowledged_at: timestamp,
    issues: distinct(scan.invalid),
  }
  writeState(dataDir, threadId, { version: 1, baseline: scan.hashes, report })
  return report
}
