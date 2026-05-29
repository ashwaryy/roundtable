import type {
  AgentName,
  AgentRuntime,
  BoundedJob,
  SystemPromptSection,
  ThreadAgentInvite,
} from '@roundtable/shared'
import { commandWrappers } from './runtime-config'

export function promptAnswerKeys(
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

export function startupPrompt(invite: ThreadAgentInvite): string {
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

export function buildTurnPrompt(job: BoundedJob): string {
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
  const custom = job.turn.instructions ? `\n\nUser instructions:\n${job.turn.instructions}` : ''
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
  const offersSubmissionChoice = Boolean(job.turn.auto_run_id) || discussionAskPolicy.length > 0
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
    'If the thread mentions attached files, product docs, the codebase, or a project snapshot, verify visibility by checking `context-items.jsonl` and `project-snapshot-manifest.json` before claiming the files are or are not present.',
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

export function turnPromptRelativePath(job: BoundedJob): string {
  return `.roundtable/tmp/${job.turn.id}-${job.turn.agent}-turn.md`
}

export function controlPromptRelativePath(
  kind: 'nudge' | 'idle-suggestion' | 'idle-suggestion-cancel',
  agent: AgentName,
  timestamp: string,
): string {
  return `.roundtable/tmp/${kind}-${agent}-${timestamp.replace(/[^0-9A-Za-z_-]+/g, '-')}.md`
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

export function systemPromptSections(render: {
  cliCommand: (
    runtime: AgentRuntime,
    model: string | null,
    effort: string | null,
    promptFile: string,
  ) => string
  claudeLocalSettings: (hookPath: string, wrappers: string[]) => unknown
  codexProjectConfig: (hookPath: string) => string
  codexRulesText: (wrappers: string[]) => string
}): SystemPromptSection[] {
  const wrappers = commandWrappers()
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
      used_by:
        'Written once per invited agent during room launch, then passed to Claude or Codex as `Read {promptFile} and follow it.`',
      source: 'packages/backend/src/rooms/prompts.ts:startupPrompt()',
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
      used_by:
        'Written to `.roundtable/tmp/{job}-{agent}-turn.md` for Ask, discussion reply, and auto-discussion turns.',
      source: 'packages/backend/src/rooms/prompts.ts:buildTurnPrompt()',
      notes: ['The live prompt varies by discussion scope, auto-run policy, and user turn instructions.'],
      content: buildTurnPrompt(sampleJob('job-001', 'comment')),
    },
    {
      id: 'turn-proposal-draft',
      title: 'Consolidation Draft Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by: 'Written when Roundtable asks an agent to draft a proposed next thread.',
      source: 'packages/backend/src/rooms/prompts.ts:buildTurnPrompt()',
      notes: ['Uses `.roundtable/tmp/consolidation-context.md` and submits with `roundtable proposal`.'],
      content: buildTurnPrompt(sampleJob('job-002', 'proposal_draft')),
    },
    {
      id: 'turn-proposal-review',
      title: 'Consolidation Review Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by:
        'Written when Roundtable asks an agent to review a proposed derived thread.',
      source: 'packages/backend/src/rooms/prompts.ts:buildTurnPrompt()',
      notes: ['Submits with `roundtable review`.'],
      content: buildTurnPrompt(sampleJob('job-003', 'proposal_review')),
    },
    {
      id: 'turn-proposal-revision',
      title: 'Consolidation Revision Turn Prompt',
      runtime: 'common',
      kind: 'turn_prompt',
      used_by:
        'Written when Roundtable asks an agent to revise the proposed derived thread.',
      source: 'packages/backend/src/rooms/prompts.ts:buildTurnPrompt()',
      notes: ['Submits the revised body with `roundtable proposal`.'],
      content: buildTurnPrompt(sampleJob('job-004', 'proposal_revision')),
    },
    {
      id: 'claude-launch',
      title: 'Claude Launch Command',
      runtime: 'claude',
      kind: 'launch_command',
      used_by: 'Written into the generated launch script for Claude runtime agents.',
      source: 'packages/backend/src/rooms/runtime-config.ts:cliCommand()',
      notes: [
        'The prompt content is not embedded directly; Claude is told to read the generated prompt file.',
      ],
      content: render.cliCommand('claude', '<model-if-configured>', '<effort-if-configured>', promptFile),
    },
    {
      id: 'claude-settings',
      title: 'Claude Local Settings',
      runtime: 'claude',
      kind: 'runtime_config',
      used_by: 'Written to `.claude/settings.local.json` inside each thread workspace.',
      source: 'packages/backend/src/rooms/runtime-config.ts:claudeLocalSettings()',
      notes: ['Controls Claude tool permissions and installs the shared Bash PreToolUse hook.'],
      content: JSON.stringify(render.claudeLocalSettings(hookPath, wrappers), null, 2),
    },
    {
      id: 'codex-launch',
      title: 'Codex Launch Command',
      runtime: 'codex',
      kind: 'launch_command',
      used_by: 'Written into the generated launch script for Codex runtime agents.',
      source: 'packages/backend/src/rooms/runtime-config.ts:cliCommand()',
      notes: [
        'The prompt content is not embedded directly; Codex is told to read the generated prompt file.',
      ],
      content: render.cliCommand('codex', '<model-if-configured>', '<effort-if-configured>', promptFile),
    },
    {
      id: 'codex-config',
      title: 'Codex Project Config',
      runtime: 'codex',
      kind: 'runtime_config',
      used_by: 'Written to `.codex/config.toml` inside each thread workspace.',
      source: 'packages/backend/src/rooms/runtime-config.ts:codexProjectConfig()',
      notes: [
        'Sets workspace-write sandboxing, disables approvals, allows localhost network proxy, and installs the shared Bash PreToolUse hook.',
      ],
      content: render.codexProjectConfig(hookPath),
    },
    {
      id: 'codex-rules',
      title: 'Codex Rules',
      runtime: 'codex',
      kind: 'runtime_rules',
      used_by: 'Written to `.codex/rules/default.rules` inside each thread workspace.',
      source: 'packages/backend/src/rooms/runtime-config.ts:codexRulesText()',
      notes: [
        'Mirrors each command under any configured command wrappers (ROUNDTABLE_COMMAND_WRAPPERS); with none configured, only the bare command rules are written.',
      ],
      content: render.codexRulesText(wrappers),
    },
  ]
}
