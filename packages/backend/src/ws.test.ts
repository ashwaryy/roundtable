import { describe, it, expect, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createBroadcastHub } from './ws'

function fakeClient(readyState: number) {
  return { readyState, send: vi.fn() }
}

describe('createBroadcastHub', () => {
  it('sends a JSON-encoded event to open clients only', () => {
    const open = fakeClient(WebSocket.OPEN)
    const closed = fakeClient(WebSocket.CLOSED)
    const wss = { clients: new Set([open, closed]) }

    const hub = createBroadcastHub(wss as never)
    hub.broadcast({ type: 'thread_created', thread_id: 'thread-1' })

    expect(open.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'thread_created', thread_id: 'thread-1' }),
    )
    expect(closed.send).not.toHaveBeenCalled()
  })
})
