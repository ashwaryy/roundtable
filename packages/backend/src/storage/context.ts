import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type {
  ContextItem,
  CreateProjectSnapshotInput,
  CreateUrlContextInput,
  FileContextItem,
  ProjectSnapshot,
  ProjectSnapshotMode,
  SnapshotReport,
  SnapshotPreflight,
  ThreadContext,
  WorkspaceAddedFile,
} from '@roundtable/shared'
import {
  attachmentsDir,
  contextItemsPath,
  projectSnapshotDir,
  projectSnapshotJsonPath,
  projectSnapshotManifestPath,
  projectSnapshotReportPath,
  projectSnapshotReportsDir,
  threadDir,
  threadJsonPath,
} from './paths'
import {
  BadRequestError,
  ConfirmationRequiredError,
  NotFoundError,
} from './errors'
import { appendJsonl } from './jsonl'

interface ManifestEntry {
  path: string
  size_bytes: number
  sha256: string
}

interface CandidateFile {
  absolutePath: string
  relativePath: string
  size_bytes: number
}

const LARGE_FILE_COUNT = 1000
const LARGE_TOTAL_BYTES = 50 * 1024 * 1024

const EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
])

function ensureThread(dataDir: string, threadId: string): void {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
  fs.mkdirSync(attachmentsDir(dataDir, threadId), { recursive: true })
  fs.mkdirSync(projectSnapshotDir(dataDir, threadId), { recursive: true })
  const contextPath = contextItemsPath(dataDir, threadId)
  if (!fs.existsSync(contextPath)) fs.writeFileSync(contextPath, '')
}

function toWorkspacePath(...parts: string[]): string {
  return parts.join('/').replaceAll(path.sep, '/')
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2))
  return input
}

function resolveDirectory(input: string): string {
  try {
    const resolved = fs.realpathSync(path.resolve(expandHome(input)))
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) throw new BadRequestError('source_path must be a directory')
    return resolved
  } catch (err) {
    if (err instanceof BadRequestError) throw err
    throw new BadRequestError('source_path must be an existing directory')
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '-')
  const trimmed = base.replace(/^-+|-+$/g, '')
  return trimmed || 'attachment'
}

function nextContextItemId(items: ContextItem[]): string {
  let max = 0
  for (const item of items) {
    const match = /^ctx(\d+)$/.exec(item.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `ctx${String(max + 1).padStart(3, '0')}`
}

function isSecretLike(relativePath: string): boolean {
  const name = path.basename(relativePath).toLowerCase()
  return (
    name.startsWith('.env') ||
    name === 'id_rsa' ||
    name === 'id_dsa' ||
    name === 'id_ecdsa' ||
    name === 'id_ed25519' ||
    /\.(pem|key|crt|cer|p12|pfx)$/.test(name)
  )
}

function hasExcludedSegment(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => EXCLUDED_DIRS.has(segment))
}

function isBinaryFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(8192)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    if (bytesRead === 0) return false
    return buffer.subarray(0, bytesRead).includes(0)
  } finally {
    fs.closeSync(fd)
  }
}

function isEligibleFile(absolutePath: string, relativePath: string): boolean {
  if (hasExcludedSegment(relativePath) || isSecretLike(relativePath)) return false
  const name = path.basename(relativePath)
  if (name === '.DS_Store' || name.endsWith('.log')) return false
  if (!fs.statSync(absolutePath).isFile()) return false
  return !isBinaryFile(absolutePath)
}

function listRecursiveCandidates(sourcePath: string): {
  candidates: CandidateFile[]
  excludedCount: number
} {
  const candidates: CandidateFile[] = []
  let excludedCount = 0

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = toWorkspacePath(path.relative(sourcePath, absolutePath))
      if (entry.isDirectory()) {
        if (hasExcludedSegment(relativePath)) {
          excludedCount += 1
          continue
        }
        walk(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        excludedCount += 1
        continue
      }
      if (!isEligibleFile(absolutePath, relativePath)) {
        excludedCount += 1
        continue
      }
      candidates.push({
        absolutePath,
        relativePath,
        size_bytes: fs.statSync(absolutePath).size,
      })
    }
  }

  walk(sourcePath)
  return { candidates, excludedCount }
}

function collectCandidates(sourcePath: string): {
  mode: ProjectSnapshotMode
  candidates: CandidateFile[]
  excludedCount: number
} {
  const result = listRecursiveCandidates(sourcePath)
  return {
    mode: 'folder',
    candidates: result.candidates,
    excludedCount: result.excludedCount,
  }
}

