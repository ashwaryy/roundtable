import fs from 'node:fs'
import path from 'node:path'
import type {
  ConsolidationProposal,
  CreateConsolidationInput,
  ProposalRevision,
  CommentAuthor,
} from '@roundtable/shared'
import {
  consolidationsDir,
  proposalJsonPath,
  revisionsDir,
  revisionPath,
  threadJsonPath,
} from './paths'
import { NotFoundError } from './errors'

function nextConsolidationId(proposals: ConsolidationProposal[]): string {
  let max = 0
  for (const proposal of proposals) {
    const match = /^consolidation-(\d+)$/.exec(proposal.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `consolidation-${String(max + 1).padStart(3, '0')}`
}

function nextRevisionId(revDir: string): string {
  if (!fs.existsSync(revDir)) return 'r001'

  let max = 0
  for (const file of fs.readdirSync(revDir)) {
    const match = /^r(\d+)\.md$/.exec(file)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `r${String(max + 1).padStart(3, '0')}`
}

export function createProposal(
  dataDir: string,
  threadId: string,
  input: CreateConsolidationInput,
): ConsolidationProposal {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const id = nextConsolidationId(listProposals(dataDir, threadId))
  fs.mkdirSync(revisionsDir(dataDir, threadId, id), { recursive: true })

  const proposal: ConsolidationProposal = {
    id,
    thread_id: threadId,
    status: 'drafting',
    summary: input.summary ?? null,
    created_at: new Date().toISOString(),
    applied_thread_id: null,
  }

  fs.writeFileSync(
    proposalJsonPath(dataDir, threadId, id),
    JSON.stringify(proposal, null, 2),
  )
  return proposal
}

export function getProposal(
  dataDir: string,
  threadId: string,
  proposalId: string,
): ConsolidationProposal | null {
  const jsonPath = proposalJsonPath(dataDir, threadId, proposalId)
  if (!fs.existsSync(jsonPath)) return null
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ConsolidationProposal
}

export function listProposals(
  dataDir: string,
  threadId: string,
): ConsolidationProposal[] {
  const dir = consolidationsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return []

  const proposals: ConsolidationProposal[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const jsonPath = proposalJsonPath(dataDir, threadId, entry.name)
    if (!fs.existsSync(jsonPath)) continue
    proposals.push(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ConsolidationProposal)
  }

  proposals.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return proposals
}

export function addProposalRevision(
  dataDir: string,
  threadId: string,
  proposalId: string,
  body: string,
  author: CommentAuthor,
): ProposalRevision {
  if (!body.trim()) throw new Error('revision body cannot be empty')

  if (!getProposal(dataDir, threadId, proposalId)) {
    throw new NotFoundError(`proposal ${proposalId} not found`)
  }

  const revDir = revisionsDir(dataDir, threadId, proposalId)
  fs.mkdirSync(revDir, { recursive: true })
  const id = nextRevisionId(revDir)

  const revision: ProposalRevision = {
    id,
    proposal_id: proposalId,
    thread_id: threadId,
    author,
    created_at: new Date().toISOString(),
  }

  fs.writeFileSync(revisionPath(dataDir, threadId, proposalId, id), body)
  fs.writeFileSync(path.join(revDir, `${id}.json`), JSON.stringify(revision, null, 2))
  return revision
}

export function listRevisions(
  dataDir: string,
  threadId: string,
  proposalId: string,
): ProposalRevision[] {
  const revDir = revisionsDir(dataDir, threadId, proposalId)
  if (!fs.existsSync(revDir)) return []

  return fs
    .readdirSync(revDir)
    .filter((file) => /^r\d+\.json$/.test(file))
    .sort()
    .map(
      (file) =>
        JSON.parse(fs.readFileSync(path.join(revDir, file), 'utf8')) as ProposalRevision,
    )
}

export function getLatestRevision(
  dataDir: string,
  threadId: string,
  proposalId: string,
): string | null {
  const revDir = revisionsDir(dataDir, threadId, proposalId)
  if (!fs.existsSync(revDir)) return null

  const files = fs
    .readdirSync(revDir)
    .filter((file) => /^r\d+\.md$/.test(file))
    .sort()
  if (files.length === 0) return null

  const latestRevisionId = files[files.length - 1].replace(/\.md$/, '')
  return fs.readFileSync(
    revisionPath(dataDir, threadId, proposalId, latestRevisionId),
    'utf8',
  )
}
