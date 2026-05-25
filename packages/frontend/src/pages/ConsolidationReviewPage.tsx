import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AgentName,
  Comment,
  ConsolidationDetail,
  RoundtableEvent,
  ThreadDetail,
} from '@roundtable/shared'
import {
  getConsolidation,
  getThread,
  listComments,
  rejectProposal,
  requestProposalReview,
  requestProposalRevision,
  saveConsolidatedOutput,
  saveProposalRevision,
  startNextIteration,
} from '../api'
import { useLiveRefresh } from '../useLiveRefresh'

export function ConsolidationReviewPage() {
  const { id, proposalId } = useParams<{ id: string; proposalId: string }>()
  const navigate = useNavigate()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [detail, setDetail] = useState<ConsolidationDetail | null>(null)
  const [body, setBody] = useState('')
  const [reviewInstructions, setReviewInstructions] = useState('')
  const [revisionInstructions, setRevisionInstructions] = useState('')
  const [reviewer, setReviewer] = useState<AgentName>('claude')
  const [reviser, setReviser] = useState<AgentName>('codex')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!id || !proposalId) return
    getThread(id).then(setThread)
    listComments(id).then(setComments)
    getConsolidation(id, proposalId).then((next) => {
      setDetail(next)
      setBody(next.latest_body ?? '')
      setReviewer(next.proposal.reviewer_agent)
      setReviser(next.proposal.reviser_agent)
    })
  }, [id, proposalId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useLiveRefresh(
    useCallback(
      (event: RoundtableEvent) => {
        if (event.thread_id !== id) return
        if (event.type === 'thread_deleted') {
          navigate('/')
          return
        }
        refresh()
      },
      [id, navigate, refresh],
    ),
  )

  async function saveRevision(event: FormEvent) {
    event.preventDefault()
    if (!id || !proposalId) return
    setError(null)
    try {
      await saveProposalRevision(id, proposalId, { body })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function askReview() {
    if (!id || !proposalId) return
    setError(null)
    try {
      await requestProposalReview(id, proposalId, {
        reviewer_agent: reviewer,
        instructions: reviewInstructions || null,
      })
      setReviewInstructions('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function askRevision() {
    if (!id || !proposalId) return
    setError(null)
    try {
      await requestProposalRevision(id, proposalId, {
        reviewer_agent: reviewer,
        reviser_agent: reviser,
        instructions: revisionInstructions || null,
      })
      setRevisionInstructions('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function reject() {
    if (!id || !proposalId) return
    setError(null)
    try {
      await rejectProposal(id, proposalId)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveOutput() {
    if (!id || !proposalId) return
    setError(null)
    try {
      const saved = await saveConsolidatedOutput(id, proposalId)
      navigate(`/saved/${saved.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function nextIteration() {
    if (!id || !proposalId) return
    setError(null)
    try {
      const next = await startNextIteration(id, proposalId)
      navigate(`/threads/${next.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!thread || !detail) return <p>Loading...</p>

  const proposal = detail.proposal
  const locked =
    proposal.status === 'applied' ||
    proposal.status === 'saved' ||
    proposal.status === 'rejected'

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <Link to={`/threads/${thread.id}`} className="back-link">
            Back to thread
          </Link>
          <h1>{proposal.id}</h1>
        </div>
        <span className={`status-pill status-pill--${proposal.status}`}>{proposal.status}</span>
      </header>

      <div className="review-layout">
        <section className="panel">
          <h2>Current Thread</h2>
          <Markdown remarkPlugins={[remarkGfm]}>{thread.body}</Markdown>
          <h2>Approved Discussion</h2>
          <ul>
            {comments.map((comment) => (
              <li key={comment.id}>
                {comment.id} {comment.author}:
                <Markdown remarkPlugins={[remarkGfm]}>{comment.body}</Markdown>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="section-heading">
            <h2>Proposed Thread</h2>
            <span>{detail.revisions.length} revisions</span>
          </div>
          <form onSubmit={saveRevision}>
            <textarea
              className="proposal-editor"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={locked}
            />
            <button type="submit" disabled={locked || !body.trim()}>
              Save Revision
            </button>
          </form>

          <h2>Latest Review</h2>
          <pre>{detail.latest_review_body ?? 'No review yet.'}</pre>

          <div className="proposal-actions">
            <label>
              Reviewer
              <select
                value={reviewer}
                onChange={(event) => setReviewer(event.target.value as AgentName)}
                disabled={locked}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </label>
            <label>
              Reviser
              <select
                value={reviser}
                onChange={(event) => setReviser(event.target.value as AgentName)}
                disabled={locked}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </label>
            <label>
              Review instructions
              <input
                value={reviewInstructions}
                onChange={(event) => setReviewInstructions(event.target.value)}
                disabled={locked}
              />
            </label>
            <button type="button" onClick={askReview} disabled={locked}>
              Ask Reviewer
            </button>
            <label>
              Revision instructions
              <input
                value={revisionInstructions}
                onChange={(event) => setRevisionInstructions(event.target.value)}
                disabled={locked}
              />
            </label>
            <button type="button" onClick={askRevision} disabled={locked}>
              Ask Reviser
            </button>
          </div>

          {proposal.status === 'saved' && proposal.saved_artifact_id ? (
            <p>
              <Link to={`/saved/${proposal.saved_artifact_id}`}>View final saved revision</Link>
            </p>
          ) : locked ? null : (
            <div className="proposal-actions proposal-actions--final">
              <button type="button" onClick={nextIteration} disabled={!body.trim()}>
                Start Next Iteration
              </button>
              <button type="button" onClick={saveOutput} disabled={!body.trim()}>
                Save Output
              </button>
              <button type="button" onClick={reject}>
                Reject
              </button>
            </div>
          )}

          {error ? <p role="alert">{error}</p> : null}
        </section>
      </div>
    </main>
  )
}
