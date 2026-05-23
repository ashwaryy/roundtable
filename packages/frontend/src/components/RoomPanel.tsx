import { useState, type FormEvent } from 'react'
import type { AgentName, AgentRoom, RoomPreflight } from '@roundtable/shared'
import { nudgeRoom, startRoom, stopRoom } from '../api'

function readyText(readyAt: string | null): string {
  return readyAt ? 'ready' : 'waiting'
}

export function RoomPanel({
  threadId,
  room,
  preflight,
  onUpdate,
}: {
  threadId: string
  room: AgentRoom | null
  preflight: RoomPreflight | null
  onUpdate: () => void
}) {
  const [claudeModel, setClaudeModel] = useState('')
  const [codexModel, setCodexModel] = useState('')
  const [nudgeAgent, setNudgeAgent] = useState<AgentName>('claude')
  const [nudgeBody, setNudgeBody] = useState('')
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

  const canStart = preflight?.ok ?? false
  const canNudge = room?.status === 'idle'
  const canStop = room && room.status !== 'not_started' && room.status !== 'stopped'
  const toolEntries = preflight ? Object.values(preflight.tools) : []

  return (
    <section aria-label="agent-room">
      <h2>Agent Room</h2>

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
          <p>Attach: {room.attach_command}</p>
          {room.last_error ? <p role="alert">{room.last_error}</p> : null}
        </>
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

      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
