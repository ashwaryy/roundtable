import { useEffect, useRef, useState } from 'react'
import type { RoundtableEvent } from '@roundtable/shared'

export type LiveRefreshStatus = 'connecting' | 'connected' | 'disconnected'

export function useLiveRefresh(onEvent: (event: RoundtableEvent) => void): LiveRefreshStatus {
  const [status, setStatus] = useState<LiveRefreshStatus>('connecting')
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    const url = `ws://${window.location.host}/ws`
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null

    function connect(): void {
      if (!active) return
      setStatus('connecting')
      socket = new WebSocket(url)
      socket.onopen = () => {
        if (active) setStatus('connected')
      }
      socket.onmessage = (msg) => {
        try {
          onEventRef.current(JSON.parse(msg.data) as RoundtableEvent)
        } catch {
          // Ignore malformed frames.
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (!active) return
        setStatus('disconnected')
        reconnectTimer = window.setTimeout(connect, 500)
      }
    }

    connect()
    return () => {
      active = false
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [])

  return status
}
