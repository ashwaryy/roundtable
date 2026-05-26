import fs from 'node:fs'
import path from 'node:path'
import type {
  Agent,
  CreateAgentInput,
  InviteAgentInput,
  ReorderThreadAgentsInput,
  ThreadAgentInvite,
  UpdateAgentInput,
  UpdateThreadAgentInviteInput,
} from '@roundtable/shared'
import { agentJsonPath, agentsDir, threadAgentsPath, threadsDir } from './paths'
import { BadRequestError, ConflictError, NotFoundError } from './errors'

const BUILTINS: Agent[] = [
  {
    id: 'claude',
    name: 'Claude',
    runtime: 'claude',
    role_description: 'Thoughtful critic',
    instructions: 'Focus on clarity, gaps, and practical improvements.',
    model: null,
    effort: null,
    color: 'amber',
    logo_url: null,
    archived: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'codex',
    name: 'Codex',
    runtime: 'codex',
    role_description: 'Implementation reviewer',
    instructions: 'Focus on technical feasibility, risk, and concrete revisions.',
    model: null,
    effort: 'medium',
    color: 'green',
    logo_url: null,
    archived: false,
    created_at: '',
    updated_at: '',
  },
]

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, filePath)
}

export function seedBuiltInAgents(dataDir: string): void {
  fs.mkdirSync(agentsDir(dataDir), { recursive: true })
  const timestamp = new Date().toISOString()
  for (const builtin of BUILTINS) {
    if (!fs.existsSync(agentJsonPath(dataDir, builtin.id))) {
      writeJsonAtomic(agentJsonPath(dataDir, builtin.id), {
        ...builtin,
        created_at: timestamp,
        updated_at: timestamp,
      })
    }
  }
}

export function listAgents(dataDir: string, includeArchived = true): Agent[] {
  seedBuiltInAgents(dataDir)
  return fs.readdirSync(agentsDir(dataDir))
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(agentsDir(dataDir), name), 'utf8')) as Agent)
    .filter((agent) => includeArchived || !agent.archived)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name))
}

export function getAgent(dataDir: string, agentId: string): Agent | null {
  seedBuiltInAgents(dataDir)
  const filePath = agentJsonPath(dataDir, agentId)
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8')) as Agent
    : null
}

function uniqueName(dataDir: string, requested: string, exceptId?: string): string {
  const existing = new Set(
    listAgents(dataDir).filter((agent) => agent.id !== exceptId).map((agent) => agent.name.toLowerCase()),
  )
  if (!existing.has(requested.toLowerCase())) return requested
  let suffix = 2
  while (existing.has(`${requested} (${suffix})`.toLowerCase())) suffix += 1
  return `${requested} (${suffix})`
}

function validateEffort(agent: Pick<Agent, 'runtime' | 'effort'>): void {
  if (!agent.effort) return
  const allowed = agent.runtime === 'codex'
    ? ['low', 'medium', 'high', 'xhigh']
    : ['low', 'medium', 'high']
  if (!allowed.includes(agent.effort)) {
    throw new BadRequestError('effort is not valid for runtime')
  }
}

function newId(dataDir: string, name: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
  let id = `agent-${stem}`
  let suffix = 2
  while (getAgent(dataDir, id)) {
    id = `agent-${stem}-${suffix}`
    suffix += 1
  }
  return id
}

export function createAgent(dataDir: string, input: CreateAgentInput): Agent {
  const timestamp = new Date().toISOString()
  const agent: Agent = {
    id: newId(dataDir, input.name),
    name: uniqueName(dataDir, input.name),
    runtime: input.runtime,
    role_description: input.role_description ?? '',
    instructions: input.instructions ?? '',
    model: input.model ?? null,
    effort: input.effort ?? null,
    color: input.color ?? 'blue',
    logo_url: input.logo_url ?? null,
    archived: false,
    created_at: timestamp,
    updated_at: timestamp,
  }
  validateEffort(agent)
  writeJsonAtomic(agentJsonPath(dataDir, agent.id), agent)
  return agent
}

export function updateAgent(dataDir: string, agentId: string, patch: UpdateAgentInput): Agent {
  const existing = getAgent(dataDir, agentId)
  if (!existing) throw new NotFoundError(`agent ${agentId} not found`)
  const updated: Agent = {
    ...existing,
    ...patch,
    name: patch.name ? uniqueName(dataDir, patch.name, agentId) : existing.name,
    updated_at: new Date().toISOString(),
  }
  validateEffort(updated)
  writeJsonAtomic(agentJsonPath(dataDir, agentId), updated)
  return updated
}

function isInvited(dataDir: string, agentId: string): boolean {
  if (!fs.existsSync(threadsDir(dataDir))) return false
  return fs.readdirSync(threadsDir(dataDir)).some((threadId) => {
    const filePath = threadAgentsPath(dataDir, threadId)
    if (!fs.existsSync(filePath)) return false
    const invites = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ThreadAgentInvite[]
    return invites.some((invite) => invite.agent_id === agentId)
  })
}

