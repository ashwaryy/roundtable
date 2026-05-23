import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type {
  AgentName,
  AgentRoom,
  NudgeRoomInput,
  RoomPreflight,
  RoomToolPreflight,
  StartRoomInput,
} from '@roundtable/shared'
import {
  roomJsonPath,
  roomPromptPath,
  roundtableBinDir,
  roundtableHelperPath,
  roundtableInternalDir,
  threadDir,
  threadJsonPath,
} from '../storage/paths'
import { BadRequestError, ConflictError, NotFoundError } from '../storage/errors'

interface InternalRoom extends AgentRoom {
  token: string
}

export interface CommandExecutor {
  execFile(
    file: string,
    args: string[],
    options?: {
      cwd?: string
      env?: NodeJS.ProcessEnv
    },
  ): string
}

export class SystemCommandExecutor implements CommandExecutor {
  execFile(
    file: string,
    args: string[],
    options: {
      cwd?: string
      env?: NodeJS.ProcessEnv
    } = {},
  ): string {
    return execFileSync(file, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
}

export interface RoomManager {
  preflight(): RoomPreflight
  getRoom(threadId: string): AgentRoom
  startRoom(threadId: string, input: StartRoomInput): AgentRoom
  stopRoom(threadId: string): AgentRoom
  nudgeRoom(threadId: string, input: NudgeRoomInput): AgentRoom
  markReady(threadId: string, agent: AgentName, token: string | null): AgentRoom
}

const TOOL_NAMES = ['tmux', 'claude', 'codex'] as const

function now(): string {
  return new Date().toISOString()
}

function tmuxSessionName(threadId: string): string {
  return `roundtable-${threadId}`
}

function attachCommand(threadId: string): string {
  return `tmux attach -t ${tmuxSessionName(threadId)}`
}

function stripToken(room: InternalRoom): AgentRoom {
  const { token: _token, ...publicRoom } = room
  return publicRoom
}

function normalizeModel(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function ensureThread(dataDir: string, threadId: string): void {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }
}

function defaultRoom(threadId: string): InternalRoom {
  const timestamp = now()
  return {
    thread_id: threadId,
    status: 'not_started',
    tmux_session: tmuxSessionName(threadId),
    attach_command: attachCommand(threadId),
    claude_model: null,
    codex_model: null,
    agents: {
      claude: { ready_at: null },
      codex: { ready_at: null },
    },
    created_at: timestamp,
    updated_at: timestamp,
    started_at: null,
    stopped_at: null,
    last_error: null,
    token: '',
  }
}

function readRoom(dataDir: string, threadId: string): InternalRoom {
  const filePath = roomJsonPath(dataDir, threadId)
  if (!fs.existsSync(filePath)) return defaultRoom(threadId)
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as InternalRoom
  return {
    ...defaultRoom(threadId),
    ...parsed,
    agents: {
      claude: parsed.agents?.claude ?? { ready_at: null },
      codex: parsed.agents?.codex ?? { ready_at: null },
    },
  }
}

function writeRoom(dataDir: string, room: InternalRoom): void {
  const dir = roundtableInternalDir(dataDir, room.thread_id)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = roomJsonPath(dataDir, room.thread_id)
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(room, null, 2))
  fs.renameSync(tmp, filePath)
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents, { mode: 0o700 })
  fs.chmodSync(filePath, 0o700)
}

function startupPrompt(agent: AgentName): string {
  return [
    '# Roundtable Agent Room',
    '',
    `You are ${agent} participating in this Roundtable thread.`,
    '',
    'Read `thread.md`, `thread.json`, `comments.jsonl`, `pending-discussions.jsonl`, attachments, and project snapshot files as needed.',
    'Discussion happens around the source thread. Do not edit `thread.md`, `thread.json`, `comments.jsonl`, `pending-discussions.jsonl`, or files under `.roundtable/`.',
    'Do not edit project snapshot files or user project files.',
    '',
    `First, acknowledge readiness by running: roundtable ready --agent ${agent}`,
    'After readiness, wait for Roundtable nudges in this terminal.',
  ].join('\n')
}

