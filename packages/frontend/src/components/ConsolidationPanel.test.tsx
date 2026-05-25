import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { AgentRoom } from '@roundtable/shared'
import { ConsolidationPanel } from './ConsolidationPanel'
import * as api from '../api'

vi.mock('../api')

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRunningAutoRoom(pauseRequested = false): AgentRoom {
  return {
    thread_id: 'thread-1',
    status: 'running',
    tmux_session: 'roundtable-thread-1',
    attach_command: 'tmux attach -t roundtable-thread-1',
    claude_model: null,
    codex_model: null,
    agents: {
      claude: { ready_at: '2026-05-23T00:00:00Z' },
      codex: { ready_at: '2026-05-23T00:00:00Z' },
    },
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
    started_at: '2026-05-23T00:00:00Z',
    stopped_at: null,
    last_error: null,
    active_job_id: 'job-001',
    auto: {
      run_id: 'auto-1',
      status: 'running',
      total_turns: 4,
      completed_turns: 1,
      remaining_turns: 3,
      next_agent: 'codex',
      allow_direct_roots: false,
      pause_requested: pauseRequested,
      started_at: '2026-05-23T00:00:00Z',
      updated_at: '2026-05-23T00:00:00Z',
      ended_at: null,
    },
    input_prompt: null,
    session_state: 'connected',
  }
}

describe('ConsolidationPanel', () => {
  it('disables finish and shows requested consolidation after queuing', async () => {
    const onUpdate = vi.fn()
    mockedApi.finishAndStartConsolidation.mockResolvedValue(
      makeRunningAutoRoom(true),
    )

    render(
      <MemoryRouter>
        <ConsolidationPanel
          threadId="thread-1"
          room={makeRunningAutoRoom()}
          proposals={[]}
          onUpdate={onUpdate}
        />
      </MemoryRouter>,
    )

    await userEvent.click(
      screen.getByRole('button', { name: /finish & consolidate/i }),
    )

    expect(mockedApi.finishAndStartConsolidation).toHaveBeenCalledWith(
      'thread-1',
      {
        drafter_agent: 'codex',
        reviewer_agent: 'claude',
        reviser_agent: 'codex',
        instructions: null,
      },
    )
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())

    const requestedButton = screen.getByRole('button', {
      name: /requested consolidation/i,
    })
    expect(requestedButton).toBeDisabled()
  })

  it('shows requested consolidation when the backend reports a queued request', () => {
    render(
      <MemoryRouter>
        <ConsolidationPanel
          threadId="thread-1"
          room={makeRunningAutoRoom(true)}
          proposals={[]}
          onUpdate={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('button', { name: /requested consolidation/i }),
    ).toBeDisabled()
  })
})