export function deleteAgent(dataDir: string, agentId: string): Agent | null {
  const existing = getAgent(dataDir, agentId)
  if (!existing) throw new NotFoundError(`agent ${agentId} not found`)
  if (agentId === 'claude' || agentId === 'codex' || isInvited(dataDir, agentId)) {
    return updateAgent(dataDir, agentId, { archived: true })
  }
  fs.unlinkSync(agentJsonPath(dataDir, agentId))
  return null
}

function snapshot(agent: Agent, order: number): ThreadAgentInvite {
  return {
    agent_id: agent.id,
    name: agent.name,
    runtime: agent.runtime,
    role_description: agent.role_description,
    instructions: agent.instructions,
    model: agent.model,
    effort: agent.effort,
    color: agent.color,
    logo_url: agent.logo_url,
    order,
  }
}

export function initializeThreadAgents(dataDir: string, threadId: string, agentIds?: string[]): ThreadAgentInvite[] {
  const ids = agentIds ?? ['claude', 'codex']
  const unique = [...new Set(ids)]
  if (unique.length < 1 || unique.length > 8) throw new BadRequestError('a thread needs 1 to 8 agents')
  const invites = unique.map((id, order) => {
    const agent = getAgent(dataDir, id)
    if (!agent || agent.archived) throw new NotFoundError(`agent ${id} not found`)
    return snapshot(agent, order)
  })
  writeJsonAtomic(threadAgentsPath(dataDir, threadId), invites)
  return invites
}

export function listThreadAgents(dataDir: string, threadId: string): ThreadAgentInvite[] {
  const filePath = threadAgentsPath(dataDir, threadId)
  if (!fs.existsSync(filePath)) throw new NotFoundError(`thread agent roster for ${threadId} not found`)
  return (JSON.parse(fs.readFileSync(filePath, 'utf8')) as ThreadAgentInvite[])
    .sort((a, b) => a.order - b.order)
}

export function inviteAgent(dataDir: string, threadId: string, input: InviteAgentInput): ThreadAgentInvite[] {
  const invites = listThreadAgents(dataDir, threadId)
  if (invites.some((invite) => invite.agent_id === input.agent_id)) {
    throw new ConflictError('agent is already invited')
  }
  if (invites.length >= 8) throw new BadRequestError('a thread cannot invite more than 8 agents')
  const agent = getAgent(dataDir, input.agent_id)
  if (!agent || agent.archived) throw new NotFoundError(`agent ${input.agent_id} not found`)
  invites.push({ ...snapshot(agent, invites.length), model: input.model ?? agent.model, effort: input.effort ?? agent.effort })
  writeJsonAtomic(threadAgentsPath(dataDir, threadId), invites)
  return invites
}

export function updateThreadAgent(dataDir: string, threadId: string, agentId: string, patch: UpdateThreadAgentInviteInput): ThreadAgentInvite[] {
  const invites = listThreadAgents(dataDir, threadId)
  const index = invites.findIndex((invite) => invite.agent_id === agentId)
  if (index < 0) throw new NotFoundError(`agent ${agentId} is not invited`)
  invites[index] = { ...invites[index], ...patch }
  writeJsonAtomic(threadAgentsPath(dataDir, threadId), invites)
  return invites
}

export function removeThreadAgent(dataDir: string, threadId: string, agentId: string): ThreadAgentInvite[] {
  const invites = listThreadAgents(dataDir, threadId)
  if (invites.length <= 1) throw new BadRequestError('a thread needs at least one agent')
  const filtered = invites.filter((invite) => invite.agent_id !== agentId)
  if (filtered.length === invites.length) throw new NotFoundError(`agent ${agentId} is not invited`)
  const reordered = filtered.map((invite, order) => ({ ...invite, order }))
  writeJsonAtomic(threadAgentsPath(dataDir, threadId), reordered)
  return reordered
}

export function reorderThreadAgents(dataDir: string, threadId: string, input: ReorderThreadAgentsInput): ThreadAgentInvite[] {
  const invites = listThreadAgents(dataDir, threadId)
  const current = invites.map((invite) => invite.agent_id).sort().join('|')
  const proposed = [...new Set(input.agent_ids)].sort().join('|')
  if (input.agent_ids.length !== invites.length || proposed !== current) {
    throw new BadRequestError('agent_ids must contain every invited agent exactly once')
  }
  const byId = new Map(invites.map((invite) => [invite.agent_id, invite]))
  const reordered = input.agent_ids.map((id, order) => ({ ...byId.get(id)!, order }))
  writeJsonAtomic(threadAgentsPath(dataDir, threadId), reordered)
  return reordered
}
