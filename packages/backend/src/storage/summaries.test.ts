import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStorage } from './index'
import {
  archiveThread,
  closeThread,
  getThreadSummary,
  setThreadSummaryDirty,
  updateThreadSummary,
} from './threads'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-summaries-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('thread summaries', () => {
  it('updates pending and active proposal counts on writes', () => {
    const storage = createStorage(dataDir)
    const thread = storage.createThread({ title: 'T', body: 'body' })

    storage.addPendingDiscussion(thread.id, { author: 'human', body: 'p1' })
    expect(getThreadSummary(dataDir, thread.id)?.pending_count).toBe(1)

    const proposal = storage.createProposal(thread.id, {})
    expect(getThreadSummary(dataDir, thread.id)?.active_proposal_count).toBe(1)

    storage.rejectPendingDiscussion(thread.id, 'pd001')
    expect(getThreadSummary(dataDir, thread.id)?.pending_count).toBe(0)

    storage.rejectProposal(thread.id, proposal.id)
    expect(getThreadSummary(dataDir, thread.id)?.active_proposal_count).toBe(0)
  })

  it('repairs dirty summary fields on storage startup', () => {
    const storage = createStorage(dataDir)
    const thread = storage.createThread({ title: 'T', body: 'body' })
    storage.addPendingDiscussion(thread.id, { author: 'human', body: 'p1' })

    setThreadSummaryDirty(dataDir, thread.id, 'pending_count')
    updateThreadSummary(dataDir, thread.id, { pending_count: 0 }, [])

    createStorage(dataDir)

    expect(getThreadSummary(dataDir, thread.id)).toEqual({
      pending_count: 1,
      active_proposal_count: 0,
      dirty: {},
    })
  })

  it('preserves dirty summary fields when archiving or closing a thread', () => {
    const storage = createStorage(dataDir)
    const first = storage.createThread({ title: 'T1', body: 'body' })
    const second = storage.createThread({ title: 'T2', body: 'body' })

    setThreadSummaryDirty(dataDir, first.id, 'pending_count')
    setThreadSummaryDirty(dataDir, second.id, 'active_proposal_count')

    archiveThread(dataDir, first.id)
    closeThread(dataDir, second.id)

    expect(getThreadSummary(dataDir, first.id)?.dirty).toEqual({ pending_count: true })
    expect(getThreadSummary(dataDir, second.id)?.dirty).toEqual({
      active_proposal_count: true,
    })
  })
})
