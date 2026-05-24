import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type {
  AgentName,
  AgentRoom,
  AskAgentInput,
  AutoDiscussionState,
  BoundedJob,
  Comment,
  ConsolidationProposal,
  HelperProposalInput,
  HelperCommentInput,
  HelperPendingDiscussionInput,
  HelperReviewInput,
  NudgeRoomInput,
  PendingDiscussion,
  ProposalReview,
  ProposalRevision,
  RoundtableEvent,
  RequestProposalReviewInput,
  RequestProposalRevisionInput,
  RoomPreflight,
  RoomToolPreflight,
  ExtendAutoDiscussionInput,
  SendRoomInputResponseInput,
  StartAutoDiscussionInput,
  StartConsolidationInput,
  StartRoomInput,
} from '@roundtable/shared'
import {
  claudeLocalSettingsPath,
  codexProjectConfigPath,
  codexRulesPath,
  currentTurnPath,
  jobsDir,
  queuedConsolidationPath,
  roomJsonPath,
  roomPromptPath,
  roundtableBinDir,
  roundtableHelperPath,
  roundtableInternalDir,
  roundtableTmpDir,
  threadDir,
  threadJsonPath,
  threadMdPath,
  contextItemsPath,
  projectSnapshotJsonPath,
} from '../storage/paths'
import { BadRequestError, ConflictError, NotFoundError } from '../storage/errors'
import { addAgentComment, listComments } from '../storage/comments'
import { addPendingDiscussion } from '../storage/pendingDiscussions'
import { getJob, nextJobId, writeJob } from '../storage/jobs'
import {
  addProposalReview,
  addProposalRevision,
  createProposal,
  getLatestReviewBody,
  getLatestRevision,
  getProposal,
  listRevisions,
  updateProposal,
} from '../storage/proposals'

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
  startAutoDiscussion(
    threadId: string,
    input: StartAutoDiscussionInput,
  ): AgentTurnResult
  startConsolidation(
    threadId: string,
    input: StartConsolidationInput,
  ): ConsolidationTurnResult
  finishAndStartConsolidation(
    threadId: string,
    input: StartConsolidationInput,
  ): AgentRoom
  requestProposalReview(
    threadId: string,
    proposalId: string,
    input: RequestProposalReviewInput,
  ): ConsolidationTurnResult
  requestProposalRevision(
    threadId: string,
    proposalId: string,
    input: RequestProposalRevisionInput,
  ): ConsolidationTurnResult
  pauseAutoDiscussion(threadId: string): AgentRoom
  extendAutoDiscussion(
    threadId: string,
    input: ExtendAutoDiscussionInput,
  ): AgentTurnResult
  sendInputResponse(
    threadId: string,
    input: SendRoomInputResponseInput,
  ): AgentRoom
  submitComment(
    threadId: string,
    input: HelperCommentInput,
    token: string | null,
  ): AgentTurnSubmission
  submitPendingDiscussion(
    threadId: string,
    input: HelperPendingDiscussionInput,
    token: string | null,
  ): AgentPendingDiscussionSubmission
  submitProposal(
    threadId: string,
    input: HelperProposalInput,
    token: string | null,
  ): AgentProposalSubmission
  submitReview(
    threadId: string,
    input: HelperReviewInput,
    token: string | null,
  ): AgentReviewSubmission
  retryTurn(threadId: string): AgentTurnResult
  skipTurn(threadId: string): AgentTurnResult
}

export interface AgentTurnResult {
  room: AgentRoom
  job: BoundedJob
}

export interface ConsolidationTurnResult extends AgentTurnResult {
  proposal: ConsolidationProposal
}

export interface AgentTurnSubmission extends AgentTurnResult {
  comment: Comment
}

export interface AgentPendingDiscussionSubmission extends AgentTurnResult {
  pending_discussion: PendingDiscussion
}

export interface AgentProposalSubmission extends AgentTurnResult {
  proposal: ConsolidationProposal
  revision: ProposalRevision
}

