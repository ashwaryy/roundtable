import type {
  Thread,
  ThreadDetail,
  Comment,
  CreateThreadInput,
  CreateCommentInput,
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
