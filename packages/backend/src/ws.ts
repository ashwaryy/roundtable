import { WebSocket, type WebSocketServer } from 'ws'
import type { RoundtableEvent } from '@roundtable/shared'

export function createBroadcastHub(wss: WebSocketServer) {
  return {
    broadcast(event: RoundtableEvent): void {
      const payload = JSON.stringify(event)
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload)
        }
      }
    },
  }
}
