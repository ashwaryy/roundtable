import type {
  BoundedJob,
  ConsolidationDetail,
  ConsolidationProposal,
} from '@roundtable/shared'

export type ConsolidationUiPhase =
  | 'none'
  | 'drafting'
  | 'reviewing'
  | 'revising'
  | 'ready'
  | 'saved'
  | 'applied'
  | 'rejected'

export interface ConsolidationUiState {
  proposal: ConsolidationProposal | null
  phase: ConsolidationUiPhase
  label: string
  helper: string
  canOpenDraft: boolean
  isRunning: boolean
  isTerminal: boolean
  isReady: boolean
}

export const CONSOLIDATION_STEPS = [
  { phase: 'drafting', label: 'Drafting' },
  { phase: 'reviewing', label: 'Reviewing' },
  { phase: 'revising', label: 'Revising' },
] as const

export function isActiveProposal(proposal: ConsolidationProposal): boolean {
  return proposal.status === 'drafting' || proposal.status === 'review'
}

export function activeConsolidationJob(
  proposalId: string | null,
  jobs: BoundedJob[],
): BoundedJob | null {
  if (!proposalId) return null
  return jobs.find((job) =>
    job.status === 'running' &&
    job.turn.proposal_id === proposalId &&
    (
      job.turn.kind === 'proposal_draft' ||
      job.turn.kind === 'proposal_review' ||
      job.turn.kind === 'proposal_revision'
    ),
  ) ?? null
}

export function phaseFromJob(job: BoundedJob | null): ConsolidationUiPhase | null {
  if (!job) return null
  switch (job.turn.kind) {
    case 'proposal_draft':
      return 'drafting'
    case 'proposal_review':
      return 'reviewing'
    case 'proposal_revision':
      return 'revising'
    default:
      return null
  }
}

export function consolidationPhaseLabel(phase: ConsolidationUiPhase): string {
  switch (phase) {
    case 'drafting':
      return 'Drafting'
    case 'reviewing':
      return 'Reviewing'
    case 'revising':
      return 'Revising'
    case 'ready':
      return 'Ready'
    case 'saved':
      return 'Saved'
    case 'applied':
      return 'Next thread started'
    case 'rejected':
      return 'Rejected'
    case 'none':
      return 'No outcome'
    default: {
      const _: never = phase
      return _
    }
  }
}

export function buildConsolidationUiState(input: {
  proposals: ConsolidationProposal[]
  jobs?: BoundedJob[]
  detail?: ConsolidationDetail | null
  proposal?: ConsolidationProposal | null
}): ConsolidationUiState {
  const proposal =
    input.proposal ??
    input.proposals.find(isActiveProposal) ??
    input.proposals[input.proposals.length - 1] ??
    null
  const job = activeConsolidationJob(proposal?.id ?? null, input.jobs ?? [])
  const jobPhase = phaseFromJob(job)
  const hasDraft = Boolean(input.detail?.latest_body?.trim())

  if (!proposal) {
    return {
      proposal: null,
      phase: 'none',
      label: 'Create outcome',
      helper: 'Turn approved discussion into a reviewable outcome.',
      canOpenDraft: false,
      isRunning: false,
      isTerminal: false,
      isReady: false,
    }
  }

  let phase: ConsolidationUiPhase
  if (proposal.status === 'saved') phase = 'saved'
  else if (proposal.status === 'applied') phase = 'applied'
  else if (proposal.status === 'rejected') phase = 'rejected'
  else if (jobPhase) phase = jobPhase
  else if (proposal.status === 'drafting') phase = 'drafting'
  else phase = 'ready'

  const isRunning =
    phase === 'drafting' || phase === 'reviewing' || phase === 'revising'
  const isTerminal =
    phase === 'saved' || phase === 'applied' || phase === 'rejected'

  return {
    proposal,
    phase,
    label: consolidationPhaseLabel(phase),
    helper: helperForPhase(phase, hasDraft),
    canOpenDraft: hasDraft || phase === 'ready' || isTerminal,
    isRunning,
    isTerminal,
    isReady: phase === 'ready',
  }
}

function helperForPhase(phase: ConsolidationUiPhase, hasDraft: boolean): string {
  switch (phase) {
    case 'drafting':
      return 'An agent is drafting the discussion outcome.'
    case 'reviewing':
      return hasDraft
        ? 'The first draft is readable while review continues.'
        : 'The draft will appear after the first pass finishes.'
    case 'revising':
      return hasDraft
        ? 'The draft is readable while the automatic revision finishes.'
        : 'The final draft will appear after revision finishes.'
    case 'ready':
      return 'Choose whether this outcome starts a next thread or closes as saved output.'
    case 'saved':
      return 'This outcome was saved and the thread is closed.'
    case 'applied':
      return 'This outcome started the next thread.'
    case 'rejected':
      return 'This outcome was rejected.'
    case 'none':
      return 'Turn approved discussion into a reviewable outcome.'
    default: {
      const _: never = phase
      return _
    }
  }
}
