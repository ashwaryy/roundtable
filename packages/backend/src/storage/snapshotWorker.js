import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parentPort, workerData } from 'node:worker_threads'

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

function toWorkspacePath(...parts) {
  return parts.join('/').replaceAll(path.sep, '/')
}

function expandHome(input) {
  if (input === '~') return os.homedir()
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2))
  return input
}

function badRequest(message) {
  const err = new Error(message)
  err.name = 'BadRequestError'
  return err
}

function resolveDirectory(input) {
  try {
    const resolved = fs.realpathSync(path.resolve(expandHome(input)))
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) throw badRequest('source_path must be a directory')
    return resolved
  } catch (err) {
    if (err?.name === 'BadRequestError') throw err
    throw badRequest('source_path must be an existing directory')
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isSecretLike(relativePath) {
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

function hasExcludedSegment(relativePath) {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => EXCLUDED_DIRS.has(segment))
}

function isBinaryFile(filePath) {
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

function isEligibleFile(absolutePath, relativePath, stat) {
  if (hasExcludedSegment(relativePath) || isSecretLike(relativePath)) return false
  const name = path.basename(relativePath)
  if (name === '.DS_Store' || name.endsWith('.log')) return false
  if (!stat.isFile()) return false
  return !isBinaryFile(absolutePath)
}

function listRecursiveCandidates(sourcePath) {
  const candidates = []
  let directoryCount = 0
  let excludedCount = 0

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = toWorkspacePath(path.relative(sourcePath, absolutePath))
      if (entry.isDirectory()) {
        if (hasExcludedSegment(relativePath)) {
          excludedCount += 1
          continue
        }
        directoryCount += 1
        walk(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        excludedCount += 1
        continue
      }
      const stat = fs.statSync(absolutePath)
      if (!isEligibleFile(absolutePath, relativePath, stat)) {
        excludedCount += 1
        continue
      }
      candidates.push({
        absolutePath,
        relativePath,
        size_bytes: stat.size,
      })
    }
  }

  walk(sourcePath)
  return { candidates, directoryCount, excludedCount }
}

function collectCandidates(sourcePath) {
  const result = listRecursiveCandidates(sourcePath)
  return {
    mode: 'folder',
    candidates: result.candidates,
    directoryCount: result.directoryCount,
    excludedCount: result.excludedCount,
  }
}

function warningsFor(fileCount, totalBytes) {
  const warnings = []
  if (fileCount > LARGE_FILE_COUNT) {
    warnings.push(`Snapshot includes ${fileCount} files.`)
  }
  if (totalBytes > LARGE_TOTAL_BYTES) {
    warnings.push(`Snapshot includes ${Math.round(totalBytes / 1024 / 1024)} MB.`)
  }
  return warnings
}

function fileHash(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function computeReport(reportId, refreshedAt, mode, warnings, previousManifest, manifest) {
  const previous = new Map(previousManifest.map((entry) => [entry.path, entry]))
  const current = new Set(manifest.map((entry) => entry.path))
  return {
    id: reportId,
    thread_id: '',
    created_at: refreshedAt,
    mode,
    file_count: manifest.length,
    total_bytes: manifest.reduce((sum, entry) => sum + entry.size_bytes, 0),
    warnings,
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
}

function fsyncPath(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function fsyncDirectory(dirPath) {
  try {
    fsyncPath(dirPath)
  } catch {
    // Best-effort directory sync; some platforms reject syncing directories.
  }
}

function writeJsonStaged(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
  fsyncPath(filePath)
  fsyncDirectory(path.dirname(filePath))
}

function maybeDelay() {
  const raw = process.env.ROUNDTABLE_SNAPSHOT_WORKER_DELAY_MS
  if (!raw) return Promise.resolve()
  const delayMs = Number(raw)
  if (!Number.isFinite(delayMs) || delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function runPreflight(request) {
  const sourcePath = resolveDirectory(request.sourcePathInput)
  if (isInside(request.workspacePath, sourcePath)) {
    throw badRequest('source_path cannot be inside the thread workspace')
  }

  const { mode, candidates, directoryCount, excludedCount } = collectCandidates(sourcePath)
  const totalBytes = candidates.reduce((sum, file) => sum + file.size_bytes, 0)
  return {
    source_path: sourcePath,
    mode,
    candidates,
    requires_confirmation: true,
    file_count: candidates.length,
    directory_count: directoryCount,
    total_bytes: totalBytes,
    excluded_count: excludedCount,
    warnings: warningsFor(candidates.length, totalBytes),
  }
}

async function runCreate(request) {
  const preflight = await runPreflight(request)
  const { candidates } = preflight
  const manifest = []
  const stagedSnapshotDir = path.join(request.stagingRoot, 'project-snapshot')

  fs.rmSync(request.stagingRoot, { recursive: true, force: true })
  fs.mkdirSync(stagedSnapshotDir, { recursive: true })

  for (const candidate of candidates) {
    const destination = path.join(stagedSnapshotDir, candidate.relativePath)
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

  const report = computeReport(
    request.reportId,
    request.now,
    preflight.mode,
    preflight.warnings,
    request.previousManifest,
    manifest,
  )
  const snapshot = {
    source_path: preflight.source_path,
    mode: preflight.mode,
    created_at: request.createdAt ?? request.now,
    refreshed_at: request.now,
    file_count: manifest.length,
    total_bytes: manifest.reduce((sum, entry) => sum + entry.size_bytes, 0),
    warnings: preflight.warnings,
    added_since_last_refresh: report.added_paths,
    latest_report_id: report.id,
  }

  writeJsonStaged(
    path.join(request.stagingRoot, 'project-snapshot-manifest.json'),
    manifest,
  )
  writeJsonStaged(path.join(request.stagingRoot, 'project-snapshot.json'), snapshot)
  writeJsonStaged(
    path.join(request.stagingRoot, 'project-snapshot-reports', `${report.id}.json`),
    report,
  )
  fsyncDirectory(stagedSnapshotDir)
  fsyncDirectory(request.stagingRoot)

  return {
    ...snapshot,
    staging_root: request.stagingRoot,
  }
}

async function main() {
  await maybeDelay()
  if (workerData.kind === 'preflight') {
    const { candidates, ...result } = await runPreflight(workerData)
    parentPort?.postMessage({ ok: true, result })
    return
  }
  parentPort?.postMessage({ ok: true, result: await runCreate(workerData) })
}

main().catch((err) => {
  parentPort?.postMessage({
    ok: false,
    error: {
      name: err?.name,
      message: err?.message ?? 'snapshot worker failed',
    },
  })
})