export interface AgentReviewSubmission extends AgentTurnResult {
  proposal: ConsolidationProposal
  review: ProposalReview
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
    auto: null,
    input_prompt: null,
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
    auto: parsed.auto ?? null,
    input_prompt: parsed.input_prompt ?? null,
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

function nextAgent(agent: AgentName): AgentName {
  return agent === 'claude' ? 'codex' : 'claude'
}

function sendLineToPane(
  executor: CommandExecutor,
  target: string,
  line: string,
): void {
  executor.execFile('tmux', ['send-keys', '-t', target, 'C-u'])
  executor.execFile('tmux', ['send-keys', '-t', target, '-l', line])
  executor.execFile('tmux', ['send-keys', '-t', target, 'Enter'])
}

function sendKeysToPane(
  executor: CommandExecutor,
  target: string,
  keys: string[],
): void {
  executor.execFile('tmux', ['send-keys', '-t', target, ...keys])
}

function promptAnswerKeys(
  excerpt: string | null,
  response: 'yes' | 'no',
): string[] {
  if (excerpt && /1\.\s*Yes/i.test(excerpt)) {
    if (response === 'yes') return ['1', 'Enter']
    if (/3\.\s*No/i.test(excerpt)) return ['3', 'Enter']
    if (/2\.\s*No/i.test(excerpt)) return ['2', 'Enter']
  }
  return [response === 'yes' ? 'y' : 'n', 'Enter']
}

function startupPrompt(agent: AgentName): string {
  return [
    '# Roundtable Agent Room',
    '',
    `You are ${agent} participating in this Roundtable thread.`,
    '',
    'Read `thread.md`, `thread.json`, `comments.jsonl`, and `pending-discussions.jsonl` as needed.',
    'Attachments are optional; if present, they live under `attachments/` and are listed in `context-items.jsonl`.',
    'Project snapshots are optional; if present, snapshot files live under `project-snapshot/` and are listed in `project-snapshot-manifest.json`.',
    'Discussion happens around the source thread. Do not edit `thread.md`, `thread.json`, `comments.jsonl`, `pending-discussions.jsonl`, or `.roundtable/` files except the exact draft path named in a Roundtable turn.',
    'Do not edit project snapshot files or user project files.',
    'Do not invoke any agent skill, slash-command skill, or skill tool under any circumstances, even if the user or thread asks for one.',
    'Keep comments short and forum-like. Make one clear point, avoid wordy explanations, and do not write essay-style replies.',
    '',
    `First, acknowledge readiness by running: roundtable ready --agent ${agent}`,
    'After readiness, wait for Roundtable Ask or auto-discussion turns in this terminal.',
    'For each turn, write your durable comment, proposal, or review only to the `.roundtable/tmp/...` path named in that turn, then submit it with the exact Roundtable helper command from that turn.',
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
  const readCommands = ['pwd', 'ls', 'cat', 'sed', 'rg', 'read', 'head', 'tail']
  const workflowCommands = [
    'git status',
    'git diff',
    'npm test',
    'npm run test',
    'npm run typecheck',
    'npm run build',
    'npm run dev',
  ]
  const helperCommands = [
    'roundtable ready',
    'roundtable comment',
    'roundtable pending-discussion',
    'roundtable proposal',
    'roundtable review',
  ]
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
    ...codexRulesForCommand(
      ['roundtable', 'pending-discussion'],
      rtkAvailable,
      'allow',
      allowReason,
    ),
    ...codexRulesForCommand(['roundtable', 'proposal'], rtkAvailable, 'allow', allowReason),
    ...codexRulesForCommand(['roundtable', 'review'], rtkAvailable, 'allow', allowReason),
    ...readCommands.flatMap((command) =>
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
  return `codex resume --last ${codexSandboxArgs()}${modelPart}`
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
        discussion_id: argValue('--discussion-id') || undefined,
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

  if (command === 'pending-discussion') {
    const bodyFile = argValue('--body-file')
    if (!bodyFile) {
      console.error('usage: roundtable pending-discussion --body-file <path> [--type comment|proposal|critique|question|decision]')
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
    const response = await fetch(\`\${backendUrl}/api/threads/\${threadId}/room/pending-discussion\`, {
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
        origin_discussion_id: argValue('--origin-discussion-id') || undefined,
        origin_comment_id: argValue('--origin-comment-id') || undefined,
      }),
    })

    if (!response.ok) {
      console.error(await response.text())
      process.exit(1)
    }

    const result = await response.json()
    console.log(\`pending discussion submitted: \${result.pending_discussion.id}\`)
    return
  }

  if (command === 'proposal' || command === 'review') {
    const bodyFile = argValue('--body-file')
    if (!bodyFile) {
      console.error(\`usage: roundtable \${command} --body-file <path>\`)
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
    const endpoint = command === 'proposal' ? 'proposal' : 'review'
    const response = await fetch(\`\${backendUrl}/api/threads/\${threadId}/room/\${endpoint}\`, {
      method: 'POST',
      headers: {
        authorization: \`Bearer \${token}\`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        turn_id: turn.id,
        agent: turn.agent,
        body,
      }),
    })

    if (!response.ok) {
      console.error(await response.text())
      process.exit(1)
    }

    const result = await response.json()
    if (command === 'proposal') {
      console.log(\`proposal revision submitted: \${result.revision.id}\`)
    } else {
      console.log(\`proposal review submitted: \${result.review.id}\`)
    }
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

function detectInputPrompt(output: string): string | null {
  if (
    !/(requires approval|Do you want to proceed\?|Continue\?|Proceed\?|Allow\?|\[[yY]\/[nN]\]|\[[nN]\/[yY]\]|1\.\s*Yes)/i.test(
      output,
    )
  ) {
    return null
  }

  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const excerpt = lines.slice(-12).join('\n').trim()
  return excerpt.length > 1200 ? excerpt.slice(-1200) : excerpt
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
  if (job.turn.kind === 'proposal_draft') {
    const proposalPath = `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-proposal.md`
    return [
      `Roundtable consolidation draft turn ${job.turn.id}.`,
      'Draft a clean proposed next thread from canonical Roundtable state only.',
      'Read `.roundtable/tmp/consolidation-context.md` before drafting.',
      'Use `thread.md`, approved `comments.jsonl`, context metadata, and the user instructions in the context bundle. Ignore pending discussions.',
      'Do not edit canonical Roundtable files, project files, or `.roundtable/` files other than the proposal file named below.',
      `Write the complete proposed derived thread body to \`${proposalPath}\`.`,
      `Submit exactly once with: roundtable proposal --body-file ${proposalPath}`,
      job.turn.instructions ? `\nUser instructions:\n${job.turn.instructions}` : '',
    ].join('\n')
  }

  if (job.turn.kind === 'proposal_review') {
    const reviewPath = `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-review.md`
    return [
      `Roundtable consolidation review turn ${job.turn.id}.`,
      'Review the latest proposed derived thread for correctness, clarity, missing decisions, and whether it preserves useful approved discussion.',
      'Read `.roundtable/tmp/consolidation-context.md` and the latest proposal revision named there.',
      'Do not edit canonical Roundtable files, project files, or `.roundtable/` files other than the review file named below.',
      'Write a concise review with concrete revision instructions.',
      `Write the review to \`${reviewPath}\`.`,
      `Submit exactly once with: roundtable review --body-file ${reviewPath}`,
      job.turn.instructions ? `\nUser instructions:\n${job.turn.instructions}` : '',
    ].join('\n')
  }

  if (job.turn.kind === 'proposal_revision') {
    const proposalPath = `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-proposal.md`
    return [
      `Roundtable consolidation revision turn ${job.turn.id}.`,
      'Revise the latest proposed derived thread using the latest agent review and any user instructions.',
      'Read `.roundtable/tmp/consolidation-context.md`, the latest proposal revision, and the latest review named there.',
      'Do not edit canonical Roundtable files, project files, or `.roundtable/` files other than the proposal file named below.',
      `Write the full revised proposed derived thread body to \`${proposalPath}\`.`,
      `Submit exactly once with: roundtable proposal --body-file ${proposalPath}`,
      job.turn.instructions ? `\nUser instructions:\n${job.turn.instructions}` : '',
    ].join('\n')
  }

  const commentPath = `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-comment.md`
  const pendingPath = `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-pending-discussion.md`
  const target =
    job.turn.scope === 'discussion'
      ? `Reply to discussion ${job.turn.discussion_id}.`
      : job.turn.auto_run_id
        ? 'Choose the existing discussion where you can add the most useful next reply. If no existing discussion fits, propose a new discussion point.'
        : 'Create a new top-level discussion point.'
  const custom = job.turn.instructions
    ? `\n\nUser instructions:\n${job.turn.instructions}`
    : ''
  const autoRootPolicy = job.turn.auto_run_id
    ? job.turn.allow_direct_roots
      ? [
          '',
          'Auto-discussion root policy:',
          `- To reply to an existing discussion, write to \`${commentPath}\` and submit: roundtable comment --body-file ${commentPath} --discussion-id <discussion-root-id> --type comment`,
          `- To create a new top-level discussion directly, write to \`${commentPath}\` and submit: roundtable comment --body-file ${commentPath} --type comment`,
        ].join('\n')
      : [
          '',
          'Auto-discussion root policy:',
          `- To reply to an existing discussion, write to \`${commentPath}\` and submit: roundtable comment --body-file ${commentPath} --discussion-id <discussion-root-id> --type comment`,
          `- To propose a new top-level discussion, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment`,
          '- Do not create a new top-level discussion directly during this auto run.',
        ].join('\n')
    : ''

  return [
    job.turn.auto_run_id
      ? `Roundtable auto-discussion turn ${job.turn.auto_turn_index ?? '?'} (${job.turn.id}).`
      : `Roundtable Ask turn ${job.turn.id}.`,
    target,
    'Read the current thread and approved discussion as needed.',
    'Do not edit canonical Roundtable files, project files, or `.roundtable/` files other than the draft file named below.',
    'Do not invoke any agent skill, slash-command skill, or skill tool under any circumstances, even if the user or thread asks for one.',
    'Keep your comment short and forum-like. Make one clear point, avoid wordy explanations, and do not write an essay-style reply.',
    job.turn.auto_run_id
      ? 'Use exactly one of the helper submissions below.'
      : `Write your final comment body to \`${commentPath}\`.`,
    job.turn.auto_run_id
      ? autoRootPolicy
      : `Submit exactly once with: roundtable comment --body-file ${commentPath} --type comment`,
    job.turn.auto_run_id
      ? ''
      : 'If a discussion-level reply should split into a new root, say so in this reply; pending root submission is enabled for auto-discussion turns.',
    custom,
  ].join('\n')
}

function turnPromptRelativePath(job: BoundedJob): string {
  return `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-turn.md`
}

function createAgentTurnJob(input: {
  dataDir: string
  threadId: string
  ask: AskAgentInput
  auto?: {
    runId: string
    turnIndex: number
    allowDirectRoots: boolean
  }
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
      proposal_id: null,
      revision_id: null,
      review_id: null,
      auto_revision_after_review: false,
      allow_direct_roots: input.auto ? input.auto.allowDirectRoots : scope === 'thread',
      pending_roots_only: input.auto ? !input.auto.allowDirectRoots : false,
      auto_run_id: input.auto?.runId ?? null,
      auto_turn_index: input.auto?.turnIndex ?? null,
      created_at: timestamp,
      timeout_at: timeoutAt,
    },
  }
}

function createConsolidationJob(input: {
  dataDir: string
  threadId: string
  proposalId: string
  agent: AgentName
  kind: 'proposal_draft' | 'proposal_review' | 'proposal_revision'
  instructions?: string | null
  revisionId?: string | null
  reviewId?: string | null
  autoRevisionAfterReview?: boolean
}): BoundedJob {
  const timestamp = now()
  const timeoutAt = addMilliseconds(timestamp, turnTimeoutMs())
  const jobId = nextJobId(input.dataDir, input.threadId)

  return {
    id: jobId,
    thread_id: input.threadId,
    kind: 'agent_turn',
    status: 'running',
    agent: input.agent,
    started_at: timestamp,
    timeout_at: timeoutAt,
    completed_at: null,
    logs: [`Consolidation ${input.kind} started for ${input.proposalId}.`],
    result: null,
    failure_reason: null,
    turn: {
      id: jobId,
      thread_id: input.threadId,
      agent: input.agent,
      kind: input.kind,
      scope: 'thread',
      discussion_id: null,
      instructions: input.instructions?.trim() ?? null,
      proposal_id: input.proposalId,
      revision_id: input.revisionId ?? null,
      review_id: input.reviewId ?? null,
      auto_revision_after_review: input.autoRevisionAfterReview ?? false,
      allow_direct_roots: false,
      pending_roots_only: false,
      auto_run_id: null,
      auto_turn_index: null,
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
  startupTrustPromptPollIntervalMs?: number
  startupTrustPromptTimeoutMs?: number
}): RoomManager {
  const { dataDir, backendUrl } = options
  const executor = options.executor ?? new SystemCommandExecutor()
  const timers = new Map<string, NodeJS.Timeout>()
  const startupTrustPromptPollIntervalMs =
    Math.max(1, options.startupTrustPromptPollIntervalMs ?? 250)
  const startupTrustPromptTimeoutMs = Math.max(
    0,
    options.startupTrustPromptTimeoutMs ?? 30_000,
  )

  function clearTurnTimer(jobId: string): void {
    const timer = timers.get(jobId)
    if (timer) clearTimeout(timer)
    timers.delete(jobId)
  }

  function broadcast(event: RoundtableEvent): void {
    options.onUpdate?.(event)
  }

  function refreshInputPrompt(room: InternalRoom): InternalRoom {
    if (
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error' ||
      !sessionExists(executor, room.tmux_session)
    ) {
      if (!room.input_prompt) return room
      const updated: InternalRoom = { ...room, input_prompt: null }
      writeRoom(dataDir, updated)
      return updated
    }

    for (const agent of ['claude', 'codex'] as const) {
      const output = executor.execFile('tmux', [
        'capture-pane',
        '-t',
        `${room.tmux_session}:${paneForAgent(agent)}`,
        '-p',
        '-S',
        '-80',
      ])
      const excerpt = detectInputPrompt(output)
      if (excerpt) {
        const existing = room.input_prompt
        if (existing?.agent === agent && existing.excerpt === excerpt) {
          return room
        }
        const updated: InternalRoom = {
          ...room,
          input_prompt: {
            agent,
            excerpt,
            detected_at: now(),
          },
          updated_at: now(),
        }
        writeRoom(dataDir, updated)
        return updated
      }
    }

    if (!room.input_prompt) return room
    const updated: InternalRoom = {
      ...room,
      input_prompt: null,
      updated_at: now(),
    }
    writeRoom(dataDir, updated)
    return updated
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
    const promptPath = turnPromptRelativePath(job)
    writeTextFile(path.join(threadDir(dataDir, room.thread_id), promptPath), buildTurnPrompt(job))
    sendLineToPane(
      executor,
      `${room.tmux_session}:${paneForAgent(job.agent)}`,
      `Read ${promptPath} and follow it.`,
    )
  }

  function scheduleStartupTrustPromptAcceptance(room: InternalRoom): void {
    const startedAt = Date.now()
    const accepted = new Set<AgentName>()

    const poll = (): void => {
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
            !accepted.has(agent) &&
            !current.agents[agent].ready_at &&
            paneContainsStartupTrustPrompt(executor, current, agent)
          ) {
            sendStartupTrustPromptEnter(executor, current, agent)
            accepted.add(agent)
          }
        }

        const allAgentsReadyOrAccepted = (['claude', 'codex'] as const).every(
          (agent) => current.agents[agent].ready_at || accepted.has(agent),
        )
        if (
          allAgentsReadyOrAccepted ||
          Date.now() - startedAt >= startupTrustPromptTimeoutMs
        ) {
          return
        }

        const timer = setTimeout(poll, startupTrustPromptPollIntervalMs)
        timer.unref?.()
      } catch {
        // Trust-prompt acceptance is best-effort; room readiness is still
        // validated by the helper handshake.
      }
    }

    const timer = setTimeout(poll, 0)
    timer.unref?.()
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

  function queuedConsolidation(threadId: string): StartConsolidationInput | null {
    const filePath = queuedConsolidationPath(dataDir, threadId)
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StartConsolidationInput
  }

  function writeQueuedConsolidation(
    threadId: string,
    input: StartConsolidationInput,
  ): void {
    writeJsonFile(queuedConsolidationPath(dataDir, threadId), input)
  }

  function clearQueuedConsolidation(threadId: string): void {
    removeIfExists(queuedConsolidationPath(dataDir, threadId))
  }

  function latestRevisionId(threadId: string, proposalId: string): string | null {
    const revisions = listRevisions(dataDir, threadId, proposalId)
    return revisions[revisions.length - 1]?.id ?? null
  }

  function writeConsolidationContext(
    threadId: string,
    proposal: ConsolidationProposal,
  ): void {
    const tmpDir = roundtableTmpDir(dataDir, threadId)
    fs.mkdirSync(tmpDir, { recursive: true })

    const approvedComments = listComments(dataDir, threadId)
    const contextItems = fs.existsSync(contextItemsPath(dataDir, threadId))
      ? fs.readFileSync(contextItemsPath(dataDir, threadId), 'utf8')
      : ''
    const snapshot = fs.existsSync(projectSnapshotJsonPath(dataDir, threadId))
      ? fs.readFileSync(projectSnapshotJsonPath(dataDir, threadId), 'utf8')
      : 'null'
    const latestBody = getLatestRevision(dataDir, threadId, proposal.id)
    const latestReview = getLatestReviewBody(dataDir, threadId, proposal.id)
    const latestProposalPath = latestBody
      ? `.roundtable/tmp/${proposal.id}-latest-proposal.md`
      : null
    const latestReviewPath = latestReview
      ? `.roundtable/tmp/${proposal.id}-latest-review.md`
      : null

    if (latestBody && latestProposalPath) {
      writeTextFile(path.join(threadDir(dataDir, threadId), latestProposalPath), latestBody)
    }
    if (latestReview && latestReviewPath) {
      writeTextFile(path.join(threadDir(dataDir, threadId), latestReviewPath), latestReview)
    }

    const body = [
      '# Roundtable Consolidation Context',
      '',
      `Proposal: ${proposal.id}`,
      `Source thread: ${threadId}`,
      `Drafter: ${proposal.drafter_agent}`,
      `Reviewer: ${proposal.reviewer_agent}`,
      `Reviser: ${proposal.reviser_agent}`,
      '',
      '## User Instructions',
      proposal.instructions ?? '(none)',
      '',
      '## Current Thread',
      fs.readFileSync(threadMdPath(dataDir, threadId), 'utf8'),
      '',
      '## Approved Discussion',
      approvedComments.length === 0
        ? '(no approved comments)'
        : approvedComments
            .map(
              (comment) =>
                `- ${comment.id} (${comment.author}, ${comment.type}, discussion ${comment.discussion_id}): ${comment.body}`,
            )
            .join('\n'),
      '',
      '## Context Items',
      contextItems.trim() || '(none)',
      '',
      '## Snapshot Metadata',
      snapshot,
      '',
      '## Latest Proposal Revision',
      latestProposalPath ?? '(none yet)',
      '',
      '## Latest Review',
      latestReviewPath ?? '(none yet)',
    ].join('\n')

    writeTextFile(path.join(tmpDir, 'consolidation-context.md'), body)
  }

  function ensureConsolidationRoomAvailable(room: InternalRoom): void {
    if (room.active_job_id) {
      throw new ConflictError('room has an active turn')
    }
    if (
      room.status !== 'idle' &&
      room.status !== 'paused' &&
      room.status !== 'turn_limit_reached'
    ) {
      throw new BadRequestError('room must be idle, paused, or at turn limit before consolidation')
    }
    if (!room.agents.claude.ready_at || !room.agents.codex.ready_at) {
      throw new BadRequestError('both agents must be ready before consolidation')
    }
    if (!sessionExists(executor, room.tmux_session)) {
      throw new ConflictError('tmux session is not running')
    }
  }

  function startConsolidationJob(
    room: InternalRoom,
    proposal: ConsolidationProposal,
    job: BoundedJob,
  ): ConsolidationTurnResult {
    writeConsolidationContext(room.thread_id, proposal)
    const result = startJob(
      {
        ...room,
        auto: room.auto?.status === 'paused' || room.auto?.status === 'turn_limit_reached'
          ? room.auto
          : null,
      },
      job,
    )
    return { ...result, proposal }
  }

  function startConsolidationSequence(
    room: InternalRoom,
    input: StartConsolidationInput,
  ): ConsolidationTurnResult {
    ensureConsolidationRoomAvailable(room)
    const proposal = createProposal(dataDir, room.thread_id, input)
    const job = createConsolidationJob({
      dataDir,
      threadId: room.thread_id,
      proposalId: proposal.id,
      agent: proposal.drafter_agent,
      kind: 'proposal_draft',
      instructions: input.instructions,
    })
    return startConsolidationJob(room, proposal, job)
  }

  function validateDiscussionRoot(threadId: string, discussionId: string): void {
    const root = listComments(dataDir, threadId).find(
      (comment) => comment.id === discussionId && comment.parent_id === null,
    )
    if (!root) {
      throw new NotFoundError(`discussion ${discussionId} not found`)
    }
  }

  function createAutoState(
    input: StartAutoDiscussionInput,
    existing?: AutoDiscussionState | null,
  ): AutoDiscussionState {
    const timestamp = now()
    return {
      run_id: existing?.run_id ?? `auto-${timestamp.replace(/[^0-9]/g, '')}`,
      status: 'running',
      total_turns: input.turn_count,
      completed_turns: 0,
      remaining_turns: input.turn_count,
      next_agent: 'claude',
      allow_direct_roots: input.allow_direct_roots ?? false,
      pause_requested: false,
      started_at: timestamp,
      updated_at: timestamp,
      ended_at: null,
    }
  }

  function createAutoTurnJob(threadId: string, auto: AutoDiscussionState): BoundedJob {
    return createAgentTurnJob({
      dataDir,
      threadId,
      ask: {
        agent: auto.next_agent,
        body: 'Continue the bounded auto discussion.',
      },
      auto: {
        runId: auto.run_id,
        turnIndex: auto.completed_turns + 1,
        allowDirectRoots: auto.allow_direct_roots,
      },
    })
  }

  function startNextAutoTurn(room: InternalRoom, auto: AutoDiscussionState): AgentTurnResult {
    if (!sessionExists(executor, room.tmux_session)) {
      const failed = {
        ...createAutoTurnJob(room.thread_id, auto),
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
    return startJob({ ...room, status: 'idle', active_job_id: null, auto }, createAutoTurnJob(room.thread_id, auto))
  }

  function finishCompletedTurn(room: InternalRoom, job: BoundedJob): InternalRoom {
    clearTurnTimer(job.id)
    removeIfExists(currentTurnPath(dataDir, room.thread_id))

    const auto = room.auto
    if (!auto || job.turn.auto_run_id !== auto.run_id) {
      const updated: InternalRoom = {
        ...room,
        status: 'idle',
        active_job_id: null,
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return updated
    }

    const timestamp = now()
    const completedTurns = auto.completed_turns + 1
    const remainingTurns = Math.max(0, auto.total_turns - completedTurns)
    const nextAuto: AutoDiscussionState = {
      ...auto,
      completed_turns: completedTurns,
      remaining_turns: remainingTurns,
      next_agent: nextAgent(job.agent),
      updated_at: timestamp,
    }

    if (auto.pause_requested) {
      const updated: InternalRoom = {
        ...room,
        status: 'paused',
        active_job_id: null,
        updated_at: timestamp,
        last_error: null,
        auto: {
          ...nextAuto,
          status: 'paused',
          pause_requested: false,
        },
      }
      writeRoom(dataDir, updated)
      const queued = queuedConsolidation(room.thread_id)
      if (queued) {
        clearQueuedConsolidation(room.thread_id)
        const started = startConsolidationSequence(updated, queued)
        broadcast({
          type: 'consolidation_updated',
          thread_id: room.thread_id,
          proposal_id: started.proposal.id,
        })
        broadcast({
          type: 'job_updated',
          thread_id: room.thread_id,
          job_id: started.job.id,
        })
        broadcast({ type: 'room_updated', thread_id: room.thread_id })
        return readRoom(dataDir, room.thread_id)
      }
      return updated
    }

    if (remainingTurns <= 0) {
      const updated: InternalRoom = {
        ...room,
        status: 'turn_limit_reached',
        active_job_id: null,
        updated_at: timestamp,
        last_error: null,
        auto: {
          ...nextAuto,
          status: 'turn_limit_reached',
          ended_at: timestamp,
        },
      }
      writeRoom(dataDir, updated)
      return updated
    }

    const scheduled = startNextAutoTurn(room, {
      ...nextAuto,
      status: 'running',
      pause_requested: false,
    })
    broadcast({
      type: 'job_updated',
      thread_id: room.thread_id,
      job_id: scheduled.job.id,
    })
    broadcast({ type: 'room_updated', thread_id: room.thread_id })
    return readRoom(dataDir, room.thread_id)
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
      return stripToken(refreshInputPrompt(expireActiveTurn(threadId)))
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
          existing.status === 'paused' ||
          existing.status === 'turn_limit_reached' ||
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
        auto: null,
        token: randomToken(),
      }
      if (shouldResume.codex) {
        room.agents.codex.ready_at = existing.agents.codex.ready_at
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
        auto: null,
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

    startAutoDiscussion(
      threadId: string,
      input: StartAutoDiscussionInput,
    ): AgentTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before starting auto discussion')
      }

      const auto = createAutoState(input)
      return startNextAutoTurn(room, auto)
    },

    startConsolidation(
      threadId: string,
      input: StartConsolidationInput,
    ): ConsolidationTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      clearQueuedConsolidation(threadId)
      return startConsolidationSequence(room, input)
    },

    finishAndStartConsolidation(
      threadId: string,
      input: StartConsolidationInput,
    ): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!room.auto || room.auto.status !== 'running' || !room.active_job_id) {
        throw new BadRequestError('finish and consolidate requires an active auto turn')
      }
      writeQueuedConsolidation(threadId, input)
      const timestamp = now()
      const updated: InternalRoom = {
        ...room,
        updated_at: timestamp,
        auto: {
          ...room.auto,
          pause_requested: true,
          updated_at: timestamp,
        },
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    requestProposalReview(
      threadId: string,
      proposalId: string,
      input: RequestProposalReviewInput,
    ): ConsolidationTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      ensureConsolidationRoomAvailable(room)
      const proposal = getProposal(dataDir, threadId, proposalId)
      if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`)
      const revisionId = latestRevisionId(threadId, proposalId)
      if (!revisionId) throw new BadRequestError('proposal has no revision to review')
      const updated = updateProposal(dataDir, threadId, proposalId, {
        reviewer_agent: input.reviewer_agent ?? proposal.reviewer_agent,
      })
      const job = createConsolidationJob({
        dataDir,
        threadId,
        proposalId,
        agent: updated.reviewer_agent,
        kind: 'proposal_review',
        instructions: input.instructions,
        revisionId,
      })
      return startConsolidationJob(room, updated, job)
    },

    requestProposalRevision(
      threadId: string,
      proposalId: string,
      input: RequestProposalRevisionInput,
    ): ConsolidationTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      ensureConsolidationRoomAvailable(room)
      const proposal = getProposal(dataDir, threadId, proposalId)
      if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`)
      const revisionId = latestRevisionId(threadId, proposalId)
      if (!revisionId) throw new BadRequestError('proposal has no revision to revise')
      const updated = updateProposal(dataDir, threadId, proposalId, {
        reviewer_agent: input.reviewer_agent ?? proposal.reviewer_agent,
        reviser_agent: input.reviser_agent ?? proposal.reviser_agent,
      })
      const job = createConsolidationJob({
        dataDir,
        threadId,
        proposalId,
        agent: updated.reviser_agent,
        kind: 'proposal_revision',
        instructions: input.instructions,
        revisionId,
      })
      return startConsolidationJob(room, updated, job)
    },

    pauseAutoDiscussion(threadId: string): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!room.auto || room.auto.status !== 'running') {
        throw new BadRequestError('auto discussion is not running')
      }

