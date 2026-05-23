import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createThread } from '../storage/threads'
import { roomJsonPath, roundtableHelperPath } from '../storage/paths'
import { ConflictError } from '../storage/errors'
import { createRoomManager, type CommandExecutor } from './manager'

class FakeExecutor implements CommandExecutor {
  commands: Array<{ file: string; args: string[] }> = []
  missing = new Set<string>()
  sessions = new Set<string>()

  execFile(file: string, args: string[]): string {
    this.commands.push({ file, args })

    if (file === 'which') {
      const name = args[0]
      if (this.missing.has(name)) throw new Error(`${name} missing`)
      return `/usr/local/bin/${name}\n`
    }

    if (args.includes('--version')) return `${file} 1.0.0\n`
    if (file === 'tmux' && args[0] === '-V') return 'tmux 3.6\n'

    if (file === 'tmux' && args[0] === 'has-session') {
      const session = args[args.indexOf('-t') + 1]
      if (!this.sessions.has(session)) throw new Error('missing session')
      return ''
    }

    if (file === 'tmux' && args[0] === 'new-session') {
      const session = args[args.indexOf('-s') + 1]
      this.sessions.add(session)
      return ''
    }

    if (file === 'tmux' && args[0] === 'kill-session') {
      const session = args[args.indexOf('-t') + 1]
      this.sessions.delete(session)
      return ''
    }

    return ''
  }
}

let dataDir: string
let executor: FakeExecutor

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-room-'))
  executor = new FakeExecutor()
  createThread(dataDir, { title: 'Room', body: '# Room' })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function roomToken(): string {
  return JSON.parse(fs.readFileSync(roomJsonPath(dataDir, 'thread-1'), 'utf8')).token
}

describe('createRoomManager', () => {
  it('preflights tmux and agent CLIs', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })

    const preflight = manager.preflight()

    expect(preflight.ok).toBe(true)
    expect(preflight.tools.tmux.version).toBe('tmux 3.6')
    expect(preflight.tools.claude.path).toBe('/usr/local/bin/claude')
  })

  it('rejects start when a required tool is missing', () => {
    executor.missing.add('codex')
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })

    expect(() => manager.startRoom('thread-1', {})).toThrow(ConflictError)
  })

  it('starts a tmux room and writes helper state', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })

    const room = manager.startRoom('thread-1', {
      claude_model: 'sonnet',
      codex_model: 'gpt-5',
    })

    expect(room.status).toBe('starting')
    expect(room.claude_model).toBe('sonnet')
    expect(room.codex_model).toBe('gpt-5')
    expect(room.attach_command).toBe('tmux attach -t roundtable-thread-1')
    expect(fs.existsSync(roundtableHelperPath(dataDir, 'thread-1'))).toBe(true)
    expect(executor.sessions.has('roundtable-thread-1')).toBe(true)
    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: [
        'split-window',
        '-h',
        '-t',
        'roundtable-thread-1:0',
        '-c',
        path.join(dataDir, 'threads', 'thread-1'),
      ],
    })
  })

  it('marks readiness idempotently and transitions to idle', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()

    const afterClaude = manager.markReady('thread-1', 'claude', token)
    const afterClaudeAgain = manager.markReady('thread-1', 'claude', token)
    const afterCodex = manager.markReady('thread-1', 'codex', token)

    expect(afterClaude.status).toBe('starting')
    expect(afterClaudeAgain.agents.claude.ready_at).toBe(afterClaude.agents.claude.ready_at)
    expect(afterCodex.status).toBe('idle')
  })

  it('rejects readiness with an invalid token', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})

    expect(() => manager.markReady('thread-1', 'claude', 'bad-token')).toThrow(
      'invalid room token',
    )
  })

  it('nudges only when idle and sends to the selected pane', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()
    manager.markReady('thread-1', 'claude', token)
    manager.markReady('thread-1', 'codex', token)

    manager.nudgeRoom('thread-1', { agent: 'codex', body: 'Please inspect this.' })

    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: [
        'send-keys',
        '-t',
        'roundtable-thread-1:0.1',
        'Please inspect this.',
        'C-m',
      ],
    })
  })

  it('stops rooms idempotently', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})

    const stopped = manager.stopRoom('thread-1')
    const stoppedAgain = manager.stopRoom('thread-1')

    expect(stopped.status).toBe('stopped')
    expect(stoppedAgain.status).toBe('stopped')
    expect(executor.sessions.has('roundtable-thread-1')).toBe(false)
  })
})
