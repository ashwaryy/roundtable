import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { RoundtableEvent } from '@roundtable/shared'
import { useLiveRefresh } from './useLiveRefresh'

class FakeSocket {
  static instances: FakeSocket[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  close(): void {
    this.onclose?.()
  }
}

function Listener({ onEvent }: { onEvent: (event: RoundtableEvent) => void }) {
  useLiveRefresh(onEvent)
  return null
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeSocket.instances = []
})

describe('useLiveRefresh', () => {
  it('reconnects after an initial socket disconnect', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onEvent = vi.fn()
    render(<Listener onEvent={onEvent} />)

    expect(FakeSocket.instances).toHaveLength(1)
    FakeSocket.instances[0].onclose?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeSocket.instances).toHaveLength(2)

    FakeSocket.instances[1].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'thread_created', thread_id: 'thread-1' }),
      }),
    )
    expect(onEvent).toHaveBeenCalledWith({
      type: 'thread_created',
      thread_id: 'thread-1',
    })
  })
})
