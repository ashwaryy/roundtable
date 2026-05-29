import fs from 'node:fs'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
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
  TmuxPaneInput,
  TmuxPaneInputKey,
  TmuxPaneSnapshot,
  ThreadStatus,
  ThreadAgentInvite,
} from '@roundtable/shared'
import {
  preToolUseHookPath,
  claudeLocalSettingsPath,
  commentsPath,
  consolidationDir,
  proposalJsonPath,
  codexProjectConfigPath,
  codexRulesPath,
  currentTurnPath,
  jobsDir,
  queuedConsolidationPath,
  roomJsonPath,
  roomPromptPath,
  reviewJsonPath,
  reviewPath,
  revisionsDir,
  revisionPath,
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
  pendingDiscussionsPath,
} from '../storage/paths'
import { BadRequestError, ConflictError, NotFoundError } from '../storage/errors'
import type { CanonicalTouched } from '../storage/touched'
import { listThreadAgents } from '../storage/agents'
import { addAgentComment, isDiscussionRoot, listComments } from '../storage/comments'
import { addPendingDiscussion, listPendingDiscussions } from '../storage/pendingDiscussions'
import { setThreadSummaryDirty, updateThreadSummary } from '../storage/threads'
import { getJob, nextJobId, writeJob } from '../storage/jobs'
import {
  addProposalReview,
  addProposalRevision,
  createProposal,
  getLatestReviewBody,
  getLatestRevision,
  getProposal,
  listProposalStatuses,
  updateProposal,
} from '../storage/proposals'
import {
  cliCommand,
  claudeLocalSettings,
  codexProjectConfig,
  codexRulesText,
  commandWrappers,
  invalidRuntimeEffortWarning,
  resumeCliCommand,
  writeAgentPermissionSetup,
} from './runtime-config'
import {
  buildTurnPrompt,
  controlPromptRelativePath,
  promptAnswerKeys,
  startupPrompt,
  systemPromptSections as buildSystemPromptSections,
  turnPromptRelativePath,
} from './prompts'

interface InternalRoom extends AgentRoom {
  token: string
  session_active: boolean | null
  session_checked_at: string | null
  input_prompt_checked_at: string | null
}

export interface CommandExecutor {
  execFile(
    file: string,
    args: string[],
    options?: {
      cwd?: string
      env?: NodeJS.ProcessEnv
      timeoutMs?: number
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
      timeoutMs?: number
    } = {},
  ): string {
    return execFileSync(file, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
    })
  }
}

