import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type {
  ContextItem,
  CreateProjectSnapshotInput,
  CreateUrlContextInput,
  FileContextItem,
  ProjectSnapshot,
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
  StorageOperationError,
} from './errors'
import { appendJsonl } from './jsonl'
import {
  nextContextItemCounterValue,
  nextSnapshotReportCounterValue,
} from './counters'

interface ManifestEntry {
  path: string
  size_bytes: number
  sha256: string
}

const DEFAULT_SNAPSHOT_WORKER_TIMEOUT_MS = 30_000

function ensureThreadExists(dataDir: string, threadId: string): void {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
}

function ensureWriteDirectories(dataDir: string, threadId: string): void {
  ensureThreadExists(dataDir, threadId)
  fs.mkdirSync(attachmentsDir(dataDir, threadId), { recursive: true })
  fs.mkdirSync(projectSnapshotDir(dataDir, threadId), { recursive: true })
}

function toWorkspacePath(...parts: string[]): string {
  return parts.join('/').replaceAll(path.sep, '/')
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '-')
  const trimmed = base.replace(/^-+|-+$/g, '')
  return trimmed || 'attachment'
}

function nextContextItemId(dataDir: string, threadId: string): string {
  return `ctx${String(nextContextItemCounterValue(dataDir, threadId)).padStart(3, '0')}`
}

