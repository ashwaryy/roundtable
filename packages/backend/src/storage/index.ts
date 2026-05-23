import type {
  Thread,
  ThreadDetail,
  Comment,
  CreateThreadInput,
  CreateCommentInput,
} from '@roundtable/shared'
import * as threads from './threads'
import * as comments from './comments'

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
  }
}

export type Storage = ReturnType<typeof createStorage>
