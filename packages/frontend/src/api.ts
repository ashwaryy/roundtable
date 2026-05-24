import type {
  Thread,
  ThreadDetail,
  Comment,
  PendingDiscussion,
  CreateThreadInput,
  CreateCommentInput,
  CreatePendingDiscussionInput,
  EditPendingDiscussionInput,
  ContextItem,
  CreateProjectSnapshotInput,
  CreateUrlContextInput,
  ProjectSnapshot,
  SnapshotPreflight,
  SnapshotPreflightInput,
  ThreadContext,
  AgentRoom,
  AskAgentInput,
  BoundedJob,
  ExtendAutoDiscussionInput,
  NudgeRoomInput,
  RoomPreflight,
  SendRoomInputResponseInput,
  StartRoomInput,
  StartAutoDiscussionInput,
  ConsolidationDetail,
  ConsolidationProposal,
  CreateProposalRevisionInput,
  RequestProposalReviewInput,
  RequestProposalRevisionInput,
  SavedConsolidation,
  StartConsolidationInput,
} from '@roundtable/shared'

export interface AgentTurnResult {
  room: AgentRoom
  job: BoundedJob
}

export interface ConsolidationTurnResult extends AgentTurnResult {
  proposal: ConsolidationProposal
}

export interface AgentTurnSubmission extends AgentTurnResult {
  comment: Comment
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function listThreads(): Promise<Thread[]> {
  return fetch('/api/threads').then((r) => json<Thread[]>(r))
}

export function createThread(input: CreateThreadInput): Promise<Thread> {
  return fetch('/api/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<Thread>(r))
}

export function getThread(id: string): Promise<ThreadDetail> {
  return fetch(`/api/threads/${id}`).then((r) => json<ThreadDetail>(r))
}

export function listComments(id: string): Promise<Comment[]> {
  return fetch(`/api/threads/${id}/comments`).then((r) => json<Comment[]>(r))
}

export function createComment(
  id: string,
  input: CreateCommentInput,
): Promise<Comment> {
  return fetch(`/api/threads/${id}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<Comment>(r))
}

export function listPendingDiscussions(threadId: string): Promise<PendingDiscussion[]> {
  return fetch(`/api/threads/${threadId}/pending-discussions`).then((r) =>
    json<PendingDiscussion[]>(r),
  )
}

export function createPendingDiscussion(
  threadId: string,
  input: CreatePendingDiscussionInput,
): Promise<PendingDiscussion> {
  return fetch(`/api/threads/${threadId}/pending-discussions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<PendingDiscussion>(r))
}

export function approvePendingDiscussion(
  threadId: string,
  pendingId: string,
): Promise<Comment> {
  return fetch(`/api/threads/${threadId}/pending-discussions/${pendingId}/approve`, {
    method: 'POST',
  }).then((r) => json<Comment>(r))
}

export function editPendingDiscussion(
  threadId: string,
  pendingId: string,
  input: EditPendingDiscussionInput,
): Promise<PendingDiscussion> {
  return fetch(`/api/threads/${threadId}/pending-discussions/${pendingId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<PendingDiscussion>(r))
}

export function rejectPendingDiscussion(
  threadId: string,
  pendingId: string,
): Promise<void> {
  return fetch(`/api/threads/${threadId}/pending-discussions/${pendingId}`, {
    method: 'DELETE',
  }).then((res) => {
    if (!res.ok) throw new Error(`request failed: ${res.status}`)
  })
}

export function getThreadContext(threadId: string): Promise<ThreadContext> {
  return fetch(`/api/threads/${threadId}/context`).then((r) => json<ThreadContext>(r))
}

export function uploadAttachmentFiles(
  threadId: string,
  files: FileList | File[],
): Promise<ContextItem[]> {
  const form = new FormData()
  Array.from(files).forEach((file) => form.append('files', file))
  return fetch(`/api/threads/${threadId}/attachments/files`, {
    method: 'POST',
    body: form,
  }).then((r) => json<ContextItem[]>(r))
}

export function addUrlContextItem(
  threadId: string,
  input: CreateUrlContextInput,
): Promise<ContextItem> {
  return fetch(`/api/threads/${threadId}/attachments/urls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<ContextItem>(r))
}

export function preflightProjectSnapshot(
  threadId: string,
  input: SnapshotPreflightInput,
): Promise<SnapshotPreflight> {
  return fetch(`/api/threads/${threadId}/project-snapshot/preflight`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<SnapshotPreflight>(r))
}

export function createProjectSnapshot(
  threadId: string,
  input: CreateProjectSnapshotInput,
): Promise<ProjectSnapshot> {
  return fetch(`/api/threads/${threadId}/project-snapshot`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<ProjectSnapshot>(r))
}

export function refreshProjectSnapshot(threadId: string): Promise<ProjectSnapshot> {
  return fetch(`/api/threads/${threadId}/project-snapshot/refresh`, {
    method: 'POST',
  }).then((r) => json<ProjectSnapshot>(r))
}

export function getRoomPreflight(threadId: string): Promise<RoomPreflight> {
  return fetch(`/api/threads/${threadId}/room/preflight`).then((r) =>
    json<RoomPreflight>(r),
  )
}

export function getRoom(threadId: string): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room`).then((r) => json<AgentRoom>(r))
}

export function startRoom(
  threadId: string,
  input: StartRoomInput,
): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentRoom>(r))
}

export function stopRoom(threadId: string): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/stop`, {
    method: 'POST',
  }).then((r) => json<AgentRoom>(r))
}

