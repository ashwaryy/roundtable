import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type {
  AgentName,
  AgentRoom,
  BoundedJob,
  ConsolidationDetail,
  ConsolidationProposal,
  ThreadStatus,
} from '@roundtable/shared'
import {
  finishAndStartConsolidation,
  startConsolidation,
} from '../api'
import { Icon, StatusPill } from './primitives'
import {
  CONSOLIDATION_STEPS,
  buildConsolidationUiState,
  isActiveProposal,
} from '../lib/consolidationUi'

export function ConsolidationPanel({
  threadId,
  threadStatus,
  room,
  proposals,
  jobs,
  activeDetail,
  summary,
  onUpdate,
}: {
  threadId: string
  threadStatus: ThreadStatus
  room: AgentRoom | null
  proposals: ConsolidationProposal[]
  jobs: BoundedJob[]
  activeDetail: ConsolidationDetail | null
  summary?: string
  onUpdate: () => void
}) {
  const [drafter, setDrafter] = useState<AgentName>('codex')
  const [reviewer, setReviewer] = useState<AgentName>('claude')
  const [reviser, setReviser] = useState<AgentName>('codex')
  const [instructions, setInstructions] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [finishRequested, setFinishRequested] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const readyAgents = room?.roster.filter((agent) => room.agents[agent.agent_id]?.ready_at) ?? []

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

  const active = proposals.find(isActiveProposal)
  const latest = proposals[proposals.length - 1] ?? null
  const shownProposal = active ?? latest
  const uiState = buildConsolidationUiState({
    proposals,
    jobs,
    detail: activeDetail,
    proposal: shownProposal,
  })
  const history = proposals.filter((proposal) => proposal.id !== shownProposal?.id).slice().reverse()
  const canCreateOutcome = threadStatus === 'open'
  const outcomeLink = shownProposal?.status === 'saved' && shownProposal.saved_artifact_id
    ? {
        to: `/saved/${shownProposal.saved_artifact_id}`,
        label: 'View saved output',
      }
    : shownProposal?.status === 'applied' && shownProposal.applied_thread_id
      ? {
          to: `/threads/${shownProposal.applied_thread_id}`,
          label: 'Open next thread',
        }
      : shownProposal
        ? {
            to: `/threads/${threadId}/consolidations/${shownProposal.id}`,
            label: uiState.isReady ? 'Review outcome' : uiState.isTerminal ? 'View outcome' : 'View draft',
          }
        : null

  return (
    <div className="rail-form">
      <div className="rail-hint" style={{ padding: 0 }}>
        Turn approved discussion into a reviewable outcome.
        {summary ? ` Current state: ${summary}.` : ''}
      </div>

      {shownProposal ? (
        <div className="proposal-card">
          <div className="proposal-card-head">
            <Icon name="file" className="ic-sm" />
            <span style={{ fontWeight: 600 }}>{shownProposal.summary || shownProposal.id}</span>
            <StatusPill status={uiState.isTerminal ? 'closed' : 'consolidating'} label={uiState.label} />
          </div>
          <div className="proposal-card-body">{uiState.helper}</div>
          {!uiState.isTerminal ? (
            <div className="outcome-steps outcome-steps--rail">
              {CONSOLIDATION_STEPS.map((step) => (
                <span
                  key={step.phase}
                  className="outcome-step"
                  data-active={uiState.phase === step.phase ? '1' : '0'}
                >
                  {step.label}
                </span>
              ))}
            </div>
          ) : null}
          <div className="pending-actions">
            {uiState.canOpenDraft && outcomeLink ? (
              <Link className="btn sm primary" to={outcomeLink.to}>
                <Icon name="eye" className="ic-sm" /> {outcomeLink.label}
              </Link>
            ) : (
              <span className="outcome-waiting">Draft not ready yet</span>
            )}
          </div>
        </div>
      ) : canCreateOutcome ? (
        <form onSubmit={submit} className="rail-form" style={{ padding: 0 }}>
          <textarea
            className="rail-input rail-textarea"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Optional outcome instructions"
          />
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <Icon name={advancedOpen ? 'chevronU' : 'chevronD'} className="ic-sm" />
            Advanced agent roles
          </button>
          {advancedOpen ? (
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
          ) : null}
          <div className="pending-actions">
            <button type="submit" className="btn primary" disabled={!canStart} style={{ flex: 1 }}>
              <Icon name="play" className="ic-sm" /> Create outcome
            </button>
            <button type="button" className="btn" onClick={finishAndConsolidate} disabled={finishButtonDisabled}>
              {consolidationRequested ? 'Requested' : 'Finish & create'}
            </button>
          </div>
        </form>
      ) : null}

      {history.length > 0 ? (
        <div className="proposal-history">
          <div className="rail-hint" style={{ padding: 0 }}>Outcome history</div>
          {history.map((proposal) => (
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
