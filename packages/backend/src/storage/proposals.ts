import fs from 'node:fs'
import path from 'node:path'
import type {
  AgentName,
  CommentAuthor,
  ConsolidationProposal,
  ConsolidationStatus,
  CreateConsolidationInput,
  ProposalReview,
  ProposalRevision,
  SavedConsolidation,
  SavedOutput,
} from '@roundtable/shared'
import {
  nextConsolidationCounterValue,
  nextRevisionCounterValue,
  nextReviewCounterValue,
} from './counters'
import {
  consolidationDir,
  consolidationsDir,
  proposalJsonPath,
  reviewJsonPath,
  reviewPath,
  reviewsDir,
  revisionsDir,
  revisionPath,
  savedConsolidationDir,
  savedDir,
  threadJsonPath,
  threadsDir,
} from './paths'
import { BadRequestError, ConflictError, NotFoundError } from './errors'

const DEFAULT_DRAFTER: AgentName = 'codex'
const DEFAULT_REVIEWER: AgentName = 'claude'
const DEFAULT_REVISER: AgentName = 'codex'

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, filePath)
}

function writeTextAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, value)
  fs.renameSync(tmp, filePath)
}

function normalizeProposal(proposal: ConsolidationProposal): ConsolidationProposal {
  return {
    ...proposal,
    instructions: proposal.instructions ?? null,
    drafter_agent: proposal.drafter_agent ?? DEFAULT_DRAFTER,
    reviewer_agent: proposal.reviewer_agent ?? DEFAULT_REVIEWER,
    reviser_agent: proposal.reviser_agent ?? DEFAULT_REVISER,
    updated_at: proposal.updated_at ?? proposal.created_at,
    latest_revision_id: proposal.latest_revision_id ?? null,
    latest_review_id: proposal.latest_review_id ?? null,
    saved_artifact_id: proposal.saved_artifact_id ?? null,
  }
}

function nextConsolidationId(dataDir: string, threadId: string): string {
  return `consolidation-${String(nextConsolidationCounterValue(dataDir, threadId)).padStart(3, '0')}`
}

function nextRevisionId(dataDir: string, threadId: string, proposalId: string): string {
  return `r${String(nextRevisionCounterValue(dataDir, threadId, proposalId)).padStart(3, '0')}`
}

function nextReviewId(dataDir: string, threadId: string, proposalId: string): string {
  return `review-${String(nextReviewCounterValue(dataDir, threadId, proposalId)).padStart(3, '0')}`
}

function idNumber(id: string | null | undefined): number {
  const match = id ? /(\d+)$/.exec(id) : null
  return match ? Number(match[1]) : 0
}

function latestIdFromDir(dir: string, pattern: RegExp): string | null {
  if (!fs.existsSync(dir)) return null
  let latest: string | null = null
  let latestNumber = 0
  for (const file of fs.readdirSync(dir)) {
    const match = pattern.exec(file)
    if (!match) continue
    const currentNumber = Number(match[1])
    if (currentNumber > latestNumber) {
      latestNumber = currentNumber
      latest = file.replace(/\.json$/, '')
    }
  }
  return latest
}

