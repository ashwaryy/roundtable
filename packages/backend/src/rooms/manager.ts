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
  RequestIdleSuggestionInput,
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
  SystemPromptSection,
  ThreadStatus,
  ThreadAgentInvite,
  AgentRuntime,
} from '@roundtable/shared'
import {
  preToolUseHookPath,
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
  threadsDir,
  threadDir,
  threadJsonPath,
  threadMdPath,
  contextItemsPath,
  projectSnapshotJsonPath,
} from '../storage/paths'
import { BadRequestError, ConflictError, NotFoundError } from '../storage/errors'
import { listThreadAgents } from '../storage/agents'
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
  preflight(threadId?: string): RoomPreflight
  getRoom(threadId: string): AgentRoom
  startRoom(threadId: string, input: StartRoomInput): AgentRoom
  syncRoster(threadId: string): AgentRoom
  restartRoom(threadId: string): AgentRoom
  stopRoom(threadId: string): AgentRoom
  nudgeRoom(threadId: string, input: NudgeRoomInput): AgentRoom
  requestIdleSuggestion(threadId: string, input: RequestIdleSuggestionInput): AgentRoom
  cancelIdleSuggestion(threadId: string): AgentRoom
  completeIdleSuggestion(threadId: string, agent: AgentName, token: string | null): AgentRoom
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
  stopAutoDiscussion(threadId: string): AgentRoom
  exitAutoDiscussion(threadId: string): AgentRoom
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

export interface AgentPendingDiscussionSubmission {
  room: AgentRoom
  job?: BoundedJob
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

function threadStatus(dataDir: string, threadId: string): ThreadStatus {
  ensureThread(dataDir, threadId)
  const thread = JSON.parse(fs.readFileSync(threadJsonPath(dataDir, threadId), 'utf8')) as {
    status?: ThreadStatus
  }
  return thread.status ?? 'open'
}

function ensureOpenThread(dataDir: string, threadId: string): void {
  const status = threadStatus(dataDir, threadId)
  if (status !== 'open') {
    throw new BadRequestError(`thread is ${status}; room actions require an open thread`)
  }
}

function defaultRoom(dataDir: string, threadId: string): InternalRoom {
  const timestamp = now()
  const roster = listThreadAgents(dataDir, threadId)
  return {
    thread_id: threadId,
    status: 'not_started',
    tmux_session: tmuxSessionName(threadId),
    attach_command: attachCommand(threadId),
    claude_model: null,
    codex_model: null,
    roster,
    agents: Object.fromEntries(roster.map((agent) => [agent.agent_id, { ready_at: null }])),
    created_at: timestamp,
    updated_at: timestamp,
    started_at: null,
    stopped_at: null,
    last_error: null,
    active_job_id: null,
    auto: null,
    input_prompt: null,
    idle_suggestion_request: null,
    session_state: 'not_started',
    token: '',
  }
}

function readRoom(dataDir: string, threadId: string): InternalRoom {
  const filePath = roomJsonPath(dataDir, threadId)
  if (!fs.existsSync(filePath)) return defaultRoom(dataDir, threadId)
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as InternalRoom
  const roster = parsed.roster ?? listThreadAgents(dataDir, threadId)
  return {
    ...defaultRoom(dataDir, threadId),
    ...parsed,
    roster,
    agents: Object.fromEntries(roster.map((agent) => [
      agent.agent_id,
      parsed.agents?.[agent.agent_id] ?? { ready_at: null },
    ])),
    auto: parsed.auto ?? null,
    input_prompt: parsed.input_prompt ?? null,
    idle_suggestion_request: parsed.idle_suggestion_request ?? null,
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

function cleanupResolvedTurnFiles(dataDir: string, job: BoundedJob): void {
  if (job.status !== 'completed' && job.status !== 'skipped') return
  const dir = roundtableTmpDir(dataDir, job.thread_id)
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith(`${job.turn.id}-`)) {
      fs.rmSync(path.join(dir, file), { force: true })
    }
  }
}

function cleanupStoppedRoomFiles(dataDir: string, threadId: string): void {
  for (const filePath of [
    currentTurnPath(dataDir, threadId),
    queuedConsolidationPath(dataDir, threadId),
    path.join(roundtableTmpDir(dataDir, threadId), 'consolidation-context.md'),
    roundtableHelperPath(dataDir, threadId),
    preToolUseHookPath(dataDir, threadId),
    claudeLocalSettingsPath(dataDir, threadId),
    codexProjectConfigPath(dataDir, threadId),
    codexRulesPath(dataDir, threadId),
  ]) {
    removeIfExists(filePath)
  }
  const internalDir = roundtableInternalDir(dataDir, threadId)
  if (fs.existsSync(internalDir)) {
    for (const file of fs.readdirSync(internalDir)) {
      if (file.endsWith('-startup.md') || /^launch-.*\.sh$/.test(file)) {
        removeIfExists(path.join(internalDir, file))
      }
    }
  }
  fs.rmSync(roundtableTmpDir(dataDir, threadId), { recursive: true, force: true })
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

function windowForAgent(agent: AgentName): string {
  return `agent-${agent.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function nextAgent(room: InternalRoom, agent: AgentName): AgentName {
  const roster = room.roster.map((invite) => invite.agent_id)
  const index = roster.indexOf(agent)
  return roster[(index + 1) % roster.length] ?? roster[0]
}

function inviteFor(room: InternalRoom, agent: AgentName): ThreadAgentInvite {
  const invite = room.roster.find((entry) => entry.agent_id === agent)
  if (!invite) throw new BadRequestError(`agent ${agent} is not in the room roster`)
  return invite
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

const startupExecutionRules = [
  'You run inside a tmux pane. The user may not have this pane attached and may not see terminal narration or interactive prompts.',
  'Use only file operations and commands already permitted for this Roundtable room and the current turn. Do not run shell pipelines, ad hoc scripts, or convenience commands that require additional approval.',
  'Use the built-in Read and Grep tools to inspect room artifacts. If you use Bash for inspection, keep it to one permitted read command such as `grep`; do not pipe results through Python or another interpreter.',
  'Do not wait at an interactive approval prompt for routine turn work. Complete the turn through an allowed Roundtable helper submission.',
]

function repeatedTurnExecutionRules(_agent: AgentName): string[] {
  return [
    'Use only permitted room operations. Avoid shell pipelines, ad hoc scripts, and commands outside the instructed workflow.',
  ]
}

function startupPrompt(invite: ThreadAgentInvite): string {
  return [
    '# Roundtable Agent Room',
    '',
    `You are ${invite.name} participating in this Roundtable thread.`,
    `Your role: ${invite.role_description || 'Roundtable discussion participant'}.`,
    invite.instructions ? `Agent instructions: ${invite.instructions}` : '',
    '',
    'When Roundtable explicitly requests work, read `thread.md`, `thread.json`, `comments.jsonl`, and `pending-discussions.jsonl` as needed.',
    'Attachments are optional; if present, they live under `attachments/` and are listed in `context-items.jsonl`.',
    'Project snapshots are optional; if present, snapshot files live under `project-snapshot/` and are listed in `project-snapshot-manifest.json`.',
    'Discussion happens around the source thread. Do not edit `thread.md`, `thread.json`, `comments.jsonl`, `pending-discussions.jsonl`, or `.roundtable/` files except draft files under `.roundtable/tmp/` permitted by a Roundtable request.',
    'Do not edit project snapshot files or user project files.',
    ...startupExecutionRules,
    'Do not invoke any agent skill, slash-command skill, or skill tool under any circumstances, even if the user or thread asks for one.',
    'Keep comments short and forum-like. Make one clear point, avoid wordy explanations, and do not write essay-style replies.',
    '',
    `First, run this readiness command now for this room launch: roundtable ready --agent ${invite.agent_id}`,
    'Run the readiness command on every launch or resumed CLI process, even if prior transcript context says it already succeeded. A prior launch acknowledgment does not apply to this room process.',
    'After readiness, wait. Do not inspect the thread, draft output, or submit anything until Roundtable sends an explicit request in this terminal.',
    'For each turn, write durable output only under `.roundtable/tmp/`, then submit it with a Roundtable helper command from that turn.',
    'If a turn permits multiple pending discussions, write each pending body to its own `.roundtable/tmp/...` file and pass that file directly to `roundtable pending-discussion`; do not copy or rename draft files before submission.',
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

function writePreToolUseHook(
  dataDir: string,
  threadId: string,
  allowedCommands: string[],
): string {
  const hookPath = preToolUseHookPath(dataDir, threadId)
  fs.mkdirSync(path.dirname(hookPath), { recursive: true })
  writeExecutable(
    hookPath,
    `#!/usr/bin/env node
const fs = require('node:fs')

const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const command = String(input.tool_input?.command ?? '').trim()
const allowedPrefixes = ${JSON.stringify(allowedCommands)}
const shellOperators = /(?:\\r|\\n|&&|\\|\\||[|;&<>\\\`]|\\$\\()/

function decision(permissionDecision, permissionDecisionReason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
    },
  }))
}

if (shellOperators.test(command)) {
  decision('deny', 'Roundtable permits only single approved shell commands. Use Read or Grep directly; do not pipe through Python or another interpreter.')
} else if (
  allowedPrefixes.some((prefix) => command === prefix || command.startsWith(prefix + ' '))
) {
  process.exit(0)
} else {
  decision('deny', 'This shell command is outside the Roundtable room allowlist. Use Read or Grep directly, or an instructed Roundtable helper command.')
}
`,
  )
  return hookPath
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

function claudeLocalSettings(hookPath: string, rtkAvailable: boolean): unknown {
  const readCommands = ['pwd', 'ls', 'cat', 'grep', 'sed', 'rg', 'read', 'head', 'tail']
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
    'roundtable done',
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

  return {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    permissions: {
      defaultMode: 'dontAsk',
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
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: hookPath,
              args: [],
              timeout: 5,
            },
          ],
        },
      ],
    },
  }
}

