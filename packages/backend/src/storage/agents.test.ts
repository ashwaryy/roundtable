import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStorage } from './index'
import { createAgent, deleteAgent, getAgent, listAgents, updateAgent } from './agents'
import { agentsDir } from './paths'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-agents-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('agent catalogue and thread invites', () => {
  it('seeds built-ins and snapshots the default new-thread roster', () => {
    const storage = createStorage(dataDir)
    const thread = storage.createThread({ title: 'Roster', body: '# Roster' })
    expect(storage.listAgents().map((agent) => agent.id)).toEqual(['claude', 'codex'])
    expect(storage.listThreadAgents(thread.id).map((agent) => agent.agent_id)).toEqual(['claude', 'codex'])
  })

  it('auto-suffixes names and archives a used agent on delete', () => {
    const storage = createStorage(dataDir)
    const first = storage.createAgent({ name: 'Architect', runtime: 'codex' })
    const second = storage.createAgent({ name: 'Architect', runtime: 'codex' })
    expect(second.name).toBe('Architect (2)')
    const thread = storage.createThread({ title: 'T', body: 'B', agent_ids: [first.id] })
    expect(storage.listThreadAgents(thread.id)[0].name).toBe('Architect')
    expect(storage.deleteAgent(first.id)?.archived).toBe(true)
  })

  it('persists ordering and model overrides on an invite snapshot', () => {
    const storage = createStorage(dataDir)
    const extra = storage.createAgent({ name: 'Reviewer', runtime: 'claude' })
    const thread = storage.createThread({ title: 'T', body: 'B' })
    storage.inviteAgent(thread.id, { agent_id: extra.id })
    storage.updateThreadAgent(thread.id, extra.id, { model: 'custom-model' })
    const roster = storage.reorderThreadAgents(thread.id, { agent_ids: [extra.id, 'claude', 'codex'] })
    expect(roster[0]).toMatchObject({ agent_id: extra.id, order: 0, model: 'custom-model' })
  })

  it('reuses the cached agent index for repeated lookups and invalidates it on writes', () => {
    const dirPath = agentsDir(dataDir)
    const originalReaddirSync = fs.readdirSync
    let agentDirReads = 0
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(((file, options) => {
      if (file === dirPath) agentDirReads += 1
      return originalReaddirSync.call(fs, file, options)
    }))

    try {
      expect(listAgents(dataDir).map((agent) => agent.id)).toEqual(['claude', 'codex'])
      expect(agentDirReads).toBe(1)

      expect(getAgent(dataDir, 'claude')?.name).toBe('Claude')
      expect(getAgent(dataDir, 'codex')?.name).toBe('Codex')
      expect(agentDirReads).toBe(1)

      const created = createAgent(dataDir, { name: 'Indexer', runtime: 'codex' })
      expect(getAgent(dataDir, created.id)?.name).toBe('Indexer')
      expect(agentDirReads).toBe(2)

      updateAgent(dataDir, created.id, { name: 'Indexer Prime' })
      expect(getAgent(dataDir, created.id)?.name).toBe('Indexer Prime')
      expect(agentDirReads).toBe(3)

      expect(deleteAgent(dataDir, created.id)).toBeNull()
      expect(getAgent(dataDir, created.id)).toBeNull()
      expect(agentDirReads).toBe(4)
    } finally {
      readdirSpy.mockRestore()
    }
  })
})
