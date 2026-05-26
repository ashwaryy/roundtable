import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateAllMonotonicCounters } from './counters'
import { createThread } from './threads'
import { writeJob } from './jobs'
import type { BoundedJob } from '@roundtable/shared'
import { counterFilePath } from './paths'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-counters-'))
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

describe('counter validation', () => {
  it('repairs regressed counters before reservations', () => {
    createThread(dataDir, { title: 'T', body: 'body' })
    writeJob(dataDir, job('job-003'))
    fs.mkdirSync(path.dirname(counterFilePath(dataDir, 'thread:thread-1:jobs')), { recursive: true })
    fs.writeFileSync(
      counterFilePath(dataDir, 'thread:thread-1:jobs'),
      JSON.stringify({
        namespace: 'thread:thread-1:jobs',
        value: 1,
        updated_at: '2026-05-23T00:00:00.000Z',
      }),
    )

    const logger = vi.fn()
    validateAllMonotonicCounters(dataDir, logger)

    const state = JSON.parse(
      fs.readFileSync(counterFilePath(dataDir, 'thread:thread-1:jobs'), 'utf8'),
    ) as { value: number }
    expect(state.value).toBe(3)
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('namespace=thread:thread-1:jobs'),
    )
  })
})