function warningsFor(fileCount: number, totalBytes: number): string[] {
  const warnings: string[] = []
  if (fileCount > LARGE_FILE_COUNT) {
    warnings.push(`Snapshot includes ${fileCount} files.`)
  }
  if (totalBytes > LARGE_TOTAL_BYTES) {
    warnings.push(`Snapshot includes ${Math.round(totalBytes / 1024 / 1024)} MB.`)
  }
  return warnings
}

function fileHash(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function readManifest(dataDir: string, threadId: string): ManifestEntry[] {
  const manifestPath = projectSnapshotManifestPath(dataDir, threadId)
  if (!fs.existsSync(manifestPath)) return []
  const stored = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Array<
    Omit<ManifestEntry, 'sha256'> & { sha256?: string }
  >
  return stored.map((entry) => {
    if (entry.sha256) return { ...entry, sha256: entry.sha256 }
    const snapshotFile = path.join(projectSnapshotDir(dataDir, threadId), entry.path)
    return {
      ...entry,
      sha256: fs.existsSync(snapshotFile) ? fileHash(snapshotFile) : '',
    }
  })
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, filePath)
}

function nextSnapshotReportId(dataDir: string, threadId: string): string {
  const dir = projectSnapshotReportsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return 'snapshot-001'
  let max = 0
  for (const file of fs.readdirSync(dir)) {
    const match = /^snapshot-(\d+)\.json$/.exec(file)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `snapshot-${String(max + 1).padStart(3, '0')}`
}

function createSnapshotReport(
  dataDir: string,
  threadId: string,
  snapshot: Omit<ProjectSnapshot, 'latest_report_id'>,
  previousManifest: ManifestEntry[],
  manifest: ManifestEntry[],
): SnapshotReport {
  const previous = new Map(previousManifest.map((entry) => [entry.path, entry]))
  const current = new Set(manifest.map((entry) => entry.path))
  const report: SnapshotReport = {
    id: nextSnapshotReportId(dataDir, threadId),
    thread_id: threadId,
    created_at: snapshot.refreshed_at,
    mode: snapshot.mode,
    file_count: snapshot.file_count,
    total_bytes: snapshot.total_bytes,
    warnings: snapshot.warnings,
    added_paths: manifest
      .map((entry) => entry.path)
      .filter((entryPath) => !previous.has(entryPath)),
    modified_paths: manifest
      .filter((entry) => {
        const old = previous.get(entry.path)
        return old !== undefined && old.sha256 !== entry.sha256
      })
      .map((entry) => entry.path),
    removed_paths: previousManifest
      .map((entry) => entry.path)
      .filter((entryPath) => !current.has(entryPath)),
  }
  writeJsonAtomic(projectSnapshotReportPath(dataDir, threadId, report.id), report)
  return report
}

export function listSnapshotReports(dataDir: string, threadId: string): SnapshotReport[] {
  ensureThread(dataDir, threadId)
  const dir = projectSnapshotReportsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((file) => /^snapshot-\d+\.json$/.test(file))
    .sort()
    .map(
      (file) =>
        JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as SnapshotReport,
    )
}

export function listContextItems(dataDir: string, threadId: string): ContextItem[] {
  ensureThread(dataDir, threadId)
  const file = contextItemsPath(dataDir, threadId)
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ContextItem)
}

export function addUrlContextItem(
  dataDir: string,
  threadId: string,
  input: CreateUrlContextInput,
): ContextItem {
  const existing = listContextItems(dataDir, threadId)
  const item: ContextItem = {
    id: nextContextItemId(existing),
    thread_id: threadId,
    kind: 'url',
    url: input.url,
    label: input.label ?? null,
    created_at: new Date().toISOString(),
  }
  appendJsonl(contextItemsPath(dataDir, threadId), item)
  return item
}

export function addAttachmentFromFile(
  dataDir: string,
  threadId: string,
  input: {
    tempPath: string
    originalName: string
    mediaType: string | null
    sizeBytes: number
  },
): FileContextItem {
  const existing = listContextItems(dataDir, threadId)
  const id = nextContextItemId(existing)
  const filename = `${id}-${sanitizeFilename(input.originalName)}`
  const destination = path.join(attachmentsDir(dataDir, threadId), filename)
  fs.copyFileSync(input.tempPath, destination)

  const item: FileContextItem = {
    id,
    thread_id: threadId,
    kind: 'file',
    filename,
    original_name: input.originalName,
    path: toWorkspacePath('attachments', filename),
    media_type: input.mediaType,
    size_bytes: input.sizeBytes,
    created_at: new Date().toISOString(),
  }
  appendJsonl(contextItemsPath(dataDir, threadId), item)
  return item
}

