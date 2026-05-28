import fs from 'node:fs'
import path from 'node:path'
import type { AgentRuntime } from '@roundtable/shared'
import {
  claudeLocalSettingsPath,
  codexProjectConfigPath,
  codexRulesPath,
  preToolUseHookPath,
} from '../storage/paths'

const READ_COMMANDS = ['pwd', 'ls', 'cat', 'grep', 'sed', 'rg', 'read', 'head', 'tail'] as const
const WORKFLOW_COMMANDS = [
  'git status',
  'git diff',
  'npm test',
  'npm run test',
  'npm run typecheck',
  'npm run build',
  'npm run dev',
] as const
const HELPER_COMMANDS = [
  'roundtable ready',
  'roundtable comment',
  'roundtable pending-discussion',
  'roundtable done',
  'roundtable proposal',
  'roundtable review',
] as const
const DESTRUCTIVE_COMMANDS = [
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
] as const

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents, { mode: 0o755 })
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeTextFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

export function commandVariants(command: string, rtkAvailable: boolean): string[] {
  return rtkAvailable ? [command, `rtk ${command}`] : [command]
}

function claudeBashRules(
  commands: readonly string[],
  rtkAvailable: boolean,
  wildcard = '',
): string[] {
  return commands.flatMap((command) =>
    commandVariants(command, rtkAvailable).map((variant) => `Bash(${variant}${wildcard})`),
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

function allowedShellCommands(rtkAvailable: boolean): string[] {
  return [...READ_COMMANDS, ...WORKFLOW_COMMANDS, ...HELPER_COMMANDS].flatMap((command) =>
    commandVariants(command, rtkAvailable),
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

export function claudeLocalSettings(hookPath: string, rtkAvailable: boolean): unknown {
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
        ...claudeBashRules(READ_COMMANDS, rtkAvailable, ' *'),
        ...claudeBashRules(WORKFLOW_COMMANDS, rtkAvailable, ' *'),
        ...claudeBashRules(HELPER_COMMANDS, rtkAvailable, ' *'),
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
        ...claudeBashRules(DESTRUCTIVE_COMMANDS, rtkAvailable, ' *'),
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

export function codexProjectConfig(hookPath: string): string {
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

export function codexRulesText(rtkAvailable: boolean): string {
  const allowReason = 'Allowed for Roundtable agent room workflow'
  const forbidReason =
    'Blocked by Roundtable because this mutates durable state or publishes externally'
  const codexRules = [
    ...HELPER_COMMANDS.flatMap((command) =>
      codexRulesForCommand(command.split(' '), rtkAvailable, 'allow', allowReason),
    ),
    ...READ_COMMANDS.flatMap((command) =>
      codexRulesForCommand([command], rtkAvailable, 'allow', allowReason),
    ),
    ...WORKFLOW_COMMANDS.flatMap((command) =>
      codexRulesForCommand(command.split(' '), rtkAvailable, 'allow', allowReason),
    ),
    ...DESTRUCTIVE_COMMANDS.flatMap((command) =>
      codexRulesForCommand(command.split(' '), rtkAvailable, 'forbidden', forbidReason),
    ),
  ]
  return `${codexRules.join('\n')}\n`
}

export function writeAgentPermissionSetup(
  dataDir: string,
  threadId: string,
  rtkAvailable: boolean,
): void {
  const hookPath = writePreToolUseHook(
    dataDir,
    threadId,
    allowedShellCommands(rtkAvailable),
  )
  writeJsonFile(
    claudeLocalSettingsPath(dataDir, threadId),
    claudeLocalSettings(hookPath, rtkAvailable),
  )
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

export function cliCommand(
  runtime: AgentRuntime,
  model: string | null,
  effort: string | null,
  promptFile: string,
): string {
  const modelPart = model ? ` --model ${shellSingleQuote(model)}` : ''
  const effortPart = effort ? ` --effort ${shellSingleQuote(effort)}` : ''
  if (runtime === 'claude') {
    return `claude --permission-mode dontAsk${modelPart}${effortPart} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
  }
  const codexEffort = effort
    ? ` -c ${shellSingleQuote(`model_reasoning_effort="${effort}"`)}`
    : ''
  return `codex ${codexSandboxArgs()}${modelPart}${codexEffort} ${shellSingleQuote(`Read ${promptFile} and follow it.`)}`
}

export function resumeCliCommand(
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
  const codexEffort = effort
    ? ` -c ${shellSingleQuote(`model_reasoning_effort="${effort}"`)}`
    : ''
  return `codex resume --last ${codexSandboxArgs()}${modelPart}${codexEffort}`
}
