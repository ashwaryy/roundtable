import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentRoom, BoundedJob, RoomPreflight } from '@roundtable/shared'
import { RoomPanel } from './RoomPanel'
import * as api from '../api'

vi.mock('../api')

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

function makePreflight(ok = true): RoomPreflight {
  return {
    ok,
    tools: {
      tmux: {
        name: 'tmux',
        available: ok,
        path: ok ? '/usr/bin/tmux' : null,
        version: ok ? 'tmux 3.6' : null,
        error: ok ? null : 'missing',
      },
      claude: {
        name: 'claude',
        available: true,
        path: '/usr/bin/claude',
        version: 'claude 1.0',
        error: null,
      },
      codex: {
        name: 'codex',
        available: true,
        path: '/usr/bin/codex',
        version: 'codex 1.0',
        error: null,
      },
    },
  }
}

function makeRoom(status: AgentRoom['status'] = 'not_started'): AgentRoom {
  return {
    thread_id: 'thread-1',
    status,
    tmux_session: 'roundtable-thread-1',
    attach_command: 'tmux attach -t roundtable-thread-1',
    claude_model: null,
    codex_model: null,
    agents: {
      claude: { ready_at: status === 'idle' ? '2026-05-23T00:00:00Z' : null },
      codex: { ready_at: status === 'idle' ? '2026-05-23T00:00:00Z' : null },
    },
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
    started_at: null,
    stopped_at: null,
    last_error: null,
    active_job_id: status === 'running' || status === 'needs_attention' ? 'job-001' : null,
    auto: null,
    input_prompt: null,
  }
}

function makeJob(): BoundedJob {
  return {
    id: 'job-001',
    thread_id: 'thread-1',
    kind: 'agent_turn',
    status: 'running',
    agent: 'claude',
    started_at: '2026-05-23T00:00:00Z',
    timeout_at: '2026-05-23T00:10:00Z',
    completed_at: null,
    logs: [],
    result: null,
    failure_reason: null,
    turn: {
      id: 'job-001',
      thread_id: 'thread-1',
      agent: 'claude',
      kind: 'comment',
      scope: 'thread',
      discussion_id: null,
      instructions: null,
      proposal_id: null,
      revision_id: null,
      review_id: null,
      auto_revision_after_review: false,
      allow_direct_roots: true,
      pending_roots_only: false,
      auto_run_id: null,
      auto_turn_index: null,
      created_at: '2026-05-23T00:00:00Z',
      timeout_at: '2026-05-23T00:10:00Z',
    },
  }
}