function fileHash(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

interface SnapshotWorkerPreflightRequest {
  kind: 'preflight'
  sourcePathInput: string
  workspacePath: string
}

interface SnapshotWorkerCreateRequest {
  kind: 'create'
  sourcePathInput: string
  workspacePath: string
  stagingRoot: string
  previousManifest: ManifestEntry[]
  reportId: string
  createdAt: string | null
  now: string
}

type SnapshotWorkerRequest =
  | SnapshotWorkerPreflightRequest
  | SnapshotWorkerCreateRequest

function snapshotWorkerTimeoutMs(): number {
  const raw = process.env.ROUNDTABLE_SNAPSHOT_WORKER_TIMEOUT_MS
  if (!raw) return DEFAULT_SNAPSHOT_WORKER_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SNAPSHOT_WORKER_TIMEOUT_MS
}

function snapshotWorkerPath(): URL {
  return new URL('./snapshotWorker.js', import.meta.url)
}

function snapshotStagingRoot(dataDir: string, threadId: string): string {
  return path.join(
    threadDir(dataDir, threadId),
    '.roundtable',
    `snapshot-staging-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
}

function toStorageOperationError(err: unknown): StorageOperationError {
  if (err instanceof BadRequestError) {
    return new StorageOperationError(err.message)
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return new StorageOperationError((err as { message: string }).message)
  }
  return new StorageOperationError('snapshot worker failed')
}

function runSnapshotWorker<T>(request: SnapshotWorkerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(snapshotWorkerPath(), {
      workerData: request,
    })
    const timeout = setTimeout(() => {
      settle(() => {
        void worker.terminate()
        reject(new StorageOperationError('snapshot worker timed out'))
      })
    }, snapshotWorkerTimeoutMs())

    let settled = false
    const settle = (handler: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      handler()
    }

    worker.once('message', (message: unknown) => {
      settle(() => {
        const payload = message as
          | { ok: true; result: T }
          | { ok: false; error: { name?: string; message?: string } }
        if (payload.ok) {
          resolve(payload.result)
          return
        }
        reject(
          payload.error?.name === 'BadRequestError'
            ? new BadRequestError(payload.error.message ?? 'snapshot worker failed')
            : new StorageOperationError(payload.error?.message ?? 'snapshot worker failed'),
        )
      })
    })
    worker.once('error', (err) => {
      settle(() => reject(toStorageOperationError(err)))
    })
    worker.once('exit', (code) => {
      if (settled || code === 0) return
      settle(() => reject(new StorageOperationError(`snapshot worker exited with code ${code}`)))
    })
  })
}

function replaceSnapshotDirectory(snapshotPath: string, stagedSnapshotPath: string): void {
  const backupPath = `${snapshotPath}.bak-${process.pid}-${Date.now()}`
  const hadExisting = fs.existsSync(snapshotPath)
  if (hadExisting) fs.renameSync(snapshotPath, backupPath)

  try {
    fs.renameSync(stagedSnapshotPath, snapshotPath)
    if (hadExisting) fs.rmSync(backupPath, { recursive: true, force: true })
  } catch (err) {
    if (fs.existsSync(snapshotPath)) {
      fs.rmSync(snapshotPath, { recursive: true, force: true })
    }
    if (hadExisting && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, snapshotPath)
    }
    throw err
  }
}

function commitSnapshotStaging(dataDir: string, threadId: string, stagingRoot: string): void {
  const stagedSnapshotPath = path.join(stagingRoot, 'project-snapshot')
  const stagedManifestPath = path.join(stagingRoot, 'project-snapshot-manifest.json')
  const stagedJsonPath = path.join(stagingRoot, 'project-snapshot.json')
  const stagedReportsDir = path.join(stagingRoot, 'project-snapshot-reports')
  const reportsDir = projectSnapshotReportsDir(dataDir, threadId)

  fs.mkdirSync(path.dirname(projectSnapshotJsonPath(dataDir, threadId)), { recursive: true })
  fs.mkdirSync(reportsDir, { recursive: true })
  replaceSnapshotDirectory(projectSnapshotDir(dataDir, threadId), stagedSnapshotPath)
  if (fs.existsSync(stagedManifestPath)) {
    fs.renameSync(stagedManifestPath, projectSnapshotManifestPath(dataDir, threadId))
  }
  if (fs.existsSync(stagedJsonPath)) {
    fs.renameSync(stagedJsonPath, projectSnapshotJsonPath(dataDir, threadId))
  }
  if (fs.existsSync(stagedReportsDir)) {
    for (const file of fs.readdirSync(stagedReportsDir)) {
      fs.renameSync(path.join(stagedReportsDir, file), path.join(reportsDir, file))
    }
  }
  fs.rmSync(stagingRoot, { recursive: true, force: true })
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
  return `snapshot-${String(nextSnapshotReportCounterValue(dataDir, threadId)).padStart(3, '0')}`
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
  ensureThreadExists(dataDir, threadId)
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
  ensureThreadExists(dataDir, threadId)
  const file = contextItemsPath(dataDir, threadId)
  if (!fs.existsSync(file)) return []
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
  const item: ContextItem = {
    id: nextContextItemId(dataDir, threadId),
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
  ensureWriteDirectories(dataDir, threadId)
  const id = nextContextItemId(dataDir, threadId)
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

export async function preflightProjectSnapshot(
  dataDir: string,
  threadId: string,
  sourcePathInput: string,
): Promise<SnapshotPreflight> {
  ensureThreadExists(dataDir, threadId)
  return runSnapshotWorker<SnapshotPreflight>({
    kind: 'preflight',
    sourcePathInput,
    workspacePath: fs.realpathSync(threadDir(dataDir, threadId)),
  })
}

export async function preflightProjectSnapshotSource(
  dataDir: string,
  sourcePathInput: string,
): Promise<SnapshotPreflight> {
  return runSnapshotWorker<SnapshotPreflight>({
    kind: 'preflight',
    sourcePathInput,
    workspacePath: fs.realpathSync(dataDir),
  })
}

export async function createProjectSnapshot(
  dataDir: string,
  threadId: string,
  input: CreateProjectSnapshotInput,
): Promise<ProjectSnapshot> {
  ensureWriteDirectories(dataDir, threadId)
  const preflight = await preflightProjectSnapshot(dataDir, threadId, input.source_path)
  if (preflight.requires_confirmation && !input.confirmed) {
    throw new ConfirmationRequiredError('snapshot requires confirmation')
  }

  const previousManifest = readManifest(dataDir, threadId)
  const existing = readProjectSnapshot(dataDir, threadId)
  const now = new Date().toISOString()
  const stagingRoot = snapshotStagingRoot(dataDir, threadId)
  try {
    const result = await runSnapshotWorker<ProjectSnapshot & { staging_root: string }>({
      kind: 'create',
      sourcePathInput: preflight.source_path,
      workspacePath: fs.realpathSync(threadDir(dataDir, threadId)),
      stagingRoot,
      previousManifest,
      reportId: nextSnapshotReportId(dataDir, threadId),
      createdAt: existing?.created_at ?? null,
      now,
    })
    commitSnapshotStaging(dataDir, threadId, result.staging_root)
    return {
      source_path: result.source_path,
      mode: result.mode,
      created_at: result.created_at,
      refreshed_at: result.refreshed_at,
      file_count: result.file_count,
      total_bytes: result.total_bytes,
      warnings: result.warnings,
      added_since_last_refresh: result.added_since_last_refresh,
      latest_report_id: result.latest_report_id,
    }
  } catch (err) {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
    throw err
  }
}

export async function refreshProjectSnapshot(
  dataDir: string,
  threadId: string,
): Promise<ProjectSnapshot> {
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
  ensureThreadExists(dataDir, threadId)
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
    'agents.json',
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
  ensureThreadExists(dataDir, threadId)
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
  ensureThreadExists(dataDir, sourceThreadId)
  ensureWriteDirectories(dataDir, targetThreadId)

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
