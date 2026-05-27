import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

export const roundtableQueryKeys = {
  threads: {
    all: ['threads'] as const,
    list: () => ['threads', 'list'] as const,
    detail: (threadId: string) => ['threads', threadId, 'detail'] as const,
    comments: (threadId: string) => ['threads', threadId, 'comments'] as const,
    pendingDiscussions: (threadId: string) => ['threads', threadId, 'pending-discussions'] as const,
    context: (threadId: string) => ['threads', threadId, 'context'] as const,
    snapshotReports: (threadId: string) => ['threads', threadId, 'snapshot-reports'] as const,
    room: (threadId: string) => ['threads', threadId, 'room'] as const,
    jobs: (threadId: string) => ['threads', threadId, 'jobs'] as const,
    roomPreflight: (threadId: string) => ['threads', threadId, 'room-preflight'] as const,
    consolidations: (threadId: string) => ['threads', threadId, 'consolidations'] as const,
    consolidation: (threadId: string, proposalId: string) =>
      ['threads', threadId, 'consolidations', proposalId] as const,
    integrity: (threadId: string) => ['threads', threadId, 'integrity'] as const,
    savedOutputs: (threadId: string) => ['threads', threadId, 'saved-outputs'] as const,
  },
  savedOutputs: {
    detail: (savedId: string) => ['saved-outputs', savedId] as const,
  },
  agents: {
    all: ['agents'] as const,
    list: () => ['agents', 'list'] as const,
  },
  system: {
    prompts: () => ['system', 'prompts'] as const,
    info: () => ['system', 'info'] as const,
  },
} as const
