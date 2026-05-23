import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type {
  AgentName,
  AgentRoom,
  AskAgentInput,
  BoundedJob,
  Comment,
  HelperCommentInput,
  NudgeRoomInput,
  RoundtableEvent,
  RoomPreflight,
  RoomToolPreflight,
  StartRoomInput,
} from '@roundtable/shared'
import {
  claudeLocalSettingsPath,
  codexProjectConfigPath,
  codexRulesPath,
  currentTurnPath,
  jobsDir,
  roomJsonPath,
  roomPromptPath,
  roundtableBinDir,
  roundtableHelperPath,
  roundtableInternalDir,
  roundtableTmpDir,
  threadDir,
  threadJsonPath,
} from '../storage/paths'
import { BadRequestError, ConflictError, NotFoundError } from '../storage/errors'
import { addAgentComment, listComments } from '../storage/comments'
import { getJob, nextJobId, writeJob } from '../storage/jobs'

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
  askAgent(threadId: string, input: AskAgentInput): AgentTurnResult
  submitComment(
    threadId: string,
    input: HelperCommentInput,
    token: string | null,
  ): AgentTurnSubmission
  retryTurn(threadId: string): AgentTurnResult
  skipTurn(threadId: string): AgentTurnResult
}

export interface AgentTurnResult {
  room: AgentRoom
  job: BoundedJob
}

export interface AgentTurnSubmission extends AgentTurnResult {
  comment: Comment
}

const TOOL_NAMES = ['tmux', 'claude', 'codex'] as const
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000

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
    active_job_id: null,
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

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, filePath)
}

function writeTextFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, contents)
  fs.renameSync(tmp, filePath)
}

function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

