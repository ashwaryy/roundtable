import { useEffect, useState, type FormEvent } from 'react'
import type { AgentName, Agent, AgentRoom, RoomPreflight, ThreadStatus } from '@roundtable/shared'
import {
  cancelIdleSuggestion,
  exitAutoDiscussion,
  extendAutoDiscussion,
  nudgeRoom,
  requestIdleSuggestion,
  openRoomTerminal,
  pauseAutoDiscussion,
  retryTurn,
  restartRoom,
  sendRoomInputResponse,
  skipTurn,
  startAutoDiscussion,
  startRoom,
  stopAutoDiscussion,
  stopRoom,
  inviteThreadAgent,
  listAgents,
  removeThreadAgent,
  updateThreadAgent,
  type AgentTurnResult,
} from '../api'
import { Avatar, Icon } from './primitives'
import { ModelSelect } from './ModelSelect'

export function RoomRosterPlaceholder() {
  return (
    <>
      <div className="agent-rows" aria-label="Loading invited agents">
        {[0, 1].map((index) => (
          <div key={index} className="agent-row agent-row-placeholder">
            <span className="sk roster-placeholder-avatar" />
            <div className="agent-meta">
              <span className="sk roster-placeholder-name" />
              <span className="sk roster-placeholder-sub" />
            </div>
            <div className="agent-row-controls">
              <span className="sk roster-placeholder-control" />
              <span className="sk roster-placeholder-effort" />
              <span className="sk roster-placeholder-remove" />
            </div>
          </div>
        ))}
      </div>
      <div className="rail-row roster-invite-placeholder">
        <select className="rail-input" disabled aria-label="Invite agent loading">
          <option>Invite agent...</option>
        </select>
        <button type="button" className="btn sm" disabled aria-label="Invite agent unavailable">
          <Icon name="plus" className="ic-sm" />
        </button>
      </div>
    </>
  )
}

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

function canStartRoom(
  isThreadOpen: boolean,
  preflight: RoomPreflight | null,
  room: AgentRoom | null,
): boolean {
  return (
    isThreadOpen &&
    (preflight?.ok ?? false) &&
    (!room ||
      room.status === 'not_started' ||
      room.status === 'stopped' ||
      room.status === 'error')
  )
}

