import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type {
  AgentName,
  AgentRoom,
  ConsolidationProposal,
} from '@roundtable/shared'
import {
  finishAndStartConsolidation,
  startConsolidation,
} from '../api'
import { Icon, StatusPill } from './primitives'

export function ConsolidationPanel({
  threadId,
  room,
  proposals,
  summary,
  onUpdate,
}: {
  threadId: string
  room: AgentRoom | null
  proposals: ConsolidationProposal[]
  summary?: string
  onUpdate: () => void
}) {
  const [drafter, setDrafter] = useState<AgentName>('codex')
  const [reviewer, setReviewer] = useState<AgentName>('claude')
  const [reviser, setReviser] = useState<AgentName>('codex')
  const [instructions, setInstructions] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [finishRequested, setFinishRequested] = useState(false)
  const readyAgents = room?.roster.filter((persona) => room.agents[persona.agent_id]?.ready_at) ?? []

  const roomReady =
    room &&
    readyAgents.length > 0 &&
    readyAgents.length === room.roster.length
  const canStart =
    Boolean(roomReady) &&
    !room?.active_job_id &&
    (room?.status === 'idle' ||
      room?.status === 'paused' ||
      room?.status === 'turn_limit_reached')
  const canFinishAndStart =
    room?.status === 'running' &&
    room.active_job_id !== null &&
    room.auto?.status === 'running'
  const consolidationRequested =
    finishRequested || room?.auto?.pause_requested === true
  const finishButtonDisabled = !canFinishAndStart || consolidationRequested

  useEffect(() => {
    if (room?.auto?.pause_requested) {
      setFinishRequested(true)
      return
    }
    if (room?.status !== 'running' || room.auto?.status !== 'running') {
      setFinishRequested(false)
    }
  }, [room?.auto?.pause_requested, room?.auto?.status, room?.status])

  useEffect(() => {
    if (readyAgents.length === 0) return
    const first = readyAgents[0].agent_id
    const second = readyAgents[1]?.agent_id ?? first
    setDrafter((value) => readyAgents.some((agent) => agent.agent_id === value) ? value : second)
    setReviewer((value) => readyAgents.some((agent) => agent.agent_id === value) ? value : first)
    setReviser((value) => readyAgents.some((agent) => agent.agent_id === value) ? value : second)
  }, [room?.roster, room?.agents])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await startConsolidation(threadId, {
        drafter_agent: drafter,
        reviewer_agent: reviewer,
        reviser_agent: reviser,
        instructions: instructions || null,
      })
      setInstructions('')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function finishAndConsolidate() {
    setError(null)
    try {
      await finishAndStartConsolidation(threadId, {
        drafter_agent: drafter,
        reviewer_agent: reviewer,
        reviser_agent: reviser,
        instructions: instructions || null,
      })
      setFinishRequested(true)
      onUpdate()
    } catch (err) {
      setFinishRequested(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const active = proposals.find((proposal) => proposal.status === 'drafting' || proposal.status === 'review')

  return (
    <div className="rail-form">
      <div className="rail-hint" style={{ padding: 0 }}>
        When the discussion is useful, consolidate it into a proposed next thread for you to review.
        {summary ? ` Current state: ${summary}.` : ''}
      </div>

      {active ? (
        <div className="proposal-card">
          <div className="proposal-card-head">
            <Icon name="file" className="ic-sm" />
            <span style={{ fontWeight: 600 }}>{active.summary || active.id}</span>
            <StatusPill status="consolidating" label={active.status} />
          </div>
          <div className="proposal-card-body">
            Drafter: <b>{active.drafter_agent}</b> · Reviewer: <b>{active.reviewer_agent}</b>
          </div>
          <div className="pending-actions">
            <Link className="btn sm primary" to={`/threads/${threadId}/consolidations/${active.id}`}>
              <Icon name="eye" className="ic-sm" /> Open review
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="rail-form" style={{ padding: 0 }}>
          <div className="rail-row three">
            <div className="rail-mini">
              <label>Drafter</label>
              <select className="rail-input" value={drafter} onChange={(event) => setDrafter(event.target.value as AgentName)}>
                {readyAgents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
              </select>
            </div>
            <div className="rail-mini">
              <label>Reviewer</label>
              <select className="rail-input" value={reviewer} onChange={(event) => setReviewer(event.target.value as AgentName)}>
                {readyAgents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
              </select>
            </div>
            <div className="rail-mini">
              <label>Reviser</label>
              <select className="rail-input" value={reviser} onChange={(event) => setReviser(event.target.value as AgentName)}>
                {readyAgents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
              </select>
            </div>
          </div>
          <textarea
            className="rail-input rail-textarea"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Optional consolidation instructions"
          />
          <div className="pending-actions">
            <button type="submit" className="btn primary" disabled={!canStart} style={{ flex: 1 }}>
              <Icon name="play" className="ic-sm" /> Consolidate
            </button>
            <button type="button" className="btn" onClick={finishAndConsolidate} disabled={finishButtonDisabled}>
              {consolidationRequested ? 'Requested' : 'Finish & Consolidate'}
            </button>
          </div>
        </form>
      )}

      {proposals.length > 0 ? (
        <div className="proposal-history">
          <div className="rail-hint" style={{ padding: 0 }}>Past proposals</div>
          {proposals.map((proposal) => (
            <div key={proposal.id} className="proposal-row">
              <Link to={`/threads/${threadId}/consolidations/${proposal.id}`} className="mono" style={{ fontSize: 11 }}>
                {proposal.id}
              </Link>
              <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{proposal.status}</span>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="room-card__error">{error}</p> : null}
    </div>
  )
}