function turnTimeoutMs(): number {
  const configured = Number(process.env.ROUNDTABLE_TURN_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TURN_TIMEOUT_MS
}

function addMilliseconds(timestamp: string, ms: number): string {
  return new Date(new Date(timestamp).getTime() + ms).toISOString()
}

function isTimedOut(job: BoundedJob): boolean {
  return Date.now() >= new Date(job.timeout_at).getTime()
}

function paneForAgent(agent: AgentName): string {
  return agent === 'claude' ? '0.0' : '0.1'
}

function startupPrompt(agent: AgentName): string {
  return [
    '# Roundtable Agent Room',
    '',
    `You are ${agent} participating in this Roundtable thread.`,
    '',
    'Read `thread.md`, `thread.json`, `comments.jsonl`, `pending-discussions.jsonl`, attachments, and project snapshot files as needed.',
    'Discussion happens around the source thread. Do not edit `thread.md`, `thread.json`, `comments.jsonl`, `pending-discussions.jsonl`, or `.roundtable/` files except the exact comment draft path named in a Roundtable Ask turn.',
    'Do not edit project snapshot files or user project files.',
    '',
    `First, acknowledge readiness by running: roundtable ready --agent ${agent}`,
    'After readiness, wait for Roundtable Ask turns in this terminal.',
    'For each Ask turn, write your durable comment only to the `.roundtable/tmp/...` path named in that turn, then submit it with the exact `roundtable comment --body-file ... --type comment` command from that turn.',
  ].join('\n')
}

function commandVariants(command: string, rtkAvailable: boolean): string[] {
  return rtkAvailable ? [command, `rtk ${command}`] : [command]
}

function claudeBashRules(
  commands: string[],
  rtkAvailable: boolean,
  wildcard = '',
): string[] {
  return commands.flatMap((command) =>
    commandVariants(command, rtkAvailable).map(
      (variant) => `Bash(${variant}${wildcard})`,
    ),
  )
}

function codexPrefixRule(
  pattern: string[],
  decision: 'allow' | 'forbidden',
  justification: string,
): string {
  const quotedPattern = pattern.map((part) => JSON.stringify(part)).join(', ')
  return `prefix_rule(pattern = [${quotedPattern}], decision = ${JSON.stringify(
    decision,
  )}, justification = ${JSON.stringify(justification)})`
}

function codexRulesForCommand(
  command: string[],
  rtkAvailable: boolean,
  decision: 'allow' | 'forbidden',
  justification: string,
): string[] {
  const rules = [codexPrefixRule(command, decision, justification)]
  if (rtkAvailable) {
    rules.push(codexPrefixRule(['rtk', ...command], decision, justification))
  }
  return rules
}

function writeAgentPermissionSetup(
  dataDir: string,
  threadId: string,
  rtkAvailable: boolean,
): void {
  const readCommands = ['pwd', 'ls', 'cat', 'sed', 'rg']
  const workflowCommands = [
    'git status',
    'git diff',
    'npm test',
    'npm run test',
    'npm run typecheck',
    'npm run build',
    'npm run dev',
  ]
  const helperCommands = ['roundtable ready', 'roundtable comment']
  const destructiveCommands = [
    'rm',
    'mv',
    'git push',
    'git commit',
    'git reset',
    'git checkout',
    'npm install',
    'npm publish',
    'npm exec',
    'npx',
  ]

  writeJsonFile(claudeLocalSettingsPath(dataDir, threadId), {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    permissions: {
      allow: [
        'Read',
        'Edit(.roundtable/tmp/**)',
        'Edit(./.roundtable/tmp/**)',
        'Write(.roundtable/tmp/**)',
        'Write(./.roundtable/tmp/**)',
        ...claudeBashRules(readCommands, rtkAvailable, ' *'),
        ...claudeBashRules(workflowCommands, rtkAvailable, ' *'),
        ...claudeBashRules(helperCommands, rtkAvailable, ' *'),
      ],
      deny: [
        'Read(./.env)',
        'Read(./.env.*)',
        'Read(./**/.env)',
        'Read(./**/.env.*)',
        'Read(./.roundtable/room.json)',
        'Edit(thread.md)',
        'Write(thread.md)',
        'Edit(thread.json)',
        'Write(thread.json)',
        'Edit(comments.jsonl)',
        'Write(comments.jsonl)',
        'Edit(pending-discussions.jsonl)',
        'Write(pending-discussions.jsonl)',
        'Edit(context-items.jsonl)',
        'Write(context-items.jsonl)',
        'Edit(project-snapshot/**)',
        'Write(project-snapshot/**)',
        'Edit(.roundtable/current-turn.json)',
        'Write(.roundtable/current-turn.json)',
        'Edit(./.roundtable/current-turn.json)',
        'Write(./.roundtable/current-turn.json)',
        'Edit(.roundtable/room.json)',
        'Write(.roundtable/room.json)',
        'Edit(./.roundtable/room.json)',
        'Write(./.roundtable/room.json)',
        'Bash(*>*)',
        'Bash(*>>*)',
        ...claudeBashRules(destructiveCommands, rtkAvailable, ' *'),
      ],
    },
  })

  writeTextFile(
    codexProjectConfigPath(dataDir, threadId),
    `approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true

[features.network_proxy]
enabled = true
domains = { "localhost" = "allow", "127.0.0.1" = "allow" }
`,
  )

  const allowReason = 'Allowed for Roundtable agent room workflow'
  const forbidReason = 'Blocked by Roundtable because this mutates durable state or publishes externally'
  const codexRules = [
    ...codexRulesForCommand(['roundtable', 'ready'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['roundtable', 'comment'], rtkAvailable, 'allow', allowReason),
    ...['pwd', 'ls', 'cat', 'sed', 'rg'].flatMap((command) =>
      codexRulesForCommand([command], rtkAvailable, 'allow', allowReason),
    ),
    ...codexRulesForCommand(['git', 'status'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['git', 'diff'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['npm', 'test'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['npm', 'run', 'test'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['npm', 'run', 'typecheck'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['npm', 'run', 'build'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['npm', 'run', 'dev'], rtkAvailable, 'allow', allowReason),
    ...['rm', 'mv', 'npx'].flatMap((command) =>
      codexRulesForCommand([command], rtkAvailable, 'forbidden', forbidReason),
    ),
    ...codexRulesForCommand(['git', 'push'], rtkAvailable, 'forbidden', forbidReason),
    ...codexRulesForCommand(['git', 'commit'], rtkAvailable, 'forbidden', forbidReason),
    ...codexRulesForCommand(['git', 'reset'], rtkAvailable, 'forbidden', forbidReason),
    ...codexRulesForCommand(['git', 'checkout'], rtkAvailable, 'forbidden', forbidReason),
    ...codexRulesForCommand(['npm', 'install'], rtkAvailable, 'forbidden', forbidReason),
    ...codexRulesForCommand(['npm', 'publish'], rtkAvailable, 'forbidden', forbidReason),
    ...codexRulesForCommand(['npm', 'exec'], rtkAvailable, 'forbidden', forbidReason),
  ]

  writeTextFile(codexRulesPath(dataDir, threadId), `${codexRules.join('\n')}\n`)
}

function codexSandboxArgs(): string {
  return [
    '--sandbox workspace-write',
    '--ask-for-approval on-request',
    `-c ${shellSingleQuote('sandbox_workspace_write.network_access=true')}`,
    `-c ${shellSingleQuote('features.network_proxy.enabled=true')}`,
    `-c ${shellSingleQuote(
      'features.network_proxy.domains={ "localhost" = "allow", "127.0.0.1" = "allow" }',
    )}`,
  ].join(' ')
}

function cliCommand(agent: AgentName, model: string | null, promptFile: string): string {
  const modelPart = model ? ` --model ${shellSingleQuote(model)}` : ''
  if (agent === 'claude') {
    return `claude${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
  }
  return `codex ${codexSandboxArgs()}${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
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
  return `codex resume --last ${codexSandboxArgs()}${modelPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
}

function writeHelperScript(
  dataDir: string,
  room: InternalRoom,
  backendUrl: string,
  shouldResume: Record<AgentName, boolean>,
): void {
  const binDir = roundtableBinDir(dataDir, room.thread_id)
  fs.mkdirSync(binDir, { recursive: true })
  writeExecutable(
    roundtableHelperPath(dataDir, room.thread_id),
    `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const command = process.argv[2]
const args = process.argv.slice(3)

function argValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

async function main() {
  const threadId = process.env.ROUNDTABLE_THREAD_ID
  const backendUrl = process.env.ROUNDTABLE_BACKEND_URL
  const token = process.env.ROUNDTABLE_ROOM_TOKEN
  if (!threadId || !backendUrl || !token) {
    console.error('roundtable helper environment is missing')
    process.exit(2)
  }

  if (command === 'ready') {
    const agent = argValue('--agent')
    if (agent !== 'claude' && agent !== 'codex') {
      console.error('usage: roundtable ready --agent claude|codex')
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
    return
  }

  if (command === 'comment') {
    const bodyFile = argValue('--body-file')
    if (!bodyFile) {
      console.error('usage: roundtable comment --body-file <path> [--type comment|proposal|critique|question|decision]')
      process.exit(2)
    }

    const workspace = process.cwd()
    const absoluteBodyFile = path.resolve(workspace, bodyFile)
    if (!absoluteBodyFile.startsWith(workspace + path.sep)) {
      console.error('body file must be inside the thread workspace')
      process.exit(2)
    }

    const body = fs.readFileSync(absoluteBodyFile, 'utf8')
    const turnPath = path.join(workspace, '.roundtable', 'current-turn.json')
    const turn = JSON.parse(fs.readFileSync(turnPath, 'utf8'))
    const response = await fetch(\`\${backendUrl}/api/threads/\${threadId}/room/comment\`, {
      method: 'POST',
      headers: {
        authorization: \`Bearer \${token}\`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        turn_id: turn.id,
        agent: turn.agent,
        body,
        type: argValue('--type') || undefined,
      }),
    })

    if (!response.ok) {
      console.error(await response.text())
      process.exit(1)
    }

    const result = await response.json()
    console.log(\`comment submitted: \${result.comment.id}\`)
    return
  }

  console.error('unsupported roundtable helper command')
  process.exit(2)
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
    const command = shouldResume[agent]
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

function toolAvailable(executor: CommandExecutor, name: string): boolean {
  try {
    executor.execFile('which', [name])
    return true
  } catch {
    return false
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

function sendStartupTrustPromptEnter(
  executor: CommandExecutor,
  room: InternalRoom,
  agent: AgentName,
): void {
  executor.execFile('tmux', [
    'send-keys',
    '-t',
    `${room.tmux_session}:${paneForAgent(agent)}`,
    'C-m',
  ])
}

function paneContainsStartupTrustPrompt(
  executor: CommandExecutor,
  room: InternalRoom,
  agent: AgentName,
): boolean {
  const output = executor.execFile('tmux', [
    'capture-pane',
    '-t',
    `${room.tmux_session}:${paneForAgent(agent)}`,
    '-p',
    '-S',
    '-80',
  ])
  return /Do you trust|Quick safety check|Yes, I trust this folder|Yes, continue/i.test(
    output,
  )
}

function markError(dataDir: string, room: InternalRoom, message: string): AgentRoom {
  const updated: InternalRoom = {
    ...room,
    status: 'error',
    updated_at: now(),
    last_error: message,
    active_job_id: null,
  }
  writeRoom(dataDir, updated)
  return stripToken(updated)
}

function buildTurnPrompt(job: BoundedJob): string {
  const target =
    job.turn.scope === 'discussion'
      ? `Reply to discussion ${job.turn.discussion_id}.`
      : 'Create a new top-level discussion point.'
  const commentPath = `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-comment.md`
  const custom = job.turn.instructions
    ? `\n\nUser instructions:\n${job.turn.instructions}`
    : ''

  return [
    `Roundtable Ask turn ${job.turn.id}.`,
    target,
    'Read the current thread and approved discussion as needed.',
    'Do not edit canonical Roundtable files, project files, or `.roundtable/` files other than the draft file named below.',
    `Write your final comment body to \`${commentPath}\`.`,
    `Submit exactly once with: roundtable comment --body-file ${commentPath} --type comment`,
    'If a discussion-level reply should split into a new root, say so in this reply; pending root submission is enabled in a later phase.',
    custom,
  ].join('\n')
}

function createAgentTurnJob(input: {
  dataDir: string
  threadId: string
  ask: AskAgentInput
}): BoundedJob {
  const timestamp = now()
  const timeoutAt = addMilliseconds(timestamp, turnTimeoutMs())
  const jobId = nextJobId(input.dataDir, input.threadId)
  const scope = input.ask.discussion_id ? 'discussion' : 'thread'

  return {
    id: jobId,
    thread_id: input.threadId,
    kind: 'agent_turn',
    status: 'running',
    agent: input.ask.agent,
    started_at: timestamp,
    timeout_at: timeoutAt,
    completed_at: null,
    logs: ['Agent turn started.'],
    result: null,
    failure_reason: null,
    turn: {
      id: jobId,
      thread_id: input.threadId,
      agent: input.ask.agent,
      kind: 'comment',
      scope,
      discussion_id: input.ask.discussion_id ?? null,
      instructions: input.ask.body?.trim() ?? null,
      allow_direct_roots: scope === 'thread',
      pending_roots_only: false,
      created_at: timestamp,
      timeout_at: timeoutAt,
    },
  }
}

export function createRoomManager(options: {
  dataDir: string
  backendUrl: string
  executor?: CommandExecutor
  onUpdate?: (event: RoundtableEvent) => void
  startupTrustPromptDelaysMs?: number[]
}): RoomManager {
  const { dataDir, backendUrl } = options
  const executor = options.executor ?? new SystemCommandExecutor()
  const timers = new Map<string, NodeJS.Timeout>()
  const startupTrustPromptDelaysMs =
    options.startupTrustPromptDelaysMs ?? [1200, 3000, 6000]

  function clearTurnTimer(jobId: string): void {
    const timer = timers.get(jobId)
    if (timer) clearTimeout(timer)
    timers.delete(jobId)
  }

  function broadcast(event: RoundtableEvent): void {
    options.onUpdate?.(event)
  }

  function expireActiveTurn(threadId: string): InternalRoom {
    let room = readRoom(dataDir, threadId)
    if (!room.active_job_id) return room

    const job = getJob(dataDir, threadId, room.active_job_id)
    if (!job || job.status !== 'running' || !isTimedOut(job)) return room

    const timestamp = now()
    const updatedJob: BoundedJob = {
      ...job,
      status: 'timed_out',
      completed_at: timestamp,
      failure_reason: 'agent turn timed out',
      logs: [...job.logs, 'Agent turn timed out.'],
    }
    writeJob(dataDir, updatedJob)
    clearTurnTimer(job.id)
    removeIfExists(currentTurnPath(dataDir, threadId))

    room = {
      ...room,
      status: 'needs_attention',
      updated_at: timestamp,
      last_error: 'agent turn timed out',
    }
    writeRoom(dataDir, room)
    broadcast({ type: 'job_updated', thread_id: threadId, job_id: job.id })
    broadcast({ type: 'room_updated', thread_id: threadId })
    return room
  }

  function scheduleTimeout(job: BoundedJob): void {
    clearTurnTimer(job.id)
    const delay = Math.max(0, new Date(job.timeout_at).getTime() - Date.now())
    const timer = setTimeout(() => {
      expireActiveTurn(job.thread_id)
    }, delay)
    timer.unref?.()
    timers.set(job.id, timer)
  }

  function sendTurnToAgent(room: InternalRoom, job: BoundedJob): void {
    fs.mkdirSync(roundtableTmpDir(dataDir, room.thread_id), { recursive: true })
    fs.mkdirSync(jobsDir(dataDir, room.thread_id), { recursive: true })
    writeJsonFile(currentTurnPath(dataDir, room.thread_id), job.turn)
    executor.execFile('tmux', [
      'send-keys',
      '-t',
      `${room.tmux_session}:${paneForAgent(job.agent)}`,
      buildTurnPrompt(job),
      'C-m',
    ])
  }

  function scheduleStartupTrustPromptAcceptance(room: InternalRoom): void {
    for (const delay of startupTrustPromptDelaysMs) {
      const timer = setTimeout(() => {
        try {
          const current = readRoom(dataDir, room.thread_id)
          if (
            current.status !== 'starting' ||
            !sessionExists(executor, current.tmux_session)
          ) {
            return
          }

          for (const agent of ['claude', 'codex'] as const) {
            if (
              !current.agents[agent].ready_at &&
              paneContainsStartupTrustPrompt(executor, current, agent)
            ) {
              sendStartupTrustPromptEnter(executor, current, agent)
            }
          }
        } catch {
          // Trust-prompt acceptance is best-effort; room readiness is still
          // validated by the helper handshake.
        }
      }, delay)
      timer.unref?.()
    }
  }

  function startJob(room: InternalRoom, job: BoundedJob): AgentTurnResult {
    writeJob(dataDir, job)
    try {
      sendTurnToAgent(room, job)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failed: BoundedJob = {
        ...job,
        status: 'failed',
        completed_at: now(),
        failure_reason: message,
        logs: [...job.logs, message],
      }
      writeJob(dataDir, failed)
      return {
        room: markError(dataDir, room, message),
        job: failed,
      }
    }

    const updated: InternalRoom = {
      ...room,
      status: 'running',
      active_job_id: job.id,
      updated_at: now(),
      last_error: null,
    }
    writeRoom(dataDir, updated)
    scheduleTimeout(job)
    return { room: stripToken(updated), job }
  }

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
      return stripToken(expireActiveTurn(threadId))
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

      const existing = expireActiveTurn(threadId)
      writeAgentPermissionSetup(dataDir, threadId, toolAvailable(executor, 'rtk'))
      if (
        (
          existing.status === 'starting' ||
          existing.status === 'idle' ||
          existing.status === 'running' ||
          existing.status === 'needs_attention'
        ) &&
        sessionExists(executor, existing.tmux_session)
      ) {
        return stripToken(existing)
      }

      const timestamp = now()
      const shouldResume = {
        claude: existing.started_at !== null && existing.agents.claude.ready_at !== null,
        codex: existing.started_at !== null && existing.agents.codex.ready_at !== null,
      }
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
        active_job_id: null,
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
        scheduleStartupTrustPromptAcceptance(room)
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
        active_job_id: null,
      }
      if (room.active_job_id) clearTurnTimer(room.active_job_id)
      removeIfExists(currentTurnPath(dataDir, threadId))
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    nudgeRoom(threadId: string, input: NudgeRoomInput): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before sending nudges')
      }
      if (!sessionExists(executor, room.tmux_session)) {
        return markError(dataDir, room, 'tmux session is not running')
      }
      const body =
        input.body?.trim() ??
        'Roundtable nudge: inspect the current thread and approved discussion. If you need to make a durable comment, wait for an Ask turn.'
      executor.execFile('tmux', [
        'send-keys',
        '-t',
        `${room.tmux_session}:${paneForAgent(input.agent)}`,
        body,
        'C-m',
      ])
      const updated: InternalRoom = { ...room, updated_at: now(), last_error: null }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    markReady(threadId: string, agent: AgentName, token: string | null): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
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

    askAgent(threadId: string, input: AskAgentInput): AgentTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before starting an ask turn')
      }
      if (!sessionExists(executor, room.tmux_session)) {
        const failed = {
          ...createAgentTurnJob({ dataDir, threadId, ask: input }),
          status: 'failed' as const,
          completed_at: now(),
          failure_reason: 'tmux session is not running',
        }
        writeJob(dataDir, failed)
        return {
          room: markError(dataDir, room, 'tmux session is not running'),
          job: failed,
        }
      }

      if (input.discussion_id) {
        const root = listComments(dataDir, threadId).find(
          (comment) =>
            comment.id === input.discussion_id && comment.parent_id === null,
        )
        if (!root) {
          throw new NotFoundError(`discussion ${input.discussion_id} not found`)
        }
      }

      return startJob(room, createAgentTurnJob({ dataDir, threadId, ask: input }))
    },

    submitComment(
      threadId: string,
      input: HelperCommentInput,
      token: string | null,
    ): AgentTurnSubmission {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!token || token !== room.token) {
        throw new BadRequestError('invalid room token')
      }
      if (room.status !== 'running' || !room.active_job_id) {
        throw new BadRequestError('no active turn is running')
      }
      if (room.active_job_id !== input.turn_id) {
        throw new BadRequestError('turn does not match active job')
      }

      const job = getJob(dataDir, threadId, room.active_job_id)
      if (!job || job.status !== 'running') {
        throw new BadRequestError('active job is not running')
      }
      if (job.agent !== input.agent || job.turn.agent !== input.agent) {
        throw new BadRequestError('agent does not match active turn')
      }
      if (isTimedOut(job)) {
        expireActiveTurn(threadId)
        throw new BadRequestError('active turn has timed out')
      }

      const comment = addAgentComment(dataDir, threadId, {
        author: input.agent,
        body: input.body,
        type: input.type,
        reply_to:
          job.turn.scope === 'discussion' ? job.turn.discussion_id : null,
      })

      const completed: BoundedJob = {
        ...job,
        status: 'completed',
        completed_at: now(),
        result: { comment_id: comment.id },
        logs: [...job.logs, `Comment ${comment.id} submitted.`],
      }
      writeJob(dataDir, completed)
      clearTurnTimer(job.id)
      removeIfExists(currentTurnPath(dataDir, threadId))

      const updated: InternalRoom = {
        ...room,
        status: 'idle',
        active_job_id: null,
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return { room: stripToken(updated), job: completed, comment }
    },

    retryTurn(threadId: string): AgentTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'needs_attention' || !room.active_job_id) {
        throw new BadRequestError('room does not have a turn needing attention')
      }
      if (!sessionExists(executor, room.tmux_session)) {
        return {
          room: markError(dataDir, room, 'tmux session is not running'),
          job: getJob(dataDir, threadId, room.active_job_id) ??
            createAgentTurnJob({
              dataDir,
              threadId,
              ask: { agent: 'claude' },
            }),
        }
      }

      const oldJob = getJob(dataDir, threadId, room.active_job_id)
      if (!oldJob) throw new NotFoundError(`job ${room.active_job_id} not found`)

      const timestamp = now()
      const timeoutAt = addMilliseconds(timestamp, turnTimeoutMs())
      const jobId = nextJobId(dataDir, threadId)
      const retryJob: BoundedJob = {
        ...oldJob,
        id: jobId,
        status: 'running',
        started_at: timestamp,
        timeout_at: timeoutAt,
        completed_at: null,
        logs: ['Agent turn retried.'],
        result: null,
        failure_reason: null,
        turn: {
          ...oldJob.turn,
          id: jobId,
          created_at: timestamp,
          timeout_at: timeoutAt,
        },
      }

      return startJob({ ...room, status: 'idle', active_job_id: null }, retryJob)
    },

    skipTurn(threadId: string): AgentTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'needs_attention' || !room.active_job_id) {
        throw new BadRequestError('room does not have a turn needing attention')
      }

      const job = getJob(dataDir, threadId, room.active_job_id)
      if (!job) throw new NotFoundError(`job ${room.active_job_id} not found`)

      const skipped: BoundedJob = {
        ...job,
        status: 'skipped',
        completed_at: now(),
        failure_reason: job.failure_reason ?? 'agent turn skipped',
        logs: [...job.logs, 'Agent turn skipped.'],
      }
      writeJob(dataDir, skipped)
      clearTurnTimer(job.id)
      removeIfExists(currentTurnPath(dataDir, threadId))

      const updated: InternalRoom = {
        ...room,
        status: 'idle',
        active_job_id: null,
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return { room: stripToken(updated), job: skipped }
    },
  }
}
