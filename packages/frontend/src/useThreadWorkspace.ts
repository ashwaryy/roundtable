import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentName,
  AgentRoom,
  BoundedJob,
  CommentType,
  RoundtableEvent,
} from '@roundtable/shared'
import {
  askAgent,
  createComment,
  deleteComment,
  getConsolidation,
  getIntegrity,
  getRoom,
  getRoomPreflight,
  getThread,
  getThreadContext,
  listComments,
  listConsolidations,
  listJobs,
  listPendingDiscussions,
  listSavedOutputs,
  listSnapshotReports,
  restartRoom,
  retryTurn,
  sendRoomInputResponse,
  skipTurn,
  type AgentTurnResult,
} from './api'
import { isActiveProposal } from './lib/consolidationUi'
import { roundtableQueryKeys } from './query'
import { useLiveRefresh } from './useLiveRefresh'

type DiscussionAskStatus = { discussionId: string; agent: AgentName }

function discussionAskFromJob(job: BoundedJob | null): DiscussionAskStatus | null {
  if (!job || job.status !== 'running' || job.turn.kind !== 'comment' || job.turn.scope !== 'discussion' || !job.turn.discussion_id) {
    return null
  }
  return { discussionId: job.turn.discussion_id, agent: job.agent }
}

export function useThreadWorkspace(threadId: string | undefined, onThreadDeleted: () => void) {
  const queryClient = useQueryClient()
  const [pendingAsk, setPendingAsk] = useState<DiscussionAskStatus | null>(null)
  const enabled = Boolean(threadId)

  const { data: thread = null } = useQuery({
    queryKey: threadId ? roundtableQueryKeys.threads.detail(threadId) : roundtableQueryKeys.threads.detail('missing'),
    queryFn: () => getThread(threadId!),
    enabled,
  })
  const commentsQuery = useQuery({
    queryKey: threadId ? roundtableQueryKeys.threads.comments(threadId) : roundtableQueryKeys.threads.comments('missing'),
    queryFn: () => listComments(threadId!),
    enabled,
  })
  const { data: pendingDiscussions = [] } = useQuery({
    queryKey: threadId
      ? roundtableQueryKeys.threads.pendingDiscussions(threadId)
      : roundtableQueryKeys.threads.pendingDiscussions('missing'),
    queryFn: () => listPendingDiscussions(threadId!),
    enabled,
  })
  const { data: threadContext = null } = useQuery({
    queryKey: threadId ? roundtableQueryKeys.threads.context(threadId) : roundtableQueryKeys.threads.context('missing'),
    queryFn: () => getThreadContext(threadId!),
    enabled,
  })
  const { data: snapshotReports = [] } = useQuery({
    queryKey: threadId
      ? roundtableQueryKeys.threads.snapshotReports(threadId)
      : roundtableQueryKeys.threads.snapshotReports('missing'),
    queryFn: () => listSnapshotReports(threadId!),
    enabled,
  })
  const { data: room = null } = useQuery({
    queryKey: threadId ? roundtableQueryKeys.threads.room(threadId) : roundtableQueryKeys.threads.room('missing'),
    queryFn: () => getRoom(threadId!),
    enabled,
  })
  const { data: jobs = [] } = useQuery({
    queryKey: threadId ? roundtableQueryKeys.threads.jobs(threadId) : roundtableQueryKeys.threads.jobs('missing'),
    queryFn: () => listJobs(threadId!),
    enabled,
  })
  const { data: roomPreflight = null } = useQuery({
    queryKey: threadId
      ? roundtableQueryKeys.threads.roomPreflight(threadId)
      : roundtableQueryKeys.threads.roomPreflight('missing'),
    queryFn: () => getRoomPreflight(threadId!),
    enabled,
  })
  const { data: proposals = [] } = useQuery({
    queryKey: threadId
      ? roundtableQueryKeys.threads.consolidations(threadId)
      : roundtableQueryKeys.threads.consolidations('missing'),
    queryFn: () => listConsolidations(threadId!),
    enabled,
  })
  const { data: integrity = null } = useQuery({
    queryKey: threadId
      ? roundtableQueryKeys.threads.integrity(threadId)
      : roundtableQueryKeys.threads.integrity('missing'),
    queryFn: () => getIntegrity(threadId!),
    enabled,
  })
  const { data: savedOutputs = [] } = useQuery({
    queryKey: threadId
      ? roundtableQueryKeys.threads.savedOutputs(threadId)
      : roundtableQueryKeys.threads.savedOutputs('missing'),
    queryFn: () => listSavedOutputs(threadId!),
    enabled,
  })

  const activeProposal = proposals.find(isActiveProposal)
  const selectedOutcomeProposal = activeProposal ?? proposals[proposals.length - 1] ?? null

  const { data: sourceThread = null } = useQuery({
    queryKey: thread?.parent_thread_id
      ? roundtableQueryKeys.threads.detail(thread.parent_thread_id)
      : roundtableQueryKeys.threads.detail('missing-parent'),
    queryFn: () => getThread(thread!.parent_thread_id!),
    enabled: Boolean(thread?.parent_thread_id),
  })
  const { data: sourceProposal = null } = useQuery({
    queryKey: thread?.parent_thread_id && thread?.created_from_consolidation_id
      ? roundtableQueryKeys.threads.consolidation(thread.parent_thread_id, thread.created_from_consolidation_id)
      : roundtableQueryKeys.threads.consolidation('missing-parent', 'missing-proposal'),
    queryFn: () => getConsolidation(thread!.parent_thread_id!, thread!.created_from_consolidation_id!),
    enabled: Boolean(thread?.parent_thread_id && thread?.created_from_consolidation_id),
    select: (detail) => detail.proposal,
  })
  const { data: activeConsolidationDetail = null } = useQuery({
    queryKey: threadId && selectedOutcomeProposal
      ? roundtableQueryKeys.threads.consolidation(threadId, selectedOutcomeProposal.id)
      : roundtableQueryKeys.threads.consolidation('missing', 'missing'),
    queryFn: () => getConsolidation(threadId!, selectedOutcomeProposal!.id),
    enabled: Boolean(threadId && selectedOutcomeProposal),
  })

  const refresh = useCallback(() => {
    if (!threadId) return
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.detail(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.comments(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.pendingDiscussions(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.context(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.snapshotReports(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.room(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.jobs(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.roomPreflight(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.consolidations(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.integrity(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.savedOutputs(threadId) })
  }, [queryClient, threadId])

  const refreshDiscussionQueues = useCallback(() => {
    if (!threadId) return
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.comments(threadId) })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.pendingDiscussions(threadId) })
  }, [queryClient, threadId])

  const onEvent = useCallback((event: RoundtableEvent) => {
    if (event.type === 'agents_updated') {
      void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.agents.all })
      return
    }
    if (!threadId || !('thread_id' in event) || event.thread_id !== threadId) return
    if (event.type === 'thread_deleted') {
      onThreadDeleted()
      return
    }
    switch (event.type) {
      case 'comment_created':
      case 'comment_deleted':
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.comments(threadId) })
        return
      case 'pending_discussion_created':
      case 'pending_discussion_updated':
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.pendingDiscussions(threadId) })
        return
      case 'room_updated':
      case 'job_updated':
      case 'thread_agents_updated':
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.room(threadId) })
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.jobs(threadId) })
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.roomPreflight(threadId) })
        return
      case 'consolidation_updated':
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.detail(threadId) })
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.consolidations(threadId) })
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.savedOutputs(threadId) })
        void queryClient.invalidateQueries({
          queryKey: roundtableQueryKeys.threads.consolidation(threadId, event.proposal_id),
        })
        if (selectedOutcomeProposal) {
          void queryClient.invalidateQueries({
            queryKey: roundtableQueryKeys.threads.consolidation(threadId, selectedOutcomeProposal.id),
          })
        }
        return
      case 'integrity_updated':
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.integrity(threadId) })
        return
      case 'thread_context_updated':
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.context(threadId) })
        void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.snapshotReports(threadId) })
        return
      default:
        refresh()
    }
  }, [onThreadDeleted, queryClient, refresh, selectedOutcomeProposal, threadId])

  const backendStatus = useLiveRefresh(onEvent)

  const comments = commentsQuery.data ?? []
  const commentsLoaded = commentsQuery.status !== 'pending'
  const activeRoomJob = room?.active_job_id ? jobs.find((job) => job.id === room.active_job_id) ?? null : null
  const activeJobAsk = discussionAskFromJob(activeRoomJob)
  const activeAsk = activeJobAsk ?? pendingAsk
  const workingAgent = activeRoomJob?.status === 'running' ? activeRoomJob.agent : null
  const autoModeActive = room?.auto !== null && room?.auto !== undefined
  const commentAskDisabledReason = autoModeActive ? 'Exit auto mode to enable Ask agent actions on comments.' : null
  const disableCommentAgentActions = room?.status === 'running' || autoModeActive || pendingAsk !== null

  useEffect(() => {
    if (!pendingAsk) return
    if (activeJobAsk && activeJobAsk.discussionId === pendingAsk.discussionId && activeJobAsk.agent === pendingAsk.agent) {
      setPendingAsk(null)
    }
  }, [activeJobAsk, pendingAsk])

  const addTopLevel = useCallback(async (input: { body: string; type: CommentType }) => {
    if (!threadId) return
    await createComment(threadId, input)
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.comments(threadId) })
  }, [queryClient, threadId])

  const addReply = useCallback(async (replyTo: string, input: { body: string; type: CommentType }) => {
    if (!threadId) return
    await createComment(threadId, { ...input, reply_to: replyTo })
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.comments(threadId) })
  }, [queryClient, threadId])

  const removeComment = useCallback(async (commentId: string) => {
    if (!threadId) return
    await deleteComment(threadId, commentId)
    void queryClient.invalidateQueries({ queryKey: roundtableQueryKeys.threads.comments(threadId) })
  }, [queryClient, threadId])

  const applyRoomResult = useCallback((result: AgentRoom | AgentTurnResult) => {
    if (!threadId) return
    if ('room' in result) {
      queryClient.setQueryData(roundtableQueryKeys.threads.room(threadId), result.room)
      queryClient.setQueryData<BoundedJob[]>(roundtableQueryKeys.threads.jobs(threadId), (previousJobs = []) =>
        previousJobs.some((job) => job.id === result.job.id)
          ? previousJobs.map((job) => (job.id === result.job.id ? result.job : job))
          : [...previousJobs, result.job],
      )
      return
    }
    queryClient.setQueryData(roundtableQueryKeys.threads.room(threadId), result)
  }, [queryClient, threadId])

  const askDiscussion = useCallback(async (discussionId: string, agent: AgentName) => {
    if (!threadId) return
    setPendingAsk({ discussionId, agent })
    try {
      applyRoomResult(await askAgent(threadId, { agent, discussion_id: discussionId }))
      setPendingAsk(null)
    } catch (error) {
      setPendingAsk(null)
      throw error
    }
  }, [applyRoomResult, threadId])

  const sendRecoveryInput = useCallback(async (response: 'yes' | 'no') => {
    if (!threadId || !room?.input_prompt) return
    applyRoomResult(await sendRoomInputResponse(threadId, { agent: room.input_prompt.agent, response }))
  }, [applyRoomResult, room?.input_prompt, threadId])

  const restartRecoveryRoom = useCallback(async () => {
    if (!threadId) return
    applyRoomResult(await restartRoom(threadId))
  }, [applyRoomResult, threadId])

  const retryRecoveryTurn = useCallback(async () => {
    if (!threadId) return
    applyRoomResult(await retryTurn(threadId))
  }, [applyRoomResult, threadId])

  const skipRecoveryTurn = useCallback(async () => {
    if (!threadId) return
    applyRoomResult(await skipTurn(threadId))
  }, [applyRoomResult, threadId])

  return {
    thread,
    comments,
    commentsLoaded,
    pendingDiscussions,
    threadContext,
    room,
    jobs,
    roomPreflight,
    proposals,
    integrity,
    savedOutputs,
    snapshotReports,
    sourceThread,
    sourceProposal,
    activeConsolidationDetail,
    backendStatus,
    refresh,
    refreshDiscussionQueues,
    addTopLevel,
    addReply,
    removeComment,
    askDiscussion,
    activeAsk,
    disableCommentAgentActions,
    commentAskDisabledReason,
    sendRecoveryInput,
    restartRecoveryRoom,
    retryRecoveryTurn,
    skipRecoveryTurn,
    applyRoomResult,
    workingAgent,
  }
}
