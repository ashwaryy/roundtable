import { useCallback, useEffect, useState } from 'react'
import type { AgentName, AgentRoom } from '@roundtable/shared'
import {
  cancelIdleSuggestion,
  exitAutoDiscussion,
  extendAutoDiscussion,
  inviteThreadAgent,
  nudgeRoom,
  openRoomTerminal,
  pauseAutoDiscussion,
  removeThreadAgent,
  requestIdleSuggestion,
  restartRoom,
  retryTurn,
  sendRoomInputResponse,
  skipTurn,
  startAutoDiscussion,
  startRoom,
  stopAutoDiscussion,
  stopRoom,
  updateThreadAgent,
  type AgentTurnResult,
} from './api'

type RoomControlsOptions = {
  threadId: string
  room: AgentRoom | null
  onUpdate: () => void
  onRoomResult: (result: AgentRoom | AgentTurnResult) => void
}

export function useRoomControls({ threadId, room, onUpdate, onRoomResult }: RoomControlsOptions) {
  const [error, setError] = useState<string | null>(null)
  const [startingRoom, setStartingRoom] = useState(false)
  const [openingTerminal, setOpeningTerminal] = useState(false)

  const start = useCallback(async (models: Record<string, string>) => {
    setError(null)
    setStartingRoom(true)
    try {
      await startRoom(threadId, {
        claude_model: models.claude || null,
        codex_model: models.codex || null,
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStartingRoom(false)
    }
  }, [onUpdate, threadId])

  const stop = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await stopRoom(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const openTerminal = useCallback(async () => {
    if (!room?.attach_command) return
    setOpeningTerminal(true)
    setError(null)
    try {
      await openRoomTerminal(threadId)
    } catch {
      navigator.clipboard?.writeText(room.attach_command)
      setError('Terminal could not be opened. Attach command copied.')
    } finally {
      setOpeningTerminal(false)
    }
  }, [room?.attach_command, threadId])

  const restart = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await restartRoom(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const nudge = useCallback(async (agent: AgentName, body: string, onSuccess: () => void) => {
    setError(null)
    try {
      const result = await nudgeRoom(threadId, { agent, body: body || null })
      onSuccess()
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const suggest = useCallback(async (agent: AgentName, body: string, onSuccess: () => void) => {
    setError(null)
    try {
      const result = await requestIdleSuggestion(threadId, { agent, body: body || null })
      onSuccess()
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const cancelSuggestion = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await cancelIdleSuggestion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const startAuto = useCallback(async (turnCount: number, allowDirectRoots: boolean) => {
    setError(null)
    try {
      const result = await startAutoDiscussion(threadId, {
        turn_count: turnCount,
        allow_direct_roots: allowDirectRoots,
      })
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const pauseAuto = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await pauseAutoDiscussion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const stopAuto = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await stopAutoDiscussion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const exitAuto = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await exitAutoDiscussion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const extendAuto = useCallback(async (turnCount: number) => {
    setError(null)
    try {
      onRoomResult(await extendAutoDiscussion(threadId, { turn_count: turnCount }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const respondToInput = useCallback(async (response: 'yes' | 'no') => {
    if (!room?.input_prompt) return
    setError(null)
    try {
      const result = await sendRoomInputResponse(threadId, {
        agent: room.input_prompt.agent,
        response,
      })
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, room?.input_prompt, threadId])

  const retry = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await retryTurn(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const skip = useCallback(async () => {
    setError(null)
    try {
      onRoomResult(await skipTurn(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onRoomResult, threadId])

  const invite = useCallback(async (inviteId: string, onSuccess: () => void) => {
    if (!inviteId) return
    try {
      await inviteThreadAgent(threadId, { agent_id: inviteId })
      onSuccess()
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onUpdate, threadId])

  const remove = useCallback(async (agentId: string) => {
    try {
      await removeThreadAgent(threadId, agentId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onUpdate, threadId])

  const saveModel = useCallback(async (agentId: string, modelValue: string | null, effortValue: string | null) => {
    try {
      await updateThreadAgent(threadId, agentId, { model: modelValue, effort: effortValue })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onUpdate, threadId])

  useEffect(() => {
    if (startingRoom && room && room.status !== 'not_started' && room.status !== 'stopped' && room.status !== 'error') {
      setStartingRoom(false)
    }
  }, [room, startingRoom])

  return {
    error,
    startingRoom,
    openingTerminal,
    start,
    stop,
    openTerminal,
    restart,
    nudge,
    suggest,
    cancelSuggestion,
    startAuto,
    pauseAuto,
    stopAuto,
    exitAuto,
    extendAuto,
    respondToInput,
    retry,
    skip,
    invite,
    remove,
    saveModel,
  }
}
