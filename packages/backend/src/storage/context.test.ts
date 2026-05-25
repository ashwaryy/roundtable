import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createThread } from './threads'
import {
  addAttachmentFromFile,
  addUrlContextItem,
  createProjectSnapshot,
  getThreadContext,
  listWorkspaceAddedFiles,
  preflightProjectSnapshot,
  refreshProjectSnapshot,
  listSnapshotReports,
  copyThreadContext,
} from './context'
import { attachmentsDir, projectSnapshotDir, threadDir } from './paths'
import { ConfirmationRequiredError } from './errors'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-context-'))
  createThread(dataDir, { title: 'A', body: 'body' })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rt-project-'))
}

describe('context items', () => {
  it('stores URL metadata without fetching content', () => {
    const item = addUrlContextItem(dataDir, 'thread-1', {
      url: 'https://example.com/spec',
      label: 'Spec',
    })

    expect(item.id).toBe('ctx001')
    expect(item.kind).toBe('url')
    expect(getThreadContext(dataDir, 'thread-1').items).toHaveLength(1)
  })

  it('copies attachments into the thread workspace', () => {
    const source = path.join(os.tmpdir(), `rt-attachment-${Date.now()}.txt`)
    fs.writeFileSync(source, 'hello')

    const item = addAttachmentFromFile(dataDir, 'thread-1', {
      tempPath: source,
      originalName: '../notes.txt',
      mediaType: 'text/plain',
      sizeBytes: 5,
    })

    expect(item.id).toBe('ctx001')
    expect(item.path).toBe('attachments/ctx001-notes.txt')
    expect(fs.readFileSync(path.join(attachmentsDir(dataDir, 'thread-1'), item.filename), 'utf8')).toBe(
      'hello',
    )
    fs.rmSync(source, { force: true })
  })
})

describe('project snapshots', () => {
  it('copies eligible folder files, including untracked files in git repos', () => {
    const project = makeProject()
    fs.mkdirSync(path.join(project, 'src'))
    fs.writeFileSync(path.join(project, 'src', 'main.ts'), 'export const x = 1\n')
    fs.writeFileSync(path.join(project, '.env'), 'SECRET=1\n')
    fs.writeFileSync(path.join(project, 'binary.dat'), Buffer.from([0, 1, 2]))
    fs.writeFileSync(path.join(project, 'untracked.ts'), 'const y = 2\n')
    execFileSync('git', ['init'], { cwd: project, stdio: 'ignore' })
    execFileSync('git', ['add', 'src/main.ts', '.env', 'binary.dat'], {
      cwd: project,
      stdio: 'ignore',
    })

    const preflight = preflightProjectSnapshot(dataDir, 'thread-1', project)
    expect(preflight.mode).toBe('folder')
    expect(preflight.file_count).toBe(2)

    const snapshot = createProjectSnapshot(dataDir, 'thread-1', {
      source_path: project,
      confirmed: true,
    })
    const snapshotDir = projectSnapshotDir(dataDir, 'thread-1')
    expect(snapshot.file_count).toBe(2)
    expect(fs.existsSync(path.join(snapshotDir, 'src', 'main.ts'))).toBe(true)
    expect(fs.existsSync(path.join(snapshotDir, '.env'))).toBe(false)
    expect(fs.existsSync(path.join(snapshotDir, 'binary.dat'))).toBe(false)
    expect(fs.existsSync(path.join(snapshotDir, 'untracked.ts'))).toBe(true)
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('requires confirmation for folder snapshots', () => {
    const project = makeProject()
    fs.writeFileSync(path.join(project, 'notes.md'), '# Notes\n')

    const preflight = preflightProjectSnapshot(dataDir, 'thread-1', project)
    expect(preflight.mode).toBe('folder')
    expect(preflight.requires_confirmation).toBe(true)
    expect(() =>
      createProjectSnapshot(dataDir, 'thread-1', { source_path: project }),
    ).toThrow(ConfirmationRequiredError)

    const snapshot = createProjectSnapshot(dataDir, 'thread-1', {
      source_path: project,
      confirmed: true,
    })
    expect(snapshot.file_count).toBe(1)
    expect(fs.existsSync(path.join(projectSnapshotDir(dataDir, 'thread-1'), 'notes.md'))).toBe(
      true,
    )
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('records files added on manual refresh', () => {
    const project = makeProject()
    fs.writeFileSync(path.join(project, 'a.md'), 'a')
    createProjectSnapshot(dataDir, 'thread-1', {
      source_path: project,
      confirmed: true,
    })
    fs.writeFileSync(path.join(project, 'b.md'), 'b')

    const snapshot = refreshProjectSnapshot(dataDir, 'thread-1')
    expect(snapshot.added_since_last_refresh).toEqual(['b.md'])
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('reports same-size modified and removed files by content hash', () => {
    const project = makeProject()
    fs.writeFileSync(path.join(project, 'a.md'), 'one')
    fs.writeFileSync(path.join(project, 'removed.md'), 'gone')
    createProjectSnapshot(dataDir, 'thread-1', {
      source_path: project,
      confirmed: true,
    })
    fs.writeFileSync(path.join(project, 'a.md'), 'two')
    fs.rmSync(path.join(project, 'removed.md'))

    refreshProjectSnapshot(dataDir, 'thread-1')
    const reports = listSnapshotReports(dataDir, 'thread-1')
    expect(reports).toHaveLength(2)
    expect(reports[1].modified_paths).toEqual(['a.md'])
    expect(reports[1].removed_paths).toEqual(['removed.md'])
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('creates a fresh baseline report when copied to the next thread', () => {
    const project = makeProject()
    fs.writeFileSync(path.join(project, 'a.md'), 'one')
    createProjectSnapshot(dataDir, 'thread-1', {
      source_path: project,
      confirmed: true,
    })
    createThread(dataDir, { title: 'Next', body: 'next' })

    copyThreadContext(dataDir, 'thread-1', 'thread-2')

    expect(listSnapshotReports(dataDir, 'thread-1')).toHaveLength(1)
    const copied = listSnapshotReports(dataDir, 'thread-2')
    expect(copied).toHaveLength(1)
    expect(copied[0].added_paths).toEqual(['a.md'])
    fs.rmSync(project, { recursive: true, force: true })
  })
})

describe('added file detection', () => {
  it('lists files manually placed in the thread workspace', () => {
    fs.writeFileSync(path.join(threadDir(dataDir, 'thread-1'), 'manual.md'), 'manual')

    const files = listWorkspaceAddedFiles(dataDir, 'thread-1')
    expect(files.map((file) => file.path)).toContain('manual.md')
  })
})
