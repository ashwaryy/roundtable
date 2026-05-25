import type {
  Thread,
  ThreadDetail,
  Comment,
  PendingDiscussion,
  ConsolidationProposal,
  ConsolidationDetail,
  ProposalRevision,
  ProposalReview,
  CreateThreadInput,
  CreateCommentInput,
  CreatePendingDiscussionInput,
  EditPendingDiscussionInput,
  CreateConsolidationInput,
  CommentAuthor,
  ContextItem,
  CreateProjectSnapshotInput,
  CreateUrlContextInput,
  FileContextItem,
  ProjectSnapshot,
  SnapshotReport,
  SnapshotPreflight,
  ThreadContext,
  BoundedJob,
  SavedConsolidation,
  SavedOutput,
  IntegrityReport,
  RoundtableEvent,
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
  ThreadAgentInvite,
  InviteAgentInput,
  UpdateThreadAgentInviteInput,
  ReorderThreadAgentsInput,
} from '@roundtable/shared'
import * as threads from './threads'
import * as comments from './comments'
import * as pending from './pendingDiscussions'
import * as proposals from './proposals'
import * as context from './context'
import * as jobs from './jobs'
import * as integrity from './integrity'
import * as agents from './agents'
import { BadRequestError, NotFoundError } from './errors'

export {
  BadRequestError,
  ConfirmationRequiredError,
  ConflictError,
  NotFoundError,
  IntegrityStorageError,
} from './errors'

