import { useEffect, useState, type FormEvent } from 'react'
import type { AgentName, AgentRoom, RoomPreflight, ThreadStatus } from '@roundtable/shared'
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
import { Avatar, Icon } from './primitives'

function sessionLabel(room: AgentRoom | null, summary?: string): string {
  if (room?.auto?.status === 'running') {
    const started = room.started_at
      ? new Date(room.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'session'
    return `${started} -> now · ${room.auto.completed_turns} of ${room.auto.total_turns} turns`
  }
  if (room?.status) return room.status.replaceAll('_', ' ')
  return summary ?? 'idle'
}

export function RoomPanel({
  threadId,
  threadStatus,
  room,
  preflight,
  hideRecoveryControls = false,
  summary,
  onUpdate,
}: {
  threadId: string
  threadStatus: ThreadStatus
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
  const [controlTab, setControlTab] = useState<'nudge' | 'ask' | 'auto'>('nudge')
  const [directOpen, setDirectOpen] = useState(true)
  const [autoTurns, setAutoTurns] = useState(4)
  const [extendTurns, setExtendTurns] = useState(4)
  const [allowDirectRoots, setAllowDirectRoots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isThreadOpen = threadStatus === 'open'

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
    isThreadOpen &&
    (preflight?.ok ?? false) &&
    (!room ||
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error')
  const canNudge = isThreadOpen && room?.status === 'idle'
  const canAsk = isThreadOpen && room?.status === 'idle'
  const canStartAuto = isThreadOpen && room?.status === 'idle'
  const canPauseAuto = isThreadOpen && room?.auto?.status === 'running'
  const canExtendAuto =
    isThreadOpen && (room?.status === 'paused' || room?.status === 'turn_limit_reached')
  const canStop =
    isThreadOpen && !!room && room.status !== 'not_started' && room.status !== 'stopped'
  const needsAttention = isThreadOpen && room?.status === 'needs_attention'
  const canRestart = isThreadOpen && room?.session_state === 'missing'
  const canResolveTurn =
    needsAttention &&
    !!room?.active_job_id &&
    room.session_state !== 'missing' &&
    room.session_state !== 'untracked'
  const toolEntries = preflight ? Object.values(preflight.tools) : []
  const allToolsOk = toolEntries.length > 0 && toolEntries.every((tool) => tool.available)
  const sessionText = sessionLabel(room, summary)
  const autoProgress = room?.auto && room.auto.total_turns > 0
    ? Math.min(100, Math.round((room.auto.completed_turns / room.auto.total_turns) * 100))
    : 0

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
      <div className="room-status">
        <div className="session-line mono dim" title={sessionText}>{sessionText}</div>

        {toolEntries.length > 0 ? (
          <div className="tool-row" title={allToolsOk ? 'All tools available' : 'Some tools missing'}>
            {toolEntries.map((tool) => (
              <span
                key={tool.name}
                className={`tool-chip ${tool.available ? 'ok' : 'missing'}`}
                title={tool.available ? (tool.version ?? tool.path ?? '') : (tool.error ?? 'missing')}
              >
                <Icon name={tool.available ? 'check' : 'close'} className="ic-sm" />
                {tool.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="rail-hint" style={{ padding: 0 }}>Checking tools...</p>
        )}

        <div className="agent-rows">
          {(['claude', 'codex'] as AgentName[]).map((agent) => {
            const ready = Boolean(room?.agents[agent].ready_at)
            const modelValue = agent === 'claude' ? claudeModel : codexModel
            const setModel = agent === 'claude' ? setClaudeModel : setCodexModel
            return (
              <div key={agent} className="agent-row">
                <Avatar author={agent} size={24} />
                <div className="agent-meta">
                  <div className="name">
                    <span className={`state ${ready ? 'on' : ''}`} />
                    {agent}
                  </div>
                  <div className="sub">{ready ? 'ready · awaiting turn' : 'not started'}</div>
                </div>
                <select
                  className="agent-model"
                  aria-label={`${agent} model`}
                  value={modelValue}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={!isThreadOpen}
                >
                  <option value="">CLI default</option>
                  {agent === 'claude' ? (
                    <>
                      <option value="claude-opus-4-7">claude-opus-4-7</option>
                      <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                      <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                    </>
                  ) : (
                    <>
                      <option value="gpt-5.5">gpt-5.5</option>
                      <option value="gpt-5.4">gpt-5.4</option>
                      <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                      <option value="gpt-5.3-codex">gpt-5.3-codex</option>
                    </>
                  )}
                </select>
              </div>
            )
          })}
        </div>

        {room?.auto?.status === 'running' ? (
          <div className="auto-progress">
            <div className="auto-progress-line">
              <span className="auto-dot" />
              <span style={{ fontWeight: 600, color: 'var(--good)' }}>Auto running</span>
              <span style={{ marginLeft: 'auto' }} className="mono">{room.auto.completed_turns}/{room.auto.total_turns}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${autoProgress}%` }} />
            </div>
          </div>
        ) : null}

        <form onSubmit={handleStart} aria-label="start-room" className="room-actions">
          {canStop ? (
            <button type="button" className="btn" onClick={handleStop}>
              <Icon name="stop" className="ic-sm" /> Stop
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!canStart}>
              <Icon name="play" className="ic-sm" /> Start Room
            </button>
          )}
          <button type="button" className="btn" onClick={handleRestart} disabled={!isThreadOpen && !canRestart} title="Restart room">
            <Icon name="refresh" className="ic-sm" />
          </button>
        </form>

        {room?.attach_command ? (
          <button
            type="button"
            className="tmux-cmd"
            title="Click to copy"
            onClick={() => navigator.clipboard?.writeText(room.attach_command)}
          >
            <Icon name="terminal" className="ic-sm" />
            <span>{room.attach_command}</span>
            <Icon name="link" className="ic-sm" />
          </button>
        ) : null}

        {!isThreadOpen ? (
          <p className="rail-hint" style={{ padding: 0 }}>Thread is {threadStatus}; room controls are disabled.</p>
        ) : null}

        {!hideRecoveryControls && room?.input_prompt ? (
          <div role="alert" aria-label="agent-input-prompt" className="rail-recovery" style={{ margin: 0 }}>
            <div className="rail-recovery-head">
              <Icon name="bell" className="ic-sm" />
              <span>{room.input_prompt.agent} is waiting</span>
            </div>
            <pre className="rail-recovery-excerpt">{room.input_prompt.excerpt}</pre>
            <div className="pending-actions">
              <button type="button" className="btn sm primary" onClick={() => handleInputResponse('yes')}>Send Yes</button>
              <button type="button" className="btn sm" onClick={() => handleInputResponse('no')}>Send No</button>
            </div>
          </div>
        ) : null}

        {!hideRecoveryControls && canResolveTurn ? (
          <div className="pending-actions">
            <button type="button" className="btn sm primary" onClick={handleRetry}>Retry Turn</button>
            <button type="button" className="btn sm" onClick={handleSkip}>Skip Turn</button>
          </div>
        ) : null}

        {error ? <p role="alert" className="room-card__error">{error}</p> : null}
      </div>

      <section className="rail-section" data-open={directOpen ? '1' : '0'}>
        <button type="button" className="rail-section-head" onClick={() => setDirectOpen((value) => !value)}>
          <span className="lbl">Direct the room</span>
          <Icon name="chevronD" className="ic-sm chev" />
        </button>
        <div className="rail-section-body">
          <div className="tabbar">
            <button type="button" className="tab" data-on={controlTab === 'nudge' ? '1' : '0'} onClick={() => setControlTab('nudge')}>
              <Icon name="send" className="ic-sm" /> Nudge
            </button>
            <button type="button" className="tab" data-on={controlTab === 'ask' ? '1' : '0'} onClick={() => setControlTab('ask')}>
              <Icon name="spark" className="ic-sm" /> Ask
            </button>
            <button type="button" className="tab" data-on={controlTab === 'auto' ? '1' : '0'} onClick={() => setControlTab('auto')}>
              <Icon name="play" className="ic-sm" /> Auto
              {room?.auto?.status === 'running' ? <span className="tab-badge"><span className="auto-dot" /></span> : null}
            </button>
          </div>

          {controlTab === 'nudge' ? (
            <form onSubmit={handleNudge} aria-label="nudge-room" className="rail-form">
              <div className="rail-hint" style={{ padding: 0 }}>One-line note into the room without consuming a turn.</div>
              <div className="rail-row">
                <select className="rail-input" aria-label="Nudge agent" value={nudgeAgent} onChange={(e) => setNudgeAgent(e.target.value as AgentName)} disabled={!canNudge}>
                  <option value="claude">→ claude</option>
                  <option value="codex">→ codex</option>
                </select>
                <button type="submit" className="btn sm primary" disabled={!canNudge || !nudgeBody.trim()}>
                  <Icon name="send" className="ic-sm" />
                </button>
              </div>
              <input className="rail-input" aria-label="Nudge body" value={nudgeBody} onChange={(e) => setNudgeBody(e.target.value)} placeholder="e.g. focus on /threads/[id] only" disabled={!canNudge} />
            </form>
          ) : null}

          {controlTab === 'ask' ? (
            <form onSubmit={handleAsk} aria-label="ask-agent" className="rail-form">
              <div className="rail-hint" style={{ padding: 0 }}>Pose a question; it becomes a top-level discussion point from you.</div>
              <div className="rail-row">
                <select className="rail-input" aria-label="Ask agent" value={askAgentName} onChange={(e) => setAskAgentName(e.target.value as AgentName)} disabled={!canAsk}>
                  <option value="claude">claude only</option>
                  <option value="codex">codex only</option>
                </select>
                <button type="submit" className="btn sm primary" disabled={!canAsk || !askBody.trim()}>Ask</button>
              </div>
              <textarea className="rail-input rail-textarea" aria-label="Ask body" value={askBody} onChange={(e) => setAskBody(e.target.value)} placeholder="Instructions for the agent..." disabled={!canAsk} />
            </form>
          ) : null}

          {controlTab === 'auto' ? (
            <div className="rail-form">
              <div className="rail-hint" style={{ padding: 0 }}>Let the room discuss on its own. You remain the approval boundary.</div>
              {room?.auto?.status === 'running' ? (
                <>
                  <div className="auto-status-card">
                    <span className="auto-dot" />
                    <span style={{ fontWeight: 600 }}>Auto running</span>
                    <span className="mono" style={{ marginLeft: 'auto' }}>{room.auto.completed_turns}/{room.auto.total_turns}</span>
                  </div>
                  <button type="button" className="btn" onClick={handlePauseAuto} disabled={!canPauseAuto}>
                    <Icon name="pause" className="ic-sm" /> Pause auto
                  </button>
                </>
              ) : (
                <form onSubmit={handleStartAuto} aria-label="start-auto-discussion" className="rail-form" style={{ padding: 0 }}>
                  <div className="rail-row">
                    <span style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 12, color: 'var(--muted-strong)' }}>Turns</span>
                    <input className="rail-input" style={{ width: 78 }} aria-label="Auto turns" type="number" min={1} max={20} value={autoTurns} onChange={(e) => setAutoTurns(Number(e.target.value))} disabled={!canStartAuto} />
                  </div>
                  <label className="cbx">
                    <input aria-label="Allow direct roots" type="checkbox" checked={allowDirectRoots} onChange={(e) => setAllowDirectRoots(e.target.checked)} disabled={!canStartAuto} />
                    <span className="box" />
                    Allow direct roots
                  </label>
                  <button type="submit" className="btn primary" disabled={!canStartAuto}>
                    <Icon name="play" className="ic-sm" /> Let them discuss
                  </button>
                </form>
              )}
              <div className="rail-divider" />
              <form onSubmit={handleExtendAuto} aria-label="extend-auto-discussion" className="rail-row">
                <input className="rail-input" style={{ width: 78 }} aria-label="Extend turns" type="number" min={1} max={20} value={extendTurns} onChange={(e) => setExtendTurns(Number(e.target.value))} disabled={!canExtendAuto} />
                <button type="submit" className="btn sm" disabled={!canExtendAuto}>Extend</button>
              </form>
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}
