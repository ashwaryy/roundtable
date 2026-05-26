import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStorage } from './index'
import { attachmentsDir, commentsPath, counterFilePath, integrityPath, jobsDir, threadMdPath } from './paths'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-integrity-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('canonical integrity', () => {
  it('bootstraps without warnings and accepts backend-owned writes', () => {
    const storage = createStorage(dataDir)
    const thread = storage.createThread({ title: 'A', body: 'body' })
    expect(storage.getIntegrity(thread.id).issues).toEqual([])

    storage.addComment(thread.id, { body: 'approved update' })
    expect(storage.getIntegrity(thread.id).issues).toEqual([])
  })

  it('skips integrity state writes on unchanged hot reads', () => {
    const storage = createStorage(dataDir)
    const thread = storage.createThread({ title: 'A', body: 'body' })
    const statePath = integrityPath(dataDir, thread.id)
    const before = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(before) as {
      baseline: Record<string, { hash: string; mtime_ms: number; size_bytes: number }>
    }

    expect(parsed.baseline['thread.md']).toEqual({
      hash: expect.any(String),
      mtime_ms: expect.any(Number),
      size_bytes: 4,
    })

    expect(storage.getThread(thread.id)?.title).toBe('A')
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before)
  })

  it('reports external changes, deletion, canonical additions, and acknowledgement', () => {
    const onUpdate = vi.fn()
    const storage = createStorage(dataDir, onUpdate)
    storage.createThread({ title: 'A', body: 'body' })
    storage.getIntegrity('thread-1')

    fs.writeFileSync(threadMdPath(dataDir, 'thread-1'), 'changed')
    fs.writeFileSync(path.join(attachmentsDir(dataDir, 'thread-1'), 'manual.txt'), 'new')
    fs.unlinkSync(commentsPath(dataDir, 'thread-1'))

    const report = storage.getIntegrity('thread-1')
    expect(report.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(['modified', 'added', 'deleted']),
    )
    expect(onUpdate).toHaveBeenCalledWith({
      type: 'integrity_updated',
      thread_id: 'thread-1',
    })

    const accepted = storage.acknowledgeIntegrity('thread-1')
    expect(accepted.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'invalid', path: 'comments.jsonl' })]),
    )
  })

  it('forces counter repair during acknowledgement even when startup heuristic would skip', () => {
    const storage = createStorage(dataDir)
    storage.createThread({ title: 'A', body: 'body' })
    fs.mkdirSync(jobsDir(dataDir, 'thread-1'), { recursive: true })
    fs.writeFileSync(path.join(jobsDir(dataDir, 'thread-1'), 'job-003.json'), '{}')

    const namespace = 'thread:thread-1:jobs'
    fs.mkdirSync(path.dirname(counterFilePath(dataDir, namespace)), { recursive: true })
    fs.writeFileSync(
      counterFilePath(dataDir, namespace),
      JSON.stringify({
        namespace,
        value: 1,
        updated_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    )

    storage.acknowledgeIntegrity('thread-1')

    const counter = JSON.parse(fs.readFileSync(counterFilePath(dataDir, namespace), 'utf8')) as { value: number }
    expect(counter.value).toBe(3)
  })

  it('surfaces malformed canonical JSONL without throwing from the report', () => {
    const storage = createStorage(dataDir)
    storage.createThread({ title: 'A', body: 'body' })
    fs.writeFileSync(commentsPath(dataDir, 'thread-1'), '{not-json}\n')

    const report = storage.getIntegrity('thread-1')
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'invalid', path: 'comments.jsonl' }),
      ]),
    )
  })
})