function ensureProposal(
  dataDir: string,
  threadId: string,
  proposalId: string,
): ConsolidationProposal {
  const proposal = getProposal(dataDir, threadId, proposalId)
  if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`)
  return proposal
}

function ensureEditable(proposal: ConsolidationProposal): void {
  if (
    proposal.status === 'applied' ||
    proposal.status === 'saved' ||
    proposal.status === 'rejected'
  ) {
    throw new ConflictError(`proposal ${proposal.id} is ${proposal.status}`)
  }
}

export function createProposal(
  dataDir: string,
  threadId: string,
  input: CreateConsolidationInput,
): ConsolidationProposal {
  if (!fs.existsSync(threadJsonPath(dataDir, threadId))) {
    throw new NotFoundError(`thread ${threadId} not found`)
  }

  const id = nextConsolidationId(dataDir, threadId)
  fs.mkdirSync(revisionsDir(dataDir, threadId, id), { recursive: true })
  fs.mkdirSync(reviewsDir(dataDir, threadId, id), { recursive: true })
  const timestamp = new Date().toISOString()

  const proposal: ConsolidationProposal = {
    id,
    thread_id: threadId,
    status: 'drafting',
    summary: input.summary ?? null,
    instructions: input.instructions ?? null,
    drafter_agent: input.drafter_agent ?? DEFAULT_DRAFTER,
    reviewer_agent: input.reviewer_agent ?? DEFAULT_REVIEWER,
    reviser_agent: input.reviser_agent ?? DEFAULT_REVISER,
    created_at: timestamp,
    updated_at: timestamp,
    latest_revision_id: null,
    latest_review_id: null,
    applied_thread_id: null,
    saved_artifact_id: null,
  }

  writeJsonAtomic(proposalJsonPath(dataDir, threadId, id), proposal)
  return proposal
}

export function getProposal(
  dataDir: string,
  threadId: string,
  proposalId: string,
): ConsolidationProposal | null {
  const jsonPath = proposalJsonPath(dataDir, threadId, proposalId)
  if (!fs.existsSync(jsonPath)) return null
  return normalizeProposal(
    JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ConsolidationProposal,
  )
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
    proposals.push(
      normalizeProposal(
        JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ConsolidationProposal,
      ),
    )
  }

  proposals.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return proposals
}

export function listProposalStatuses(
  dataDir: string,
  threadId: string,
): ConsolidationStatus[] {
  const dir = consolidationsDir(dataDir, threadId)
  if (!fs.existsSync(dir)) return []

  const statuses: ConsolidationStatus[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const jsonPath = proposalJsonPath(dataDir, threadId, entry.name)
    if (!fs.existsSync(jsonPath)) continue
    const proposal = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      status?: ConsolidationStatus
    }
    if (proposal.status) statuses.push(proposal.status)
  }
  return statuses
}

export function updateProposal(
  dataDir: string,
  threadId: string,
  proposalId: string,
  patch: Partial<ConsolidationProposal>,
): ConsolidationProposal {
  const proposal = ensureProposal(dataDir, threadId, proposalId)
  const updated = normalizeProposal({
    ...proposal,
    ...patch,
    id: proposal.id,
    thread_id: proposal.thread_id,
    updated_at: new Date().toISOString(),
  })
  writeJsonAtomic(proposalJsonPath(dataDir, threadId, proposalId), updated)
  return updated
}

export function setProposalStatus(
  dataDir: string,
  threadId: string,
  proposalId: string,
  status: ConsolidationStatus,
): ConsolidationProposal {
  return updateProposal(dataDir, threadId, proposalId, { status })
}

export function addProposalRevision(
  dataDir: string,
  threadId: string,
  proposalId: string,
  body: string,
  author: CommentAuthor,
): ProposalRevision {
  if (!body.trim()) throw new BadRequestError('revision body cannot be empty')

  const proposal = ensureProposal(dataDir, threadId, proposalId)
  ensureEditable(proposal)

  const revDir = revisionsDir(dataDir, threadId, proposalId)
  fs.mkdirSync(revDir, { recursive: true })
  const id = nextRevisionId(dataDir, threadId, proposalId)

  const revision: ProposalRevision = {
    id,
    proposal_id: proposalId,
    thread_id: threadId,
    author,
    created_at: new Date().toISOString(),
  }

  writeTextAtomic(revisionPath(dataDir, threadId, proposalId, id), body)
  writeJsonAtomic(path.join(revDir, `${id}.json`), revision)
  try {
    updateProposal(dataDir, threadId, proposalId, { latest_revision_id: id })
  } catch (err) {
    console.error(
      `failed to update latest revision pointer proposal=${proposalId} revision=${id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    throw err
  }
  return revision
}

