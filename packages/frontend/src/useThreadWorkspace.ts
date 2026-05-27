import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentName,
  AgentRoom,
  BoundedJob,
  Comment,
  CommentType,
  ConsolidationDetail,
  ConsolidationProposal,
  IntegrityReport,
  PendingDiscussion,
  RoomPreflight,
  RoundtableEvent,
  SavedConsolidation,
  SnapshotReport,
  ThreadContext,
  ThreadDetail,
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
import { useLiveRefresh } from './useLiveRefresh'
import { isActiveProposal } from './lib/consolidationUi'

type DiscussionAskStatus = { discussionId: string; agent: AgentName }

function discussionAskFromJob(job: BoundedJob | null): DiscussionAskStatus | null {
  if (!job || job.status !== 'running' || job.turn.kind !== 'comment' || job.turn.scope !== 'discussion' || !job.turn.discussion_id) {
    return null
  }
  return { discussionId: job.turn.discussion_id, agent: job.agent }
}

export function useThreadWorkspace(threadId: string | undefined, onThreadDeleted: () => void) {
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [pendingDiscussions, setPendingDiscussions] = useState<PendingDiscussion[]>([])
  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null)
  const [room, setRoom] = useState<AgentRoom | null>(null)
  const [jobs, setJobs] = useState<BoundedJob[]>([])
  const [roomPreflight, setRoomPreflight] = useState<RoomPreflight | null>(null)
  const [proposals, setProposals] = useState<ConsolidationProposal[]>([])
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [savedOutputs, setSavedOutputs] = useState<SavedConsolidation[]>([])
  const [snapshotReports, setSnapshotReports] = useState<SnapshotReport[]>([])
  const [sourceThread, setSourceThread] = useState<ThreadDetail | null>(null)
  const [sourceProposal, setSourceProposal] = useState<ConsolidationProposal | null>(null)
  const [activeConsolidationDetail, setActiveConsolidationDetail] = useState<ConsolidationDetail | null>(null)
  const [pendingAsk, setPendingAsk] = useState<DiscussionAskStatus | null>(null)
  const requestSeqRef = useRef<Record<string, number>>({})

  const loadLatest = useCallback(<T,>(key: string, request: () => Promise<T>, apply: (value: T) => void) => {
    const seq = (requestSeqRef.current[key] ?? 0) + 1
    requestSeqRef.current[key] = seq
    request()
      .then((value) => {
        if (requestSeqRef.current[key] === seq) apply(value)
      })
      .catch(() => {
        // Keep the existing state when a transient refresh request fails.
      })
  }, [])

  const refreshThread = useCallback(() => {
    if (!threadId) return
    loadLatest('thread', () => getThread(threadId), setThread)
  }, [loadLatest, threadId])

  const refreshComments = useCallback(() => {
    if (!threadId) return
    loadLatest('comments', () => listComments(threadId), (nextComments) => {
      setComments(nextComments)
      setCommentsLoaded(true)
    })
  }, [loadLatest, threadId])

  const refreshPendingDiscussions = useCallback(() => {
    if (!threadId) return
    loadLatest('pending', () => listPendingDiscussions(threadId), setPendingDiscussions)
  }, [loadLatest, threadId])

  const refreshContext = useCallback(() => {
    if (!threadId) return
    loadLatest('context', () => getThreadContext(threadId), setThreadContext)
    loadLatest('snapshotReports', () => listSnapshotReports(threadId), setSnapshotReports)
  }, [loadLatest, threadId])

  const refreshRoom = useCallback(() => {
    if (!threadId) return
    loadLatest('room', () => getRoom(threadId), setRoom)
    loadLatest('jobs', () => listJobs(threadId), setJobs)
    loadLatest('roomPreflight', () => getRoomPreflight(threadId), setRoomPreflight)
  }, [loadLatest, threadId])

  const refreshConsolidations = useCallback(() => {
    if (!threadId) return
    loadLatest('proposals', () => listConsolidations(threadId), setProposals)
    loadLatest('savedOutputs', () => listSavedOutputs(threadId), setSavedOutputs)
  }, [loadLatest, threadId])

  const refreshIntegrity = useCallback(() => {
    if (!threadId) return
    loadLatest('integrity', () => getIntegrity(threadId), setIntegrity)
  }, [loadLatest, threadId])

  const refresh = useCallback(() => {
    if (!threadId) return
    refreshThread()
    refreshComments()
    refreshPendingDiscussions()
    refreshContext()
    refreshRoom()
    refreshConsolidations()
    refreshIntegrity()
  }, [refreshComments, refreshConsolidations, refreshContext, refreshIntegrity, refreshPendingDiscussions, refreshRoom, refreshThread, threadId])

  const refreshDiscussionQueues = useCallback(() => {
    refreshComments()
    refreshPendingDiscussions()
  }, [refreshComments, refreshPendingDiscussions])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!thread?.parent_thread_id || !thread.created_from_consolidation_id) {
      setSourceThread(null)
      setSourceProposal(null)
      return
    }
    getThread(thread.parent_thread_id)
      .then(setSourceThread)
      .catch(() => setSourceThread(null))
    getConsolidation(thread.parent_thread_id, thread.created_from_consolidation_id)
      .then((detail) => setSourceProposal(detail.proposal))
      .catch(() => setSourceProposal(null))
  }, [thread?.created_from_consolidation_id, thread?.parent_thread_id])

  const activeProposal = proposals.find(isActiveProposal)
  const selectedOutcomeProposal = activeProposal ?? proposals[proposals.length - 1] ?? null

  useEffect(() => {
    if (!threadId || !selectedOutcomeProposal) {
      setActiveConsolidationDetail(null)
      return
    }
    getConsolidation(threadId, selectedOutcomeProposal.id)
      .then(setActiveConsolidationDetail)
      .catch(() => setActiveConsolidationDetail(null))
  }, [selectedOutcomeProposal?.id, selectedOutcomeProposal?.updated_at, threadId])

  const onEvent = useCallback((event: RoundtableEvent) => {
    if (!('thread_id' in event) || event.thread_id !== threadId) return
    if (event.type === 'thread_deleted') {
      onThreadDeleted()
      return
    }
    switch (event.type) {
      case 'comment_created':
      case 'comment_deleted':
        refreshComments()
        return
      case 'pending_discussion_created':
      case 'pending_discussion_updated':
        refreshPendingDiscussions()
        return
      case 'room_updated':
      case 'job_updated':
      case 'thread_agents_updated':
        refreshRoom()
        return
      case 'consolidation_updated':
        refreshConsolidations()
        return
      case 'integrity_updated':
        refreshIntegrity()
        return
      case 'thread_context_updated':
        refreshContext()
        return
      default:
        refresh()
    }
  }, [onThreadDeleted, refresh, refreshComments, refreshConsolidations, refreshContext, refreshIntegrity, refreshPendingDiscussions, refreshRoom, threadId])

  const backendStatus = useLiveRefresh(onEvent)

  const activeRoomJob = room?.active_job_id ? (jobs.find((job) => job.id === room.active_job_id) ?? null) : null
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
    refreshComments()
  }, [refreshComments, threadId])

  const addReply = useCallback(async (replyTo: string, input: { body: string; type: CommentType }) => {
    if (!threadId) return
    await createComment(threadId, { ...input, reply_to: replyTo })
    refreshComments()
  }, [refreshComments, threadId])

  const removeComment = useCallback(async (commentId: string) => {
    if (!threadId) return
    await deleteComment(threadId, commentId)
    refreshComments()
  }, [refreshComments, threadId])

  const applyRoomResult = useCallback((result: AgentRoom | AgentTurnResult) => {
    if ('room' in result) {
      setRoom(result.room)
      setJobs((previousJobs) =>
        previousJobs.some((job) => job.id === result.job.id)
          ? previousJobs.map((job) => (job.id === result.job.id ? result.job : job))
          : [...previousJobs, result.job],
      )
    } else {
      setRoom(result)
    }
  }, [])

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