function codexProjectConfig(hookPath: string): string {
  return `approval_policy = "never"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true

[features.network_proxy]
enabled = true
domains = { "localhost" = "allow", "127.0.0.1" = "allow" }

[hooks]
PreToolUse = [{ matcher = "Bash", hooks = [{ type = "command", command = ${JSON.stringify(hookPath)}, timeout = 5 }] }]
`
}

function codexRulesText(rtkAvailable: boolean): string {
  const readCommands = ['pwd', 'ls', 'cat', 'grep', 'sed', 'rg', 'read', 'head', 'tail']
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
  return `${codexRules.join('\n')}\n`
}

function writeAgentPermissionSetup(
  dataDir: string,
  threadId: string,
  rtkAvailable: boolean,
): void {
  const readCommands = ['pwd', 'ls', 'cat', 'grep', 'sed', 'rg', 'read', 'head', 'tail']
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
    'roundtable done',
    'roundtable proposal',
    'roundtable review',
  ]
  const allowedBashCommands = [
    ...readCommands,
    ...workflowCommands,
    ...helperCommands,
  ].flatMap((command) => commandVariants(command, rtkAvailable))
  const hookPath = writePreToolUseHook(dataDir, threadId, allowedBashCommands)

  writeJsonFile(claudeLocalSettingsPath(dataDir, threadId), claudeLocalSettings(hookPath, rtkAvailable))

  writeTextFile(codexProjectConfigPath(dataDir, threadId), codexProjectConfig(hookPath))
  writeTextFile(codexRulesPath(dataDir, threadId), codexRulesText(rtkAvailable))
}

function codexSandboxArgs(): string {
  return [
    '--sandbox workspace-write',
    '--ask-for-approval never',
    '--dangerously-bypass-hook-trust',
    `-c ${shellSingleQuote('sandbox_workspace_write.network_access=true')}`,
    `-c ${shellSingleQuote('features.network_proxy.enabled=true')}`,
    `-c ${shellSingleQuote(
      'features.network_proxy.domains={ "localhost" = "allow", "127.0.0.1" = "allow" }',
    )}`,
  ].join(' ')
}