export function getRevisionBody(
  dataDir: string,
  threadId: string,
  proposalId: string,
  revisionId: string,
): string | null {
  const filePath = revisionPath(dataDir, threadId, proposalId, revisionId)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
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
  const proposal = getProposal(dataDir, threadId, proposalId)
  if (proposal?.latest_revision_id) {
    const body = getRevisionBody(dataDir, threadId, proposalId, proposal.latest_revision_id)
    if (body !== null) return body
  }
  // Recovery-only fallback for a crash/failure before latest_revision_id was updated.
  // Steady-state reads should use the authoritative pointer after startup repair.
  const revisions = listRevisions(dataDir, threadId, proposalId)
  const latest = revisions[revisions.length - 1]
  return latest ? getRevisionBody(dataDir, threadId, proposalId, latest.id) : null
}

export function addProposalReview(
  dataDir: string,
  threadId: string,
  proposalId: string,
  body: string,
  author: AgentName,
  revisionId: string | null,
): ProposalReview {
  if (!body.trim()) throw new BadRequestError('review body cannot be empty')

  const proposal = ensureProposal(dataDir, threadId, proposalId)
  ensureEditable(proposal)

  if (revisionId && !getRevisionBody(dataDir, threadId, proposalId, revisionId)) {
    throw new NotFoundError(`revision ${revisionId} not found`)
  }

  const reviewDir = reviewsDir(dataDir, threadId, proposalId)
  fs.mkdirSync(reviewDir, { recursive: true })
  const id = nextReviewId(dataDir, threadId, proposalId)
  const review: ProposalReview = {
    id,
    proposal_id: proposalId,
    thread_id: threadId,
    author,
    revision_id: revisionId,
    created_at: new Date().toISOString(),
  }

  writeTextAtomic(reviewPath(dataDir, threadId, proposalId, id), body)
  writeJsonAtomic(reviewJsonPath(dataDir, threadId, proposalId, id), review)
  try {
    updateProposal(dataDir, threadId, proposalId, { latest_review_id: id })
  } catch (err) {
    console.error(
      `failed to update latest review pointer proposal=${proposalId} review=${id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    throw err
  }
  return review
}

export function getReviewBody(
  dataDir: string,
  threadId: string,
  proposalId: string,
  reviewId: string,
): string | null {
  const filePath = reviewPath(dataDir, threadId, proposalId, reviewId)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

export function listReviews(
  dataDir: string,
  threadId: string,
  proposalId: string,
): ProposalReview[] {
  const reviewDir = reviewsDir(dataDir, threadId, proposalId)
  if (!fs.existsSync(reviewDir)) return []

  return fs
    .readdirSync(reviewDir)
    .filter((file) => /^review-\d+\.json$/.test(file))
    .sort()
    .map(
      (file) =>
        JSON.parse(fs.readFileSync(path.join(reviewDir, file), 'utf8')) as ProposalReview,
    )
}

export function getLatestReviewBody(
  dataDir: string,
  threadId: string,
  proposalId: string,
): string | null {
  const proposal = getProposal(dataDir, threadId, proposalId)
  if (proposal?.latest_review_id) {
    const body = getReviewBody(dataDir, threadId, proposalId, proposal.latest_review_id)
    if (body !== null) return body
  }
  // Recovery-only fallback for a crash/failure before latest_review_id was updated.
  // Steady-state reads should use the authoritative pointer after startup repair.
  const reviews = listReviews(dataDir, threadId, proposalId)
  const latest = reviews[reviews.length - 1]
  return latest ? getReviewBody(dataDir, threadId, proposalId, latest.id) : null
}

export function repairLatestProposalPointers(
  dataDir: string,
  logRepair: (message: string) => void = console.warn,
): Array<{ threadId: string; proposalId: string }> {
  const repaired: Array<{ threadId: string; proposalId: string }> = []
  if (!fs.existsSync(threadsDir(dataDir))) return repaired
  for (const threadEntry of fs.readdirSync(threadsDir(dataDir), { withFileTypes: true })) {
    if (!threadEntry.isDirectory()) continue
    const threadId = threadEntry.name
    const root = consolidationsDir(dataDir, threadId)
    if (!fs.existsSync(root)) continue

    for (const proposalEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!proposalEntry.isDirectory()) continue
      const proposalId = proposalEntry.name
      const proposal = getProposal(dataDir, threadId, proposalId)
      if (!proposal) continue

      const latestRevisionId = latestIdFromDir(
        revisionsDir(dataDir, threadId, proposalId),
        /^r(\d+)\.json$/,
      )
      if (latestRevisionId && idNumber(proposal.latest_revision_id) < idNumber(latestRevisionId)) {
        updateProposal(dataDir, threadId, proposalId, { latest_revision_id: latestRevisionId })
        repaired.push({ threadId, proposalId })
        logRepair(
          `proposal pointer repaired proposal=${proposalId} field=latest_revision_id old=${
            proposal.latest_revision_id ?? 'missing'
          } new=${latestRevisionId}`,
        )
      }

      const updatedProposal = getProposal(dataDir, threadId, proposalId) ?? proposal
      const latestReviewId = latestIdFromDir(
        reviewsDir(dataDir, threadId, proposalId),
        /^review-(\d+)\.json$/,
      )
      if (latestReviewId && idNumber(updatedProposal.latest_review_id) < idNumber(latestReviewId)) {
        updateProposal(dataDir, threadId, proposalId, { latest_review_id: latestReviewId })
        repaired.push({ threadId, proposalId })
        logRepair(
          `proposal pointer repaired proposal=${proposalId} field=latest_review_id old=${
            updatedProposal.latest_review_id ?? 'missing'
          } new=${latestReviewId}`,
        )
      }
    }
  }
  return repaired
}

export function rejectProposal(
  dataDir: string,
  threadId: string,
  proposalId: string,
): ConsolidationProposal {
  const proposal = ensureProposal(dataDir, threadId, proposalId)
  ensureEditable(proposal)
  return setProposalStatus(dataDir, threadId, proposalId, 'rejected')
}

export function markApplied(
  dataDir: string,
  threadId: string,
  proposalId: string,
  appliedThreadId: string,
): ConsolidationProposal {
  const proposal = ensureProposal(dataDir, threadId, proposalId)
  ensureEditable(proposal)
  return updateProposal(dataDir, threadId, proposalId, {
    status: 'applied',
    applied_thread_id: appliedThreadId,
  })
}

export function saveProposalOutput(
  dataDir: string,
  threadId: string,
  proposalId: string,
  input: {
    title: string
    body: string
  },
): SavedConsolidation {
  const proposal = ensureProposal(dataDir, threadId, proposalId)
  ensureEditable(proposal)
  if (!input.body.trim()) throw new BadRequestError('proposal body cannot be empty')

  const savedId = `${threadId}-${proposalId}`
  const dir = savedConsolidationDir(dataDir, savedId)
  fs.mkdirSync(dir, { recursive: true })
  const saved: SavedConsolidation = {
    id: savedId,
    source_thread_id: threadId,
    proposal_id: proposalId,
    title: input.title,
    body_path: path.join(dir, 'thread.md'),
    created_at: new Date().toISOString(),
  }
  writeTextAtomic(path.join(dir, 'thread.md'), input.body)
  writeJsonAtomic(path.join(dir, 'saved.json'), saved)
  updateProposal(dataDir, threadId, proposalId, {
    status: 'saved',
    saved_artifact_id: savedId,
  })
  return saved
}

export function listSavedOutputs(dataDir: string, threadId: string): SavedConsolidation[] {
  const dir = savedDir(dataDir)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, 'saved.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map(
      (filePath) =>
        JSON.parse(fs.readFileSync(filePath, 'utf8')) as SavedConsolidation,
    )
    .filter((saved) => saved.source_thread_id === threadId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getSavedOutput(dataDir: string, savedId: string): SavedOutput | null {
  const dir = savedConsolidationDir(dataDir, savedId)
  const metadataPath = path.join(dir, 'saved.json')
  const bodyPath = path.join(dir, 'thread.md')
  if (!fs.existsSync(metadataPath) || !fs.existsSync(bodyPath)) return null
  const saved = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as SavedConsolidation
  return { ...saved, body: fs.readFileSync(bodyPath, 'utf8') }
}

export function removeProposal(dataDir: string, threadId: string, proposalId: string): void {
  fs.rmSync(consolidationDir(dataDir, threadId, proposalId), {
    recursive: true,
    force: true,
  })
}
