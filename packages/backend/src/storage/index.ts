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
  SnapshotPreflight,
  ThreadContext,
  BoundedJob,
  SavedConsolidation,
} from '@roundtable/shared'
import * as threads from './threads'
import * as comments from './comments'
import * as pending from './pendingDiscussions'
import * as proposals from './proposals'
import * as context from './context'
import * as jobs from './jobs'
import { BadRequestError, NotFoundError } from './errors'

export {
  BadRequestError,
  ConfirmationRequiredError,
  ConflictError,
  NotFoundError,
} from './errors'

export function createStorage(dataDir: string) {
  return {
    createThread: (input: CreateThreadInput): Thread =>
      threads.createThread(dataDir, input),
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
      if (input.copyContext) {
        context.copyThreadContext(dataDir, input.parentThreadId, thread.id)
      }
      return thread
    },
    archiveThread: (threadId: string): Thread => threads.archiveThread(dataDir, threadId),
    closeThread: (threadId: string): Thread => threads.closeThread(dataDir, threadId),
    listThreads: (): Thread[] => threads.listThreads(dataDir),
    getThread: (id: string): ThreadDetail | null => threads.getThread(dataDir, id),
    listComments: (threadId: string): Comment[] =>
      comments.listComments(dataDir, threadId),
    addComment: (threadId: string, input: CreateCommentInput): Comment =>
      comments.addComment(dataDir, threadId, input),
    listPendingDiscussions: (threadId: string): PendingDiscussion[] =>
      pending.listPendingDiscussions(dataDir, threadId),
    addPendingDiscussion: (
      threadId: string,
      input: CreatePendingDiscussionInput,
    ): PendingDiscussion => pending.addPendingDiscussion(dataDir, threadId, input),
    approvePendingDiscussion: (threadId: string, pendingId: string): Comment =>
      pending.approvePendingDiscussion(dataDir, threadId, pendingId),
    editPendingDiscussion: (
      threadId: string,
      pendingId: string,
      input: EditPendingDiscussionInput,
    ): PendingDiscussion =>
      pending.editPendingDiscussion(dataDir, threadId, pendingId, input),
    rejectPendingDiscussion: (threadId: string, pendingId: string): void =>
      pending.rejectPendingDiscussion(dataDir, threadId, pendingId),
    createProposal: (
      threadId: string,
      input: CreateConsolidationInput,
    ): ConsolidationProposal => proposals.createProposal(dataDir, threadId, input),
    getProposal: (
      threadId: string,
      proposalId: string,
    ): ConsolidationProposal | null =>
      proposals.getProposal(dataDir, threadId, proposalId),
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
    addProposalRevision: (
      threadId: string,
      proposalId: string,
      body: string,
      author: CommentAuthor,
    ): ProposalRevision =>
      proposals.addProposalRevision(dataDir, threadId, proposalId, body, author),
    addProposalReview: (
      threadId: string,
      proposalId: string,
      body: string,
      author: Parameters<typeof proposals.addProposalReview>[4],
      revisionId: string | null,
    ): ProposalReview =>
      proposals.addProposalReview(dataDir, threadId, proposalId, body, author, revisionId),
    updateProposal: (
      threadId: string,
      proposalId: string,
      patch: Partial<ConsolidationProposal>,
    ): ConsolidationProposal =>
      proposals.updateProposal(dataDir, threadId, proposalId, patch),
    rejectProposal: (threadId: string, proposalId: string): ConsolidationProposal =>
      proposals.rejectProposal(dataDir, threadId, proposalId),
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
      context.copyThreadContext(dataDir, threadId, next.id)
      threads.archiveThread(dataDir, threadId)
      proposals.markApplied(dataDir, threadId, proposalId, next.id)
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
    ): ContextItem => context.addUrlContextItem(dataDir, threadId, input),
    addAttachmentFromFile: (
      threadId: string,
      input: {
        tempPath: string
        originalName: string
        mediaType: string | null
        sizeBytes: number
      },
    ): FileContextItem => context.addAttachmentFromFile(dataDir, threadId, input),
    preflightProjectSnapshot: (
      threadId: string,
      sourcePath: string,
    ): SnapshotPreflight =>
      context.preflightProjectSnapshot(dataDir, threadId, sourcePath),
    createProjectSnapshot: (
      threadId: string,
      input: CreateProjectSnapshotInput,
    ): ProjectSnapshot => context.createProjectSnapshot(dataDir, threadId, input),
    refreshProjectSnapshot: (threadId: string): ProjectSnapshot =>
      context.refreshProjectSnapshot(dataDir, threadId),
    listJobs: (threadId: string): BoundedJob[] => jobs.listJobs(dataDir, threadId),
    getJob: (threadId: string, jobId: string): BoundedJob | null =>
      jobs.getJob(dataDir, threadId, jobId),
    writeJob: (job: BoundedJob): BoundedJob => jobs.writeJob(dataDir, job),
    nextJobId: (threadId: string): string => jobs.nextJobId(dataDir, threadId),
    addAgentComment: (
      threadId: string,
      input: Parameters<typeof comments.addAgentComment>[2],
    ): Comment => comments.addAgentComment(dataDir, threadId, input),
  }
}

export type Storage = ReturnType<typeof createStorage>
