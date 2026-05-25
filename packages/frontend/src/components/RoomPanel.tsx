import { useEffect, useState, type FormEvent } from 'react'
import type { AgentName, AgentRoom, RoomPreflight } from '@roundtable/shared'
import {
  askAgent,
  extendAutoDiscussion,
  nudgeRoom,
  pauseAutoDiscussion,
  retryTurn,
  restartRoom,
  sendRoomInputResponse,
  skipTurn,
  startAutoDiscussion,
  startRoom,
  stopRoom,
} from '../api'

function readyText(readyAt: string | null): string {
  return readyAt ? 'ready' : 'waiting'
}

export function RoomPanel({
  threadId,
  room,
  preflight,
  hideRecoveryControls = false,
  summary,
  onUpdate,
}: {
  threadId: string
  room: AgentRoom | null
  preflight: RoomPreflight | null
  hideRecoveryControls?: boolean
  summary?: string
  onUpdate: () => void
}) {
  const [claudeModel, setClaudeModel] = useState('')
  const [codexModel, setCodexModel] = useState('')
  const [nudgeAgent, setNudgeAgent] = useState<AgentName>('claude')
  const [nudgeBody, setNudgeBody] = useState('')
  const [askAgentName, setAskAgentName] = useState<AgentName>('claude')
  const [askBody, setAskBody] = useState('')
  const [autoTurns, setAutoTurns] = useState(4)
  const [extendTurns, setExtendTurns] = useState(4)
  const [allowDirectRoots, setAllowDirectRoots] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStart(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await startRoom(threadId, {
        claude_model: claudeModel || null,
        codex_model: codexModel || null,
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleStop() {
    setError(null)
    try {
      await stopRoom(threadId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRestart() {
    setError(null)
    try {
      await restartRoom(threadId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNudge(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await nudgeRoom(threadId, {
        agent: nudgeAgent,
        body: nudgeBody || null,
      })
      setNudgeBody('')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleAsk(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await askAgent(threadId, {
        agent: askAgentName,
        body: askBody || null,
      })
      setAskBody('')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleStartAuto(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await startAutoDiscussion(threadId, {
        turn_count: autoTurns,
        allow_direct_roots: allowDirectRoots,
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handlePauseAuto() {
    setError(null)
    try {
      await pauseAutoDiscussion(threadId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExtendAuto(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await extendAutoDiscussion(threadId, { turn_count: extendTurns })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleInputResponse(response: 'yes' | 'no') {
    if (!room?.input_prompt) return
    setError(null)
    try {
      await sendRoomInputResponse(threadId, {
        agent: room.input_prompt.agent,
        response,
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRetry() {
    setError(null)
    try {
      await retryTurn(threadId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSkip() {
    setError(null)
    try {
      await skipTurn(threadId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const canStart =
    (preflight?.ok ?? false) &&
    (!room ||
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error')
  const canNudge = room?.status === 'idle'
  const canAsk = room?.status === 'idle'
  const canStartAuto = room?.status === 'idle'
  const canPauseAuto = room?.auto?.status === 'running'
  const canExtendAuto = room?.status === 'paused' || room?.status === 'turn_limit_reached'
  const canStop = room && room.status !== 'not_started' && room.status !== 'stopped'
  const needsAttention = room?.status === 'needs_attention'
  const canRestart = room?.session_state === 'missing'
  const canResolveTurn =
    needsAttention &&
    !!room?.active_job_id &&
    room.session_state !== 'missing' &&
    room.session_state !== 'untracked'
  const toolEntries = preflight ? Object.values(preflight.tools) : []

  useEffect(() => {
    if (
      !room ||
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error'
    ) {
      return
    }

    const interval = window.setInterval(onUpdate, 3000)
    return () => window.clearInterval(interval)
  }, [onUpdate, room])

  return (
    <section aria-label="agent-room">
      <div className="section-heading">
        <h2>Agent Room</h2>
        {summary ? <span>{summary}</span> : null}
      </div>

      {toolEntries.length > 0 ? (
        <ul>
          {toolEntries.map((tool) => (
            <li key={tool.name}>
              {tool.name}: {tool.available ? tool.version ?? tool.path : 'missing'}
            </li>
          ))}
        </ul>
      ) : (
        <p>Checking room tools...</p>
      )}

      <p>Status: {room?.status ?? 'loading'}</p>
      {room ? (
        <>
          <p>Claude: {readyText(room.agents.claude.ready_at)}</p>
          <p>Codex: {readyText(room.agents.codex.ready_at)}</p>
          {room.auto ? (
            <p>
              Auto: {room.auto.status} ({room.auto.completed_turns}/
              {room.auto.total_turns})
            </p>
          ) : null}
          <p>Attach: {room.attach_command}</p>
          <p>Session: {room.session_state.replaceAll('_', ' ')}</p>
          {room.last_error ? <p role="alert">{room.last_error}</p> : null}
        </>
      ) : null}

      {!hideRecoveryControls && room?.input_prompt ? (
        <div role="alert" aria-label="agent-input-prompt">
          <h3>{room.input_prompt.agent} is waiting for input</h3>
          <pre>{room.input_prompt.excerpt}</pre>
          <button type="button" onClick={() => handleInputResponse('yes')}>
            Send Yes
          </button>
          <button type="button" onClick={() => handleInputResponse('no')}>
            Send No
          </button>
        </div>
      ) : null}

      <form onSubmit={handleStart} aria-label="start-room">
        <label>
          Claude model
          <input
            aria-label="Claude model"
            value={claudeModel}
            onChange={(event) => setClaudeModel(event.target.value)}
            placeholder="CLI default"
          />
        </label>
        <label>
          Codex model
          <input
            aria-label="Codex model"
            value={codexModel}
            onChange={(event) => setCodexModel(event.target.value)}
            placeholder="CLI default"
          />
        </label>
        <button type="submit" disabled={!canStart}>
          Start Room
        </button>
      </form>

      <button type="button" onClick={handleStop} disabled={!canStop}>
        Stop Room
      </button>
      {!hideRecoveryControls && canRestart ? (
        <button type="button" onClick={handleRestart}>
          Restart Room
        </button>
      ) : null}

      <form onSubmit={handleNudge} aria-label="nudge-room">
        <select
          aria-label="Nudge agent"
          value={nudgeAgent}
          onChange={(event) => setNudgeAgent(event.target.value as AgentName)}
          disabled={!canNudge}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <input
          aria-label="Nudge body"
          value={nudgeBody}
          onChange={(event) => setNudgeBody(event.target.value)}
          placeholder="Optional nudge"
          disabled={!canNudge}
        />
        <button type="submit" disabled={!canNudge}>
          Send Nudge
        </button>
      </form>

      <form onSubmit={handleAsk} aria-label="ask-agent">
        <select
          aria-label="Ask agent"
          value={askAgentName}
          onChange={(event) => setAskAgentName(event.target.value as AgentName)}
          disabled={!canAsk}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <input
          aria-label="Ask body"
          value={askBody}
          onChange={(event) => setAskBody(event.target.value)}
          placeholder="Optional ask instructions"
          disabled={!canAsk}
        />
        <button type="submit" disabled={!canAsk}>
          Ask about a new topic
        </button>
      </form>

      <form onSubmit={handleStartAuto} aria-label="start-auto-discussion">
        <label>
          Turns
          <input
            aria-label="Auto turns"
            type="number"
            min={1}
            max={20}
            value={autoTurns}
            onChange={(event) => setAutoTurns(Number(event.target.value))}
            disabled={!canStartAuto}
          />
        </label>
        <label>
          <input
            aria-label="Allow direct roots"
            type="checkbox"
            checked={allowDirectRoots}
            onChange={(event) => setAllowDirectRoots(event.target.checked)}
            disabled={!canStartAuto}
          />
          Allow direct roots
        </label>
        <button type="submit" disabled={!canStartAuto}>
          Let Them Discuss
        </button>
      </form>

      <button type="button" onClick={handlePauseAuto} disabled={!canPauseAuto}>
        Pause
      </button>

      <form onSubmit={handleExtendAuto} aria-label="extend-auto-discussion">
        <label>
          Extend turns
          <input
            aria-label="Extend turns"
            type="number"
            min={1}
            max={20}
            value={extendTurns}
            onChange={(event) => setExtendTurns(Number(event.target.value))}
            disabled={!canExtendAuto}
          />
        </label>
        <button type="submit" disabled={!canExtendAuto}>
          Extend
        </button>
      </form>

      {!hideRecoveryControls && canResolveTurn ? (
        <p>
          <button type="button" onClick={handleRetry}>
            Retry Turn
          </button>
          <button type="button" onClick={handleSkip}>
            Skip Turn
          </button>
        </p>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