export function RoomPanel({
  threadId,
  threadStatus,
  room,
  preflight,
  hideRecoveryControls = false,
  summary,
  onUpdate,
  onRoomResult,
}: {
  threadId: string
  threadStatus: ThreadStatus
  room: AgentRoom | null
  preflight: RoomPreflight | null
  hideRecoveryControls?: boolean
  summary?: string
  onUpdate: () => void
  onRoomResult: (result: AgentRoom | AgentTurnResult) => void
}) {
  const [models, setModels] = useState<Record<string, string>>({})
  const [efforts, setEfforts] = useState<Record<string, string>>({})
  const [catalogue, setCatalogue] = useState<Agent[]>([])
  const [inviteId, setInviteId] = useState('')
  const [nudgeAgent, setNudgeAgent] = useState<AgentName>('claude')
  const [nudgeBody, setNudgeBody] = useState('')
  const [suggestAgent, setSuggestAgent] = useState<AgentName>('claude')
  const [suggestBody, setSuggestBody] = useState('')
  const [controlTab, setControlTab] = useState<'nudge' | 'suggest' | 'auto'>('nudge')
  const [directOpen, setDirectOpen] = useState(true)
  const [autoTurns, setAutoTurns] = useState(4)
  const [extendTurns, setExtendTurns] = useState(4)
  const [allowDirectRoots, setAllowDirectRoots] = useState(false)
  const [startingRoom, setStartingRoom] = useState(false)
  const [openingTerminal, setOpeningTerminal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isThreadOpen = threadStatus === 'open'
  const roster = room?.roster ?? []

  useEffect(() => {
    listAgents().then((items) => setCatalogue(items.filter((item) => !item.archived)))
  }, [])

  useEffect(() => {
    setModels(Object.fromEntries(roster.map((agent) => [agent.agent_id, agent.model ?? ''])))
    setEfforts(Object.fromEntries(roster.map((agent) => [agent.agent_id, agent.effort ?? ''])))
    const first = roster[0]?.agent_id
    if (first) {
      setNudgeAgent((value) => roster.some((agent) => agent.agent_id === value) ? value : first)
      setSuggestAgent((value) => roster.some((agent) => agent.agent_id === value) ? value : first)
    }
  }, [room?.roster])

  async function handleStart(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setStartingRoom(true)
    try {
      await startRoom(threadId, {
        claude_model: models.claude || null,
        codex_model: models.codex || null,
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStartingRoom(false)
    }
  }

  async function handleStop() {
    setError(null)
    try {
      onRoomResult(await stopRoom(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleOpenTerminal() {
    if (!room?.attach_command) return
    setOpeningTerminal(true)
    setError(null)
    try {
      await openRoomTerminal(threadId)
    } catch (err) {
      navigator.clipboard?.writeText(room.attach_command)
      setError('Terminal could not be opened. Attach command copied.')
    } finally {
      setOpeningTerminal(false)
    }
  }

  async function handleRestart() {
    setError(null)
    try {
      onRoomResult(await restartRoom(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNudge(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const result = await nudgeRoom(threadId, {
        agent: nudgeAgent,
        body: nudgeBody || null,
      })
      setNudgeBody('')
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSuggest(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const result = await requestIdleSuggestion(threadId, {
        agent: suggestAgent,
        body: suggestBody || null,
      })
      setSuggestBody('')
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCancelSuggestion() {
    setError(null)
    try {
      onRoomResult(await cancelIdleSuggestion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleStartAuto(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const result = await startAutoDiscussion(threadId, {
        turn_count: autoTurns,
        allow_direct_roots: allowDirectRoots,
      })
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handlePauseAuto() {
    setError(null)
    try {
      onRoomResult(await pauseAutoDiscussion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleStopAuto() {
    setError(null)
    try {
      onRoomResult(await stopAutoDiscussion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExitAuto() {
    setError(null)
    try {
      onRoomResult(await exitAutoDiscussion(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExtendAuto(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      onRoomResult(await extendAutoDiscussion(threadId, { turn_count: extendTurns }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleInputResponse(response: 'yes' | 'no') {
    if (!room?.input_prompt) return
    setError(null)
    try {
      const result = await sendRoomInputResponse(threadId, {
        agent: room.input_prompt.agent,
        response,
      })
      onRoomResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRetry() {
    setError(null)
    try {
      onRoomResult(await retryTurn(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSkip() {
    setError(null)
    try {
      onRoomResult(await skipTurn(threadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleInvite() {
    if (!inviteId) return
    try {
      await inviteThreadAgent(threadId, { agent_id: inviteId })
      setInviteId('')
      onUpdate()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function handleRemove(agentId: string) {
    try {
      await removeThreadAgent(threadId, agentId)
      onUpdate()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  async function saveModel(agentId: string, modelValue = models[agentId] || null) {
    try {
      await updateThreadAgent(threadId, agentId, { model: modelValue, effort: efforts[agentId] || null })
      onUpdate()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const canStart = canStartRoom(isThreadOpen, preflight, room)
  const canNudge = isThreadOpen && room?.status === 'idle'
  const canSuggest = isThreadOpen && room?.status === 'idle'
  const canStartAuto = isThreadOpen && room?.status === 'idle'
  const canPauseAuto = isThreadOpen && room?.auto?.status === 'running'
  const canStopAuto = isThreadOpen && room?.auto?.status === 'running'
  const canExitAuto =
    isThreadOpen &&
    !!room?.auto &&
    (room?.status === 'paused' || room?.status === 'turn_limit_reached')
  const canExtendAuto =
    isThreadOpen &&
    !!room?.auto &&
    (room?.status === 'paused' || room?.status === 'turn_limit_reached')
  const canStop =
    isThreadOpen &&
    !!room &&
    room.status !== 'not_started' &&
    room.status !== 'stopped'
  const needsAttention = isThreadOpen && room?.status === 'needs_attention'
  const canRestart = isThreadOpen && room?.session_state === 'missing'
  const canReloadRoom = isThreadOpen || canRestart
  const canResolveTurn =
    needsAttention &&
    !!room?.active_job_id &&
    room.session_state !== 'missing' &&
    room.session_state !== 'untracked'
  const toolEntries = preflight
    ? Object.values(preflight.tools)
    : (['tmux', 'claude', 'codex'] as const).map((name) => ({
        name,
        available: false,
        path: null,
        version: null,
        error: 'Checking tools...',
      }))
  const allToolsOk = toolEntries.length > 0 && toolEntries.every((tool) => tool.available)
  const sessionText = sessionLabel(room, summary)
  const canOpenTerminal =
    isThreadOpen &&
    !!room?.attach_command &&
    (room.session_state === 'connected' || room.session_state === 'recovered')
  const showAgentReadiness =
    isThreadOpen &&
    !!room &&
    room.status !== 'not_started' &&
    room.status !== 'stopped' &&
    room.status !== 'error'
  const autoProgress = room?.auto && room.auto.total_turns > 0
    ? Math.min(100, Math.round((room.auto.completed_turns / room.auto.total_turns) * 100))
    : 0

  useEffect(() => {
    if (startingRoom && !canStartRoom(isThreadOpen, preflight, room)) {
      setStartingRoom(false)
    }
  }, [isThreadOpen, preflight, room, startingRoom])

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

        {room ? <div className="agent-rows">
          {roster.map((agent) => {
            const agentId = agent.agent_id
            const ready = showAgentReadiness && Boolean(room?.agents[agentId]?.ready_at)
            return (
              <div key={agentId} className="agent-row">
                <Avatar author={agentId} agent={agent} size={24} />
                <div className="agent-meta">
                  <div className="name">
                    <span className={`state ${ready ? 'on' : ''}`} />
                    {agent.name}
                  </div>
                  <div className="sub">{agent.runtime} · {ready ? 'ready' : 'not started'}</div>
                </div>
                <div className="agent-row-controls">
                  <ModelSelect
                    runtime={agent.runtime}
                    className="agent-model"
                    ariaLabel={`${agentId} model`}
                    value={models[agentId] ?? ''}
                    onChange={(value) => setModels((modelsByAgent) => ({ ...modelsByAgent, [agentId]: value }))}
                    onCommit={(value) => void saveModel(agentId, value || null)}
                    disabled={!isThreadOpen}
                  />
                  <select className="agent-model" aria-label={`${agentId} effort`} value={efforts[agentId] ?? ''} onChange={(event) => setEfforts((value) => ({ ...value, [agentId]: event.target.value }))} onBlur={() => void saveModel(agentId)} disabled={!isThreadOpen}>
                    <option value="">Effort</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>{agent.runtime === 'codex' ? <option value="xhigh">XHigh</option> : null}
                  </select>
                  {roster.length > 1 && (room?.status === 'idle' || room?.status === 'not_started' || room?.status === 'stopped') ? (
                    <button
                      type="button"
                      className="agent-remove"
                      title={`Remove ${agent.name}`}
                      aria-label={`Remove ${agent.name}`}
                      onClick={() => void handleRemove(agentId)}
                    >
                      <Icon name="close" className="ic-sm" />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div> : <RoomRosterPlaceholder />}
        {room && isThreadOpen && (room.status === 'idle' || room.status === 'not_started' || room.status === 'stopped') ? (
          <div className="rail-row">
            <select className="rail-input" value={inviteId} onChange={(event) => setInviteId(event.target.value)}>
              <option value="">Invite agent...</option>
              {catalogue.filter((agent) => !roster.some((invite) => invite.agent_id === agent.id)).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <button type="button" className="btn sm" disabled={!inviteId} onClick={() => void handleInvite()}><Icon name="plus" className="ic-sm" /></button>
          </div>
        ) : null}

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

        {room?.auto?.status === 'running' ? null : (
          <form onSubmit={handleStart} aria-label="start-room" className="room-actions">
            {canStop ? (
              <button type="button" className="btn" onClick={handleStop}>
                <Icon name="stop" className="ic-sm" /> Stop
              </button>
            ) : (
              <button type="submit" className="btn primary" disabled={!canStart || startingRoom}>
                {startingRoom ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Icon name="play" className="ic-sm" /> Start Room
                  </>
                )}
              </button>
            )}
            <button type="button" className="btn" onClick={handleRestart} disabled={!canReloadRoom} title="Restart room">
              <Icon name="refresh" className="ic-sm" />
            </button>
          </form>
        )}

        <div className="tmux-attach" data-placeholder={room?.attach_command ? '0' : '1'}>
          <button
            type="button"
            className="tmux-cmd"
            title={room?.attach_command ? 'Copy attach command' : 'Attach command unavailable'}
            disabled={!room?.attach_command}
            onClick={() => {
              if (room?.attach_command) {
                navigator.clipboard?.writeText(room.attach_command)
              }
            }}
          >
            <Icon name="terminal" className="ic-sm" />
            <span>{room?.attach_command ?? 'tmux attach command'}</span>
            <Icon name="link" className="ic-sm" />
          </button>
          <button
            type="button"
            className="tmux-watch"
            title="Open terminal attached to this tmux session"
            aria-label="Open terminal attached to this tmux session"
            disabled={openingTerminal || !canOpenTerminal}
            onClick={handleOpenTerminal}
          >
            <Icon name="eye" className="ic-sm" />
          </button>
        </div>

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
            <button type="button" className="tab" data-on={controlTab === 'suggest' ? '1' : '0'} onClick={() => setControlTab('suggest')}>
              <Icon name="spark" className="ic-sm" /> Suggest
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
                  {roster.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
                </select>
                <button type="submit" className="btn sm primary" disabled={!canNudge || !nudgeBody.trim()}>
                  <Icon name="send" className="ic-sm" />
                </button>
              </div>
              <input className="rail-input" aria-label="Nudge body" value={nudgeBody} onChange={(e) => setNudgeBody(e.target.value)} placeholder="e.g. focus on /threads/[id] only" disabled={!canNudge} />
            </form>
          ) : null}

          {controlTab === 'suggest' ? (
            <form onSubmit={handleSuggest} aria-label="request-suggestion" className="rail-form">
              <div className="rail-hint" style={{ padding: 0 }}>Ask for proposed discussion points; they require your approval.</div>
              {room?.idle_suggestion_request ? (
                <div className="rail-row">
                  <div className="rail-hint" style={{ padding: 0 }}>
                    {room.idle_suggestion_request.status === 'done'
                      ? `${room.idle_suggestion_request.agent} finished with ${room.idle_suggestion_request.submitted_count} suggestion${room.idle_suggestion_request.submitted_count === 1 ? '' : 's'}.`
                      : `Suggest is active for ${room.idle_suggestion_request.agent}; ${room.idle_suggestion_request.submitted_count} submitted so far. Cancel to stop further suggestions.`}
                  </div>
                  <button type="button" className="btn sm" onClick={handleCancelSuggestion}>Cancel</button>
                </div>
              ) : null}
              <div className="rail-row">
                <select className="rail-input" aria-label="Suggestion agent" value={suggestAgent} onChange={(e) => setSuggestAgent(e.target.value as AgentName)} disabled={!canSuggest}>
                  {roster.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
                </select>
                <button type="submit" className="btn sm primary" disabled={!canSuggest}>Suggest</button>
              </div>
              <textarea className="rail-input rail-textarea" aria-label="Suggestion instructions" value={suggestBody} onChange={(e) => setSuggestBody(e.target.value)} placeholder="Optional focus for the proposed topic..." disabled={!canSuggest} />
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
                  <div className="rail-row two">
                    <button type="button" className="btn" onClick={handlePauseAuto} disabled={!canPauseAuto}>
                      <Icon name="pause" className="ic-sm" /> Pause
                    </button>
                    <button type="button" className="btn" onClick={handleStopAuto} disabled={!canStopAuto}>
                      <Icon name="stop" className="ic-sm" /> Stop
                    </button>
                  </div>
                </>
              ) : canExtendAuto || canExitAuto ? (
                <>
                  <div className="auto-status-card">
                    <span style={{ fontWeight: 600 }}>
                      {room?.status === 'paused' ? 'Auto paused' : 'Auto complete'}
                    </span>
                    <span className="mono" style={{ marginLeft: 'auto' }}>
                      {room?.auto?.completed_turns}/{room?.auto?.total_turns}
                    </span>
                  </div>
                  <form onSubmit={handleExtendAuto} aria-label="extend-auto-discussion" className="rail-row auto-exit-row">
                    <input className="rail-input" style={{ width: 78 }} aria-label="Extend turns" type="number" min={1} max={20} value={extendTurns} onChange={(e) => setExtendTurns(Number(e.target.value))} disabled={!canExtendAuto} />
                    <button type="submit" className="btn sm" disabled={!canExtendAuto}>Extend</button>
                    <button type="button" className="btn sm" onClick={handleExitAuto} disabled={!canExitAuto}>Exit auto</button>
                  </form>
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
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}
