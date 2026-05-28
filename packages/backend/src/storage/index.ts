import path from 'node:path'
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
import {
  attachmentsDir,
  commentsPath,
  consolidationDir,
  contextItemsPath,
  pendingDiscussionsPath,
  projectSnapshotDir,
  projectSnapshotJsonPath,
  projectSnapshotManifestPath,
  projectSnapshotReportsDir,
  proposalJsonPath,
  reviewJsonPath,
  reviewPath,
  revisionsDir,
  revisionPath,
  savedConsolidationDir,
  threadAgentsPath,
  threadDir,
  threadJsonPath,
} from './paths'
import type { CanonicalTouched } from './touched'
import { mergeTouched } from './touched'

export {
  BadRequestError,
  ConfirmationRequiredError,
  ConflictError,
  NotFoundError,
  IntegrityStorageError,
  StorageOperationError,
} from './errors'

function revisionJsonPath(
  dataDir: string,
  threadId: string,
  proposalId: string,
  revisionId: string,
): string {
  return path.join(revisionsDir(dataDir, threadId, proposalId), `${revisionId}.json`)
}

export function createStorage(
  dataDir: string,
  onIntegrityUpdate?: (event: RoundtableEvent) => void,
) {
  agents.seedBuiltInAgents(dataDir)
  for (const repair of proposals.repairLatestProposalPointers(dataDir)) {
    integrity.acceptApplicationWrite(dataDir, repair.threadId, {
      filesAddedOrUpdated: [proposalJsonPath(dataDir, repair.threadId, repair.proposalId)],
    })
  }

  function activeProposalCount(threadId: string): number {
    return proposals
      .listProposalStatuses(dataDir, threadId)
      .filter((status) => status === 'drafting' || status === 'review').length
  }

  for (const threadId of threads.repairDirtyThreadSummaries(dataDir, {
    pendingCount: (threadId) => pending.countPendingDiscussions(dataDir, threadId),
    activeProposalCount: (threadId) => activeProposalCount(threadId),
  })) {
    integrity.acceptApplicationWrite(dataDir, threadId, {
      filesAddedOrUpdated: [threadJsonPath(dataDir, threadId)],
    })
  }

  function applyWrite<T>(
    threadId: string,
    operation: () => { result: T; touched: CanonicalTouched },
  ): T {
    const { result, touched } = operation()
    integrity.acceptApplicationWrite(dataDir, threadId, touched)
    return result
  }

  function applyWriteWithThreadSummary<T>(
    threadId: string,
    fields: Array<threads.ThreadSummaryField>,
    operation: () => { result: T; touched: CanonicalTouched },
  ): T {
    for (const field of fields) {
      threads.setThreadSummaryDirty(dataDir, threadId, field)
    }

    let outcome: { result: T; touched: CanonicalTouched }
    try {
      outcome = operation()
    } catch (err) {
      integrity.acceptApplicationWrite(dataDir, threadId, {
        filesAddedOrUpdated: [threadJsonPath(dataDir, threadId)],
      })
      throw err
    }

    const touchedWithThreadJson = mergeTouched(outcome.touched, {
      filesAddedOrUpdated: [threadJsonPath(dataDir, threadId)],
    })

    try {
      const patch: Partial<Record<threads.ThreadSummaryField, number>> = {}
      if (fields.includes('pending_count')) {
        patch.pending_count = pending.countPendingDiscussions(dataDir, threadId)
      }
      if (fields.includes('active_proposal_count')) {
        patch.active_proposal_count = activeProposalCount(threadId)
      }
      threads.updateThreadSummary(
        dataDir,
        threadId,
        patch,
        fields,
      )
      integrity.acceptApplicationWrite(dataDir, threadId, touchedWithThreadJson)
      return outcome.result
    } catch (err) {
      integrity.acceptApplicationWrite(dataDir, threadId, touchedWithThreadJson)
      throw err
    }
  }

  return {
    createThread: (input: CreateThreadInput): Thread => {
      const thread = threads.createThread(dataDir, input)
      agents.initializeThreadAgents(dataDir, thread.id, input.agent_ids)
      integrity.acceptApplicationWrite(dataDir, thread.id, {
        rootsAddedOrUpdated: [threadDir(dataDir, thread.id)],
      })
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
      integrity.acceptApplicationWrite(dataDir, thread.id, {
        rootsAddedOrUpdated: [threadDir(dataDir, thread.id)],
      })
      return thread
    },
    archiveThread: (threadId: string): Thread =>
      applyWrite(threadId, () => ({
        result: threads.archiveThread(dataDir, threadId),
        touched: { filesAddedOrUpdated: [threadJsonPath(dataDir, threadId)] },
      })),
    closeThread: (threadId: string): Thread =>
      applyWrite(threadId, () => ({
        result: threads.closeThread(dataDir, threadId),
        touched: { filesAddedOrUpdated: [threadJsonPath(dataDir, threadId)] },
      })),
    deleteThread: (threadId: string): void => threads.deleteThread(dataDir, threadId),
    listThreads: (): Thread[] => threads.listThreads(dataDir),
    getThread: (id: string): ThreadDetail | null => threads.getThread(dataDir, id),
    listComments: (threadId: string): Comment[] => comments.listComments(dataDir, threadId),
    addComment: (threadId: string, input: CreateCommentInput): Comment =>
      applyWrite(threadId, () => ({
        result: comments.addComment(dataDir, threadId, input),
        touched: { filesAddedOrUpdated: [commentsPath(dataDir, threadId)] },
      })),
    deleteComment: (threadId: string, commentId: string): void =>
      applyWrite(threadId, () => {
        comments.deleteComment(dataDir, threadId, commentId)
        return {
          result: undefined,
          touched: { filesAddedOrUpdated: [commentsPath(dataDir, threadId)] },
        }
      }),
    listPendingDiscussions: (threadId: string): PendingDiscussion[] =>
      pending.listPendingDiscussions(dataDir, threadId),
    countPendingDiscussions: (threadId: string): number =>
      threads.getThreadSummary(dataDir, threadId)?.pending_count ??
      pending.countPendingDiscussions(dataDir, threadId),
    getThreadSummary: (threadId: string) => threads.getThreadSummary(dataDir, threadId),
    addPendingDiscussion: (
      threadId: string,
      input: CreatePendingDiscussionInput,
    ): PendingDiscussion =>
      applyWriteWithThreadSummary(threadId, ['pending_count'], () => {
        if (
          input.author !== 'human' &&
          input.author !== 'system' &&
          !agents.listThreadAgents(dataDir, threadId).some((invite) => invite.agent_id === input.author)
        ) {
          throw new BadRequestError(`agent ${input.author} is not invited to this thread`)
        }
        return {
          result: pending.addPendingDiscussion(dataDir, threadId, input),
          touched: { filesAddedOrUpdated: [pendingDiscussionsPath(dataDir, threadId)] },
        }
      }),
    approvePendingDiscussion: (threadId: string, pendingId: string): Comment =>
      applyWriteWithThreadSummary(threadId, ['pending_count'], () => ({
        result: pending.approvePendingDiscussion(dataDir, threadId, pendingId),
        touched: {
          filesAddedOrUpdated: [
            commentsPath(dataDir, threadId),
            pendingDiscussionsPath(dataDir, threadId),
          ],
        },
      })),
    editPendingDiscussion: (
      threadId: string,
      pendingId: string,
      input: EditPendingDiscussionInput,
    ): PendingDiscussion =>
      applyWrite(threadId, () => ({
        result: pending.editPendingDiscussion(dataDir, threadId, pendingId, input),
        touched: { filesAddedOrUpdated: [pendingDiscussionsPath(dataDir, threadId)] },
      })),
    rejectPendingDiscussion: (threadId: string, pendingId: string): void =>
      applyWriteWithThreadSummary(threadId, ['pending_count'], () => {
        pending.rejectPendingDiscussion(dataDir, threadId, pendingId)
        return {
          result: undefined,
          touched: { filesAddedOrUpdated: [pendingDiscussionsPath(dataDir, threadId)] },
        }
      }),
    createProposal: (
      threadId: string,
      input: CreateConsolidationInput,
    ): ConsolidationProposal =>
      applyWriteWithThreadSummary(threadId, ['active_proposal_count'], () => {
        const proposal = proposals.createProposal(dataDir, threadId, input)
        return {
          result: proposal,
          touched: {
            rootsAddedOrUpdated: [consolidationDir(dataDir, threadId, proposal.id)],
          },
        }
      }),
    getProposal: (
      threadId: string,
      proposalId: string,
    ): ConsolidationProposal | null => proposals.getProposal(dataDir, threadId, proposalId),
    getConsolidationDetail: (
      threadId: string,
      proposalId: string,
    ): ConsolidationDetail | null => {
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
    listProposals: (threadId: string): ConsolidationProposal[] =>
      proposals.listProposals(dataDir, threadId),
    listProposalStatuses: (threadId: string) =>
      proposals.listProposalStatuses(dataDir, threadId),
    addProposalRevision: (
      threadId: string,
      proposalId: string,
      body: string,
      author: CommentAuthor,
    ): ProposalRevision =>
      applyWrite(threadId, () => {
        const revision = proposals.addProposalRevision(dataDir, threadId, proposalId, body, author)
        return {
          result: revision,
          touched: {
            filesAddedOrUpdated: [
              revisionPath(dataDir, threadId, proposalId, revision.id),
              revisionJsonPath(dataDir, threadId, proposalId, revision.id),
              proposalJsonPath(dataDir, threadId, proposalId),
            ],
          },
        }
      }),
    addProposalReview: (
      threadId: string,
      proposalId: string,
      body: string,
      author: Parameters<typeof proposals.addProposalReview>[4],
      revisionId: string | null,
    ): ProposalReview =>
      applyWrite(threadId, () => {
        const review = proposals.addProposalReview(dataDir, threadId, proposalId, body, author, revisionId)
        return {
          result: review,
          touched: {
            filesAddedOrUpdated: [
              reviewPath(dataDir, threadId, proposalId, review.id),
              reviewJsonPath(dataDir, threadId, proposalId, review.id),
              proposalJsonPath(dataDir, threadId, proposalId),
            ],
          },
        }
      }),
    updateProposal: (
      threadId: string,
      proposalId: string,
      patch: Partial<ConsolidationProposal>,
    ): ConsolidationProposal =>
      applyWriteWithThreadSummary(threadId, ['active_proposal_count'], () => ({
        result: proposals.updateProposal(dataDir, threadId, proposalId, patch),
        touched: { filesAddedOrUpdated: [proposalJsonPath(dataDir, threadId, proposalId)] },
      })),
    rejectProposal: (threadId: string, proposalId: string): ConsolidationProposal =>
      applyWriteWithThreadSummary(threadId, ['active_proposal_count'], () => ({
        result: proposals.rejectProposal(dataDir, threadId, proposalId),
        touched: { filesAddedOrUpdated: [proposalJsonPath(dataDir, threadId, proposalId)] },
      })),
    saveProposalOutput: (
      threadId: string,
      proposalId: string,
    ): SavedConsolidation => {
      const thread = threads.getThread(dataDir, threadId)
      if (!thread) throw new NotFoundError(`thread ${threadId} not found`)
      const body = proposals.getLatestRevision(dataDir, threadId, proposalId)
      if (!body) throw new BadRequestError('proposal has no revision to save')
      const saved = proposals.saveProposalOutput(dataDir, threadId, proposalId, {
        title: thread.title,
        body,
      })
      threads.closeThread(dataDir, threadId)
      threads.setThreadSummaryDirty(dataDir, threadId, 'active_proposal_count')
      try {
        threads.updateThreadSummary(
          dataDir,
          threadId,
          { active_proposal_count: activeProposalCount(threadId) },
          ['active_proposal_count'],
        )
      } finally {
        integrity.acceptApplicationWrite(
          dataDir,
          threadId,
          mergeTouched(
            {
              filesAddedOrUpdated: [
                threadJsonPath(dataDir, threadId),
                proposalJsonPath(dataDir, threadId, proposalId),
              ],
            },
            {
              rootsAddedOrUpdated: [savedConsolidationDir(dataDir, saved.id)],
            },
          ),
        )
      }
      return saved
    },
    applyProposalNextIteration: (
      threadId: string,
      proposalId: string,
    ): Thread => {
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
      threads.setThreadSummaryDirty(dataDir, threadId, 'active_proposal_count')
      proposals.markApplied(dataDir, threadId, proposalId, next.id)
      try {
        threads.updateThreadSummary(
          dataDir,
          threadId,
          { active_proposal_count: activeProposalCount(threadId) },
          ['active_proposal_count'],
        )
      } finally {
      integrity.acceptApplicationWrite(dataDir, threadId, {
        filesAddedOrUpdated: [
          threadJsonPath(dataDir, threadId),
          proposalJsonPath(dataDir, threadId, proposalId),
        ],
      })
      }
      integrity.acceptApplicationWrite(dataDir, next.id, {
        rootsAddedOrUpdated: [threadDir(dataDir, next.id)],
      })
      return next
    },
    getLatestRevision: (threadId: string, proposalId: string): string | null =>
      proposals.getLatestRevision(dataDir, threadId, proposalId),
    listRevisions: (threadId: string, proposalId: string): ProposalRevision[] =>
      proposals.listRevisions(dataDir, threadId, proposalId),
    getThreadContext: (threadId: string): ThreadContext =>
      context.getThreadContext(dataDir, threadId),
    addUrlContextItem: (
      threadId: string,
      input: CreateUrlContextInput,
    ): ContextItem =>
      applyWrite(threadId, () => ({
        result: context.addUrlContextItem(dataDir, threadId, input),
        touched: { filesAddedOrUpdated: [contextItemsPath(dataDir, threadId)] },
      })),
    addAttachmentFromFile: (
      threadId: string,
      input: {
        tempPath: string
        originalName: string
        mediaType: string | null
        sizeBytes: number
      },
    ): FileContextItem =>
      applyWrite(threadId, () => {
        const item = context.addAttachmentFromFile(dataDir, threadId, input)
        return {
          result: item,
          touched: {
            filesAddedOrUpdated: [
              contextItemsPath(dataDir, threadId),
              path.join(attachmentsDir(dataDir, threadId), item.filename),
            ],
          },
        }
      }),
    preflightProjectSnapshot: async (
      threadId: string,
      sourcePath: string,
    ): Promise<SnapshotPreflight> =>
      context.preflightProjectSnapshot(dataDir, threadId, sourcePath),
    preflightProjectSnapshotSource: async (
      sourcePath: string,
    ): Promise<SnapshotPreflight> =>
      context.preflightProjectSnapshotSource(dataDir, sourcePath),
    createProjectSnapshot: async (
      threadId: string,
      input: CreateProjectSnapshotInput,
    ): Promise<ProjectSnapshot> => {
      const result = await context.createProjectSnapshot(dataDir, threadId, input)
      integrity.acceptApplicationWrite(dataDir, threadId, {
        filesAddedOrUpdated: [
          projectSnapshotJsonPath(dataDir, threadId),
          projectSnapshotManifestPath(dataDir, threadId),
        ],
        rootsAddedOrUpdated: [
          projectSnapshotDir(dataDir, threadId),
          projectSnapshotReportsDir(dataDir, threadId),
        ],
      })
      return result
    },
    refreshProjectSnapshot: async (threadId: string): Promise<ProjectSnapshot> => {
      const result = await context.refreshProjectSnapshot(dataDir, threadId)
      integrity.acceptApplicationWrite(dataDir, threadId, {
        filesAddedOrUpdated: [
          projectSnapshotJsonPath(dataDir, threadId),
          projectSnapshotManifestPath(dataDir, threadId),
        ],
        rootsAddedOrUpdated: [
          projectSnapshotDir(dataDir, threadId),
          projectSnapshotReportsDir(dataDir, threadId),
        ],
      })
      return result
    },
    listSnapshotReports: (threadId: string): SnapshotReport[] =>
      context.listSnapshotReports(dataDir, threadId),
    listSavedOutputs: (threadId: string): SavedConsolidation[] =>
      proposals.listSavedOutputs(dataDir, threadId),
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
    acceptIntegrity: (threadId: string, touched?: CanonicalTouched): IntegrityReport =>
      integrity.acceptApplicationWrite(dataDir, threadId, touched),
    listJobs: (threadId: string): BoundedJob[] => jobs.listJobs(dataDir, threadId),
    getJob: (threadId: string, jobId: string): BoundedJob | null =>
      jobs.getJob(dataDir, threadId, jobId),
    writeJob: (job: BoundedJob): BoundedJob => jobs.writeJob(dataDir, job),
    nextJobId: (threadId: string): string => jobs.nextJobId(dataDir, threadId),
    addAgentComment: (
      threadId: string,
      input: Parameters<typeof comments.addAgentComment>[2],
    ): Comment =>
      applyWrite(threadId, () => ({
        result: comments.addAgentComment(dataDir, threadId, input),
        touched: { filesAddedOrUpdated: [commentsPath(dataDir, threadId)] },
      })),
    listAgents: (): Agent[] => agents.listAgents(dataDir),
    createAgent: (input: CreateAgentInput): Agent =>
      agents.createAgent(dataDir, input),
    updateAgent: (agentId: string, patch: UpdateAgentInput): Agent =>
      agents.updateAgent(dataDir, agentId, patch),
    deleteAgent: (agentId: string): Agent | null =>
      agents.deleteAgent(dataDir, agentId),
    listThreadAgents: (threadId: string): ThreadAgentInvite[] =>
      agents.listThreadAgents(dataDir, threadId),
    inviteAgent: (threadId: string, input: InviteAgentInput): ThreadAgentInvite[] =>
      applyWrite(threadId, () => ({
        result: agents.inviteAgent(dataDir, threadId, input),
        touched: { filesAddedOrUpdated: [threadAgentsPath(dataDir, threadId)] },
      })),
    updateThreadAgent: (
      threadId: string,
      agentId: string,
      patch: UpdateThreadAgentInviteInput,
    ): ThreadAgentInvite[] =>
      applyWrite(threadId, () => ({
        result: agents.updateThreadAgent(dataDir, threadId, agentId, patch),
        touched: { filesAddedOrUpdated: [threadAgentsPath(dataDir, threadId)] },
      })),
    removeThreadAgent: (threadId: string, agentId: string): ThreadAgentInvite[] =>
      applyWrite(threadId, () => ({
        result: agents.removeThreadAgent(dataDir, threadId, agentId),
        touched: { filesAddedOrUpdated: [threadAgentsPath(dataDir, threadId)] },
      })),
    reorderThreadAgents: (
      threadId: string,
      input: ReorderThreadAgentsInput,
    ): ThreadAgentInvite[] =>
      applyWrite(threadId, () => ({
        result: agents.reorderThreadAgents(dataDir, threadId, input),
        touched: { filesAddedOrUpdated: [threadAgentsPath(dataDir, threadId)] },
      })),
  }
}

export type Storage = ReturnType<typeof createStorage>