describe('RoomPanel', () => {
  it('renders preflight, room status, readiness, and attach command', () => {
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom('idle')}
        preflight={makePreflight()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByText(/tmux: tmux 3.6/)).toBeInTheDocument()
    expect(screen.getByText('Status: idle')).toBeInTheDocument()
    expect(screen.getByText('Claude: ready')).toBeInTheDocument()
    expect(screen.getByText(/tmux attach -t roundtable-thread-1/)).toBeInTheDocument()
  })

  it('starts a room with optional model values', async () => {
    const onUpdate = vi.fn()
    mockedApi.startRoom.mockResolvedValue(makeRoom('starting'))
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom()}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.type(screen.getByLabelText('Claude model'), 'sonnet')
    await userEvent.type(screen.getByLabelText('Codex model'), 'gpt-5')
    await userEvent.click(screen.getByRole('button', { name: /start room/i }))

    expect(mockedApi.startRoom).toHaveBeenCalledWith('thread-1', {
      claude_model: 'sonnet',
      codex_model: 'gpt-5',
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('disables start when preflight fails', () => {
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom()}
        preflight={makePreflight(false)}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /start room/i })).toBeDisabled()
    expect(screen.getByText('tmux: missing')).toBeInTheDocument()
  })

  it('nudges the selected agent only when idle', async () => {
    const onUpdate = vi.fn()
    mockedApi.nudgeRoom.mockResolvedValue(makeRoom('idle'))
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom('idle')}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText('Nudge agent'), 'codex')
    await userEvent.type(screen.getByLabelText('Nudge body'), 'Please inspect this.')
    await userEvent.click(screen.getByRole('button', { name: /send nudge/i }))

    expect(mockedApi.nudgeRoom).toHaveBeenCalledWith('thread-1', {
      agent: 'codex',
      body: 'Please inspect this.',
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('starts a thread-level ask turn', async () => {
    const onUpdate = vi.fn()
    mockedApi.askAgent.mockResolvedValue({
      room: makeRoom('running'),
      job: {
        id: 'job-001',
        thread_id: 'thread-1',
        kind: 'agent_turn',
        status: 'running',
        agent: 'claude',
        started_at: '2026-05-23T00:00:00Z',
        timeout_at: '2026-05-23T00:10:00Z',
        completed_at: null,
        logs: [],
        result: null,
        failure_reason: null,
        turn: {
          id: 'job-001',
          thread_id: 'thread-1',
          agent: 'claude',
          kind: 'comment',
          scope: 'thread',
          discussion_id: null,
          instructions: 'Look here',
          proposal_id: null,
          revision_id: null,
          review_id: null,
          auto_revision_after_review: false,
          allow_direct_roots: true,
          pending_roots_only: false,
          auto_run_id: null,
          auto_turn_index: null,
          created_at: '2026-05-23T00:00:00Z',
          timeout_at: '2026-05-23T00:10:00Z',
        },
      },
    })
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom('idle')}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.type(screen.getByLabelText('Ask body'), 'Look here')
    await userEvent.click(screen.getByRole('button', { name: /ask agent/i }))

    expect(mockedApi.askAgent).toHaveBeenCalledWith('thread-1', {
      agent: 'claude',
      body: 'Look here',
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('starts auto discussion with turn count and direct-root bypass', async () => {
    const onUpdate = vi.fn()
    mockedApi.startAutoDiscussion.mockResolvedValue({
      room: makeRoom('running'),
      job: makeJob(),
    })
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom('idle')}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.clear(screen.getByLabelText('Auto turns'))
    await userEvent.type(screen.getByLabelText('Auto turns'), '6')
    await userEvent.click(screen.getByLabelText('Allow direct roots'))
    await userEvent.click(screen.getByRole('button', { name: /let them discuss/i }))

    expect(mockedApi.startAutoDiscussion).toHaveBeenCalledWith('thread-1', {
      turn_count: 6,
      allow_direct_roots: true,
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('pauses and extends auto discussion from valid states', async () => {
    const onUpdate = vi.fn()
    mockedApi.pauseAutoDiscussion.mockResolvedValue(makeRoom('running'))
    mockedApi.extendAutoDiscussion.mockResolvedValue({
      room: makeRoom('running'),
      job: makeJob(),
    })
    const running = {
      ...makeRoom('running'),
      auto: {
        run_id: 'auto-1',
        status: 'running' as const,
        total_turns: 4,
        completed_turns: 1,
        remaining_turns: 3,
        next_agent: 'codex' as const,
        allow_direct_roots: false,
        pause_requested: false,
        started_at: '2026-05-23T00:00:00Z',
        updated_at: '2026-05-23T00:00:00Z',
        ended_at: null,
      },
    }
    const { rerender } = render(
      <RoomPanel
        threadId="thread-1"
        room={running}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    expect(mockedApi.pauseAutoDiscussion).toHaveBeenCalledWith('thread-1')

    rerender(
      <RoomPanel
        threadId="thread-1"
        room={{ ...running, status: 'turn_limit_reached' }}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )
    await userEvent.clear(screen.getByLabelText('Extend turns'))
    await userEvent.type(screen.getByLabelText('Extend turns'), '3')
    await userEvent.click(screen.getByRole('button', { name: /^extend$/i }))

    expect(mockedApi.extendAutoDiscussion).toHaveBeenCalledWith('thread-1', {
      turn_count: 3,
    })
  })

  it('surfaces a detected input prompt and sends yes or no', async () => {
    const onUpdate = vi.fn()
    mockedApi.sendRoomInputResponse.mockResolvedValue(makeRoom('running'))
    render(
      <RoomPanel
        threadId="thread-1"
        room={{
          ...makeRoom('running'),
          input_prompt: {
            agent: 'codex',
            excerpt: 'This command requires approval\nDo you want to proceed?',
            detected_at: '2026-05-23T00:00:00Z',
          },
        }}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getByText('codex is waiting for input')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /send yes/i }))

    expect(mockedApi.sendRoomInputResponse).toHaveBeenCalledWith('thread-1', {
      agent: 'codex',
      response: 'yes',
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('stops an active room', async () => {
    const onUpdate = vi.fn()
    mockedApi.stopRoom.mockResolvedValue(makeRoom('stopped'))
    render(
      <RoomPanel
        threadId="thread-1"
        room={makeRoom('starting')}
        preflight={makePreflight()}
        onUpdate={onUpdate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /stop room/i }))

    expect(mockedApi.stopRoom).toHaveBeenCalledWith('thread-1')
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })
})