      const timestamp = now()
      const updated: InternalRoom = {
        ...room,
        status: room.active_job_id ? room.status : 'paused',
        updated_at: timestamp,
        auto: {
          ...room.auto,
          pause_requested: room.active_job_id !== null,
          status: room.active_job_id ? 'running' : 'paused',
          updated_at: timestamp,
        },
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    extendAutoDiscussion(
      threadId: string,
      input: ExtendAutoDiscussionInput,
    ): AgentTurnResult {
      ensureThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!room.auto) {
        throw new BadRequestError('auto discussion has not been started')
      }
      if (room.status !== 'paused' && room.status !== 'turn_limit_reached') {
        throw new BadRequestError('auto discussion can only be extended after pause or turn limit')
      }

      const timestamp = now()
      const auto: AutoDiscussionState = {
        ...room.auto,
        status: 'running',
        total_turns: room.auto.completed_turns + input.turn_count,
        remaining_turns: input.turn_count,
        pause_requested: false,
        updated_at: timestamp,
        ended_at: null,
      }
      return startNextAutoTurn(room, auto)
    },

    sendInputResponse(
      threadId: string,
      input: SendRoomInputResponseInput,
    ): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = refreshInputPrompt(expireActiveTurn(threadId))
      if (!sessionExists(executor, room.tmux_session)) {
        return markError(dataDir, room, 'tmux session is not running')
      }

