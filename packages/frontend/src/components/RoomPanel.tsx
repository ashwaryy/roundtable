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
    <>
      {/* ── Room Initiation Card ─────────────────────────────── */}
      <section aria-label="room-initiation" className="room-card">
        <div className="section-heading">
          <h2>Agent Room</h2>
          {room ? (
            <span className={`status-pill status-pill--${room.status}`}>
              {room.status.replaceAll('_', ' ')}
            </span>
          ) : summary ? (
            <span>{summary}</span>
          ) : null}
        </div>

        {/* Agent presence tiles — only meaningful once the room is running */}
        {room && room.status !== 'not_started' && room.status !== 'stopped' ? (
          <div className="room-card__agents">
            <div className={`room-card__agent room-card__agent--claude${room.agents.claude.ready_at ? ' room-card__agent--ready' : ''}`}>
              <span className="room-card__dot" aria-hidden="true" />
              <span className="room-card__agent-name">Claude</span>
            </div>
            <div className={`room-card__agent room-card__agent--codex${room.agents.codex.ready_at ? ' room-card__agent--ready' : ''}`}>
              <span className="room-card__dot" aria-hidden="true" />
              <span className="room-card__agent-name">Codex</span>
            </div>
          </div>
        ) : null}

        {/* Tool preflight chips */}
        {toolEntries.length > 0 ? (
          <div className="room-card__tools">
            {toolEntries.map((tool) => (
              <span
                key={tool.name}
                className={`room-card__tool${tool.available ? '' : ' room-card__tool--missing'}`}
                title={tool.available ? (tool.version ?? tool.path ?? '') : (tool.error ?? 'missing')}
              >
                <span className="room-card__tool-icon" aria-hidden="true">
                  {tool.available ? '✓' : '✗'}
                </span>
                {tool.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="room-card__muted">Checking tools…</p>
        )}

        {/* Auto progress */}
        {room?.auto ? (
          <p className="room-card__muted">
            Auto {room.auto.status} · {room.auto.completed_turns}/{room.auto.total_turns} turns
          </p>
        ) : null}

        {/* Input prompt (recovery) */}
        {!hideRecoveryControls && room?.input_prompt ? (
          <div role="alert" aria-label="agent-input-prompt" className="room-card__prompt">
            <h3>{room.input_prompt.agent} is waiting for input</h3>
            <pre>{room.input_prompt.excerpt}</pre>
            <div className="inline-actions">
              <button type="button" onClick={() => handleInputResponse('yes')}>Send Yes</button>
              <button type="button" onClick={() => handleInputResponse('no')}>Send No</button>
            </div>
          </div>
        ) : null}

        {/* Model config + start */}
        <form onSubmit={handleStart} aria-label="start-room" className="room-card__start-form">
          <div className="room-card__model-row">
            <label>
              Claude
              <select
                aria-label="Claude model"
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
              >
                <option value="">CLI default</option>
                <option value="claude-opus-4-7">claude-opus-4-7</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5</option>
              </select>
            </label>
            <label>
              Codex
              <select
                aria-label="Codex model"
                value={codexModel}
                onChange={(e) => setCodexModel(e.target.value)}
              >
                <option value="">CLI default</option>
                <option value="gpt-5.5">gpt-5.5</option>
                <option value="gpt-5.4">gpt-5.4</option>
                <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                <option value="gpt-5.3-codex">gpt-5.3-codex</option>
              </select>
            </label>
          </div>
          <div className="room-card__start-row">
            <button type="submit" disabled={!canStart}>Start Room</button>
            <button type="button" onClick={handleStop} disabled={!canStop} className="btn-destructive">
              Stop
            </button>
          </div>
        </form>

        {/* Attach command */}
        {room?.attach_command ? (
          <p className="room-card__attach"><code>{room.attach_command}</code></p>
        ) : null}

        {!hideRecoveryControls && canRestart ? (
          <button type="button" onClick={handleRestart}>Restart Room</button>
        ) : null}

        {error ? <p role="alert" className="room-card__error">{error}</p> : null}
      </section>

      {/* ── Room Controls Card ───────────────────────────────── */}
      <section aria-label="room-controls" className="room-card">
        <div className="section-heading">
          <h2>Controls</h2>
        </div>

        {/* Nudge */}
        <div className="room-ctrls__group">
          <h3>Nudge</h3>
          <form onSubmit={handleNudge} aria-label="nudge-room" className="room-ctrls__inline-form">
            <select
              aria-label="Nudge agent"
              value={nudgeAgent}
              onChange={(e) => setNudgeAgent(e.target.value as AgentName)}
              disabled={!canNudge}
              className="room-ctrls__agent-select"
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <input
              aria-label="Nudge body"
              value={nudgeBody}
              onChange={(e) => setNudgeBody(e.target.value)}
              placeholder="Message"
              disabled={!canNudge}
            />
            <button type="submit" disabled={!canNudge}>Send</button>
          </form>
        </div>

        {/* Ask */}
        <div className="room-ctrls__group">
          <h3>Ask</h3>
          <form onSubmit={handleAsk} aria-label="ask-agent" className="room-ctrls__inline-form">
            <select
              aria-label="Ask agent"
              value={askAgentName}
              onChange={(e) => setAskAgentName(e.target.value as AgentName)}
              disabled={!canAsk}
              className="room-ctrls__agent-select"
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <input
              aria-label="Ask body"
              value={askBody}
              onChange={(e) => setAskBody(e.target.value)}
              placeholder="Instructions"
              disabled={!canAsk}
            />
            <button type="submit" disabled={!canAsk}>Ask</button>
          </form>
        </div>

        {/* Auto discussion */}
        <div className="room-ctrls__group">
          <h3>Auto</h3>
          <form onSubmit={handleStartAuto} aria-label="start-auto-discussion" className="room-ctrls__auto-form">
            <div className="room-ctrls__auto-config">
              <label className="room-ctrls__turns-label">
                Turns
                <div className="room-ctrls__num-wrap">
                  <input
                    aria-label="Auto turns"
                    type="number"
                    min={1}
                    max={20}
                    value={autoTurns}
                    onChange={(e) => setAutoTurns(Number(e.target.value))}
                    disabled={!canStartAuto}
                  />
                </div>
              </label>
              <label className="room-ctrls__check-label">
                <input
                  aria-label="Allow direct roots"
                  type="checkbox"
                  checked={allowDirectRoots}
                  onChange={(e) => setAllowDirectRoots(e.target.checked)}
                  disabled={!canStartAuto}
                />
                Direct roots
              </label>
            </div>
            <button type="submit" disabled={!canStartAuto}>Let Them Discuss</button>
          </form>
          <div className="room-ctrls__auto-secondary">
            <button type="button" onClick={handlePauseAuto} disabled={!canPauseAuto}>Pause</button>
            <form onSubmit={handleExtendAuto} aria-label="extend-auto-discussion" className="room-ctrls__extend-form">
              <div className="room-ctrls__num-wrap">
                <input
                  aria-label="Extend turns"
                  type="number"
                  min={1}
                  max={20}
                  value={extendTurns}
                  onChange={(e) => setExtendTurns(Number(e.target.value))}
                  disabled={!canExtendAuto}
                />
              </div>
              <button type="submit" disabled={!canExtendAuto}>Extend</button>
            </form>
          </div>
        </div>

        {/* Recovery actions */}
        {!hideRecoveryControls && canResolveTurn ? (
          <div className="room-ctrls__group">
            <h3>Recovery</h3>
            <div className="inline-actions">
              <button type="button" onClick={handleRetry}>Retry Turn</button>
              <button type="button" onClick={handleSkip}>Skip Turn</button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