export function preflightProjectSnapshot(
  dataDir: string,
  threadId: string,
  sourcePathInput: string,
): SnapshotPreflight {
  ensureThread(dataDir, threadId)
  const sourcePath = resolveDirectory(sourcePathInput)
  const workspacePath = fs.realpathSync(threadDir(dataDir, threadId))
  if (isInside(workspacePath, sourcePath)) {
    throw new BadRequestError('source_path cannot be inside the thread workspace')
  }

  const { mode, candidates, excludedCount } = collectCandidates(sourcePath)
  const totalBytes = candidates.reduce((sum, file) => sum + file.size_bytes, 0)
  const warnings = warningsFor(candidates.length, totalBytes)

  return {
    source_path: sourcePath,
    mode,
    requires_confirmation: true,
    file_count: candidates.length,
    total_bytes: totalBytes,
    excluded_count: excludedCount,
    warnings,
  }
}

export function createProjectSnapshot(
  dataDir: string,
  threadId: string,
  input: CreateProjectSnapshotInput,
): ProjectSnapshot {
  const preflight = preflightProjectSnapshot(dataDir, threadId, input.source_path)
  if (preflight.requires_confirmation && !input.confirmed) {
    throw new ConfirmationRequiredError('snapshot requires confirmation')
  }

  const { candidates } = collectCandidates(preflight.source_path)
  const snapshotPath = projectSnapshotDir(dataDir, threadId)
  const tmpPath = `${snapshotPath}.tmp-${process.pid}-${Date.now()}`
  const previousManifest = readManifest(dataDir, threadId)
  const manifest: ManifestEntry[] = []

  fs.rmSync(tmpPath, { recursive: true, force: true })
  fs.mkdirSync(tmpPath, { recursive: true })

  try {
    for (const candidate of candidates) {
      const destination = path.join(tmpPath, candidate.relativePath)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(candidate.absolutePath, destination)
      try {
        fs.chmodSync(destination, 0o444)
      } catch {
        // Best-effort read-only snapshot files.
      }
      manifest.push({
        path: candidate.relativePath,
        size_bytes: candidate.size_bytes,
        sha256: fileHash(candidate.absolutePath),
      })
    }

    fs.rmSync(snapshotPath, { recursive: true, force: true })
    fs.renameSync(tmpPath, snapshotPath)
  } catch (err) {
    fs.rmSync(tmpPath, { recursive: true, force: true })
    throw err
  }

  const existing = readProjectSnapshot(dataDir, threadId)
  const now = new Date().toISOString()
  const snapshotBase: Omit<ProjectSnapshot, 'latest_report_id'> = {
    source_path: preflight.source_path,
    mode: preflight.mode,
    created_at: existing?.created_at ?? now,
    refreshed_at: now,
    file_count: manifest.length,
    total_bytes: manifest.reduce((sum, entry) => sum + entry.size_bytes, 0),
    warnings: preflight.warnings,
    added_since_last_refresh: [],
  }
  const report = createSnapshotReport(
    dataDir,
    threadId,
    snapshotBase,
    previousManifest,
    manifest,
  )
  const snapshot: ProjectSnapshot = {
    ...snapshotBase,
    added_since_last_refresh: report.added_paths,
    latest_report_id: report.id,
  }

  writeJsonAtomic(projectSnapshotManifestPath(dataDir, threadId), manifest)
  writeJsonAtomic(projectSnapshotJsonPath(dataDir, threadId), snapshot)
  return snapshot
}

export function refreshProjectSnapshot(
  dataDir: string,
  threadId: string,
): ProjectSnapshot {
  const snapshot = readProjectSnapshot(dataDir, threadId)
  if (!snapshot) throw new NotFoundError(`snapshot for ${threadId} not found`)
  return createProjectSnapshot(dataDir, threadId, {
    source_path: snapshot.source_path,
    confirmed: true,
  })
}

export function readProjectSnapshot(
  dataDir: string,
  threadId: string,
): ProjectSnapshot | null {
  ensureThread(dataDir, threadId)
  const file = projectSnapshotJsonPath(dataDir, threadId)
  if (!fs.existsSync(file)) return null
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectSnapshot
  return { ...snapshot, latest_report_id: snapshot.latest_report_id ?? null }
}

