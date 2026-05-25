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

  const roomReady =
    room &&
    Boolean(room.agents.claude.ready_at) &&
    Boolean(room.agents.codex.ready_at)
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

  return (
    <section aria-label="consolidation" className="room-card">
      <div className="section-heading">
        <h2>Consolidation</h2>
        {summary ? <span>{summary}</span> : null}
      </div>
      <form onSubmit={submit}>
        <label>
          Drafter
          <select value={drafter} onChange={(event) => setDrafter(event.target.value as AgentName)}>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          Reviewer
          <select value={reviewer} onChange={(event) => setReviewer(event.target.value as AgentName)}>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <label>
          Reviser
          <select value={reviser} onChange={(event) => setReviser(event.target.value as AgentName)}>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          Instructions
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Optional consolidation instructions"
          />
        </label>
        <button type="submit" disabled={!canStart}>
          Consolidate
        </button>
      </form>
      <button type="button" onClick={finishAndConsolidate} disabled={finishButtonDisabled}>
        {consolidationRequested ? (
          <span className="button-loading" aria-live="polite">
            <span className="button-spinner" aria-hidden="true" />
            Requested Consolidation
          </span>
        ) : (
          'Finish & Consolidate'
        )}
      </button>
      {proposals.length > 0 ? (
        <ul>
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <Link to={`/threads/${threadId}/consolidations/${proposal.id}`}>
                {proposal.id}
              </Link>{' '}
              {proposal.status}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">No consolidations yet.</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
