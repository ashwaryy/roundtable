import type {
  Thread,
  ThreadDetail,
  Comment,
  PendingDiscussion,
  CreateThreadInput,
  CreateCommentInput,
  CreatePendingDiscussionInput,
  EditPendingDiscussionInput,
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
