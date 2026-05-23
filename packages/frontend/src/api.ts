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
  NudgeRoomInput,
  RoomPreflight,
  StartRoomInput,
} from '@roundtable/shared'

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
