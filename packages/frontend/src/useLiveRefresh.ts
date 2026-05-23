import { useEffect } from 'react'
import type { RoundtableEvent } from '@roundtable/shared'

export function useLiveRefresh(onEvent: (event: RoundtableEvent) => void): void {
  useEffect(() => {
    const url = `ws://${window.location.host}/ws`
    const socket = new WebSocket(url)
    socket.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as RoundtableEvent)
      } catch {
        // Ignore malformed frames.
      }
    }
    return () => socket.close()
  }, [onEvent])
}