function listKnownWorkspacePaths(
  dataDir: string,
  threadId: string,
  items: ContextItem[],
): Set<string> {
  const known = new Set([
    'thread.json',
    'thread.md',
    'comments.jsonl',
    'pending-discussions.jsonl',
    'context-items.jsonl',
    'project-snapshot.json',
    'project-snapshot-manifest.json',
  ])
  for (const item of items) {
    if (item.kind === 'file') known.add(item.path)
  }
  for (const entry of readManifest(dataDir, threadId)) {
    known.add(toWorkspacePath('project-snapshot', entry.path))
  }
  for (const report of listSnapshotReports(dataDir, threadId)) {
    known.add(toWorkspacePath('project-snapshot-reports', `${report.id}.json`))
  }
  return known
}

export function listWorkspaceAddedFiles(
  dataDir: string,
  threadId: string,
): WorkspaceAddedFile[] {
  ensureThread(dataDir, threadId)
  const root = threadDir(dataDir, threadId)
  const known = listKnownWorkspacePaths(dataDir, threadId, listContextItems(dataDir, threadId))
  const files: WorkspaceAddedFile[] = []

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = toWorkspacePath(path.relative(root, absolutePath))
      if (entry.isDirectory()) {
        if (
          entry.name === 'consolidations' ||
          entry.name === '.roundtable' ||
          entry.name === '.claude' ||
          entry.name === '.codex'
        ) continue
        walk(absolutePath)
        continue
      }
      if (!entry.isFile() || known.has(relativePath)) continue
      const stat = fs.statSync(absolutePath)
      files.push({
        path: relativePath,
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
      })
    }
  }

  walk(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function getThreadContext(dataDir: string, threadId: string): ThreadContext {
  return {
    items: listContextItems(dataDir, threadId),
    snapshot: readProjectSnapshot(dataDir, threadId),
    workspace_added_files: listWorkspaceAddedFiles(dataDir, threadId),
  }
}

export function copyThreadContext(
  dataDir: string,
  sourceThreadId: string,
  targetThreadId: string,
): void {
  ensureThread(dataDir, sourceThreadId)
  ensureThread(dataDir, targetThreadId)

  const sourceItems = listContextItems(dataDir, sourceThreadId)
  const targetItems = sourceItems.map((item) => ({
    ...item,
    thread_id: targetThreadId,
  }))
  fs.writeFileSync(
    contextItemsPath(dataDir, targetThreadId),
    targetItems.map((item) => JSON.stringify(item)).join('\n') +
      (targetItems.length > 0 ? '\n' : ''),
  )

  fs.rmSync(attachmentsDir(dataDir, targetThreadId), { recursive: true, force: true })
  fs.mkdirSync(attachmentsDir(dataDir, targetThreadId), { recursive: true })
  for (const item of sourceItems) {
    if (item.kind !== 'file') continue
    const source = path.join(threadDir(dataDir, sourceThreadId), item.path)
    const destination = path.join(threadDir(dataDir, targetThreadId), item.path)
    if (!fs.existsSync(source)) continue
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }

  const sourceSnapshotDir = projectSnapshotDir(dataDir, sourceThreadId)
  const targetSnapshotDir = projectSnapshotDir(dataDir, targetThreadId)
  fs.rmSync(targetSnapshotDir, { recursive: true, force: true })
  if (fs.existsSync(sourceSnapshotDir)) {
    fs.cpSync(sourceSnapshotDir, targetSnapshotDir, { recursive: true })
  } else {
    fs.mkdirSync(targetSnapshotDir, { recursive: true })
  }

  for (const filePath of [projectSnapshotManifestPath(dataDir, sourceThreadId)]) {
    if (!fs.existsSync(filePath)) continue
    const targetPath = filePath
      .replace(threadDir(dataDir, sourceThreadId), threadDir(dataDir, targetThreadId))
    fs.copyFileSync(filePath, targetPath)
  }

  const sourceSnapshot = readProjectSnapshot(dataDir, sourceThreadId)
  if (sourceSnapshot) {
    const manifest = readManifest(dataDir, targetThreadId)
    const timestamp = new Date().toISOString()
    const snapshotBase: Omit<ProjectSnapshot, 'latest_report_id'> = {
      ...sourceSnapshot,
      created_at: timestamp,
      refreshed_at: timestamp,
      added_since_last_refresh: [],
    }
    const report = createSnapshotReport(dataDir, targetThreadId, snapshotBase, [], manifest)
    writeJsonAtomic(projectSnapshotJsonPath(dataDir, targetThreadId), {
      ...snapshotBase,
      added_since_last_refresh: report.added_paths,
      latest_report_id: report.id,
    })
  }
}
