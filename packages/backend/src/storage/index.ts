import type {
  Thread,
  ThreadDetail,
  Comment,
  PendingDiscussion,
  ConsolidationProposal,
  ProposalRevision,
  CreateThreadInput,
  CreateCommentInput,
  CreatePendingDiscussionInput,
  EditPendingDiscussionInput,
  CreateConsolidationInput,
  CommentAuthor,
} from '@roundtable/shared'
import * as threads from './threads'
import * as comments from './comments'
import * as pending from './pendingDiscussions'
import * as proposals from './proposals'

export { NotFoundError } from './errors'

export function createStorage(dataDir: string) {
  return {
    createThread: (input: CreateThreadInput): Thread =>
      threads.createThread(dataDir, input),
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
    listProposals: (threadId: string): ConsolidationProposal[] =>
      proposals.listProposals(dataDir, threadId),
    addProposalRevision: (
      threadId: string,
      proposalId: string,
      body: string,
      author: CommentAuthor,
    ): ProposalRevision =>
      proposals.addProposalRevision(dataDir, threadId, proposalId, body, author),
    getLatestRevision: (threadId: string, proposalId: string): string | null =>
      proposals.getLatestRevision(dataDir, threadId, proposalId),
    listRevisions: (threadId: string, proposalId: string): ProposalRevision[] =>
      proposals.listRevisions(dataDir, threadId, proposalId),
  }
}

export type Storage = ReturnType<typeof createStorage>
