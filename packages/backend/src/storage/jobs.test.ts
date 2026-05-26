import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BoundedJob } from '@roundtable/shared'
import { createThread } from './threads'
import { getJob, listJobs, nextJobId, writeJob } from './jobs'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-jobs-'))
  createThread(dataDir, { title: 'T', body: 'body' })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function job(id: string): BoundedJob {
  return {
    id,
    thread_id: 'thread-1',
    kind: 'agent_turn',
    status: 'running',
    agent: 'claude',
    started_at: '2026-05-23T00:00:00.000Z',
    timeout_at: '2026-05-23T00:10:00.000Z',
    completed_at: null,
    logs: [],
    result: null,
    failure_reason: null,
    turn: {
      id,
      thread_id: 'thread-1',
      agent: 'claude',
      kind: 'comment',
      scope: 'thread',
      discussion_id: null,
      instructions: null,
      proposal_id: null,
      revision_id: null,
      review_id: null,
      auto_revision_after_review: false,
      allow_direct_roots: true,
      pending_roots_only: false,
      auto_run_id: null,
      auto_turn_index: null,
      created_at: '2026-05-23T00:00:00.000Z',
      timeout_at: '2026-05-23T00:10:00.000Z',
    },
  }
}

describe('jobs storage', () => {
  it('generates durable job ids', () => {
    expect(nextJobId(dataDir, 'thread-1')).toBe('job-001')
    writeJob(dataDir, job('job-001'))
    expect(nextJobId(dataDir, 'thread-1')).toBe('job-002')
  })

  it('does not reuse deleted job ids', () => {
    const id = nextJobId(dataDir, 'thread-1')
    writeJob(dataDir, job(id))
    fs.rmSync(path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'jobs', 'job-001.json'))
    expect(nextJobId(dataDir, 'thread-1')).toBe('job-002')
  })

  it('writes, reads, and lists jobs in id order', () => {
    writeJob(dataDir, job('job-002'))
    writeJob(dataDir, job('job-001'))

    expect(getJob(dataDir, 'thread-1', 'job-001')?.id).toBe('job-001')
    expect(listJobs(dataDir, 'thread-1').map((item) => item.id)).toEqual([
      'job-001',
      'job-002',
    ])
  })
})
