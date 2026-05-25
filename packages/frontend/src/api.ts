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
  RequestIdleSuggestionInput,
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
  SavedOutput,
  SnapshotReport,
  IntegrityReport,
  StartConsolidationInput,
  ThreadListItem,
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
  ThreadAgentInvite,
  InviteAgentInput,
  UpdateThreadAgentInviteInput,
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

const READ_RETRY_DELAYS_MS = [200, 400, 800, 1000, 1000]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function readJson<T>(url: string, attempt = 0): Promise<T> {
  try {
    const response = await fetch(url)
    if (
      !response.ok &&
      response.status >= 500 &&
      attempt < READ_RETRY_DELAYS_MS.length
    ) {
      await delay(READ_RETRY_DELAYS_MS[attempt])
      return readJson<T>(url, attempt + 1)
    }
    return json<T>(response)
  } catch (err) {
    if (attempt >= READ_RETRY_DELAYS_MS.length) throw err
    await delay(READ_RETRY_DELAYS_MS[attempt])
    return readJson<T>(url, attempt + 1)
  }
}

export function listThreads(): Promise<ThreadListItem[]> {
  return readJson<ThreadListItem[]>('/api/threads')
}

export function createThread(input: CreateThreadInput): Promise<Thread> {
  return fetch('/api/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<Thread>(r))
}

export function listAgents(): Promise<Agent[]> {
  return readJson<Agent[]>('/api/agents')
}

export function createAgent(input: CreateAgentInput): Promise<Agent> {
  return fetch('/api/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }).then((r) => json<Agent>(r))
}

export function updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
  return fetch(`/api/agents/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }).then((r) => json<Agent>(r))
}

export function deleteAgent(id: string): Promise<Agent | void> {
  return fetch(`/api/agents/${id}`, { method: 'DELETE' }).then((r) =>
    r.status === 204 ? undefined : json<Agent>(r),
  )
}

export function importAgents(jsonText: string): Promise<Agent[]> {
  return fetch('/api/agents/import-json', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: jsonText }),
  }).then((r) => json<Agent[]>(r))
}

export function listThreadAgents(threadId: string): Promise<ThreadAgentInvite[]> {
  return readJson<ThreadAgentInvite[]>(`/api/threads/${threadId}/agents`)
}

export function inviteThreadAgent(threadId: string, input: InviteAgentInput): Promise<ThreadAgentInvite[]> {
  return fetch(`/api/threads/${threadId}/agents`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }).then((r) => json<ThreadAgentInvite[]>(r))
}

export function updateThreadAgent(threadId: string, id: string, input: UpdateThreadAgentInviteInput): Promise<ThreadAgentInvite[]> {
  return fetch(`/api/threads/${threadId}/agents/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }).then((r) => json<ThreadAgentInvite[]>(r))
}

export function removeThreadAgent(threadId: string, id: string): Promise<ThreadAgentInvite[]> {
  return fetch(`/api/threads/${threadId}/agents/${id}`, { method: 'DELETE' })
    .then((r) => json<ThreadAgentInvite[]>(r))
}

export function getThread(id: string): Promise<ThreadDetail> {
  return readJson<ThreadDetail>(`/api/threads/${id}`)
}

export function deleteThread(id: string): Promise<void> {
  return fetch(`/api/threads/${id}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error(`request failed: ${res.status}`)
  })
}

export function listComments(id: string): Promise<Comment[]> {
  return readJson<Comment[]>(`/api/threads/${id}/comments`)
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

export function deleteComment(threadId: string, commentId: string): Promise<void> {
  return fetch(`/api/threads/${threadId}/comments/${commentId}`, {
    method: 'DELETE',
  }).then((res) => {
    if (!res.ok) throw new Error(`request failed: ${res.status}`)
  })
}

export function listPendingDiscussions(threadId: string): Promise<PendingDiscussion[]> {
  return readJson<PendingDiscussion[]>(`/api/threads/${threadId}/pending-discussions`)
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
  return readJson<ThreadContext>(`/api/threads/${threadId}/context`)
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

export function listSnapshotReports(threadId: string): Promise<SnapshotReport[]> {
  return readJson<SnapshotReport[]>(`/api/threads/${threadId}/project-snapshot/reports`)
}

export function getIntegrity(threadId: string): Promise<IntegrityReport> {
  return readJson<IntegrityReport>(`/api/threads/${threadId}/integrity`)
}

export function acknowledgeIntegrity(threadId: string): Promise<IntegrityReport> {
  return fetch(`/api/threads/${threadId}/integrity/acknowledge`, {
    method: 'POST',
  }).then((r) => json<IntegrityReport>(r))
}

export function listSavedOutputs(threadId: string): Promise<SavedConsolidation[]> {
  return readJson<SavedConsolidation[]>(`/api/threads/${threadId}/saved-outputs`)
}

export function getSavedOutput(savedId: string): Promise<SavedOutput> {
  return readJson<SavedOutput>(`/api/saved/${savedId}`)
}

export function getRoomPreflight(threadId: string): Promise<RoomPreflight> {
  return readJson<RoomPreflight>(`/api/threads/${threadId}/room/preflight`)
}

export function getRoom(threadId: string): Promise<AgentRoom> {
  return readJson<AgentRoom>(`/api/threads/${threadId}/room`)
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

export function openRoomTerminal(threadId: string): Promise<void> {
  return fetch(`/api/threads/${threadId}/room/open-terminal`, {
    method: 'POST',
  }).then((res) => {
    if (!res.ok) throw new Error(`request failed: ${res.status}`)
  })
}

export function restartRoom(threadId: string): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/restart`, {
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

export function requestIdleSuggestion(
  threadId: string,
  input: RequestIdleSuggestionInput,
): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/suggestion-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<AgentRoom>(r))
}

export function cancelIdleSuggestion(threadId: string): Promise<AgentRoom> {
  return fetch(`/api/threads/${threadId}/room/suggestion-request/cancel`, {
    method: 'POST',
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
  return readJson<BoundedJob[]>(`/api/threads/${threadId}/jobs`)
}

export function listConsolidations(threadId: string): Promise<ConsolidationProposal[]> {
  return readJson<ConsolidationProposal[]>(`/api/threads/${threadId}/consolidations`)
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
  return readJson<ConsolidationDetail>(
    `/api/threads/${threadId}/consolidations/${proposalId}`,
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