export function nudgeRoom(
  threadId: string,
  input: NudgeRoomInput,
): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/nudge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentRoom>(r))
}

export function askAgent(
  threadId: string,
  input: AskAgentInput,
): Promise<AgentTurnResult> {
  return fetch(`/api/threads/${threadId}/room/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentTurnResult>(r))
}

export function startAutoDiscussion(
  threadId: string,
  input: StartAutoDiscussionInput,
): Promise<AgentTurnResult> {
  return fetch(`/api/threads/${threadId}/room/auto/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentTurnResult>(r))
}

export function pauseAutoDiscussion(threadId: string): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/auto/pause`, {
    method: 'POST',
  }).then((r) => json<AgentRoom>(r))
}

export function extendAutoDiscussion(
  threadId: string,
  input: ExtendAutoDiscussionInput,
): Promise<AgentTurnResult> {
  return fetch(`/api/threads/${threadId}/room/auto/extend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentTurnResult>(r))
}

export function sendRoomInputResponse(
  threadId: string,
  input: SendRoomInputResponseInput,
): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/input-response`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentRoom>(r))
}

export function retryTurn(threadId: string): Promise<AgentTurnResult> {
  return fetch(`/api/threads/${threadId}/room/turn/retry`, {
    method: 'POST',
  }).then((r) => json<AgentTurnResult>(r))
}

export function skipTurn(threadId: string): Promise<AgentTurnResult> {
  return fetch(`/api/threads/${threadId}/room/turn/skip`, {
    method: 'POST',
  }).then((r) => json<AgentTurnResult>(r))
}

export function listJobs(threadId: string): Promise<BoundedJob[]> {
  return fetch(`/api/threads/${threadId}/jobs`).then((r) => json<BoundedJob[]>(r))
}

export function listConsolidations(threadId: string): Promise<ConsolidationProposal[]> {
  return fetch(`/api/threads/${threadId}/consolidations`).then((r) =>
    json<ConsolidationProposal[]>(r),
  )
}

export function startConsolidation(
  threadId: string,
  input: StartConsolidationInput,
): Promise<ConsolidationTurnResult> {
  return fetch(`/api/threads/${threadId}/consolidations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<ConsolidationTurnResult>(r))
}

export function finishAndStartConsolidation(
  threadId: string,
  input: StartConsolidationInput,
): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/consolidations/finish-and-start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentRoom>(r))
}

export function getConsolidation(
  threadId: string,
  proposalId: string,
): Promise<ConsolidationDetail> {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}`).then((r) =>
    json<ConsolidationDetail>(r),
  )
}

export function saveProposalRevision(
  threadId: string,
  proposalId: string,
  input: CreateProposalRevisionInput,
) {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}/revisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json(r))
}

export function requestProposalReview(
  threadId: string,
  proposalId: string,
  input: RequestProposalReviewInput,
): Promise<ConsolidationTurnResult> {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<ConsolidationTurnResult>(r))
}

export function requestProposalRevision(
  threadId: string,
  proposalId: string,
  input: RequestProposalRevisionInput,
): Promise<ConsolidationTurnResult> {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}/revise`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<ConsolidationTurnResult>(r))
}

export function rejectProposal(
  threadId: string,
  proposalId: string,
): Promise<ConsolidationProposal> {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}/reject`, {
    method: 'POST',
  }).then((r) => json<ConsolidationProposal>(r))
}

export function saveConsolidatedOutput(
  threadId: string,
  proposalId: string,
): Promise<SavedConsolidation> {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}/save`, {
    method: 'POST',
  }).then((r) => json<SavedConsolidation>(r))
}

export function startNextIteration(
  threadId: string,
  proposalId: string,
): Promise<Thread> {
  return fetch(`/api/threads/${threadId}/consolidations/${proposalId}/next-iteration`, {
    method: 'POST',
  }).then((r) => json<Thread>(r))
}
