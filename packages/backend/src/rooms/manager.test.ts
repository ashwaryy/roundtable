import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { archiveThread, closeThread, createThread } from '../storage/threads'
import {
  preToolUseHookPath,
  claudeLocalSettingsPath,
  codexProjectConfigPath,
  codexRulesPath,
  currentTurnPath,
  roomJsonPath,
  roundtableHelperPath,
} from '../storage/paths'
import { BadRequestError, ConflictError } from '../storage/errors'
import { getJob } from '../storage/jobs'
import { addComment, listComments } from '../storage/comments'
import { createAgent, initializeThreadAgents, inviteAgent, removeThreadAgent } from '../storage/agents'
import { listPendingDiscussions } from '../storage/pendingDiscussions'
import { createRoomManager, type CommandExecutor } from './manager'

class FakeExecutor implements CommandExecutor {
  commands: Array<{ file: string; args: string[] }> = []
  missing = new Set<string>()
  sessions = new Set<string>()
  paneCaptures = new Map<string, string>()

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

    if (file === 'tmux' && args[0] === 'capture-pane') {
      const target = args[args.indexOf('-t') + 1]
      return this.paneCaptures.get(target) ?? ''
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

function startReadyRoom() {
  const manager = createRoomManager({
    dataDir,
    backendUrl: 'http://localhost:4319',
    executor,
  })
  manager.startRoom('thread-1', {})
  const token = roomToken()
  manager.markReady('thread-1', 'claude', token)
  manager.markReady('thread-1', 'codex', token)
  return { manager, token }
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

  it('rejects starting rooms for archived and closed threads', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })

    archiveThread(dataDir, 'thread-1')
    expect(() => manager.startRoom('thread-1', {})).toThrow(BadRequestError)
    expect(executor.sessions.has('roundtable-thread-1')).toBe(false)

    createThread(dataDir, { title: 'Closed', body: '# Closed' })
    closeThread(dataDir, 'thread-2')
    expect(() => manager.startRoom('thread-2', {})).toThrow(BadRequestError)
    expect(executor.sessions.has('roundtable-thread-2')).toBe(false)
  })

  it('rejects room mutations after a thread is archived', () => {
    const { manager, token } = startReadyRoom()
    archiveThread(dataDir, 'thread-1')

    expect(() => manager.nudgeRoom('thread-1', { agent: 'claude' })).toThrow(BadRequestError)
    expect(() => manager.askAgent('thread-1', { agent: 'claude' })).toThrow(BadRequestError)
    expect(() => manager.startAutoDiscussion('thread-1', { turn_count: 1 })).toThrow(BadRequestError)
    expect(() => manager.markReady('thread-1', 'claude', token)).toThrow(BadRequestError)
  })

  it('writes per-thread agent permission setup without requiring rtk', () => {
    executor.missing.add('rtk')
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptTimeoutMs: 0,
    })

    manager.startRoom('thread-1', {})

    const claudeSettings = JSON.parse(
      fs.readFileSync(claudeLocalSettingsPath(dataDir, 'thread-1'), 'utf8'),
    )
    expect(claudeSettings.permissions.defaultMode).toBe('dontAsk')
    expect(claudeSettings.permissions.allow).toEqual(
      expect.arrayContaining([
        'Read',
        'Edit(.roundtable/tmp/**)',
        'Edit(./.roundtable/tmp/**)',
        'Write(.roundtable/tmp/**)',
        'Write(./.roundtable/tmp/**)',
        'Bash(roundtable ready *)',
        'Bash(roundtable comment *)',
        'Bash(cat *)',
        'Bash(grep *)',
        'Bash(read *)',
        'Bash(head *)',
        'Bash(tail *)',
        'Bash(npm run test *)',
      ]),
    )
    expect(claudeSettings.permissions.allow).not.toContain('Bash(rtk cat *)')
    expect(claudeSettings.permissions.deny).toEqual(
      expect.arrayContaining([
        'Read(./.roundtable/room.json)',
        'Edit(.roundtable/current-turn.json)',
        'Write(.roundtable/current-turn.json)',
        'Bash(rm *)',
        'Bash(git push *)',
        'Bash(npm install *)',
      ]),
    )
    expect(claudeSettings.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: preToolUseHookPath(dataDir, 'thread-1'),
            args: [],
            timeout: 5,
          },
        ],
      },
    ])
    const noRtkHookPath = preToolUseHookPath(dataDir, 'thread-1')
    const noRtkHookDecision = (command: string) =>
      execFileSync(noRtkHookPath, [], {
        encoding: 'utf8',
        input: JSON.stringify({ tool_input: { command } }),
      })
    expect(noRtkHookDecision('grep c014 comments.jsonl')).toBe('')
    expect(
      JSON.parse(noRtkHookDecision('rtk grep c014 comments.jsonl')).hookSpecificOutput
        .permissionDecision,
    ).toBe('deny')

    const codexStartup = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'codex-startup.md'),
      'utf8',
    )
    expect(codexStartup).toContain(
      'except draft files under `.roundtable/tmp/` permitted by a Roundtable turn',
    )
    expect(codexStartup).toContain(
      'Attachments are optional; if present, they live under `attachments/`',
    )
    expect(codexStartup).toContain(
      'Project snapshots are optional; if present, snapshot files live under `project-snapshot/`',
    )
    expect(codexStartup).toContain('project-snapshot-manifest.json')
    expect(codexStartup).toContain(
      'Do not invoke any agent skill, slash-command skill, or skill tool under any circumstances',
    )
    expect(codexStartup).toContain(
      'Keep comments short and forum-like. Make one clear point',
    )
    expect(codexStartup).toContain('write durable output only under `.roundtable/tmp/`')
    expect(codexStartup).toContain(
      'write each pending body to its own `.roundtable/tmp/...` file',
    )
    expect(codexStartup).toContain(
      'Run the readiness command on every launch or resumed CLI process',
    )
    expect(codexStartup).toContain(
      'A prior launch acknowledgment does not apply to this room process.',
    )
    expect(codexStartup).toContain(
      'The user may not have this pane attached and may not see terminal narration or interactive prompts.',
    )
    expect(codexStartup).toContain(
      'Use only file operations and commands already permitted for this Roundtable room and the current turn.',
    )
    expect(codexStartup).toContain(
      'Use the built-in Read and Grep tools to inspect room artifacts.',
    )
    expect(codexStartup).toContain(
      'Do not wait at an interactive approval prompt for routine turn work.',
    )
    expect(codexStartup).not.toContain('exact draft path named')

    const codexConfig = fs.readFileSync(
      codexProjectConfigPath(dataDir, 'thread-1'),
      'utf8',
    )
    expect(codexConfig).toContain('sandbox_mode = "workspace-write"')
    expect(codexConfig).toContain('approval_policy = "never"')
    expect(codexConfig).toContain('[sandbox_workspace_write]')
    expect(codexConfig).toContain('network_access = true')
    expect(codexConfig).toContain('[features.network_proxy]')
    expect(codexConfig).toContain('"localhost" = "allow"')
    expect(codexConfig).toContain('"127.0.0.1" = "allow"')
    expect(codexConfig).toContain('[hooks]')
    expect(codexConfig).toContain('PreToolUse = [{ matcher = "Bash"')
    expect(codexConfig).toContain(preToolUseHookPath(dataDir, 'thread-1'))

    const launchCodex = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-codex.sh'),
      'utf8',
    )
    const launchClaude = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-claude.sh'),
      'utf8',
    )
    expect(launchClaude).toContain('exec claude --permission-mode dontAsk')
    expect(launchCodex).toContain('exec codex --sandbox workspace-write')
    expect(launchCodex).toContain('--ask-for-approval never')
    expect(launchCodex).toContain('--dangerously-bypass-hook-trust')
    expect(launchCodex).toContain('sandbox_workspace_write.network_access=true')
    expect(launchCodex).toContain('features.network_proxy.domains=')

    const codexRules = fs.readFileSync(codexRulesPath(dataDir, 'thread-1'), 'utf8')
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["roundtable", "ready"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["roundtable", "comment"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["cat"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["read"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["tail"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["rm"], decision = "forbidden"',
    )
    expect(codexRules).not.toContain('["rtk",')
  })

  it('adds rtk wrapper permissions only when rtk is installed', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptTimeoutMs: 0,
    })

    manager.startRoom('thread-1', {})

    const claudeSettings = JSON.parse(
      fs.readFileSync(claudeLocalSettingsPath(dataDir, 'thread-1'), 'utf8'),
    )
    expect(claudeSettings.permissions.allow).toEqual(
      expect.arrayContaining([
        'Bash(rtk roundtable ready *)',
        'Bash(rtk roundtable comment *)',
        'Bash(rtk cat *)',
        'Bash(rtk grep *)',
        'Bash(rtk read *)',
      ]),
    )
    const hookPath = preToolUseHookPath(dataDir, 'thread-1')
    const hookOutput = (command: string) =>
      execFileSync(hookPath, [], {
          encoding: 'utf8',
          input: JSON.stringify({ tool_input: { command } }),
        })
    expect(hookOutput('rtk grep c014 comments.jsonl')).toBe('')
    expect(
      JSON.parse(hookOutput('rtk grep c014 comments.jsonl | python3 -c "print(1)"'))
        .hookSpecificOutput,
    ).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('do not pipe through Python'),
    })
    expect(JSON.parse(hookOutput('python3 -c "print(1)"')).hookSpecificOutput.permissionDecision).toBe(
      'deny',
    )

    const codexRules = fs.readFileSync(codexRulesPath(dataDir, 'thread-1'), 'utf8')
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["rtk", "roundtable", "ready"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["rtk", "cat"], decision = "allow"',
    )
    expect(codexRules).toContain(
      'prefix_rule(pattern = ["rtk", "read"], decision = "allow"',
    )
  })

  it('starts a tmux room, writes helper state, and schedules trust prompt acceptance', async () => {
    executor.paneCaptures.set(
      'roundtable-thread-1:agent-claude',
      'Quick safety check\n> 1. Yes, I trust this folder',
    )
    executor.paneCaptures.set(
      'roundtable-thread-1:agent-codex',
      'Do you trust the contents of this directory?\n> 1. Yes, continue',
    )
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptPollIntervalMs: 1,
      startupTrustPromptTimeoutMs: 50,
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
    expect(
      fs.readFileSync(roundtableHelperPath(dataDir, 'thread-1'), 'utf8'),
    ).toContain('roundtable comment --body-file')
    expect(
      fs.readFileSync(roundtableHelperPath(dataDir, 'thread-1'), 'utf8'),
    ).toContain("continue_turn: args.includes('--continue-turn')")
    expect(executor.sessions.has('roundtable-thread-1')).toBe(true)
    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: [
        'new-window',
        '-d',
        '-t',
        'roundtable-thread-1',
        '-n',
        'agent-codex',
        '-c',
        path.join(dataDir, 'threads', 'thread-1'),
      ],
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['send-keys', '-t', 'roundtable-thread-1:agent-claude', 'C-m'],
    })
    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['send-keys', '-t', 'roundtable-thread-1:agent-codex', 'C-m'],
    })
  })

  it('launches one named tmux window for each invited persona', () => {
    const reviewer = createAgent(dataDir, { name: 'Reviewer', runtime: 'codex', color: 'teal' })
    initializeThreadAgents(dataDir, 'thread-1', ['claude', reviewer.id])
    const manager = createRoomManager({ dataDir, backendUrl: 'http://localhost:4319', executor })

    const room = manager.startRoom('thread-1', {})

    expect(room.roster.map((agent) => agent.agent_id)).toEqual(['claude', reviewer.id])
    expect(executor.commands).toContainEqual(expect.objectContaining({
      file: 'tmux',
      args: expect.arrayContaining(['new-window', 'agent-agent-reviewer']),
    }))
  })

  it('adds and removes persona windows while an idle room is live', () => {
    const { manager, token } = startReadyRoom()
    const reviewer = createAgent(dataDir, { name: 'Reviewer', runtime: 'codex', color: 'teal' })
    inviteAgent(dataDir, 'thread-1', { agent_id: reviewer.id })

    const adding = manager.syncRoster('thread-1')
    expect(adding.status).toBe('starting')
    expect(adding.agents[reviewer.id].ready_at).toBeNull()
    expect(executor.commands).toContainEqual(expect.objectContaining({
      file: 'tmux',
      args: expect.arrayContaining(['new-window', 'agent-agent-reviewer']),
    }))
    expect(manager.markReady('thread-1', reviewer.id, token).status).toBe('idle')

    removeThreadAgent(dataDir, 'thread-1', reviewer.id)
    const removing = manager.syncRoster('thread-1')
    expect(removing.roster.map((agent) => agent.agent_id)).toEqual(['claude', 'codex'])
    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['kill-window', '-t', 'roundtable-thread-1:agent-agent-reviewer'],
    })
  })

  it('does not send startup Enter when a pane is past the trust prompt', async () => {
    executor.paneCaptures.set('roundtable-thread-1:agent-claude', 'Claude Code ready')
    executor.paneCaptures.set('roundtable-thread-1:agent-codex', 'Codex ready')
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptPollIntervalMs: 1,
      startupTrustPromptTimeoutMs: 5,
    })

    manager.startRoom('thread-1', {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    const startupEnterCommands = executor.commands.filter(
      (command) =>
        command.file === 'tmux' &&
        command.args[0] === 'send-keys' &&
        command.args.length === 4 &&
        command.args[3] === 'C-m',
    )
    expect(startupEnterCommands).toEqual([])
  })

  it('trusts generated Codex hooks when their review prompt appears at startup', async () => {
    executor.paneCaptures.set('roundtable-thread-1:agent-claude', 'Claude Code ready')
    executor.paneCaptures.set(
      'roundtable-thread-1:agent-codex',
      'Hooks need review\n1 hook is new or changed.\n> 1. Review hooks\n2. Trust all and continue\n3. Continue without trusting (hooks won\'t run)',
    )
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptPollIntervalMs: 1,
      startupTrustPromptTimeoutMs: 50,
    })

    manager.startRoom('thread-1', {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['send-keys', '-t', 'roundtable-thread-1:agent-codex', 'Down', 'C-m'],
    })
  })

  it('accepts startup trust prompts that appear after agent startup is slow', async () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptPollIntervalMs: 1,
      startupTrustPromptTimeoutMs: 50,
    })

    manager.startRoom('thread-1', {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(
      executor.commands.some(
        (command) =>
          command.file === 'tmux' &&
          command.args[0] === 'send-keys' &&
          command.args[3] === 'C-m',
      ),
    ).toBe(false)

    executor.paneCaptures.set(
      'roundtable-thread-1:agent-claude',
      'Quick safety check\n> 1. Yes, I trust this folder',
    )
    executor.paneCaptures.set(
      'roundtable-thread-1:agent-codex',
      'Do you trust the contents of this directory?\n> 1. Yes, continue',
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['send-keys', '-t', 'roundtable-thread-1:agent-claude', 'C-m'],
    })
    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['send-keys', '-t', 'roundtable-thread-1:agent-codex', 'C-m'],
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

  it('restarts fresh after a failed start attempt that never became ready', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptTimeoutMs: 0,
    })

    manager.startRoom('thread-1', {})
    manager.stopRoom('thread-1')
    executor.commands = []

    manager.startRoom('thread-1', {})

    const launchClaude = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-claude.sh'),
      'utf8',
    )
    const launchCodex = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-codex.sh'),
      'utf8',
    )
    expect(launchClaude).toContain('exec claude --permission-mode dontAsk ')
    expect(launchClaude).not.toContain('claude --continue')
    expect(launchCodex).toContain('exec codex ')
    expect(launchCodex).not.toContain('codex resume --last')
  })

  it('uses resume only for agents that previously became ready', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptTimeoutMs: 0,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()
    manager.markReady('thread-1', 'claude', token)
    manager.stopRoom('thread-1')

    manager.startRoom('thread-1', {})

    const launchClaude = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-claude.sh'),
      'utf8',
    )
    const launchCodex = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-codex.sh'),
      'utf8',
    )
    expect(launchClaude).toContain('claude --continue --permission-mode dontAsk')
    expect(launchCodex).toContain('exec codex ')
    expect(launchCodex).not.toContain('codex resume --last')
  })

  it('resumes codex without passing startup text as a session id', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
      startupTrustPromptTimeoutMs: 0,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()
    manager.markReady('thread-1', 'claude', token)
    manager.markReady('thread-1', 'codex', token)
    manager.stopRoom('thread-1')

    const restarted = manager.startRoom('thread-1', {})

    const launchCodex = fs.readFileSync(
      path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'launch-codex.sh'),
      'utf8',
    )
    expect(launchCodex).toContain('codex resume --last')
    expect(launchCodex).not.toContain('Read ')
    expect(launchCodex).not.toContain('codex-startup.md')
    expect(restarted.agents.codex.ready_at).not.toBeNull()
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
        'roundtable-thread-1:agent-codex',
        'Please inspect this.',
        'C-m',
      ],
    })
  })

  it('detects a pane input prompt and sends a yes response', () => {
    const { manager } = startReadyRoom()
    executor.paneCaptures.set(
      'roundtable-thread-1:agent-codex',
      [
        'This command requires approval',
        'Do you want to proceed?',
        '1. Yes',
        '2. Yes, and do not ask again',
        '3. No',
      ].join('\n'),
    )

    const detected = manager.getRoom('thread-1')
    expect(detected.input_prompt).toMatchObject({
      agent: 'codex',
    })
    expect(detected.input_prompt?.excerpt).toContain('Do you want to proceed?')

    const updated = manager.sendInputResponse('thread-1', {
      agent: 'codex',
      response: 'yes',
    })

    expect(updated.input_prompt).toBeNull()
    expect(executor.commands).toContainEqual({
      file: 'tmux',
      args: ['send-keys', '-t', 'roundtable-thread-1:agent-codex', '1', 'Enter'],
    })
  })

  it('starts an ask turn, writes current-turn context, and sends a single-line prompt file instruction', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()
    manager.markReady('thread-1', 'claude', token)
    manager.markReady('thread-1', 'codex', token)

    const result = manager.askAgent('thread-1', {
      agent: 'codex',
      body: 'Please review the thread.',
    })

    expect(result.room.status).toBe('running')
    expect(result.room.active_job_id).toBe('job-001')
    expect(result.job.turn.scope).toBe('thread')
    expect(JSON.parse(fs.readFileSync(currentTurnPath(dataDir, 'thread-1'), 'utf8'))).toMatchObject({
      id: 'job-001',
      agent: 'codex',
    })
    const turnPromptPath = path.join(
      dataDir,
      'threads',
      'thread-1',
      '.roundtable',
      'tmp',
      'job-001-codex-turn.md',
    )
    const turnPrompt = fs.readFileSync(turnPromptPath, 'utf8')
    expect(turnPrompt).toContain('Roundtable Ask turn job-001')
    expect(turnPrompt).toContain(
      'Write your final comment body to `.roundtable/tmp/job-001-codex-comment.md`.',
    )
    expect(turnPrompt).not.toContain('interactive prompts')
    expect(turnPrompt).toContain('Use only permitted room operations.')
    expect(turnPrompt).not.toContain('Do not invoke any agent skill')
    expect(turnPrompt).toContain('Keep your comment short and forum-like')
    expect(turnPrompt).toContain(
      'roundtable comment --body-file .roundtable/tmp/job-001-codex-comment.md --type comment',
    )
    expect(turnPrompt).not.toContain('.roundtable/tmp/comment.md')

    const promptTextCommandIndex = executor.commands.findIndex(
      (command) =>
        command.file === 'tmux' &&
        command.args[0] === 'send-keys' &&
        command.args[2] === 'roundtable-thread-1:agent-codex' &&
        command.args[3] === '-l' &&
        command.args[4].includes('job-001-codex-turn.md'),
    )
    expect(executor.commands.slice(promptTextCommandIndex - 1, promptTextCommandIndex + 2)).toEqual([
      {
        file: 'tmux',
        args: ['send-keys', '-t', 'roundtable-thread-1:agent-codex', 'C-u'],
      },
      {
        file: 'tmux',
        args: [
          'send-keys',
          '-t',
          'roundtable-thread-1:agent-codex',
          '-l',
          'Read .roundtable/tmp/job-001-codex-turn.md and follow it.',
        ],
      },
      {
        file: 'tmux',
        args: ['send-keys', '-t', 'roundtable-thread-1:agent-codex', 'Enter'],
      },
    ])
    expect(executor.commands[promptTextCommandIndex].args[4]).not.toContain('\n')
    expect(executor.commands[promptTextCommandIndex].args[4]).not.toContain(
      '.roundtable/tmp/comment.md',
    )
  })

  it('completes an ask turn after helper comment submission', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()
    manager.markReady('thread-1', 'claude', token)
    manager.markReady('thread-1', 'codex', token)
    manager.askAgent('thread-1', { agent: 'claude' })

    const result = manager.submitComment(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'claude',
        body: 'agent comment',
        type: 'critique',
      },
      token,
    )

    expect(result.room.status).toBe('idle')
    expect(result.room.active_job_id).toBeNull()
    expect(result.comment.author).toBe('claude')
    expect(result.comment.type).toBe('critique')
    expect(getJob(dataDir, 'thread-1', 'job-001')?.status).toBe('completed')
    expect(listComments(dataDir, 'thread-1')).toHaveLength(1)
    expect(fs.existsSync(currentTurnPath(dataDir, 'thread-1'))).toBe(false)
  })

  it('does not repeat startup execution rules in Claude turn prompts', () => {
    const { manager } = startReadyRoom()

    manager.askAgent('thread-1', { agent: 'claude' })

    const turnPrompt = fs.readFileSync(
      path.join(
        dataDir,
        'threads',
        'thread-1',
        '.roundtable',
        'tmp',
        'job-001-claude-turn.md',
      ),
      'utf8',
    )
    expect(turnPrompt).toContain('Do not edit canonical Roundtable files or project files.')
    expect(turnPrompt).not.toContain('interactive prompts')
    expect(turnPrompt).not.toContain('Use only file operations and commands already permitted')
    expect(turnPrompt).not.toContain('Use the built-in Read and Grep tools')
  })

  it('allows a discussion-level ask to queue multiple pending splits before its final reply', () => {
    const { manager, token } = startReadyRoom()
    const root = addComment(dataDir, 'thread-1', { body: 'Original discussion' })

    manager.askAgent('thread-1', {
      agent: 'codex',
      discussion_id: root.id,
    })

    const turnPromptPath = path.join(
      dataDir,
      'threads',
      'thread-1',
      '.roundtable',
      'tmp',
      'job-001-codex-turn.md',
    )
    const turnPrompt = fs.readFileSync(turnPromptPath, 'utf8')
    expect(turnPrompt).toContain('Discussion-level Ask policy:')
    expect(turnPrompt).toContain(
      'Write only the Markdown draft files under `.roundtable/tmp/` required for the submissions below.',
    )
    expect(turnPrompt).toContain(
      'Queue zero or more pending splits, then use exactly one terminal helper submission below.',
    )
    expect(turnPrompt).toContain(
      'roundtable pending-discussion --body-file .roundtable/tmp/job-001-codex-pending-discussion.md --type comment --origin-discussion-id c001 --continue-turn',
    )
    expect(turnPrompt).toContain(
      'write each body to a distinct Markdown file under `.roundtable/tmp/`',
    )
    expect(turnPrompt).toContain(
      'Do not use `cp`, `mv`, shell redirection, or chained shell commands',
    )

    const firstPending = manager.submitPendingDiscussion(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'codex',
        body: 'First separate discussion.',
        type: 'question',
        continue_turn: true,
      },
      token,
    )

    expect(firstPending.room.status).toBe('running')
    expect(firstPending.room.active_job_id).toBe('job-001')
    expect(firstPending.job.status).toBe('running')
    expect(firstPending.job.result).toBeNull()
    expect(firstPending.pending_discussion).toMatchObject({
      body: 'First separate discussion.',
      type: 'question',
      origin_discussion_id: root.id,
    })
    expect(fs.existsSync(currentTurnPath(dataDir, 'thread-1'))).toBe(true)

    manager.submitPendingDiscussion(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'codex',
        body: 'Second separate discussion.',
        continue_turn: true,
      },
      token,
    )
    const result = manager.submitComment(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'codex',
        body: 'I separated two follow-up questions for review.',
      },
      token,
    )

    expect(result.room.status).toBe('idle')
    expect(result.comment.parent_id).toBe(root.id)
    expect(listPendingDiscussions(dataDir, 'thread-1')).toHaveLength(2)
    expect(fs.existsSync(currentTurnPath(dataDir, 'thread-1'))).toBe(false)
  })

  it('does not allow a thread-level ask to submit a pending discussion', () => {
    const { manager, token } = startReadyRoom()
    manager.askAgent('thread-1', { agent: 'codex' })

    expect(() =>
      manager.submitPendingDiscussion(
        'thread-1',
        {
          turn_id: 'job-001',
          agent: 'codex',
          body: 'Unexpected pending root.',
        },
        token,
      ),
    ).toThrow('pending discussion submission requires an auto or discussion-level Ask turn')
  })

  it('starts auto discussion with Claude and writes pending-only turn context', () => {
    const { manager } = startReadyRoom()

    const result = manager.startAutoDiscussion('thread-1', {
      turn_count: 2,
      allow_direct_roots: false,
    })

    expect(result.room.status).toBe('running')
    expect(result.room.auto).toMatchObject({
      status: 'running',
      total_turns: 2,
      completed_turns: 0,
      remaining_turns: 2,
      next_agent: 'claude',
      allow_direct_roots: false,
    })
    expect(result.job.agent).toBe('claude')
    expect(result.job.turn.auto_turn_index).toBe(1)
    expect(result.job.turn.pending_roots_only).toBe(true)
    expect(JSON.parse(fs.readFileSync(currentTurnPath(dataDir, 'thread-1'), 'utf8'))).toMatchObject({
      auto_run_id: result.room.auto?.run_id,
      pending_roots_only: true,
    })
  })

  it('queues multiple auto pending discussions in one turn and schedules the next agent on the terminal submission', () => {
    const { manager, token } = startReadyRoom()
    manager.startAutoDiscussion('thread-1', {
      turn_count: 2,
      allow_direct_roots: false,
    })

    const queued = manager.submitPendingDiscussion(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'claude',
        body: 'This needs the first new root.',
        type: 'critique',
        continue_turn: true,
      },
      token,
    )

    expect(queued.pending_discussion.id).toBe('pd001')
    expect(queued.job.status).toBe('running')
    expect(queued.room.active_job_id).toBe('job-001')
    expect(queued.room.auto).toMatchObject({
      completed_turns: 0,
      remaining_turns: 2,
      next_agent: 'claude',
    })

    const result = manager.submitPendingDiscussion(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'claude',
        body: 'This needs the final new root.',
        type: 'critique',
      },
      token,
    )

    expect(result.pending_discussion.id).toBe('pd002')
    expect(result.job.result).toEqual({ pending_discussion_id: 'pd002' })
    expect(result.room.status).toBe('running')
    expect(result.room.active_job_id).toBe('job-002')
    expect(result.room.auto).toMatchObject({
      completed_turns: 1,
      remaining_turns: 1,
      next_agent: 'codex',
    })
    expect(getJob(dataDir, 'thread-1', 'job-002')?.agent).toBe('codex')
    expect(listPendingDiscussions(dataDir, 'thread-1')).toHaveLength(2)
  })

  it('blocks direct roots during auto mode unless bypass is enabled', () => {
    const { manager, token } = startReadyRoom()
    manager.startAutoDiscussion('thread-1', {
      turn_count: 1,
      allow_direct_roots: false,
    })

    expect(() =>
      manager.submitComment(
        'thread-1',
        {
          turn_id: 'job-001',
          agent: 'claude',
          body: 'direct root',
        },
        token,
      ),
    ).toThrow('auto discussion requires new roots')
  })

  it('allows direct roots for an auto run bypass and stops at the turn limit', () => {
    const { manager, token } = startReadyRoom()
    manager.startAutoDiscussion('thread-1', {
      turn_count: 1,
      allow_direct_roots: true,
    })

    const result = manager.submitComment(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'claude',
        body: 'direct root',
      },
      token,
    )

    expect(result.room.status).toBe('turn_limit_reached')
    expect(result.room.auto).toMatchObject({
      status: 'turn_limit_reached',
      completed_turns: 1,
      remaining_turns: 0,
    })
    expect(listComments(dataDir, 'thread-1')[0]).toMatchObject({
      parent_id: null,
      body: 'direct root',
    })
  })

  it('pauses auto discussion after the active turn finishes and can extend it', () => {
    const { manager, token } = startReadyRoom()
    manager.startAutoDiscussion('thread-1', {
      turn_count: 2,
      allow_direct_roots: false,
    })

    const pausing = manager.pauseAutoDiscussion('thread-1')
    expect(pausing.status).toBe('running')
    expect(pausing.auto?.pause_requested).toBe(true)

    const paused = manager.submitPendingDiscussion(
      'thread-1',
      {
        turn_id: 'job-001',
        agent: 'claude',
        body: 'new root',
      },
      token,
    )
    expect(paused.room.status).toBe('paused')
    expect(paused.room.active_job_id).toBeNull()
    expect(paused.room.auto).toMatchObject({
      status: 'paused',
      completed_turns: 1,
      next_agent: 'codex',
    })

    const extended = manager.extendAutoDiscussion('thread-1', { turn_count: 2 })
    expect(extended.room.status).toBe('running')
    expect(extended.job.agent).toBe('codex')
    expect(extended.room.auto).toMatchObject({
      status: 'running',
      total_turns: 3,
      remaining_turns: 2,
    })
  })

  it('rejects helper submissions that do not match the active turn', () => {
    const manager = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    manager.startRoom('thread-1', {})
    const token = roomToken()
    manager.markReady('thread-1', 'claude', token)
    manager.markReady('thread-1', 'codex', token)
    manager.askAgent('thread-1', { agent: 'claude' })

    expect(() =>
      manager.submitComment(
        'thread-1',
        { turn_id: 'job-001', agent: 'codex', body: 'wrong agent' },
        token,
      ),
    ).toThrow('agent does not match active turn')
  })

  it('marks timed-out active turns as needing attention', async () => {
    const previousTimeout = process.env.ROUNDTABLE_TURN_TIMEOUT_MS
    process.env.ROUNDTABLE_TURN_TIMEOUT_MS = '1'
    try {
      const manager = createRoomManager({
        dataDir,
        backendUrl: 'http://localhost:4319',
        executor,
      })
      manager.startRoom('thread-1', {})
      const token = roomToken()
      manager.markReady('thread-1', 'claude', token)
      manager.markReady('thread-1', 'codex', token)
      manager.askAgent('thread-1', { agent: 'claude' })

      await new Promise((resolve) => setTimeout(resolve, 20))

      const room = manager.getRoom('thread-1')
      expect(room.status).toBe('needs_attention')
      expect(room.last_error).toBe('agent turn timed out')
      expect(getJob(dataDir, 'thread-1', 'job-001')?.status).toBe('timed_out')
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.ROUNDTABLE_TURN_TIMEOUT_MS
      } else {
        process.env.ROUNDTABLE_TURN_TIMEOUT_MS = previousTimeout
      }
    }
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

  it('records an active turn as skipped and removes disposable drafts when stopped', () => {
    const { manager } = startReadyRoom()
    manager.askAgent('thread-1', { agent: 'claude' })
    const tempDir = path.join(dataDir, 'threads', 'thread-1', '.roundtable', 'tmp')
    expect(fs.existsSync(tempDir)).toBe(true)

    manager.stopRoom('thread-1')

    expect(getJob(dataDir, 'thread-1', 'job-001')?.status).toBe('skipped')
    expect(fs.existsSync(tempDir)).toBe(false)
  })

  it('recovers a persisted live session and preserves an active turn', () => {
    const { manager } = startReadyRoom()
    manager.askAgent('thread-1', { agent: 'claude' })

    const recovered = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    }).getRoom('thread-1')

    expect(recovered.session_state).toBe('recovered')
    expect(recovered.active_job_id).toBe('job-001')
    expect(recovered.status).toBe('running')
  })

  it('retains an interrupted job through missing-session restart and retry', () => {
    const { manager } = startReadyRoom()
    manager.askAgent('thread-1', { agent: 'claude' })
    executor.sessions.delete('roundtable-thread-1')

    const restored = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    })
    const missing = restored.getRoom('thread-1')
    expect(missing.session_state).toBe('missing')
    expect(missing.status).toBe('needs_attention')
    expect(getJob(dataDir, 'thread-1', 'job-001')?.status).toBe('failed')
    expect(() => restored.skipTurn('thread-1')).toThrow('restart the room')

    restored.restartRoom('thread-1')
    const token = roomToken()
    restored.markReady('thread-1', 'claude', token)
    const ready = restored.markReady('thread-1', 'codex', token)
    expect(ready.status).toBe('needs_attention')

    const retried = restored.retryTurn('thread-1')
    expect(retried.job.id).toBe('job-002')
    expect(retried.room.status).toBe('running')
  })

  it('does not adopt an untracked session and stops terminal-thread sessions', () => {
    executor.sessions.add('roundtable-thread-1')
    const untracked = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    }).getRoom('thread-1')
    expect(untracked.session_state).toBe('untracked')

    archiveThread(dataDir, 'thread-1')
    const terminal = createRoomManager({
      dataDir,
      backendUrl: 'http://localhost:4319',
      executor,
    }).getRoom('thread-1')
    expect(terminal.status).toBe('stopped')
    expect(executor.sessions.has('roundtable-thread-1')).toBe(false)
  })
})