function cliCommand(runtime: AgentRuntime, model: string | null, effort: string | null, promptFile: string): string {
  const modelPart = model ? ` --model ${shellSingleQuote(model)}` : ''
  const effortPart = effort ? ` --effort ${shellSingleQuote(effort)}` : ''
  if (runtime === 'claude') {
    return `claude --permission-mode dontAsk${modelPart}${effortPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
  }
  const codexEffort = effort ? ` -c ${shellSingleQuote(`model_reasoning_effort="${effort}"`)}` : ''
  return `codex ${codexSandboxArgs()}${modelPart}${codexEffort} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
}

function resumeCliCommand(
  runtime: AgentRuntime,
  model: string | null,
  effort: string | null,
  promptFile: string,
): string {
  const modelPart = model ? ` --model ${shellSingleQuote(model)}` : ''
  const effortPart = effort ? ` --effort ${shellSingleQuote(effort)}` : ''
  if (runtime === 'claude') {
    return `claude --continue --permission-mode dontAsk${modelPart}${effortPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
  }
  const codexEffort = effort ? ` -c ${shellSingleQuote(`model_reasoning_effort="${effort}"`)}` : ''
  return `codex resume --last ${codexSandboxArgs()}${modelPart}${codexEffort}`
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
    if (!agent) {
      console.error('usage: roundtable ready --agent <agent-id>')
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
      console.error('usage: roundtable pending-discussion --body-file <path> [--type comment|proposal|critique|question|decision] [--continue-turn]')
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
    const turn = fs.existsSync(turnPath) ? JSON.parse(fs.readFileSync(turnPath, 'utf8')) : null
    const agent = turn?.agent || process.env.ROUNDTABLE_AGENT_ID
    if (!agent) {
      console.error('pending discussion requires an active turn or room agent identity')
      process.exit(2)
    }
    const response = await fetch(\`\${backendUrl}/api/threads/\${threadId}/room/pending-discussion\`, {
      method: 'POST',
      headers: {
        authorization: \`Bearer \${token}\`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        turn_id: turn?.id,
        agent,
        body,
        type: argValue('--type') || undefined,
        origin_discussion_id: argValue('--origin-discussion-id') || undefined,
        origin_comment_id: argValue('--origin-comment-id') || undefined,
        continue_turn: args.includes('--continue-turn'),
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

  if (command === 'done') {
    const agent = process.env.ROUNDTABLE_AGENT_ID
    if (!agent) {
      console.error('done requires room agent identity')
      process.exit(2)
    }

    const response = await fetch(\`\${backendUrl}/api/threads/\${threadId}/room/suggestion-request/done\`, {
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

    console.log('suggestions done')
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

  for (const invite of room.roster) {
    const agent = invite.agent_id
    const promptFile = roomPromptPath(dataDir, room.thread_id, agent)
    fs.writeFileSync(promptFile, startupPrompt(invite))
    const command = shouldResume[agent]
      ? resumeCliCommand(invite.runtime, invite.model, invite.effort, promptFile)
      : cliCommand(invite.runtime, invite.model, invite.effort, promptFile)
    writeExecutable(
      path.join(roundtableInternalDir(dataDir, room.thread_id), `launch-${agent}.sh`),
      `#!/bin/sh
export PATH=${shellSingleQuote(`${binDir}:${process.env.PATH ?? ''}`)}
export ROUNDTABLE_THREAD_ID=${shellSingleQuote(room.thread_id)}
export ROUNDTABLE_BACKEND_URL=${shellSingleQuote(backendUrl)}
export ROUNDTABLE_ROOM_TOKEN=${shellSingleQuote(room.token)}
export ROUNDTABLE_AGENT_ID=${shellSingleQuote(agent)}
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

function sendStartupPromptKeys(
  executor: CommandExecutor,
  room: InternalRoom,
  agent: AgentName,
  keys: string[],
): void {
  executor.execFile('tmux', [
    'send-keys',
    '-t',
    `${room.tmux_session}:${windowForAgent(agent)}`,
    ...keys,
  ])
}

function startupPromptAcceptanceKeys(
  executor: CommandExecutor,
  room: InternalRoom,
  agent: AgentName,
): string[] | null {
  const output = executor.execFile('tmux', [
    'capture-pane',
    '-t',
    `${room.tmux_session}:${windowForAgent(agent)}`,
    '-p',
    '-S',
    '-80',
  ])
  if (/Hooks need review[\s\S]*Trust all and continue/i.test(output)) {
    if (/Press enter to confirm or esc to go back/i.test(output)) {
      return ['Down', 'C-m']
    }
    return ['2', 'Enter']
  }
  if (
    /Do you trust|Quick safety check|Yes, I trust this folder|Yes, continue/i.test(
      output,
    )
  ) {
    return ['C-m']
  }
  return null
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
    session_state: message.includes('tmux session') ? 'missing' : room.session_state,
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
      ...repeatedTurnExecutionRules(job.turn.agent),
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
      ...repeatedTurnExecutionRules(job.turn.agent),
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
      ...repeatedTurnExecutionRules(job.turn.agent),
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
          `- To queue a proposed top-level discussion for approval and continue this turn, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment --continue-turn`,
          `- To submit a final proposed top-level discussion for approval and end this turn, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment`,
        ].join('\n')
      : [
          '',
          'Auto-discussion root policy:',
          `- To reply to an existing discussion, write to \`${commentPath}\` and submit: roundtable comment --body-file ${commentPath} --discussion-id <discussion-root-id> --type comment`,
          `- To queue a new top-level discussion and continue this turn, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment --continue-turn`,
          `- To submit the final new top-level discussion and end this turn, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment`,
          '- Do not create a new top-level discussion directly during this auto run.',
        ].join('\n')
    : ''
  const discussionAskPolicy =
    !job.turn.auto_run_id && job.turn.scope === 'discussion'
      ? [
          '',
          'Discussion-level Ask policy:',
          `- To reply in the current discussion, write to \`${commentPath}\` and submit: roundtable comment --body-file ${commentPath} --type comment`,
          `- To queue a split into a new top-level discussion and continue this turn, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment --origin-discussion-id ${job.turn.discussion_id} --continue-turn`,
          `- To submit a final split and end this turn, write to \`${pendingPath}\` and submit: roundtable pending-discussion --body-file ${pendingPath} --type comment --origin-discussion-id ${job.turn.discussion_id}`,
        ].join('\n')
      : ''
  const offersSubmissionChoice =
    Boolean(job.turn.auto_run_id) || discussionAskPolicy.length > 0
  const multiPendingGuidance = offersSubmissionChoice
    ? [
        'For multiple pending splits, write each body to a distinct Markdown file under `.roundtable/tmp/` and replace the suggested `--body-file` path with that file path.',
        'Submit each helper command separately. Do not use `cp`, `mv`, shell redirection, or chained shell commands to prepare or submit draft files.',
      ].join('\n')
    : ''

  return [
    job.turn.auto_run_id
      ? `Roundtable auto-discussion turn ${job.turn.auto_turn_index ?? '?'} (${job.turn.id}).`
      : `Roundtable Ask turn ${job.turn.id}.`,
    target,
    'Read the current thread and approved discussion as needed.',
    'Do not edit canonical Roundtable files or project files. Write only the Markdown draft files under `.roundtable/tmp/` required for the submissions below.',
    ...repeatedTurnExecutionRules(job.turn.agent),
    'Keep your comment short and forum-like. Make one clear point, avoid wordy explanations, and do not write an essay-style reply.',
    offersSubmissionChoice
      ? 'Queue zero or more pending splits, then use exactly one terminal helper submission below.'
      : `Write your final comment body to \`${commentPath}\`.`,
    job.turn.auto_run_id
      ? autoRootPolicy
      : discussionAskPolicy ||
        `Submit exactly once with: roundtable comment --body-file ${commentPath} --type comment`,
    multiPendingGuidance,
    custom,
  ].join('\n')
}

function turnPromptRelativePath(job: BoundedJob): string {
  return `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-turn.md`
}

function sampleJob(
  id: string,
  kind: BoundedJob['turn']['kind'],
  overrides: Partial<BoundedJob['turn']> = {},
): BoundedJob {
  const timestamp = '2026-01-01T00:00:00.000Z'
  const turn: BoundedJob['turn'] = {
    id,
    thread_id: 'thread-1',
    agent: 'codex',
    kind,
    scope: 'thread',
    discussion_id: null,
    instructions: null,
    proposal_id: kind.startsWith('proposal') ? 'consolidation-1' : null,
    revision_id: kind === 'proposal_review' || kind === 'proposal_revision' ? 'rev-1' : null,
    review_id: kind === 'proposal_revision' ? 'review-1' : null,
    auto_revision_after_review: false,
    allow_direct_roots: false,
    pending_roots_only: false,
    auto_run_id: null,
    auto_turn_index: null,
    created_at: timestamp,
    timeout_at: timestamp,
    ...overrides,
  }
  return {
    id,
    thread_id: 'thread-1',
    kind: 'agent_turn',
    status: 'running',
    agent: turn.agent,
    started_at: timestamp,
    timeout_at: timestamp,
    completed_at: null,
    logs: [],
    result: null,
    failure_reason: null,
    turn,
  }
}

export function systemPromptSections(): SystemPromptSection[] {
  const sampleInvite: ThreadAgentInvite = {
    agent_id: 'agent-example',
    name: 'Example Agent',
    runtime: 'codex',
    role_description: 'Roundtable discussion participant',
    instructions: 'Example configured agent instructions appear here.',
    model: null,
    effort: null,
    color: 'teal',
    logo_url: null,
    order: 0,
  }
  const promptFile = '.roundtable/agent-example-prompt.md'
  const hookPath = '.roundtable/pretooluse-hook.js'

  return [
    {
      id: 'startup-common',
      title: 'Startup Prompt',
      runtime: 'common',
      kind: 'startup_prompt',
      used_by: 'Written once per invited agent during room launch, then passed to Claude or Codex as `Read {promptFile} and follow it.`',
      source: 'packages/backend/src/rooms/manager.ts:startupPrompt()',
      notes: [
        'This is shared by both runtimes.',
        'Configured agent instructions are injected in this prompt as `Agent instructions: ...`.',
      ],
      content: startupPrompt(sampleInvite),
    },
    {
      id: 'turn-comment',
      title: 'Ask / Comment Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by: 'Written to `.roundtable/tmp/{job}-{agent}-turn.md` for Ask, discussion reply, and auto-discussion turns.',
      source: 'packages/backend/src/rooms/manager.ts:buildTurnPrompt()',
      notes: ['The live prompt varies by discussion scope, auto-run policy, and user turn instructions.'],
      content: buildTurnPrompt(sampleJob('job-001', 'comment')),
    },
    {
      id: 'turn-proposal-draft',
      title: 'Consolidation Draft Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by: 'Written when Roundtable asks an agent to draft a proposed next thread.',
      source: 'packages/backend/src/rooms/manager.ts:buildTurnPrompt()',
      notes: ['Uses `.roundtable/tmp/consolidation-context.md` and submits with `roundtable proposal`.'],
      content: buildTurnPrompt(sampleJob('job-002', 'proposal_draft')),
    },
    {
      id: 'turn-proposal-review',
      title: 'Consolidation Review Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by: 'Written when Roundtable asks an agent to review a proposed derived thread.',
      source: 'packages/backend/src/rooms/manager.ts:buildTurnPrompt()',
      notes: ['Submits with `roundtable review`.'],
      content: buildTurnPrompt(sampleJob('job-003', 'proposal_review')),
    },
    {
      id: 'turn-proposal-revision',
      title: 'Consolidation Revision Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by: 'Written when Roundtable asks an agent to revise the proposed derived thread.',
      source: 'packages/backend/src/rooms/manager.ts:buildTurnPrompt()',
      notes: ['Submits the revised body with `roundtable proposal`.'],
      content: buildTurnPrompt(sampleJob('job-004', 'proposal_revision')),
    },
    {
      id: 'claude-launch',
      title: 'Claude Launch Command',
      runtime: 'claude',
      kind: 'launch_command',
      used_by: 'Written into the generated launch script for Claude runtime agents.',
      source: 'packages/backend/src/rooms/manager.ts:cliCommand()',
      notes: ['The prompt content is not embedded directly; Claude is told to read the generated prompt file.'],
      content: cliCommand('claude', '<model-if-configured>', '<effort-if-configured>', promptFile),
    },
    {
      id: 'claude-settings',
      title: 'Claude Local Settings',
      runtime: 'claude',
      kind: 'runtime_config',
      used_by: 'Written to `.claude/settings.local.json` inside each thread workspace.',
      source: 'packages/backend/src/rooms/manager.ts:claudeLocalSettings()',
      notes: ['Controls Claude tool permissions and installs the shared Bash PreToolUse hook.'],
      content: JSON.stringify(claudeLocalSettings(hookPath, true), null, 2),
    },
    {
      id: 'codex-launch',
      title: 'Codex Launch Command',
      runtime: 'codex',
      kind: 'launch_command',
      used_by: 'Written into the generated launch script for Codex runtime agents.',
      source: 'packages/backend/src/rooms/manager.ts:cliCommand()',
      notes: ['The prompt content is not embedded directly; Codex is told to read the generated prompt file.'],
      content: cliCommand('codex', '<model-if-configured>', '<effort-if-configured>', promptFile),
    },
    {
      id: 'codex-config',
      title: 'Codex Project Config',
      runtime: 'codex',
      kind: 'runtime_config',
      used_by: 'Written to `.codex/config.toml` inside each thread workspace.',
      source: 'packages/backend/src/rooms/manager.ts:codexProjectConfig()',
      notes: ['Sets workspace-write sandboxing, disables approvals, allows localhost network proxy, and installs the shared Bash PreToolUse hook.'],
      content: codexProjectConfig(hookPath),
    },
    {
      id: 'codex-rules',
      title: 'Codex Rules',
      runtime: 'codex',
      kind: 'runtime_rules',
      used_by: 'Written to `.codex/rules/default.rules` inside each thread workspace.',
      source: 'packages/backend/src/rooms/manager.ts:codexRulesText()',
      notes: ['Shows the rtk-enabled variant; rooms without rtk omit the mirrored `rtk ...` prefix rules.'],
      content: codexRulesText(true),
    },
  ]
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
  beforeCanonicalWrite?: (threadId: string) => void
  onCanonicalWrite?: (threadId: string) => void
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

    for (const { agent_id: agent } of room.roster) {
      const output = executor.execFile('tmux', [
        'capture-pane',
        '-t',
        `${room.tmux_session}:${windowForAgent(agent)}`,
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
      `${room.tmux_session}:${windowForAgent(job.agent)}`,
      `Read ${promptPath} and follow it.`,
    )
  }

  function scheduleStartupTrustPromptAcceptance(room: InternalRoom): void {
    const startedAt = Date.now()
    const accepted = new Set<AgentName>()
    const pendingPromptKeys = new Map<AgentName, string>()

    const poll = (): void => {
      try {
        const current = readRoom(dataDir, room.thread_id)
        if (
          current.status !== 'starting' ||
          !sessionExists(executor, current.tmux_session)
        ) {
          return
        }

        for (const { agent_id: agent } of current.roster) {
          const promptKeys =
            !accepted.has(agent) && !current.agents[agent].ready_at
              ? startupPromptAcceptanceKeys(executor, current, agent)
              : null
          if (!promptKeys) {
            // No prompt this poll: reset so a later prompt must settle again.
            pendingPromptKeys.delete(agent)
            continue
          }
          // Require the same prompt on two consecutive polls before sending, so
          // keys never land before the prompt's input handler has attached.
          const signature = promptKeys.join(' ')
          if (pendingPromptKeys.get(agent) === signature) {
            sendStartupPromptKeys(executor, current, agent, promptKeys)
            accepted.add(agent)
            pendingPromptKeys.delete(agent)
          } else {
            pendingPromptKeys.set(agent, signature)
          }
        }

        const allAgentsReadyOrAccepted = current.roster.every(
          ({ agent_id: agent }) => current.agents[agent].ready_at || accepted.has(agent),
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
      idle_suggestion_request: null,
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
    if (!room.roster.every(({ agent_id }) => room.agents[agent_id]?.ready_at)) {
      throw new BadRequestError('all room agents must be ready before consolidation')
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
    const first = room.roster[0].agent_id
    const second = room.roster[1]?.agent_id ?? first
    const resolved: StartConsolidationInput = {
      ...input,
      drafter_agent: input.drafter_agent ?? second,
      reviewer_agent: input.reviewer_agent ?? first,
      reviser_agent: input.reviser_agent ?? second,
    }
    for (const agent of [resolved.drafter_agent, resolved.reviewer_agent, resolved.reviser_agent]) {
      inviteFor(room, agent!)
    }
    options.beforeCanonicalWrite?.(room.thread_id)
    const proposal = createProposal(dataDir, room.thread_id, resolved)
    options.onCanonicalWrite?.(room.thread_id)
    const job = createConsolidationJob({
      dataDir,
      threadId: room.thread_id,
      proposalId: proposal.id,
      agent: proposal.drafter_agent,
      kind: 'proposal_draft',
      instructions: resolved.instructions,
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
    threadId: string,
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
      next_agent: readRoom(dataDir, threadId).roster[0]?.agent_id ?? 'claude',
      allow_direct_roots: input.allow_direct_roots ?? false,
      pause_requested: false,
      stop_requested: false,
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
    cleanupResolvedTurnFiles(dataDir, job)

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
      next_agent: nextAgent(room, job.agent),
      updated_at: timestamp,
    }

    if (auto.stop_requested) {
      const updated: InternalRoom = {
        ...room,
        status: 'idle',
        active_job_id: null,
        updated_at: timestamp,
        last_error: null,
        auto: null,
      }
      writeRoom(dataDir, updated)
      return updated
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
          stop_requested: false,
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
      stop_requested: false,
    })
    broadcast({
      type: 'job_updated',
      thread_id: room.thread_id,
      job_id: scheduled.job.id,
    })
    broadcast({ type: 'room_updated', thread_id: room.thread_id })
    return readRoom(dataDir, room.thread_id)
  }

  function reconcileRoom(threadId: string, startup = false): InternalRoom {
    const room = readRoom(dataDir, threadId)
    const roomFileExists = fs.existsSync(roomJsonPath(dataDir, threadId))
    const live = sessionExists(executor, room.tmux_session)
    const status = threadStatus(dataDir, threadId)
    if ((status === 'closed' || status === 'archived') && live) {
      executor.execFile('tmux', ['kill-session', '-t', room.tmux_session])
      const stopped = {
        ...room,
        status: 'stopped' as const,
        session_state: 'stopped' as const,
        stopped_at: now(),
        updated_at: now(),
        active_job_id: null,
        auto: null,
      }
      writeRoom(dataDir, stopped)
      cleanupStoppedRoomFiles(dataDir, threadId)
      return stopped
    }
    if (!roomFileExists && live) {
      const untracked: InternalRoom = {
        ...room,
        status: 'needs_attention',
        session_state: 'untracked',
        last_error: 'An untracked tmux session exists; stop it before restarting the room.',
        updated_at: now(),
      }
      writeRoom(dataDir, untracked)
      return untracked
    }
    if (!roomFileExists) return room
    if (live && room.session_state === 'untracked') return room
    if (live) {
      const recovered: InternalRoom = {
        ...room,
        session_state:
          startup
            ? 'recovered'
            : room.session_state === 'connected' || room.session_state === 'recovered'
            ? room.session_state
            : 'recovered',
        updated_at: now(),
      }
      const active = recovered.active_job_id
        ? getJob(dataDir, threadId, recovered.active_job_id)
        : null
      if (active?.status === 'running') scheduleTimeout(active)
      writeRoom(dataDir, recovered)
      return recovered
    }
    if (
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.session_state === 'stopped'
    ) {
      return room
    }
    const active = room.active_job_id ? getJob(dataDir, threadId, room.active_job_id) : null
    if (active?.status === 'running') {
      writeJob(dataDir, {
        ...active,
        status: 'failed',
        completed_at: now(),
        failure_reason: 'tmux session disappeared while the turn was running',
        logs: [...active.logs, 'Room session missing after backend restart.'],
      })
    }
    const missing: InternalRoom = {
      ...room,
      status: room.active_job_id ? 'needs_attention' : 'error',
      session_state: 'missing',
      updated_at: now(),
      last_error: room.active_job_id
        ? 'Room session is missing; restart the room, then retry or skip the interrupted turn.'
        : 'Room session is missing; restart the room to continue.',
    }
    writeRoom(dataDir, missing)
    return missing
  }

  function reconcilePersistedRooms(): void {
    const dir = threadsDir(dataDir)
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !fs.existsSync(threadJsonPath(dataDir, entry.name))) continue
      reconcileRoom(entry.name, true)
    }
  }

  const manager: RoomManager = {
    preflight(threadId?: string): RoomPreflight {
      const tools = {
        tmux: toolPreflight(executor, 'tmux'),
        claude: toolPreflight(executor, 'claude'),
        codex: toolPreflight(executor, 'codex'),
      }
      const required = threadId
        ? new Set(['tmux', ...listThreadAgents(dataDir, threadId).map((invite) => invite.runtime)])
        : new Set(Object.keys(tools))
      return {
        ok: Object.values(tools).every((tool) => !required.has(tool.name) || tool.available),
        tools,
      }
    },

    getRoom(threadId: string): AgentRoom {
      ensureThread(dataDir, threadId)
      const reconciled = reconcileRoom(threadId)
      if (reconciled.session_state === 'missing' || reconciled.session_state === 'untracked') {
        return stripToken(reconciled)
      }
      return stripToken(refreshInputPrompt(expireActiveTurn(threadId)))
    },

    startRoom(threadId: string, input: StartRoomInput): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const roster = listThreadAgents(dataDir, threadId).map((invite) => ({
        ...invite,
        model: invite.agent_id === 'claude'
          ? normalizeModel(input.claude_model) ?? invite.model
          : invite.agent_id === 'codex'
            ? normalizeModel(input.codex_model) ?? invite.model
            : invite.model,
      }))
      const requiredTools = ['tmux', ...new Set(roster.map((invite) => invite.runtime))]
      const missing = requiredTools.filter((tool) => !toolAvailable(executor, tool))
      if (missing.length > 0) {
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
      const shouldResume: Record<AgentName, boolean> = Object.fromEntries(
        roster.map((invite) => [
          invite.agent_id,
          existing.started_at !== null && existing.agents[invite.agent_id]?.ready_at !== null,
        ]),
      )
      const room: InternalRoom = {
        ...existing,
        status: 'starting',
        claude_model: normalizeModel(input.claude_model),
        codex_model: normalizeModel(input.codex_model),
        roster,
        agents: Object.fromEntries(roster.map((invite) => [invite.agent_id, { ready_at: null }])),
        updated_at: timestamp,
        started_at: existing.started_at ?? timestamp,
        stopped_at: null,
        last_error: null,
        active_job_id: null,
        auto: null,
        idle_suggestion_request: null,
        session_state: 'connected',
        token: randomToken(),
      }
      for (const invite of roster) {
        if (shouldResume[invite.agent_id] && existing.agents[invite.agent_id]?.ready_at) {
          room.agents[invite.agent_id].ready_at = existing.agents[invite.agent_id].ready_at
        }
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
          '-n',
          windowForAgent(roster[0].agent_id),
          '-c',
          cwd,
        ])
        executor.execFile('tmux', [
          'send-keys',
          '-t',
          `${room.tmux_session}:${windowForAgent(roster[0].agent_id)}`,
          path.join(internalDir, `launch-${roster[0].agent_id}.sh`),
          'C-m',
        ])
        for (const invite of roster.slice(1)) {
          executor.execFile('tmux', [
            'new-window',
            '-d',
            '-t',
            room.tmux_session,
            '-n',
            windowForAgent(invite.agent_id),
            '-c',
            cwd,
          ])
          executor.execFile('tmux', [
            'send-keys',
            '-t',
            `${room.tmux_session}:${windowForAgent(invite.agent_id)}`,
            path.join(internalDir, `launch-${invite.agent_id}.sh`),
            'C-m',
          ])
        }
        scheduleStartupTrustPromptAcceptance(room)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return markError(dataDir, room, message)
      }

      writeRoom(dataDir, room)
      return stripToken(room)
    },

    syncRoster(threadId: string): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'not_started' && room.status !== 'stopped' && room.status !== 'idle') {
        throw new ConflictError('room must be idle before changing its roster')
      }
      const roster = listThreadAgents(dataDir, threadId)
      if (room.status === 'not_started' || room.status === 'stopped') {
        const updated = {
          ...room,
          roster,
          agents: Object.fromEntries(roster.map((invite) => [invite.agent_id, { ready_at: null }])),
          updated_at: now(),
        }
        writeRoom(dataDir, updated)
        return stripToken(updated)
      }
      const previousIds = new Set(room.roster.map((invite) => invite.agent_id))
      const nextIds = new Set(roster.map((invite) => invite.agent_id))
      const previousById = new Map(room.roster.map((invite) => [invite.agent_id, invite]))
      const restartIds = new Set(roster
        .filter((invite) => {
          const previous = previousById.get(invite.agent_id)
          return !previous || previous.model !== invite.model || previous.effort !== invite.effort
        })
        .map((invite) => invite.agent_id))
      for (const invite of room.roster) {
        if (!nextIds.has(invite.agent_id) || restartIds.has(invite.agent_id)) {
          executor.execFile('tmux', ['kill-window', '-t', `${room.tmux_session}:${windowForAgent(invite.agent_id)}`])
        }
      }
      const updated: InternalRoom = {
        ...room,
        roster,
        agents: Object.fromEntries(roster.map((invite) => [
          invite.agent_id,
          restartIds.has(invite.agent_id) ? { ready_at: null } : room.agents[invite.agent_id] ?? { ready_at: null },
        ])),
        status: restartIds.size > 0 ? 'starting' : 'idle',
        idle_suggestion_request: null,
        updated_at: now(),
      }
      writeHelperScript(
        dataDir,
        updated,
        backendUrl,
          Object.fromEntries(roster.map((invite) => [invite.agent_id, previousIds.has(invite.agent_id)])),
      )
      for (const invite of roster) {
        if (!restartIds.has(invite.agent_id)) continue
        executor.execFile('tmux', [
          'new-window', '-d', '-t', room.tmux_session, '-n', windowForAgent(invite.agent_id),
          '-c', threadDir(dataDir, threadId),
        ])
        executor.execFile('tmux', [
          'send-keys', '-t', `${room.tmux_session}:${windowForAgent(invite.agent_id)}`,
          path.join(roundtableInternalDir(dataDir, threadId), `launch-${invite.agent_id}.sh`), 'C-m',
        ])
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    restartRoom(threadId: string): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const existing = reconcileRoom(threadId)
      if (sessionExists(executor, existing.tmux_session)) {
        throw new ConflictError('room session is already running')
      }
      const activeJobId = existing.active_job_id
      const auto = existing.auto
      manager.startRoom(threadId, {
        claude_model: existing.claude_model,
        codex_model: existing.codex_model,
      })
      const started = readRoom(dataDir, threadId)
      const restarted: InternalRoom = {
        ...started,
        active_job_id: activeJobId,
        auto,
        session_state: 'connected',
        last_error: activeJobId
          ? 'Room restarted. Wait for readiness, then retry or skip the interrupted turn.'
          : null,
      }
      writeRoom(dataDir, restarted)
      return stripToken(restarted)
    },

    stopRoom(threadId: string): AgentRoom {
      ensureThread(dataDir, threadId)
      const room = readRoom(dataDir, threadId)
      if (sessionExists(executor, room.tmux_session)) {
        executor.execFile('tmux', ['kill-session', '-t', room.tmux_session])
      }
      if (room.active_job_id) {
        const job = getJob(dataDir, threadId, room.active_job_id)
        if (job?.status === 'running') {
          const skipped: BoundedJob = {
            ...job,
            status: 'skipped',
            completed_at: now(),
            failure_reason: 'room stopped before the active turn completed',
            logs: [...job.logs, 'Room stopped; active turn skipped.'],
          }
          writeJob(dataDir, skipped)
          cleanupResolvedTurnFiles(dataDir, skipped)
        }
      }
      const timestamp = now()
      const updated: InternalRoom = {
        ...room,
        status: 'stopped',
        updated_at: timestamp,
        stopped_at: timestamp,
        active_job_id: null,
        auto: null,
        idle_suggestion_request: null,
        session_state: 'stopped',
      }
      if (room.active_job_id) clearTurnTimer(room.active_job_id)
      removeIfExists(currentTurnPath(dataDir, threadId))
      writeRoom(dataDir, updated)
      cleanupStoppedRoomFiles(dataDir, threadId)
      return stripToken(updated)
    },

    nudgeRoom(threadId: string, input: NudgeRoomInput): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before sending nudges')
      }
      inviteFor(room, input.agent)
      if (!sessionExists(executor, room.tmux_session)) {
        return markError(dataDir, room, 'tmux session is not running')
      }
      const body =
        input.body?.trim() ??
        'Roundtable nudge: inspect the current thread and approved discussion. If you need to make a durable comment or suggestion, wait for an explicit Roundtable request.'
      executor.execFile('tmux', [
        'send-keys',
        '-t',
        `${room.tmux_session}:${windowForAgent(input.agent)}`,
        body,
        'C-m',
      ])
      const updated: InternalRoom = { ...room, updated_at: now(), last_error: null }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    requestIdleSuggestion(threadId: string, input: RequestIdleSuggestionInput): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before requesting a suggestion')
      }
      inviteFor(room, input.agent)
      if (!sessionExists(executor, room.tmux_session)) {
        return markError(dataDir, room, 'tmux session is not running')
      }

      fs.mkdirSync(roundtableTmpDir(dataDir, threadId), { recursive: true })
      const request = {
        agent: input.agent,
        instructions: input.body?.trim() ?? null,
        status: 'active' as const,
        submitted_count: 0,
        requested_at: now(),
        completed_at: null,
      }
      const focus = request.instructions
        ? ` Focus on this instruction: ${request.instructions}`
        : ' Inspect the current thread and approved discussion for useful new topics.'
      sendLineToPane(
        executor,
        `${room.tmux_session}:${windowForAgent(input.agent)}`,
        `Roundtable idle suggestion request.${focus} Queue useful new top-level topics for user approval only; do not submit approved comments. For each proposed topic, write the body to a distinct Markdown file under .roundtable/tmp/ and submit it with: roundtable pending-discussion --body-file <that-file> --type comment. You may submit multiple pending discussions while this request is active. When finished, submit: roundtable done. If no useful topic exists, submit roundtable done without creating a pending discussion.`,
      )
      const updated: InternalRoom = {
        ...room,
        idle_suggestion_request: request,
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    cancelIdleSuggestion(threadId: string): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before cancelling a suggestion request')
      }
      const request = room.idle_suggestion_request
      if (!request) return stripToken(room)
      if (sessionExists(executor, room.tmux_session)) {
        sendLineToPane(
          executor,
          `${room.tmux_session}:${windowForAgent(request.agent)}`,
          'Roundtable idle suggestion request cancelled. Do not submit a pending discussion for the cancelled request.',
        )
      }
      const updated: InternalRoom = {
        ...room,
        idle_suggestion_request: null,
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    completeIdleSuggestion(
      threadId: string,
      agent: AgentName,
      token: string | null,
    ): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!token || token !== room.token) {
        throw new BadRequestError('invalid room token')
      }
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before completing a suggestion request')
      }
      inviteFor(room, agent)
      const request = room.idle_suggestion_request
      if (!request || request.agent !== agent) {
        throw new BadRequestError('idle suggestion completion requires an active request')
      }
      if (request.status === 'done') return stripToken(room)
      const updated: InternalRoom = {
        ...room,
        idle_suggestion_request: {
          ...request,
          status: 'done',
          completed_at: now(),
        },
        updated_at: now(),
        last_error: null,
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    markReady(threadId: string, agent: AgentName, token: string | null): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!token || token !== room.token) {
        throw new BadRequestError('invalid room token')
      }
      if (
        room.status !== 'starting' &&
        room.status !== 'idle' &&
        !(room.status === 'needs_attention' && room.active_job_id)
      ) {
        throw new BadRequestError('room is not starting')
      }
      inviteFor(room, agent)
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
      if (updated.roster.every(({ agent_id }) => updated.agents[agent_id]?.ready_at)) {
        updated.status = updated.active_job_id ? 'needs_attention' : 'idle'
      }
      updated.session_state = 'connected'
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    askAgent(threadId: string, input: AskAgentInput): AgentTurnResult {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before starting an ask turn')
      }
      inviteFor(room, input.agent)
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
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'idle') {
        throw new BadRequestError('room must be idle before starting auto discussion')
      }

      const auto = createAutoState(threadId, input)
      return startNextAutoTurn(room, auto)
    },

    startConsolidation(
      threadId: string,
      input: StartConsolidationInput,
    ): ConsolidationTurnResult {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      clearQueuedConsolidation(threadId)
      return startConsolidationSequence(room, input)
    },

    finishAndStartConsolidation(
      threadId: string,
      input: StartConsolidationInput,
    ): AgentRoom {
      ensureOpenThread(dataDir, threadId)
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
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      ensureConsolidationRoomAvailable(room)
      const proposal = getProposal(dataDir, threadId, proposalId)
      if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`)
      if (input.reviewer_agent) inviteFor(room, input.reviewer_agent)
      const revisionId = latestRevisionId(threadId, proposalId)
      if (!revisionId) throw new BadRequestError('proposal has no revision to review')
      options.beforeCanonicalWrite?.(threadId)
      const updated = updateProposal(dataDir, threadId, proposalId, {
        reviewer_agent: input.reviewer_agent ?? proposal.reviewer_agent,
      })
      inviteFor(room, updated.reviewer_agent)
      options.onCanonicalWrite?.(threadId)
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
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      ensureConsolidationRoomAvailable(room)
      const proposal = getProposal(dataDir, threadId, proposalId)
      if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`)
      if (input.reviewer_agent) inviteFor(room, input.reviewer_agent)
      if (input.reviser_agent) inviteFor(room, input.reviser_agent)
      const revisionId = latestRevisionId(threadId, proposalId)
      if (!revisionId) throw new BadRequestError('proposal has no revision to revise')
      options.beforeCanonicalWrite?.(threadId)
      const updated = updateProposal(dataDir, threadId, proposalId, {
        reviewer_agent: input.reviewer_agent ?? proposal.reviewer_agent,
        reviser_agent: input.reviser_agent ?? proposal.reviser_agent,
      })
      inviteFor(room, updated.reviser_agent)
      options.onCanonicalWrite?.(threadId)
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
      ensureOpenThread(dataDir, threadId)
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
          stop_requested: false,
          status: room.active_job_id ? 'running' : 'paused',
          updated_at: timestamp,
        },
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    stopAutoDiscussion(threadId: string): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!room.auto || room.auto.status !== 'running') {
        throw new BadRequestError('auto discussion is not running')
      }

      const timestamp = now()
      if (!room.active_job_id) {
        const updated: InternalRoom = {
          ...room,
          status: 'idle',
          updated_at: timestamp,
          last_error: null,
          auto: null,
        }
        writeRoom(dataDir, updated)
        return stripToken(updated)
      }

      const updated: InternalRoom = {
        ...room,
        updated_at: timestamp,
        auto: {
          ...room.auto,
          pause_requested: false,
          stop_requested: true,
          status: 'running',
          updated_at: timestamp,
        },
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    exitAutoDiscussion(threadId: string): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!room.auto) {
        throw new BadRequestError('auto discussion has not been started')
      }
      if (room.status !== 'paused' && room.status !== 'turn_limit_reached') {
        throw new BadRequestError('auto discussion can only be exited after pause or turn limit')
      }

      const updated: InternalRoom = {
        ...room,
        status: 'idle',
        updated_at: now(),
        last_error: null,
        auto: null,
      }
      writeRoom(dataDir, updated)
      return stripToken(updated)
    },

    extendAutoDiscussion(
      threadId: string,
      input: ExtendAutoDiscussionInput,
    ): AgentTurnResult {
      ensureOpenThread(dataDir, threadId)
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
        stop_requested: false,
        updated_at: timestamp,
        ended_at: null,
      }
      return startNextAutoTurn(room, auto)
    },

    sendInputResponse(
      threadId: string,
      input: SendRoomInputResponseInput,
    ): AgentRoom {
      ensureOpenThread(dataDir, threadId)
      const room = refreshInputPrompt(expireActiveTurn(threadId))
      if (!sessionExists(executor, room.tmux_session)) {
        return markError(dataDir, room, 'tmux session is not running')
      }

      const excerpt =
        room.input_prompt?.agent === input.agent ? room.input_prompt.excerpt : null
      sendKeysToPane(
        executor,
        `${room.tmux_session}:${windowForAgent(input.agent)}`,
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
      ensureOpenThread(dataDir, threadId)
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
        job.turn.kind === 'proposal_draft' ||
        job.turn.kind === 'proposal_review' ||
        job.turn.kind === 'proposal_revision'
      ) {
        throw new BadRequestError(
          `active turn requires roundtable ${
            job.turn.kind === 'proposal_review' ? 'review' : 'proposal'
          } submission`,
        )
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
      options.beforeCanonicalWrite?.(threadId)
      const comment = addAgentComment(dataDir, threadId, {
        author: input.agent,
        body: input.body,
        type: input.type,
        reply_to: replyTo,
      })
      options.onCanonicalWrite?.(threadId)

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
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (!token || token !== room.token) {
        throw new BadRequestError('invalid room token')
      }
      if (room.status === 'idle' && !room.active_job_id && !input.turn_id) {
        inviteFor(room, input.agent)
        if (!room.idle_suggestion_request || room.idle_suggestion_request.agent !== input.agent) {
          throw new BadRequestError(
            'idle pending discussion requires an explicit suggestion request',
          )
        }
        if (room.idle_suggestion_request.status === 'done') {
          throw new BadRequestError('idle suggestion request is already complete')
        }
        if (input.continue_turn) {
          throw new BadRequestError('idle pending discussion cannot continue a turn')
        }
        options.beforeCanonicalWrite?.(threadId)
        const pending = addPendingDiscussion(dataDir, threadId, {
          author: input.agent,
          body: input.body,
          type: input.type,
          origin_discussion_id: input.origin_discussion_id ?? null,
          origin_comment_id: input.origin_comment_id ?? null,
        })
        options.onCanonicalWrite?.(threadId)
        const updated: InternalRoom = {
          ...room,
          idle_suggestion_request: {
            ...room.idle_suggestion_request,
            submitted_count: room.idle_suggestion_request.submitted_count + 1,
          },
          updated_at: now(),
          last_error: null,
        }
        writeRoom(dataDir, updated)
        return { room: stripToken(updated), pending_discussion: pending }
      }
      if (room.status !== 'running' || !room.active_job_id) {
        throw new BadRequestError('no active turn is running')
      }
      if (!input.turn_id) {
        throw new BadRequestError('active pending discussion requires a turn id')
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
      if (!job.turn.auto_run_id && job.turn.scope !== 'discussion') {
        throw new BadRequestError(
          'pending discussion submission requires an auto or discussion-level Ask turn',
        )
      }
      if (isTimedOut(job)) {
        expireActiveTurn(threadId)
        throw new BadRequestError('active turn has timed out')
      }

      options.beforeCanonicalWrite?.(threadId)
      const pending = addPendingDiscussion(dataDir, threadId, {
        author: input.agent,
        body: input.body,
        type: input.type,
        origin_discussion_id:
          input.origin_discussion_id ?? job.turn.discussion_id ?? null,
        origin_comment_id: input.origin_comment_id ?? null,
      })
      options.onCanonicalWrite?.(threadId)

      if (input.continue_turn) {
        const active: BoundedJob = {
          ...job,
          logs: [...job.logs, `Pending discussion ${pending.id} queued; turn remains active.`],
        }
        writeJob(dataDir, active)
        return {
          room: stripToken(room),
          job: active,
          pending_discussion: pending,
        }
      }

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
      ensureOpenThread(dataDir, threadId)
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

      options.beforeCanonicalWrite?.(threadId)
      const revision = addProposalRevision(
        dataDir,
        threadId,
        job.turn.proposal_id,
        input.body,
        input.agent,
      )
      options.onCanonicalWrite?.(threadId)
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
      options.onCanonicalWrite?.(threadId)
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
      ensureOpenThread(dataDir, threadId)
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

      options.beforeCanonicalWrite?.(threadId)
      const review = addProposalReview(
        dataDir,
        threadId,
        job.turn.proposal_id,
        input.body,
        input.agent,
        job.turn.revision_id,
      )
      options.onCanonicalWrite?.(threadId)
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
        options.onCanonicalWrite?.(threadId)
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
      ensureOpenThread(dataDir, threadId)
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
              ask: { agent: room.roster[0]?.agent_id ?? 'claude' },
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
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      if (room.status !== 'needs_attention' || !room.active_job_id) {
        throw new BadRequestError('room does not have a turn needing attention')
      }
      if (!sessionExists(executor, room.tmux_session)) {
        throw new BadRequestError('restart the room before skipping the interrupted turn')
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
  reconcilePersistedRooms()
  return manager
}