      const excerpt =
        room.input_prompt?.agent === input.agent ? room.input_prompt.excerpt : null
      sendKeysToPane(
        executor,
        `${room.tmux_session}:${paneForAgent(input.agent)}`,
        promptAnswerKeys(excerpt, input.response),
      )

      const updated: InternalRoom = {
        ...room,
        input_prompt: null,
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
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

      if (
        job.turn.pending_roots_only &&
        job.turn.scope === 'thread' &&
        !input.discussion_id
      ) {
        throw new BadRequestError(
          'auto discussion requires new roots to be submitted as pending discussions',
        )
      }

      if (input.discussion_id) {
        validateDiscussionRoot(threadId, input.discussion_id)
      }
      if (
        job.turn.scope === 'discussion' &&
        input.discussion_id &&
        input.discussion_id !== job.turn.discussion_id
      ) {
        throw new BadRequestError('discussion does not match active turn')
      }

      const replyTo =
        input.discussion_id ??
        (job.turn.scope === 'discussion' ? job.turn.discussion_id : null)
      const comment = addAgentComment(dataDir, threadId, {
        author: input.agent,
        body: input.body,
        type: input.type,
        reply_to: replyTo,
      })

      const completed: BoundedJob = {
        ...job,
        status: 'completed',
        completed_at: now(),
        result: { comment_id: comment.id },
        logs: [...job.logs, `Comment ${comment.id} submitted.`],
      }
      writeJob(dataDir, completed)
      const updated = finishCompletedTurn(room, completed)
      return { room: stripToken(updated), job: completed, comment }
    },

