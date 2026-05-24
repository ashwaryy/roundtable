import { afterEach, describe, expect, it, vi } from 'vitest'
import { listThreads } from './api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('read requests', () => {
  it('retries a transient backend startup failure', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('backend unavailable'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'thread-1',
              title: 'Recovered',
              status: 'open',
              parent_thread_id: null,
              created_from_consolidation_id: null,
              created_at: '2026-05-25T00:00:00Z',
              archived_at: null,
              closed_at: null,
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = listThreads()
    await vi.advanceTimersByTimeAsync(200)

    await expect(result).resolves.toEqual([
      expect.objectContaining({ id: 'thread-1', title: 'Recovered' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