export function createStorage(
  dataDir: string,
  onIntegrityUpdate?: (event: RoundtableEvent) => void,
) {
  agents.seedBuiltInAgents(dataDir)
  function inspect(threadId: string): void {
    try {
      const previousIssues = integrity.currentIntegrityIssueCount(dataDir, threadId)
      const report = integrity.inspectIntegrity(dataDir, threadId)
      if (report.issues.length > previousIssues) {
        onIntegrityUpdate?.({ type: 'integrity_updated', thread_id: threadId })
      }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  function mutate<T>(threadId: string, operation: () => T): T {
    inspect(threadId)
    const result = operation()
    integrity.acceptApplicationWrite(dataDir, threadId)
    return result
  }

  return {
    createThread: (input: CreateThreadInput): Thread => {
      const thread = threads.createThread(dataDir, input)
      agents.initializeThreadAgents(dataDir, thread.id, input.agent_ids)
      integrity.acceptApplicationWrite(dataDir, thread.id)
      return thread
    },
    createDerivedThread: (
      input: {
        title: string
        body: string
        parentThreadId: string
        consolidationId: string
        copyContext?: boolean
      },
    ): Thread => {
      const thread = threads.createDerivedThread(dataDir, input)
      agents.initializeThreadAgents(
        dataDir,
        thread.id,
        agents.listThreadAgents(dataDir, input.parentThreadId).map((invite) => invite.agent_id),
      )
      if (input.copyContext) {
        context.copyThreadContext(dataDir, input.parentThreadId, thread.id)
      }
      integrity.acceptApplicationWrite(dataDir, thread.id)
      return thread
    },
    archiveThread: (threadId: string): Thread =>
      mutate(threadId, () => threads.archiveThread(dataDir, threadId)),
    closeThread: (threadId: string): Thread =>
      mutate(threadId, () => threads.closeThread(dataDir, threadId)),
    deleteThread: (threadId: string): void => {
      inspect(threadId)
      threads.deleteThread(dataDir, threadId)
    },
    listThreads: (): Thread[] => threads.listThreads(dataDir),
    getThread: (id: string): ThreadDetail | null => {
      inspect(id)
      return threads.getThread(dataDir, id)
    },
    listComments: (threadId: string): Comment[] => {
      inspect(threadId)
      return comments.listComments(dataDir, threadId)
    },
    addComment: (threadId: string, input: CreateCommentInput): Comment =>
      mutate(threadId, () => comments.addComment(dataDir, threadId, input)),
    deleteComment: (threadId: string, commentId: string): void =>
      mutate(threadId, () => comments.deleteComment(dataDir, threadId, commentId)),
    listPendingDiscussions: (threadId: string): PendingDiscussion[] => {
      inspect(threadId)
      return pending.listPendingDiscussions(dataDir, threadId)
    },
    countPendingDiscussions: (threadId: string): number =>
      pending.countPendingDiscussions(dataDir, threadId),
    addPendingDiscussion: (
      threadId: string,
      input: CreatePendingDiscussionInput,
    ): PendingDiscussion =>
      mutate(threadId, () => {
        if (
          input.author !== 'human' &&
          input.author !== 'system' &&
          !agents.listThreadAgents(dataDir, threadId).some((invite) => invite.agent_id === input.author)
        ) {
          throw new BadRequestError(`agent ${input.author} is not invited to this thread`)
        }
        return pending.addPendingDiscussion(dataDir, threadId, input)
      }),
    approvePendingDiscussion: (threadId: string, pendingId: string): Comment =>
      mutate(threadId, () => pending.approvePendingDiscussion(dataDir, threadId, pendingId)),
    editPendingDiscussion: (
      threadId: string,
      pendingId: string,
      input: EditPendingDiscussionInput,
    ): PendingDiscussion => mutate(threadId, () =>
      pending.editPendingDiscussion(dataDir, threadId, pendingId, input)),
    rejectPendingDiscussion: (threadId: string, pendingId: string): void =>
      mutate(threadId, () => pending.rejectPendingDiscussion(dataDir, threadId, pendingId)),
    createProposal: (
      threadId: string,
      input: CreateConsolidationInput,
    ): ConsolidationProposal =>
      mutate(threadId, () => proposals.createProposal(dataDir, threadId, input)),
    getProposal: (
      threadId: string,
      proposalId: string,
    ): ConsolidationProposal | null => {
      inspect(threadId)
      return proposals.getProposal(dataDir, threadId, proposalId)
    },
    getConsolidationDetail: (
      threadId: string,
      proposalId: string,
    ): ConsolidationDetail | null => {
      inspect(threadId)
      const proposal = proposals.getProposal(dataDir, threadId, proposalId)
      if (!proposal) return null
      return {
        proposal,
        revisions: proposals.listRevisions(dataDir, threadId, proposalId),
        latest_body: proposals.getLatestRevision(dataDir, threadId, proposalId),
        reviews: proposals.listReviews(dataDir, threadId, proposalId),
        latest_review_body: proposals.getLatestReviewBody(dataDir, threadId, proposalId),
      }
    },
    listProposals: (threadId: string): ConsolidationProposal[] => {
      inspect(threadId)
      return proposals.listProposals(dataDir, threadId)
    },
    listProposalStatuses: (threadId: string) =>
      proposals.listProposalStatuses(dataDir, threadId),
    addProposalRevision: (
      threadId: string,
      proposalId: string,
      body: string,
      author: CommentAuthor,
    ): ProposalRevision => mutate(threadId, () =>
      proposals.addProposalRevision(dataDir, threadId, proposalId, body, author)),
    addProposalReview: (
      threadId: string,
      proposalId: string,
      body: string,
      author: Parameters<typeof proposals.addProposalReview>[4],
      revisionId: string | null,
    ): ProposalReview => mutate(threadId, () =>
      proposals.addProposalReview(dataDir, threadId, proposalId, body, author, revisionId)),
    updateProposal: (
      threadId: string,
      proposalId: string,
      patch: Partial<ConsolidationProposal>,
    ): ConsolidationProposal => mutate(threadId, () =>
      proposals.updateProposal(dataDir, threadId, proposalId, patch)),
    rejectProposal: (threadId: string, proposalId: string): ConsolidationProposal =>
      mutate(threadId, () => proposals.rejectProposal(dataDir, threadId, proposalId)),
    saveProposalOutput: (
      threadId: string,
      proposalId: string,
    ): SavedConsolidation => {
      inspect(threadId)
      const thread = threads.getThread(dataDir, threadId)
      if (!thread) throw new NotFoundError(`thread ${threadId} not found`)
      const body = proposals.getLatestRevision(dataDir, threadId, proposalId)
      if (!body) throw new BadRequestError('proposal has no revision to save')
      const saved = proposals.saveProposalOutput(dataDir, threadId, proposalId, {
        title: thread.title,
        body,
      })
      threads.closeThread(dataDir, threadId)
      integrity.acceptApplicationWrite(dataDir, threadId)
      return saved
    },
    applyProposalNextIteration: (
      threadId: string,
      proposalId: string,
    ): Thread => {
      inspect(threadId)
      const thread = threads.getThread(dataDir, threadId)
      if (!thread) throw new NotFoundError(`thread ${threadId} not found`)
      const body = proposals.getLatestRevision(dataDir, threadId, proposalId)
      if (!body) throw new BadRequestError('proposal has no revision to apply')
      const next = threads.createDerivedThread(dataDir, {
        title: thread.title,
        body,
        parentThreadId: threadId,
        consolidationId: proposalId,
      })
      agents.initializeThreadAgents(
        dataDir,
        next.id,
        agents.listThreadAgents(dataDir, threadId).map((invite) => invite.agent_id),
      )
      context.copyThreadContext(dataDir, threadId, next.id)
      threads.archiveThread(dataDir, threadId)
      proposals.markApplied(dataDir, threadId, proposalId, next.id)
      integrity.acceptApplicationWrite(dataDir, threadId)
      integrity.acceptApplicationWrite(dataDir, next.id)
      return next
    },
    getLatestRevision: (threadId: string, proposalId: string): string | null =>
      proposals.getLatestRevision(dataDir, threadId, proposalId),
    listRevisions: (threadId: string, proposalId: string): ProposalRevision[] =>
      proposals.listRevisions(dataDir, threadId, proposalId),
    getThreadContext: (threadId: string): ThreadContext => {
      inspect(threadId)
      return context.getThreadContext(dataDir, threadId)
    },
    addUrlContextItem: (
      threadId: string,
      input: CreateUrlContextInput,
    ): ContextItem =>
      mutate(threadId, () => context.addUrlContextItem(dataDir, threadId, input)),
    addAttachmentFromFile: (
      threadId: string,
      input: {
        tempPath: string
        originalName: string
        mediaType: string | null
        sizeBytes: number
      },
    ): FileContextItem =>
      mutate(threadId, () => context.addAttachmentFromFile(dataDir, threadId, input)),
    preflightProjectSnapshot: (
      threadId: string,
      sourcePath: string,
    ): SnapshotPreflight =>
      context.preflightProjectSnapshot(dataDir, threadId, sourcePath),
    createProjectSnapshot: (
      threadId: string,
      input: CreateProjectSnapshotInput,
    ): ProjectSnapshot =>
      mutate(threadId, () => context.createProjectSnapshot(dataDir, threadId, input)),
    refreshProjectSnapshot: (threadId: string): ProjectSnapshot =>
      mutate(threadId, () => context.refreshProjectSnapshot(dataDir, threadId)),
    listSnapshotReports: (threadId: string): SnapshotReport[] => {
      inspect(threadId)
      return context.listSnapshotReports(dataDir, threadId)
    },
    listSavedOutputs: (threadId: string): SavedConsolidation[] => {
      inspect(threadId)
      return proposals.listSavedOutputs(dataDir, threadId)
    },
    getSavedOutput: (savedId: string): SavedOutput | null =>
      proposals.getSavedOutput(dataDir, savedId),
    getIntegrity: (threadId: string): IntegrityReport => {
      const previousIssues = integrity.currentIntegrityIssueCount(dataDir, threadId)
      const report = integrity.inspectIntegrity(dataDir, threadId, { force: true })
      if (report.issues.length > previousIssues) {
        onIntegrityUpdate?.({ type: 'integrity_updated', thread_id: threadId })
      }
      return report
    },
    acknowledgeIntegrity: (threadId: string): IntegrityReport =>
      integrity.acknowledgeIntegrity(dataDir, threadId),
    acceptIntegrity: (threadId: string): IntegrityReport =>
      integrity.acceptApplicationWrite(dataDir, threadId),
    listJobs: (threadId: string): BoundedJob[] => jobs.listJobs(dataDir, threadId),
    getJob: (threadId: string, jobId: string): BoundedJob | null =>
      jobs.getJob(dataDir, threadId, jobId),
    writeJob: (job: BoundedJob): BoundedJob => jobs.writeJob(dataDir, job),
    nextJobId: (threadId: string): string => jobs.nextJobId(dataDir, threadId),
    addAgentComment: (
      threadId: string,
      input: Parameters<typeof comments.addAgentComment>[2],
    ): Comment => comments.addAgentComment(dataDir, threadId, input),
    listAgents: (): Agent[] => agents.listAgents(dataDir),
    createAgent: (input: CreateAgentInput): Agent =>
      agents.createAgent(dataDir, input),
    updateAgent: (agentId: string, patch: UpdateAgentInput): Agent =>
      agents.updateAgent(dataDir, agentId, patch),
    deleteAgent: (agentId: string): Agent | null =>
      agents.deleteAgent(dataDir, agentId),
    listThreadAgents: (threadId: string): ThreadAgentInvite[] => {
      inspect(threadId)
      return agents.listThreadAgents(dataDir, threadId)
    },
    inviteAgent: (threadId: string, input: InviteAgentInput): ThreadAgentInvite[] =>
      mutate(threadId, () => agents.inviteAgent(dataDir, threadId, input)),
    updateThreadAgent: (
      threadId: string,
      agentId: string,
      patch: UpdateThreadAgentInviteInput,
    ): ThreadAgentInvite[] =>
      mutate(threadId, () => agents.updateThreadAgent(dataDir, threadId, agentId, patch)),
    removeThreadAgent: (threadId: string, agentId: string): ThreadAgentInvite[] =>
      mutate(threadId, () => agents.removeThreadAgent(dataDir, threadId, agentId)),
    reorderThreadAgents: (
      threadId: string,
      input: ReorderThreadAgentsInput,
    ): ThreadAgentInvite[] =>
      mutate(threadId, () => agents.reorderThreadAgents(dataDir, threadId, input)),
  }
}

export type Storage = ReturnType<typeof createStorage>