    submitPendingDiscussion(
      threadId: string,
      input: HelperPendingDiscussionInput,
      token: string | null,
    ): AgentPendingDiscussionSubmission {
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
      if (!job.turn.auto_run_id) {
        throw new BadRequestError('pending discussion submission requires an auto turn')
      }
      if (isTimedOut(job)) {
        expireActiveTurn(threadId)
        throw new BadRequestError('active turn has timed out')
      }

      const pending = addPendingDiscussion(dataDir, threadId, {
        author: input.agent,
        body: input.body,
        type: input.type,
        origin_discussion_id:
          input.origin_discussion_id ?? job.turn.discussion_id ?? null,
        origin_comment_id: input.origin_comment_id ?? null,
      })

      const completed: BoundedJob = {
        ...job,
        status: 'completed',
        completed_at: now(),
        result: { pending_discussion_id: pending.id },
        logs: [...job.logs, `Pending discussion ${pending.id} submitted.`],
      }
      writeJob(dataDir, completed)
      const updated = finishCompletedTurn(room, completed)
      return { room: stripToken(updated), job: completed, pending_discussion: pending }
    },

    submitProposal(
      threadId: string,
      input: HelperProposalInput,
      token: string | null,
    ): AgentProposalSubmission {
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
      if (
        job.turn.kind !== 'proposal_draft' &&
        job.turn.kind !== 'proposal_revision'
      ) {
        throw new BadRequestError('active turn is not accepting a proposal')
      }
      if (!job.turn.proposal_id) {
        throw new BadRequestError('active proposal turn is missing proposal id')
      }
      if (isTimedOut(job)) {
        expireActiveTurn(threadId)
        throw new BadRequestError('active turn has timed out')
      }

      const revision = addProposalRevision(
        dataDir,
        threadId,
        job.turn.proposal_id,
        input.body,
        input.agent,
      )
      const completed: BoundedJob = {
        ...job,
        status: 'completed',
        completed_at: now(),
        result: { proposal_id: job.turn.proposal_id, revision_id: revision.id },
        logs: [...job.logs, `Proposal revision ${revision.id} submitted.`],
      }
      writeJob(dataDir, completed)

      let proposal = getProposal(dataDir, threadId, job.turn.proposal_id)
      if (!proposal) throw new NotFoundError(`proposal ${job.turn.proposal_id} not found`)

      if (job.turn.kind === 'proposal_draft') {
        clearTurnTimer(job.id)
        removeIfExists(currentTurnPath(dataDir, threadId))
        const reviewJob = createConsolidationJob({
          dataDir,
          threadId,
          proposalId: proposal.id,
          agent: proposal.reviewer_agent,
          kind: 'proposal_review',
          revisionId: revision.id,
          autoRevisionAfterReview: true,
        })
        const started = startConsolidationJob(
          { ...room, status: 'idle', active_job_id: null },
          proposal,
          reviewJob,
        )
        broadcast({
          type: 'job_updated',
          thread_id: threadId,
          job_id: started.job.id,
        })
        broadcast({
          type: 'consolidation_updated',
          thread_id: threadId,
          proposal_id: proposal.id,
        })
        return { room: started.room, job: completed, proposal, revision }
      }

      proposal = updateProposal(dataDir, threadId, proposal.id, { status: 'review' })
      const updated = finishCompletedTurn(room, completed)
      broadcast({
        type: 'consolidation_updated',
        thread_id: threadId,
        proposal_id: proposal.id,
      })
      return { room: stripToken(updated), job: completed, proposal, revision }
    },