function cliCommand(agent: AgentName, model: string | null, promptFile: string): string {
  const modelPart = model ? ` --model ${shellSingleQuote(model)}` : ''
  if (agent === 'claude') {
    return `claude${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
  }
  return `codex${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
}

function resumeCliCommand(
  agent: AgentName,
  model: string | null,
  promptFile: string,
): string {
  const modelPart = model ? ` --model ${shellSingleQuote(model)}` : ''
  if (agent === 'claude') {
    return `claude --continue${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
  }
  return `codex resume --last${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
}

function writeHelperScript(
  dataDir: string,
  room: InternalRoom,
  backendUrl: string,
  shouldResume: boolean,
): void {
  const binDir = roundtableBinDir(dataDir, room.thread_id)
  fs.mkdirSync(binDir, { recursive: true })
  writeExecutable(
    roundtableHelperPath(dataDir, room.thread_id),
    `#!/usr/bin/env node
const command = process.argv[2]
const args = process.argv.slice(3)

function argValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

async function main() {
  if (command !== 'ready') {
    console.error('unsupported roundtable helper command')
    process.exit(2)
  }

  const agent = argValue('--agent')
  if (agent !== 'claude' && agent !== 'codex') {
    console.error('usage: roundtable ready --agent claude|codex')
    process.exit(2)
  }

  const threadId = process.env.ROUNDTABLE_THREAD_ID
  const backendUrl = process.env.ROUNDTABLE_BACKEND_URL
  const token = process.env.ROUNDTABLE_ROOM_TOKEN
  if (!threadId || !backendUrl || !token) {
    console.error('roundtable helper environment is missing')
    process.exit(2)
  }

  const response = await fetch(\`\${backendUrl}/api/threads/\${threadId}/room/ready\`, {
    method: 'POST',
    headers: {
      authorization: \`Bearer \${token}\`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ agent }),
  })

  if (!response.ok) {
    console.error(await response.text())
    process.exit(1)
  }

  console.log(\`\${agent} ready\`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
`,
  )

  for (const agent of ['claude', 'codex'] as const) {
    const promptFile = roomPromptPath(dataDir, room.thread_id, agent)
    fs.writeFileSync(promptFile, startupPrompt(agent))
    const model = agent === 'claude' ? room.claude_model : room.codex_model
    const command = shouldResume
      ? resumeCliCommand(agent, model, promptFile)
      : cliCommand(agent, model, promptFile)
    writeExecutable(
      path.join(roundtableInternalDir(dataDir, room.thread_id), `launch-${agent}.sh`),
      `#!/bin/sh
export PATH=${shellSingleQuote(`${binDir}:${process.env.PATH ?? ''}`)}
export ROUNDTABLE_THREAD_ID=${shellSingleQuote(room.thread_id)}
export ROUNDTABLE_BACKEND_URL=${shellSingleQuote(backendUrl)}
export ROUNDTABLE_ROOM_TOKEN=${shellSingleQuote(room.token)}
cd ${shellSingleQuote(threadDir(dataDir, room.thread_id))}
exec ${command}
`,
    )
  }
}

function toolPreflight(executor: CommandExecutor, name: (typeof TOOL_NAMES)[number]): RoomToolPreflight {
  try {
    const toolPath = executor.execFile('which', [name]).trim()
    let version: string | null = null
    try {
      const args = name === 'tmux' ? ['-V'] : ['--version']
      version = executor.execFile(name, args).trim().split('\n')[0] || null
    } catch {
      version = null
    }
    return { name, available: true, path: toolPath, version, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { name, available: false, path: null, version: null, error: message }
  }
}

function sessionExists(executor: CommandExecutor, sessionName: string): boolean {
  try {
    executor.execFile('tmux', ['has-session', '-t', sessionName])
    return true
  } catch {
    return false
  }
}

function markError(dataDir: string, room: InternalRoom, message: string): AgentRoom {
  const updated: InternalRoom = {
    ...room,
    status: 'error',
    updated_at: now(),
    last_error: message,
  }
  writeRoom(dataDir, updated)
  return stripToken(updated)
}

export function createRoomManager(options: {
  dataDir: string
  backendUrl: string
  executor?: CommandExecutor
}): RoomManager {
  const { dataDir, backendUrl } = options
  const executor = options.executor ?? new SystemCommandExecutor()

  return {
    preflight(): RoomPreflight {
      const tools = {
        tmux: toolPreflight(executor, 'tmux'),
        claude: toolPreflight(executor, 'claude'),
        codex: toolPreflight(executor, 'codex'),
      }
      return {
        ok: Object.values(tools).every((tool) => tool.available),
        tools,
      }
    },

    getRoom(threadId: string): AgentRoom {
      ensureThread(dataDir, threadId)
      return stripToken(readRoom(dataDir, threadId))
    },

    startRoom(threadId: string, input: StartRoomInput): AgentRoom {
      ensureThread(dataDir, threadId)
      const preflight = this.preflight()
      if (!preflight.ok) {
        const missing = Object.values(preflight.tools)
          .filter((tool) => !tool.available)
          .map((tool) => tool.name)
          .join(', ')
        throw new ConflictError(`missing required room tools: ${missing}`)
      }

      const existing = readRoom(dataDir, threadId)
      if (
        (existing.status === 'starting' || existing.status === 'idle') &&
        sessionExists(executor, existing.tmux_session)
      ) {
        return stripToken(existing)
      }

      const timestamp = now()
      const shouldResume = existing.started_at !== null
      const room: InternalRoom = {
        ...existing,
        status: 'starting',
        claude_model: normalizeModel(input.claude_model),
        codex_model: normalizeModel(input.codex_model),
        agents: {
          claude: { ready_at: null },
          codex: { ready_at: null },
        },
        updated_at: timestamp,
        started_at: existing.started_at ?? timestamp,
        stopped_at: null,
        last_error: null,
        token: randomToken(),
      }
      writeHelperScript(dataDir, room, backendUrl, shouldResume)

      try {
        const cwd = threadDir(dataDir, threadId)
        const internalDir = roundtableInternalDir(dataDir, threadId)
        executor.execFile('tmux', [
          'new-session',
          '-d',
          '-s',
          room.tmux_session,
          '-c',
          cwd,
        ])
        executor.execFile('tmux', [
          'send-keys',
          '-t',
          `${room.tmux_session}:0.0`,
          path.join(internalDir, 'launch-claude.sh'),
          'C-m',
        ])
        executor.execFile('tmux', [
          'split-window',
          '-h',
          '-t',
          `${room.tmux_session}:0`,
          '-c',
          cwd,
        ])
        executor.execFile('tmux', [
          'send-keys',
          '-t',
          `${room.tmux_session}:0.1`,
          path.join(internalDir, 'launch-codex.sh'),
          'C-m',
        ])
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return markError(dataDir, room, message)
      }

      writeRoom(dataDir, room)
      return stripToken(room)
    },

    stopRoom(threadId: string): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = readRoom(dataDir, threadId)
      if (sessionExists(executor, room.tmux_session)) {
        executor.execFile('tmux', ['kill-session', '-t', room.tmux_session])
      }
      const timestamp = now()
      const updated: InternalRoom = {
        ...room,
        status: 'stopped',
        updated_at: timestamp,
        stopped_at: timestamp,
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    nudgeRoom(threadId: string, input: NudgeRoomInput): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = readRoom(dataDir, threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before sending nudges')
      }
      if (!sessionExists(executor, room.tmux_session)) {
        return markError(dataDir, room, 'tmux session is not running')
      }
      const pane = input.agent === 'claude' ? '0.0' : '0.1'
      const body =
        input.body?.trim() ??
        'Roundtable nudge: inspect the current thread and approved discussion. Reply in this terminal only; durable comment submission is enabled in a later phase.'
      executor.execFile('tmux', [
        'send-keys',
        '-t',
        `${room.tmux_session}:${pane}`,
        body,
        'C-m',
      ])
      const updated: InternalRoom = { ...room, updated_at: now(), last_error: null }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    markReady(threadId: string, agent: AgentName, token: string | null): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = readRoom(dataDir, threadId)
      if (!token || token !== room.token) {
        throw new BadRequestError('invalid room token')
      }
      if (room.status !== 'starting' && room.status !== 'idle') {
        throw new BadRequestError('room is not starting')
      }
      const updated: InternalRoom = {
        ...room,
        agents: {
          ...room.agents,
          [agent]: {
            ready_at: room.agents[agent].ready_at ?? now(),
          },
        },
        updated_at: now(),
        last_error: null,
      }
      if (updated.agents.claude.ready_at && updated.agents.codex.ready_at) {
        updated.status = 'idle'
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },
  }
}
