import { useCallback, useEffect, useRef, useState } from 'react'
import type { TmuxPaneInput, TmuxPaneSnapshot } from '@roundtable/shared'
import { getTmuxPaneSnapshot, sendTmuxPaneInput } from './api'

const TMUX_VIEW_POLL_MS = 1000

type ViewableAgent = { agent_id: string; name: string }

export function useTmuxViewer(threadId: string, agents: ViewableAgent[]) {
  const [open, setOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<TmuxPaneSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputSending, setInputSending] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const snapshotRef = useRef<TmuxPaneSnapshot | null>(null)

  useEffect(() => {
    if (!open) return
    if (agents.length === 0) {
      setSelectedAgent(null)
      setSnapshot(null)
      setLoading(false)
      setStale(false)
      setError('No tmux windows are currently viewable.')
      setInputError(null)
      return
    }
    if (!selectedAgent || !agents.some((agent) => agent.agent_id === selectedAgent)) {
      setSelectedAgent(agents[0]?.agent_id ?? null)
    }
  }, [agents, open, selectedAgent])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    if (!open || !selectedAgent) return
    let cancelled = false
    let pollTimer: number | null = null

    const loadSnapshot = async (showLoading: boolean) => {
      if (showLoading) setLoading(true)
      try {
        const next = await getTmuxPaneSnapshot(threadId, selectedAgent)
        if (cancelled) return
        setSnapshot(next)
        setError(null)
        setInputError(null)
        setStale(false)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        if (showLoading || !snapshotRef.current) {
          setSnapshot(null)
        } else {
          setStale(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setSnapshot(null)
    setError(null)
    setStale(false)
    void loadSnapshot(true)

    pollTimer = window.setInterval(() => {
      void loadSnapshot(false)
    }, TMUX_VIEW_POLL_MS)

    return () => {
      cancelled = true
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [open, refreshNonce, selectedAgent, threadId])

  const openViewer = useCallback((agentId: string) => {
    setOpen(true)
    setSelectedAgent(agentId)
    setSnapshot(null)
    setError(null)
    setInputError(null)
    setStale(false)
  }, [])

  const closeViewer = useCallback(() => {
    setOpen(false)
    setSelectedAgent(null)
    setSnapshot(null)
    setError(null)
    setInputError(null)
    setStale(false)
    setLoading(false)
    setInputSending(false)
  }, [])

  const selectViewerAgent = useCallback((agentId: string) => {
    setSelectedAgent(agentId)
    setInputError(null)
  }, [])

  const sendInput = useCallback(async (input: TmuxPaneInput) => {
    if (!selectedAgent) return
    setInputSending(true)
    setInputError(null)
    try {
      await sendTmuxPaneInput(threadId, selectedAgent, input)
      setRefreshNonce((value) => value + 1)
    } catch (err) {
      setInputError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setInputSending(false)
    }
  }, [selectedAgent, threadId])

  return {
    open,
    selectedAgent,
    snapshot,
    loading,
    stale,
    error,
    inputSending,
    inputError,
    openViewer,
    closeViewer,
    selectViewerAgent,
    sendInput,
  }
}
