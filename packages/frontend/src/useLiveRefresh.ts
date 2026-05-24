import { useEffect } from 'react'
import type { RoundtableEvent } from '@roundtable/shared'

export function useLiveRefresh(onEvent: (event: RoundtableEvent) => void): void {
  useEffect(() => {
    const url = `ws://${window.location.host}/ws`
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null

    function connect(): void {
      if (!active) return
      socket = new WebSocket(url)
      socket.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(msg.data) as RoundtableEvent)
        } catch {
          // Ignore malformed frames.
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (active) reconnectTimer = window.setTimeout(connect, 500)
      }
    }

    connect()
    return () => {
      active = false
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [onEvent])
}