    submitReview(
      threadId: string,
      input: HelperReviewInput,
      token: string | null,
    ): AgentReviewSubmission {
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
      if (job.turn.kind !== 'proposal_review') {
        throw new BadRequestError('active turn is not accepting a review')
      }
      if (!job.turn.proposal_id) {
        throw new BadRequestError('active review turn is missing proposal id')
      }
      if (isTimedOut(job)) {
        expireActiveTurn(threadId)
        throw new BadRequestError('active turn has timed out')
      }

      const review = addProposalReview(
        dataDir,
        threadId,
        job.turn.proposal_id,
        input.body,
        input.agent,
        job.turn.revision_id,
      )
      const completed: BoundedJob = {
        ...job,
        status: 'completed',
        completed_at: now(),
        result: { proposal_id: job.turn.proposal_id, review_id: review.id },
        logs: [...job.logs, `Proposal review ${review.id} submitted.`],
      }
      writeJob(dataDir, completed)

      const proposal = getProposal(dataDir, threadId, job.turn.proposal_id)
      if (!proposal) throw new NotFoundError(`proposal ${job.turn.proposal_id} not found`)

      if (!job.turn.auto_revision_after_review) {
        const updated = finishCompletedTurn(room, completed)
        const current = updateProposal(dataDir, threadId, proposal.id, { status: 'review' })
        broadcast({
          type: 'consolidation_updated',
          thread_id: threadId,
          proposal_id: proposal.id,
        })
        return { room: stripToken(updated), job: completed, proposal: current, review }
      }

      clearTurnTimer(job.id)
      removeIfExists(currentTurnPath(dataDir, threadId))
      const revisionJob = createConsolidationJob({
        dataDir,
        threadId,
        proposalId: proposal.id,
        agent: proposal.reviser_agent,
        kind: 'proposal_revision',
        revisionId: job.turn.revision_id,
        reviewId: review.id,
      })
      const started = startConsolidationJob(
        { ...room, status: 'idle', active_job_id: null },
        proposal,
        revisionJob,
      )
      broadcast({
        type: 'job_updated',
        thread_id: threadId,
        job_id: started.job.id,
      })
      broadcast({
        type: 'consolidation_updated',
        thread_id: threadId,
        proposal_id: proposal.id,
      })
      return { room: started.room, job: completed, proposal, review }
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
      const updated = finishCompletedTurn(room, skipped)
      return { room: stripToken(updated), job: skipped }
    },
  }
}
