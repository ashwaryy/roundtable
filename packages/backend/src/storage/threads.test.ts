import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createThread, listThreads, getThread } from './threads'
import {
  threadDir,
  threadJsonPath,
  threadMdPath,
  commentsPath,
  pendingDiscussionsPath,
  contextItemsPath,
  attachmentsDir,
  projectSnapshotDir,
} from './paths'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-threads-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('createThread', () => {
  it('writes canonical thread files and context directories', () => {
    const thread = createThread(dataDir, { title: 'TTS queue', body: '# Plan\nbody' })

    expect(thread.id).toBe('thread-1')
    expect(thread.title).toBe('TTS queue')
    expect(thread.status).toBe('open')
    expect(thread.parent_thread_id).toBeNull()
    expect(thread.archived_at).toBeNull()
    expect(typeof thread.created_at).toBe('string')

    const stored = JSON.parse(
      fs.readFileSync(threadJsonPath(dataDir, 'thread-1'), 'utf8'),
    )
    expect(stored.title).toBe('TTS queue')
    expect(fs.readFileSync(threadMdPath(dataDir, 'thread-1'), 'utf8')).toBe(
      '# Plan\nbody',
    )
    expect(fs.readFileSync(commentsPath(dataDir, 'thread-1'), 'utf8')).toBe('')
    expect(fs.readFileSync(pendingDiscussionsPath(dataDir, 'thread-1'), 'utf8')).toBe(
      '',
    )
    expect(fs.readFileSync(contextItemsPath(dataDir, 'thread-1'), 'utf8')).toBe('')
    expect(fs.existsSync(attachmentsDir(dataDir, 'thread-1'))).toBe(true)
    expect(fs.existsSync(projectSnapshotDir(dataDir, 'thread-1'))).toBe(true)
  })

  it('assigns incrementing ids', () => {
    const a = createThread(dataDir, { title: 'A', body: 'a' })
    const b = createThread(dataDir, { title: 'B', body: 'b' })
    expect(a.id).toBe('thread-1')
    expect(b.id).toBe('thread-2')
  })
})

describe('listThreads', () => {
  it('returns [] when no threads exist', () => {
    expect(listThreads(dataDir)).toEqual([])
  })

  it('returns threads newest-first', () => {
    createThread(dataDir, { title: 'A', body: 'a' })
    createThread(dataDir, { title: 'B', body: 'b' })
    const ids = listThreads(dataDir).map((t) => t.id)
    expect(ids).toEqual(['thread-2', 'thread-1'])
  })

  it('breaks created_at ties by numeric id, not lexicographically', () => {
    const sameTime = '2026-05-23T00:00:00.000Z'
    for (const n of [2, 10]) {
      const id = `thread-${n}`
      fs.mkdirSync(threadDir(dataDir, id), { recursive: true })
      fs.writeFileSync(
        threadJsonPath(dataDir, id),
        JSON.stringify({
          id,
          title: id,
          status: 'open',
          parent_thread_id: null,
          created_from_consolidation_id: null,
          created_at: sameTime,
          archived_at: null,
        }),
      )
      fs.writeFileSync(threadMdPath(dataDir, id), 'body')
      fs.writeFileSync(commentsPath(dataDir, id), '')
      fs.writeFileSync(pendingDiscussionsPath(dataDir, id), '')
    }
    const ids = listThreads(dataDir).map((t) => t.id)
    expect(ids).toEqual(['thread-10', 'thread-2'])
  })
})

describe('getThread', () => {
  it('returns null for a missing thread', () => {
    expect(getThread(dataDir, 'thread-999')).toBeNull()
  })

  it('returns the thread plus its markdown body', () => {
    createThread(dataDir, { title: 'A', body: '# Heading' })
    const detail = getThread(dataDir, 'thread-1')
    expect(detail?.title).toBe('A')
    expect(detail?.body).toBe('# Heading')
  })
})