export interface RoomManager {
  preflight(threadId?: string): RoomPreflight
  getRoom(threadId: string): Promise<AgentRoom>
  getRoomSummary(threadId: string): AgentRoom
  getTmuxPaneSnapshot(threadId: string, agent: AgentName): TmuxPaneSnapshot
  sendTmuxPaneInput(threadId: string, agent: AgentName, input: TmuxPaneInput): void
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

type ToolName = 'tmux' | 'claude' | 'codex'

const TOOL_NAMES: readonly ToolName[] = ['tmux', 'claude', 'codex']
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000
const TMUX_VIEW_LINE_LIMIT = 200
const DEFAULT_EXEC_TIMEOUT_MS = 5_000
const ROOM_SUMMARY_PROBE_TTL_MS = 1_500
const INPUT_PROMPT_PROBE_TTL_MS = 1_500
const TOOL_PREFLIGHT_TTL_MS = 30_000
const DEFAULT_TMUX_SUBMIT_DELAY_MS = 200

function now(): string {
  return new Date().toISOString()
}

function tmuxSubmitDelayMs(): number {
  const raw = process.env.ROUNDTABLE_TMUX_SUBMIT_DELAY_MS
  if (!raw) return DEFAULT_TMUX_SUBMIT_DELAY_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TMUX_SUBMIT_DELAY_MS
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

function tmuxSessionName(threadId: string): string {
  return `roundtable-${threadId}`
}

function attachCommand(threadId: string): string {
  return `tmux attach -t ${tmuxSessionName(threadId)}`
}

function agentStates(
  roster: ThreadAgentInvite[],
  existing: Partial<AgentRoom['agents']> = {},
): AgentRoom['agents'] {
  return Object.fromEntries(roster.map((agent) => [
    agent.agent_id,
    {
      ready_at: existing[agent.agent_id]?.ready_at ?? null,
      pane_viewable: existing[agent.agent_id]?.pane_viewable ?? false,
    },
  ]))
}

function stripToken(room: InternalRoom): AgentRoom {
  const {
    token: _token,
    session_active: _sessionActive,
    session_checked_at: _sessionCheckedAt,
    input_prompt_checked_at: _inputPromptCheckedAt,
    ...publicRoom
  } = room
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
    agents: agentStates(roster),
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
    session_active: null,
    session_checked_at: null,
    input_prompt_checked_at: null,
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
    agents: agentStates(roster, parsed.agents ?? {}),
    auto: parsed.auto ?? null,
    input_prompt: parsed.input_prompt ?? null,
    idle_suggestion_request: parsed.idle_suggestion_request ?? null,
    session_active: parsed.session_active ?? null,
    session_checked_at: parsed.session_checked_at ?? null,
    input_prompt_checked_at: parsed.input_prompt_checked_at ?? null,
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

function paneTarget(room: Pick<AgentRoom, 'tmux_session'>, agent: AgentName): string {
  return `${room.tmux_session}:${windowForAgent(agent)}`
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

function inviteForSnapshot(room: InternalRoom, agent: AgentName): ThreadAgentInvite {
  const invite = room.roster.find((entry) => entry.agent_id === agent)
  if (!invite) throw new NotFoundError(`agent ${agent} not found`)
  return invite
}

function tmuxKeyForInput(key: TmuxPaneInputKey): string {
  switch (key) {
    case 'Enter':
      return 'C-m'
    case 'Escape':
      return 'Escape'
    case 'Tab':
      return 'Tab'
    case 'Backspace':
      return 'BSpace'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'CtrlC':
      return 'C-c'
    case 'CtrlD':
      return 'C-d'
    case 'CtrlL':
      return 'C-l'
    case 'CtrlU':
      return 'C-u'
    default: {
      const exhaustive: never = key
      throw new BadRequestError(`unsupported tmux input key: ${String(exhaustive)}`)
    }
  }
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
    const effortWarning = invalidRuntimeEffortWarning(invite.runtime, invite.effort)
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
${effortWarning ? `echo ${shellSingleQuote(effortWarning)} >&2\n` : ''}exec ${command}
`,
    )
  }
}

function toolPreflight(executor: CommandExecutor, name: ToolName): RoomToolPreflight {
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

interface CachedToolPreflight {
  checkedAt: number
  result: RoomToolPreflight
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

function sessionExistsAsync(executor: CommandExecutor, sessionName: string): Promise<boolean> {
  if (!(executor instanceof SystemCommandExecutor)) {
    return Promise.resolve(sessionExists(executor, sessionName))
  }
  return new Promise((resolve) => {
    execFile(
      'tmux',
      ['has-session', '-t', sessionName],
      {
        encoding: 'utf8',
        timeout: DEFAULT_EXEC_TIMEOUT_MS,
      },
      (err) => resolve(!err),
    )
  })
}

function paneExists(
  executor: CommandExecutor,
  room: Pick<AgentRoom, 'tmux_session'>,
  agent: AgentName,
): boolean {
  try {
    executor.execFile('tmux', ['list-panes', '-t', paneTarget(room, agent), '-F', '#{pane_id}'])
    return true
  } catch {
    return false
  }
}

function capturePane(
  executor: CommandExecutor,
  room: Pick<AgentRoom, 'tmux_session'>,
  agent: AgentName,
  startLine: number,
): string {
  return executor.execFile('tmux', [
    'capture-pane',
    '-t',
    paneTarget(room, agent),
    '-p',
    '-S',
    String(startLine),
  ])
}

function capturePaneAsync(
  executor: CommandExecutor,
  room: Pick<AgentRoom, 'tmux_session'>,
  agent: AgentName,
  startLine: number,
): Promise<string> {
  if (!(executor instanceof SystemCommandExecutor)) {
    return Promise.resolve(capturePane(executor, room, agent, startLine))
  }
  return new Promise((resolve, reject) => {
    execFile(
      'tmux',
      [
        'capture-pane',
        '-t',
        paneTarget(room, agent),
        '-p',
        '-S',
        String(startLine),
      ],
      {
        encoding: 'utf8',
        timeout: DEFAULT_EXEC_TIMEOUT_MS,
      },
      (err, stdout) => {
        if (err) {
          reject(err instanceof Error ? err : new Error('tmux capture-pane failed'))
          return
        }
        resolve(stdout)
      },
    )
  })
}

function withPaneViewable(
  executor: CommandExecutor,
  room: InternalRoom,
  live = sessionExists(executor, room.tmux_session),
): InternalRoom {
  return {
    ...room,
    agents: Object.fromEntries(Object.entries(room.agents).map(([agentId, state]) => [
      agentId,
      {
        ...state,
        pane_viewable: live && paneExists(executor, room, agentId),
      },
    ])),
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
  const output = capturePane(executor, room, agent, -80)
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

// Number of trailing non-empty pane lines that reflect the agent's live state.
// Prompts always render at the bottom of the pane, so matching only this tail
// keeps resolved prompts left behind in scrollback from triggering a stale
// "waiting for input" banner.
const INPUT_PROMPT_TAIL_LINES = 12

// A visible working/spinner indicator means the agent owns the pane and is busy,
// not blocked on a prompt — Codex and Claude both clear it once they actually
// pause for approval.
const WORKING_INDICATOR = /esc to interrupt|esc to cancel/i

const INPUT_PROMPT_PATTERN =
  /(requires approval|Do you want to proceed\?|Continue\?|Proceed\?|Allow\?|\[[yY]\/[nN]\]|\[[nN]\/[yY]\]|1\.\s*Yes)/i

function detectInputPrompt(output: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  if (lines.length === 0) return null

  const tail = lines.slice(-INPUT_PROMPT_TAIL_LINES)
  const tailText = tail.join('\n')
  if (WORKING_INDICATOR.test(tailText)) return null
  if (!INPUT_PROMPT_PATTERN.test(tailText)) return null

  const excerpt = tailText.trim()
  return excerpt.length > 1200 ? excerpt.slice(-1200) : excerpt
}

function markError(
  dataDir: string,
  room: InternalRoom,
  message: string,
  onWrite?: (room: InternalRoom) => void,
): AgentRoom {
  const updated: InternalRoom = {
    ...room,
    status: 'error',
    updated_at: now(),
    last_error: message,
    active_job_id: null,
    session_state: message.includes('tmux session') ? 'missing' : room.session_state,
  }
  writeRoom(dataDir, updated)
  onWrite?.(updated)
  return stripToken(updated)
}

function writeControlPrompt(
  dataDir: string,
  threadId: string,
  kind: 'nudge' | 'idle-suggestion' | 'idle-suggestion-cancel',
  agent: AgentName,
  body: string,
): string {
  fs.mkdirSync(roundtableTmpDir(dataDir, threadId), { recursive: true })
  const promptPath = controlPromptRelativePath(kind, agent, now())
  writeTextFile(path.join(threadDir(dataDir, threadId), promptPath), body)
  return promptPath
}

export function systemPromptSections(): SystemPromptSection[] {
  return buildSystemPromptSections({
    cliCommand,
    claudeLocalSettings,
    codexProjectConfig,
    codexRulesText,
  })
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
  onCanonicalWrite?: (threadId: string, touched: CanonicalTouched) => void
}): RoomManager {
  const { dataDir, backendUrl } = options
  const executor = options.executor ?? new SystemCommandExecutor()
  const timers = new Map<string, NodeJS.Timeout>()
  const toolPreflightCache = new Map<ToolName, CachedToolPreflight>()
  const roomSummaryCache = new Map<string, InternalRoom>()
  const queuedSummaryProbes = new Set<string>()
  const paneActionQueues = new Map<string, Promise<void>>()
  let summaryProbeScheduled = false
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

  function cachedToolPreflight(name: ToolName): RoomToolPreflight {
    const cached = toolPreflightCache.get(name)
    const checkedAt = Date.now()
    if (cached && checkedAt - cached.checkedAt < TOOL_PREFLIGHT_TTL_MS) {
      return cached.result
    }
    const result = toolPreflight(executor, name)
    toolPreflightCache.set(name, { checkedAt, result })
    return result
  }

  function cacheRoom(room: InternalRoom): InternalRoom {
    roomSummaryCache.set(room.thread_id, room)
    return room
  }

  function storeRoom(room: InternalRoom): void {
    writeRoom(dataDir, room)
    cacheRoom(room)
  }

  function enqueuePaneAction(target: string, action: () => Promise<void> | void): void {
    const prior = paneActionQueues.get(target) ?? Promise.resolve()
    const next = prior
      .catch(() => undefined)
      .then(action)
      .catch(() => undefined)
      .finally(() => {
        if (paneActionQueues.get(target) === next) paneActionQueues.delete(target)
      })
    paneActionQueues.set(target, next)
  }

  function sendKeysToPane(target: string, keys: string[]): void {
    if (!paneActionQueues.has(target)) {
      executor.execFile('tmux', ['send-keys', '-t', target, ...keys])
      return
    }
    enqueuePaneAction(target, () => {
      executor.execFile('tmux', ['send-keys', '-t', target, ...keys])
    })
  }

  function sendLiteralToPane(target: string, text: string): void {
    if (!paneActionQueues.has(target)) {
      executor.execFile('tmux', ['send-keys', '-t', target, '-l', text])
      return
    }
    enqueuePaneAction(target, () => {
      executor.execFile('tmux', ['send-keys', '-t', target, '-l', text])
    })
  }

  function sendLineToPane(target: string, line: string): void {
    enqueuePaneAction(target, async () => {
      executor.execFile('tmux', ['send-keys', '-t', target, 'C-u'])
      executor.execFile('tmux', ['send-keys', '-t', target, '-l', line])
      await delay(tmuxSubmitDelayMs())
      executor.execFile('tmux', ['send-keys', '-t', target, 'C-m'])
    })
  }

  function cachedRoom(threadId: string): InternalRoom {
    const cached = roomSummaryCache.get(threadId)
    if (cached) return cached
    return cacheRoom(readRoom(dataDir, threadId))
  }

  function hasFreshSessionState(room: InternalRoom): boolean {
    if (room.session_active === null || !room.session_checked_at) return false
    return Date.now() - Date.parse(room.session_checked_at) < ROOM_SUMMARY_PROBE_TTL_MS
  }

  function markChecked(room: InternalRoom, live: boolean, checkedAt = now()): InternalRoom {
    return {
      ...room,
      session_active: live,
      session_checked_at: checkedAt,
    }
  }

  function inputPromptProbeNeeded(room: InternalRoom): boolean {
    if (
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error'
    ) {
      return false
    }
    if (!room.input_prompt_checked_at) return true
    return Date.now() - Date.parse(room.input_prompt_checked_at) >= INPUT_PROMPT_PROBE_TTL_MS
  }

  function refreshInputPrompt(
    room: InternalRoom,
    liveHint: boolean | null = hasFreshSessionState(room) ? room.session_active : null,
  ): InternalRoom {
    const checkedAt = now()
    if (
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error' ||
      liveHint === false ||
      (liveHint === null && !sessionExists(executor, room.tmux_session))
    ) {
      const updated: InternalRoom = {
        ...room,
        input_prompt: null,
        input_prompt_checked_at: checkedAt,
      }
      if (
        updated.input_prompt === room.input_prompt &&
        updated.input_prompt_checked_at === room.input_prompt_checked_at
      ) {
        return room
      }
      storeRoom(updated)
      return updated
    }

    for (const { agent_id: agent } of room.roster) {
      const output = capturePane(executor, room, agent, -80)
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
            detected_at: checkedAt,
          },
          updated_at: checkedAt,
          input_prompt_checked_at: checkedAt,
        }
        storeRoom(updated)
        return updated
      }
    }

    if (!room.input_prompt) {
      const updated: InternalRoom = { ...room, input_prompt_checked_at: checkedAt }
      if (updated.input_prompt_checked_at === room.input_prompt_checked_at) return room
      storeRoom(updated)
      return updated
    }
    const updated: InternalRoom = {
      ...room,
      input_prompt: null,
      updated_at: checkedAt,
      input_prompt_checked_at: checkedAt,
    }
    storeRoom(updated)
    return updated
  }

  async function refreshInputPromptAsync(
    room: InternalRoom,
    liveHint: boolean | null = hasFreshSessionState(room) ? room.session_active : null,
  ): Promise<InternalRoom> {
    const checkedAt = now()
    if (
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error' ||
      liveHint === false ||
      (liveHint === null && !sessionExists(executor, room.tmux_session))
    ) {
      const updated: InternalRoom = {
        ...room,
        input_prompt: null,
        input_prompt_checked_at: checkedAt,
      }
      if (
        updated.input_prompt === room.input_prompt &&
        updated.input_prompt_checked_at === room.input_prompt_checked_at
      ) {
        return room
      }
      storeRoom(updated)
      return updated
    }

    for (const { agent_id: agent } of room.roster) {
      const output = await capturePaneAsync(executor, room, agent, -80)
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
            detected_at: checkedAt,
          },
          updated_at: checkedAt,
          input_prompt_checked_at: checkedAt,
        }
        storeRoom(updated)
        return updated
      }
    }

    if (!room.input_prompt) {
      const updated: InternalRoom = { ...room, input_prompt_checked_at: checkedAt }
      if (updated.input_prompt_checked_at === room.input_prompt_checked_at) return room
      storeRoom(updated)
      return updated
    }
    const updated: InternalRoom = {
      ...room,
      input_prompt: null,
      updated_at: checkedAt,
      input_prompt_checked_at: checkedAt,
    }
    storeRoom(updated)
    return updated
  }

  function expireActiveTurn(threadId: string, existingRoom?: InternalRoom): InternalRoom {
    let room = existingRoom ?? readRoom(dataDir, threadId)
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
    storeRoom(room)
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
    sendLineToPane(`${room.tmux_session}:${windowForAgent(job.agent)}`, `Read ${promptPath} and follow it.`)
  }

  function scheduleStartupTrustPromptAcceptance(room: InternalRoom): void {
    const startedAt = Date.now()
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
          const promptKeys = !current.agents[agent].ready_at
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
            pendingPromptKeys.delete(agent)
          } else {
            pendingPromptKeys.set(agent, signature)
          }
        }

        const allAgentsReady = current.roster.every(
          ({ agent_id: agent }) => current.agents[agent].ready_at,
        )
        if (
          allAgentsReady ||
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
        room: markError(dataDir, room, message, cacheRoom),
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
    storeRoom(updated)
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

  function activeProposalCount(threadId: string): number {
    return listProposalStatuses(dataDir, threadId)
      .filter((status) => status === 'drafting' || status === 'review').length
  }

  function acceptDirtyThreadSummaryWrite(threadId: string): void {
    options.onCanonicalWrite?.(threadId, {
      filesAddedOrUpdated: [threadJsonPath(dataDir, threadId)],
    })
  }

  function revisionJsonFile(
    threadId: string,
    proposalId: string,
    revisionId: string,
  ): string {
    return path.join(revisionsDir(dataDir, threadId, proposalId), `${revisionId}.json`)
  }

  function latestRevisionId(threadId: string, proposalId: string): string | null {
    return getProposal(dataDir, threadId, proposalId)?.latest_revision_id ?? null
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
    setThreadSummaryDirty(dataDir, room.thread_id, 'active_proposal_count')
    let proposal: ConsolidationProposal
    try {
      proposal = createProposal(dataDir, room.thread_id, resolved)
    } catch (err) {
      acceptDirtyThreadSummaryWrite(room.thread_id)
      throw err
    }
    try {
      updateThreadSummary(
        dataDir,
        room.thread_id,
        { active_proposal_count: activeProposalCount(room.thread_id) },
        ['active_proposal_count'],
      )
    } finally {
      options.onCanonicalWrite?.(room.thread_id, {
        filesAddedOrUpdated: [threadJsonPath(dataDir, room.thread_id)],
        rootsAddedOrUpdated: [consolidationDir(dataDir, room.thread_id, proposal.id)],
      })
    }
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
    if (!isDiscussionRoot(dataDir, threadId, discussionId)) {
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
        room: markError(dataDir, room, 'tmux session is not running', cacheRoom),
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
      storeRoom(updated)
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
      storeRoom(updated)
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
      storeRoom(updated)
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
      storeRoom(updated)
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
      const stopped = withPaneViewable(executor, {
        ...room,
        status: 'stopped' as const,
        session_state: 'stopped' as const,
        stopped_at: now(),
        updated_at: now(),
        active_job_id: null,
        auto: null,
      }, false)
      storeRoom(stopped)
      cleanupStoppedRoomFiles(dataDir, threadId)
      return stopped
    }
    if (!roomFileExists && live) {
      const untracked: InternalRoom = withPaneViewable(executor, {
        ...room,
        status: 'needs_attention',
        session_state: 'untracked',
        last_error: 'An untracked tmux session exists; stop it before restarting the room.',
        updated_at: now(),
      }, true)
      storeRoom(untracked)
      return untracked
    }
    if (!roomFileExists) return room
    if (live && room.session_state === 'untracked') return room
    if (live) {
      const recovered = withPaneViewable(executor, {
        ...room,
        session_active: true,
        session_checked_at: now(),
        session_state:
          startup || room.session_checked_at === null
            ? 'recovered'
            : room.session_state === 'connected' || room.session_state === 'recovered'
            ? room.session_state
            : 'recovered',
        updated_at: now(),
      }, true)
      const active = recovered.active_job_id
        ? getJob(dataDir, threadId, recovered.active_job_id)
        : null
      if (active?.status === 'running') scheduleTimeout(active)
      storeRoom(recovered)
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
    const missing: InternalRoom = withPaneViewable(executor, {
      ...room,
      status: room.active_job_id ? 'needs_attention' : 'error',
      session_state: 'missing',
      updated_at: now(),
      last_error: room.active_job_id
        ? 'Room session is missing; restart the room, then retry or skip the interrupted turn.'
        : 'Room session is missing; restart the room to continue.',
    }, false)
    storeRoom(missing)
    return missing
  }

  function seedRoomSummaryCache(): void {
    const dir = threadsDir(dataDir)
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !fs.existsSync(threadJsonPath(dataDir, entry.name))) continue
      cacheRoom(readRoom(dataDir, entry.name))
    }
  }

  function roomSummaryNeedsProbe(room: InternalRoom): boolean {
    if (
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.session_state === 'stopped' ||
      room.session_state === 'untracked'
    ) {
      return false
    }
    if (!room.session_checked_at) return true
    return Date.now() - Date.parse(room.session_checked_at) >= ROOM_SUMMARY_PROBE_TTL_MS
  }

  function applySummaryProbeResult(
    threadId: string,
    live: boolean,
    checkedAt: string,
  ): void {
    const current = readRoom(dataDir, threadId)
    if (current.session_checked_at && Date.parse(current.session_checked_at) > Date.parse(checkedAt)) {
      cacheRoom(current)
      return
    }

    if (live) {
      storeRoom(
        markChecked(
          {
            ...current,
            session_state:
              current.session_state === 'missing' ? 'recovered' : current.session_state,
          },
          true,
          checkedAt,
        ),
      )
      return
    }

    if (
      current.status === 'not_started' ||
      current.status === 'stopped' ||
      current.session_state === 'stopped'
    ) {
      storeRoom(markChecked(current, false, checkedAt))
      return
    }

    const active = current.active_job_id ? getJob(dataDir, threadId, current.active_job_id) : null
    if (active?.status === 'running') {
      writeJob(dataDir, {
        ...active,
        status: 'failed',
        completed_at: now(),
        failure_reason: 'tmux session disappeared while the turn was running',
        logs: [...active.logs, 'Room session missing during background session probe.'],
      })
    }

    storeRoom(
      markChecked(
        {
          ...current,
          status: current.active_job_id ? 'needs_attention' : 'error',
          session_state: 'missing',
          last_error: current.active_job_id
            ? 'Room session is missing; restart the room, then retry or skip the interrupted turn.'
            : 'Room session is missing; restart the room to continue.',
        },
        false,
        checkedAt,
      ),
    )
  }

  function takeNextSummaryProbe(): string | null {
    const threadIds = [...queuedSummaryProbes]
    if (threadIds.length === 0) return null
    threadIds.sort((left, right) => {
      const leftAt = Date.parse(cachedRoom(left).session_checked_at ?? '1970-01-01T00:00:00.000Z')
      const rightAt = Date.parse(cachedRoom(right).session_checked_at ?? '1970-01-01T00:00:00.000Z')
      return leftAt - rightAt
    })
    const threadId = threadIds[0]
    queuedSummaryProbes.delete(threadId)
    return threadId
  }

  function processNextSummaryProbe(): void {
    const threadId = takeNextSummaryProbe()
    if (!threadId) {
      summaryProbeScheduled = false
      return
    }
    // Keep probes sequential to avoid subprocess fan-out while the async tmux
    // check itself stays off the event loop.
    void (async () => {
      const room = cachedRoom(threadId)
      if (roomSummaryNeedsProbe(room)) {
        const checkedAt = now()
        const live = await sessionExistsAsync(executor, room.tmux_session)
        applySummaryProbeResult(threadId, live, checkedAt)
      }
    })().finally(() => {
      setImmediate(processNextSummaryProbe)
    })
  }

  function queueSummaryProbe(threadId: string): void {
    queuedSummaryProbes.add(threadId)
    if (summaryProbeScheduled) return
    summaryProbeScheduled = true
    setTimeout(processNextSummaryProbe, 0)
  }

  function getRoomSummary(threadId: string): AgentRoom {
    ensureThread(dataDir, threadId)
    const room = cachedRoom(threadId)
    if (roomSummaryNeedsProbe(room)) queueSummaryProbe(threadId)
    return stripToken(room)
  }

  function reconcilePersistedRooms(): void {
    seedRoomSummaryCache()
  }

  const manager: RoomManager = {
    preflight(threadId?: string): RoomPreflight {
      const tools = Object.fromEntries(
        TOOL_NAMES.map((name) => [name, cachedToolPreflight(name)]),
      ) as RoomPreflight['tools']
      const required = threadId
        ? new Set(['tmux', ...listThreadAgents(dataDir, threadId).map((invite) => invite.runtime)])
        : new Set(TOOL_NAMES)
      return {
        ok: Object.values(tools).every((tool) => !required.has(tool.name) || tool.available),
        tools,
      }
    },

    async getRoom(threadId: string): Promise<AgentRoom> {
      ensureThread(dataDir, threadId)
      const status = threadStatus(dataDir, threadId)
      const cached = cachedRoom(threadId)
      const reconciled =
        status === 'closed' ||
        status === 'archived' ||
        !fs.existsSync(roomJsonPath(dataDir, threadId)) ||
        roomSummaryNeedsProbe(cached)
        ? reconcileRoom(threadId)
        : cached
      if (reconciled.session_state === 'missing' || reconciled.session_state === 'untracked') {
        return stripToken(reconciled)
      }
      const room = expireActiveTurn(threadId, reconciled)
      const liveHint = hasFreshSessionState(room) ? room.session_active : null
      const detailed = inputPromptProbeNeeded(room)
        ? await refreshInputPromptAsync(room, liveHint)
        : room
      return stripToken(detailed)
    },

    getRoomSummary(threadId: string): AgentRoom {
      return getRoomSummary(threadId)
    },

    getTmuxPaneSnapshot(threadId: string, agent: AgentName): TmuxPaneSnapshot {
      ensureThread(dataDir, threadId)
      const room = reconcileRoom(threadId)
      inviteForSnapshot(room, agent)
      if (room.session_state !== 'connected' && room.session_state !== 'recovered') {
        throw new ConflictError('room tmux session is not running')
      }
      if (!room.agents[agent]?.pane_viewable) {
        throw new ConflictError(`agent ${agent} tmux window is not viewable`)
      }

      const capturedAt = now()
      const raw = capturePane(executor, room, agent, -(TMUX_VIEW_LINE_LIMIT + 1))
      const lines = raw.replace(/\r/g, '').split('\n')
      const truncated = lines.length > TMUX_VIEW_LINE_LIMIT
      const text = (truncated ? lines.slice(-TMUX_VIEW_LINE_LIMIT) : lines).join('\n')

      return {
        thread_id: threadId,
        agent_id: agent,
        captured_at: capturedAt,
        text,
        truncated,
      }
    },

    sendTmuxPaneInput(threadId: string, agent: AgentName, input: TmuxPaneInput): void {
      ensureThread(dataDir, threadId)
      const room = reconcileRoom(threadId)
      inviteForSnapshot(room, agent)
      if (room.session_state !== 'connected' && room.session_state !== 'recovered') {
        throw new ConflictError('room tmux session is not running')
      }
      if (!room.agents[agent]?.pane_viewable) {
        throw new ConflictError(`agent ${agent} tmux window is not viewable`)
      }

      const target = `${room.tmux_session}:${windowForAgent(agent)}`
      if (input.type === 'key') {
        sendKeysToPane(target, [tmuxKeyForInput(input.key)])
        return
      }
      sendLiteralToPane(target, input.text)
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
        throw new ConflictError(`missing required room tools: ${missing.join(', ')}`)
      }

      const existing = expireActiveTurn(threadId)
      writeAgentPermissionSetup(dataDir, threadId, commandWrappers())
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
      const forceFresh = input.resume === false
      const shouldResume: Record<AgentName, boolean> = Object.fromEntries(
        roster.map((invite) => [
          invite.agent_id,
          !forceFresh && existing.started_at !== null && existing.agents[invite.agent_id]?.ready_at !== null,
        ]),
      )
      const room: InternalRoom = {
        ...existing,
        status: 'starting',
        claude_model: normalizeModel(input.claude_model),
        codex_model: normalizeModel(input.codex_model),
        roster,
        agents: agentStates(roster),
        updated_at: timestamp,
        started_at: forceFresh ? timestamp : (existing.started_at ?? timestamp),
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
        return markError(dataDir, room, message, cacheRoom)
      }

      const connected = withPaneViewable(executor, room, true)
      storeRoom(connected)
      return stripToken(connected)
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
          agents: agentStates(roster),
          updated_at: now(),
        }
        storeRoom(updated)
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
        agents: agentStates(roster, Object.fromEntries(roster.map((invite) => [
          invite.agent_id,
          restartIds.has(invite.agent_id)
            ? { ready_at: null, pane_viewable: false }
            : room.agents[invite.agent_id] ?? { ready_at: null, pane_viewable: false },
        ]))),
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
      const synced = withPaneViewable(executor, updated, true)
      storeRoom(synced)
      return stripToken(synced)
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
      storeRoom(restarted)
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
      const updated = withPaneViewable(executor, {
        ...room,
        status: 'stopped',
        updated_at: timestamp,
        stopped_at: timestamp,
        active_job_id: null,
        auto: null,
        idle_suggestion_request: null,
        session_state: 'stopped',
      }, false)
      if (room.active_job_id) clearTurnTimer(room.active_job_id)
      removeIfExists(currentTurnPath(dataDir, threadId))
      storeRoom(updated)
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
        return markError(dataDir, room, 'tmux session is not running', cacheRoom)
      }
      const body =
        input.body?.trim() ??
        'Roundtable nudge: inspect the current thread and approved discussion. If you need to make a durable comment or suggestion, wait for an explicit Roundtable request.'
      const promptPath = writeControlPrompt(dataDir, threadId, 'nudge', input.agent, body)
      sendLineToPane(`${room.tmux_session}:${windowForAgent(input.agent)}`, `Read ${promptPath} and follow it.`)
      const updated: InternalRoom = { ...room, updated_at: now(), last_error: null }
      storeRoom(updated)
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
        return markError(dataDir, room, 'tmux session is not running', cacheRoom)
      }

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
      const promptPath = writeControlPrompt(
        dataDir,
        threadId,
        'idle-suggestion',
        input.agent,
        `Roundtable idle suggestion request.${focus} Queue useful new top-level topics for user approval only; do not submit approved comments. For each proposed topic, write the body to a distinct Markdown file under .roundtable/tmp/ and submit it with: roundtable pending-discussion --body-file <that-file> --type comment. You may submit multiple pending discussions while this request is active. When finished, submit: roundtable done. If no useful topic exists, submit roundtable done without creating a pending discussion.`,
      )
      sendLineToPane(`${room.tmux_session}:${windowForAgent(input.agent)}`, `Read ${promptPath} and follow it.`)
      const updated: InternalRoom = {
        ...room,
        idle_suggestion_request: request,
        updated_at: now(),
        last_error: null,
      }
      storeRoom(updated)
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
        const promptPath = writeControlPrompt(
          dataDir,
          threadId,
          'idle-suggestion-cancel',
          request.agent,
          'Roundtable idle suggestion request cancelled. Do not submit a pending discussion for the cancelled request.',
        )
        sendLineToPane(`${room.tmux_session}:${windowForAgent(request.agent)}`, `Read ${promptPath} and follow it.`)
      }
      const updated: InternalRoom = {
        ...room,
        idle_suggestion_request: null,
        updated_at: now(),
        last_error: null,
      }
      storeRoom(updated)
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
      storeRoom(updated)
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
            pane_viewable: room.agents[agent].pane_viewable,
          },
        },
        updated_at: now(),
        last_error: null,
      }
      if (updated.roster.every(({ agent_id }) => updated.agents[agent_id]?.ready_at)) {
        updated.status = updated.active_job_id ? 'needs_attention' : 'idle'
      }
      updated.session_state = 'connected'
      storeRoom(updated)
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
          room: markError(dataDir, room, 'tmux session is not running', cacheRoom),
          job: failed,
        }
      }

      if (input.discussion_id && !isDiscussionRoot(dataDir, threadId, input.discussion_id)) {
        throw new NotFoundError(`discussion ${input.discussion_id} not found`)
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
      storeRoom(updated)
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
      const updated = updateProposal(dataDir, threadId, proposalId, {
        reviewer_agent: input.reviewer_agent ?? proposal.reviewer_agent,
      })
      inviteFor(room, updated.reviewer_agent)
      options.onCanonicalWrite?.(threadId, {
        filesAddedOrUpdated: [proposalJsonPath(dataDir, threadId, proposalId)],
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
      ensureOpenThread(dataDir, threadId)
      const room = expireActiveTurn(threadId)
      ensureConsolidationRoomAvailable(room)
      const proposal = getProposal(dataDir, threadId, proposalId)
      if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`)
      if (input.reviewer_agent) inviteFor(room, input.reviewer_agent)
      if (input.reviser_agent) inviteFor(room, input.reviser_agent)
      const revisionId = latestRevisionId(threadId, proposalId)
      if (!revisionId) throw new BadRequestError('proposal has no revision to revise')
      const updated = updateProposal(dataDir, threadId, proposalId, {
        reviewer_agent: input.reviewer_agent ?? proposal.reviewer_agent,
        reviser_agent: input.reviser_agent ?? proposal.reviser_agent,
      })
      inviteFor(room, updated.reviser_agent)
      options.onCanonicalWrite?.(threadId, {
        filesAddedOrUpdated: [proposalJsonPath(dataDir, threadId, proposalId)],
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
      storeRoom(updated)
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
        storeRoom(updated)
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
      storeRoom(updated)
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
      storeRoom(updated)
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
      if (room.session_active === false || (!hasFreshSessionState(room) && !sessionExists(executor, room.tmux_session))) {
        return markError(dataDir, room, 'tmux session is not running', cacheRoom)
      }

      const excerpt =
        room.input_prompt?.agent === input.agent ? room.input_prompt.excerpt : null
      sendKeysToPane(`${room.tmux_session}:${windowForAgent(input.agent)}`, promptAnswerKeys(excerpt, input.response))

      const updated: InternalRoom = {
        ...room,
        input_prompt: null,
        updated_at: now(),
        last_error: null,
      }
      storeRoom(updated)
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
      const comment = addAgentComment(dataDir, threadId, {
        author: input.agent,
        body: input.body,
        type: input.type,
        reply_to: replyTo,
      })
      options.onCanonicalWrite?.(threadId, {
        filesAddedOrUpdated: [commentsPath(dataDir, threadId)],
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
        setThreadSummaryDirty(dataDir, threadId, 'pending_count')
        let pending: PendingDiscussion
        try {
          pending = addPendingDiscussion(dataDir, threadId, {
            author: input.agent,
            body: input.body,
            type: input.type,
            origin_discussion_id: input.origin_discussion_id ?? null,
            origin_comment_id: input.origin_comment_id ?? null,
          })
        } catch (err) {
          acceptDirtyThreadSummaryWrite(threadId)
          throw err
        }
        try {
          updateThreadSummary(
            dataDir,
            threadId,
            { pending_count: listPendingDiscussions(dataDir, threadId).length },
            ['pending_count'],
          )
        } finally {
          options.onCanonicalWrite?.(threadId, {
            filesAddedOrUpdated: [
              pendingDiscussionsPath(dataDir, threadId),
              threadJsonPath(dataDir, threadId),
            ],
          })
        }
        const updated: InternalRoom = {
          ...room,
          idle_suggestion_request: {
            ...room.idle_suggestion_request,
            submitted_count: room.idle_suggestion_request.submitted_count + 1,
          },
          updated_at: now(),
          last_error: null,
        }
        storeRoom(updated)
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

      setThreadSummaryDirty(dataDir, threadId, 'pending_count')
      let pending: PendingDiscussion
      try {
        pending = addPendingDiscussion(dataDir, threadId, {
          author: input.agent,
          body: input.body,
          type: input.type,
          origin_discussion_id:
            input.origin_discussion_id ?? job.turn.discussion_id ?? null,
          origin_comment_id: input.origin_comment_id ?? null,
        })
      } catch (err) {
        acceptDirtyThreadSummaryWrite(threadId)
        throw err
      }
      try {
        updateThreadSummary(
          dataDir,
          threadId,
          { pending_count: listPendingDiscussions(dataDir, threadId).length },
          ['pending_count'],
        )
      } finally {
        options.onCanonicalWrite?.(threadId, {
          filesAddedOrUpdated: [
            pendingDiscussionsPath(dataDir, threadId),
            threadJsonPath(dataDir, threadId),
          ],
        })
      }

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

      const revision = addProposalRevision(
        dataDir,
        threadId,
        job.turn.proposal_id,
        input.body,
        input.agent,
      )
      options.onCanonicalWrite?.(threadId, {
        filesAddedOrUpdated: [
          revisionPath(dataDir, threadId, job.turn.proposal_id, revision.id),
          revisionJsonFile(threadId, job.turn.proposal_id, revision.id),
          proposalJsonPath(dataDir, threadId, job.turn.proposal_id),
        ],
      })
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
      options.onCanonicalWrite?.(threadId, {
        filesAddedOrUpdated: [proposalJsonPath(dataDir, threadId, proposal.id)],
      })
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

      const review = addProposalReview(
        dataDir,
        threadId,
        job.turn.proposal_id,
        input.body,
        input.agent,
        job.turn.revision_id,
      )
      options.onCanonicalWrite?.(threadId, {
        filesAddedOrUpdated: [
          reviewPath(dataDir, threadId, job.turn.proposal_id, review.id),
          reviewJsonPath(dataDir, threadId, job.turn.proposal_id, review.id),
          proposalJsonPath(dataDir, threadId, job.turn.proposal_id),
        ],
      })
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
        options.onCanonicalWrite?.(threadId, {
          filesAddedOrUpdated: [proposalJsonPath(dataDir, threadId, proposal.id)],
        })
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
          room: markError(dataDir, room, 'tmux session is not running', cacheRoom),
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
