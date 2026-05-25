import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentName, ConsolidationDetail, RoundtableEvent, ThreadDetail, AgentRoom, BoundedJob } from "@roundtable/shared";
import {
  getConsolidation,
  getThread,
  getRoom,
  listJobs,
  rejectProposal,
  requestProposalReview,
  requestProposalRevision,
  saveConsolidatedOutput,
  saveProposalRevision,
  startNextIteration,
} from "../api";
import { useLiveRefresh } from "../useLiveRefresh";
import { Icon } from "../components/primitives";
import { ThemeToggle } from "../components/ThemeToggle";
import { CONSOLIDATION_STEPS, buildConsolidationUiState } from "../lib/consolidationUi";
import { readStoredBoolean, writeStoredBoolean } from "../lib/uiStorage";

const REVIEW_RAIL_COLLAPSED_STORAGE_KEY = "roundtable.reviewRailCollapsed";

function RailSection({ label, count, defaultOpen = true, children }: { label: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rail-section" data-open={open ? "1" : "0"}>
      <button type="button" className="rail-section-head" onClick={() => setOpen((value) => !value)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="lbl">{label}</span>
          {count != null ? <span className="rail-section-count">{count}</span> : null}
        </div>
        <Icon name="chevronD" className="ic-sm chev" />
      </button>
      <div className="rail-section-body">{children}</div>
    </section>
  );
}

export function ConsolidationReviewPage() {
  const { id, proposalId } = useParams<{ id: string; proposalId: string }>();
  const navigate = useNavigate();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [detail, setDetail] = useState<ConsolidationDetail | null>(null);
  const [room, setRoom] = useState<AgentRoom | null>(null);
  const [jobs, setJobs] = useState<BoundedJob[]>([]);
  const [body, setBody] = useState("");
  const [reviewInstructions, setReviewInstructions] = useState("");
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [reviewer, setReviewer] = useState<AgentName>("claude");
  const [reviser, setReviser] = useState<AgentName>("codex");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => readStoredBoolean(REVIEW_RAIL_COLLAPSED_STORAGE_KEY, false));

  const refresh = useCallback(() => {
    if (!id || !proposalId) return;
    getThread(id).then(setThread);
    getRoom(id).then(setRoom);
    listJobs(id).then(setJobs);
    getConsolidation(id, proposalId).then((next) => {
      setDetail(next);
      setBody(next.latest_body ?? "");
      setReviewer(next.proposal.reviewer_agent);
      setReviser(next.proposal.reviser_agent);
    });
  }, [id, proposalId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    writeStoredBoolean(REVIEW_RAIL_COLLAPSED_STORAGE_KEY, railCollapsed);
  }, [railCollapsed]);

  const backendStatus = useLiveRefresh(
    useCallback(
      (event: RoundtableEvent) => {
        if (!("thread_id" in event) || event.thread_id !== id) return;
        if (event.type === "thread_deleted") {
          navigate("/");
          return;
        }
        refresh();
      },
      [id, navigate, refresh],
    ),
  );

  async function saveRevision(event: FormEvent) {
    event.preventDefault();
    if (!id || !proposalId) return;
    setError(null);
    try {
      await saveProposalRevision(id, proposalId, { body });
      setEditing(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function askReview() {
    if (!id || !proposalId) return;
    setError(null);
    try {
      await requestProposalReview(id, proposalId, {
        reviewer_agent: reviewer,
        instructions: reviewInstructions || null,
      });
      setReviewInstructions("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function askRevision() {
    if (!id || !proposalId) return;
    setError(null);
    try {
      await requestProposalRevision(id, proposalId, {
        reviewer_agent: reviewer,
        reviser_agent: reviser,
        instructions: revisionInstructions || null,
      });
      setRevisionInstructions("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reject() {
    if (!id || !proposalId) return;
    setError(null);
    try {
      await rejectProposal(id, proposalId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveOutput() {
    if (!id || !proposalId) return;
    setError(null);
    try {
      const saved = await saveConsolidatedOutput(id, proposalId);
      navigate(`/saved/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function nextIteration() {
    if (!id || !proposalId) return;
    setError(null);
    try {
      const next = await startNextIteration(id, proposalId);
      navigate(`/threads/${next.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!thread || !detail) return <p>Loading...</p>;

  const proposal = detail.proposal;
  const uiState = buildConsolidationUiState({
    proposals: [proposal],
    jobs,
    detail,
    proposal,
  });
  const locked = proposal.status === "applied" || proposal.status === "saved" || proposal.status === "rejected";
  const busy = uiState.isRunning;
  const readyForDecision = !locked && !busy && Boolean(body.trim());
  const readyAgents = (room?.roster ?? []).filter((agent) => room?.agents[agent.agent_id]?.ready_at);
  const backendStatusLabel = `Backend ${backendStatus}`;

  return (
    <div className="workspace-root consolidation-review-workspace" style={{ "--sidebar-w": railCollapsed ? "52px" : "340px" } as CSSProperties}>
      <header className="workspace-header" aria-label="outcome review header">
        <Link to={`/threads/${thread.id}`} className="workspace-back" aria-label="Back to thread" title="Back to thread">
          <Icon name="arrowLeft" className="ic" />
        </Link>

        <Link to="/" className="workspace-brand" aria-label="Roundtable home">
          <span className="workspace-brand__dot" data-backend-status={backendStatus} aria-label={backendStatusLabel} title={backendStatusLabel} />
          <span>Roundtable</span>
        </Link>

        <div className="workspace-header__title">
          <div className="workspace-crumbs">
            <Link to="/">threads</Link>
            <span>/</span>
            <Link to={`/threads/${thread.id}`}>thread.md</Link>
            <span>/</span>
            <strong>Discussion outcome</strong>
          </div>
        </div>

        <div className="workspace-header__badges">
          <span className={`status-pill status-pill--${proposal.status}`}>{uiState.label}</span>
          <ThemeToggle />
        </div>
      </header>

      <div className="workspace-body">
        <main className="workspace-main consolidation-review-main" aria-label="discussion outcome review">
          <div className="thread-body-section">
            <section className="source review-source">
              {!uiState.isTerminal ? (
                <div className="outcome-steps">
                  {CONSOLIDATION_STEPS.map((step) => (
                    <span key={step.phase} className="outcome-step" data-active={uiState.phase === step.phase ? "1" : "0"}>
                      {step.label}
                    </span>
                  ))}
                </div>
              ) : null}

              {editing ? (
                <form onSubmit={saveRevision} className="proposal-edit-form">
                  <textarea className="proposal-editor" value={body} onChange={(event) => setBody(event.target.value)} disabled={locked || busy} />
                  <div className="inline-actions">
                    <button type="submit" className="btn primary" disabled={locked || busy || !body.trim()}>
                      Save revision
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setBody(detail.latest_body ?? "");
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="source-body proposal-preview">
                  {body.trim() ? (
                    <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
                  ) : (
                    <p className="empty-state">The draft has not been submitted yet.</p>
                  )}
                </div>
              )}

              <div className="source-foot review-source-foot">
                {!editing ? (
                  <button type="button" className="btn sm ghost" onClick={() => setEditing(true)} disabled={locked || busy || !body.trim()}>
                    Edit draft
                  </button>
                ) : null}
                {busy ? <span className="review-muted">Editing unlocks when the current agent pass finishes.</span> : null}
                <span className="spacer" />
                {locked ? null : (
                  <>
                    <button type="button" className="btn sm primary" onClick={nextIteration} disabled={!readyForDecision}>
                      Create New Thread From This
                    </button>
                    <button type="button" className="btn sm primary" onClick={saveOutput} disabled={!readyForDecision}>
                      Save Output & Close
                    </button>
                    <button type="button" className="btn sm" onClick={reject} disabled={busy}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>

          {error ? (
            <p role="alert" className="review-main-error">
              {error}
            </p>
          ) : null}
        </main>

        <aside className={`workspace-sidebar rail review-rail ${railCollapsed ? "rail--collapsed" : ""}`} aria-label="review context">
          {railCollapsed ? (
            <div className="rail-collapsed-strip">
              <button type="button" className="strip-icon" onClick={() => setRailCollapsed(false)} title="Expand rail">
                <Icon name="chevronL" className="ic-sm" />
              </button>
              <div className="strip-sep" />
              <div className="vlabel">Review</div>
            </div>
          ) : (
            <>
              <div className="rail-head">
                <div className="title">
                  <Icon name="file" className="ic-sm" />
                  Review Notes
                </div>
                <button type="button" className="btn ghost icon" onClick={() => setRailCollapsed(true)} title="Collapse rail">
                  <Icon name="chevronR" className="ic-sm" />
                </button>
              </div>
              <div className="rail-body">
                <RailSection label="Latest review" count={detail.reviews.length} defaultOpen>
                  <div className="review-note review-note--rail">
                    {detail.latest_review_body ? (
                      <Markdown remarkPlugins={[remarkGfm]}>{detail.latest_review_body}</Markdown>
                    ) : (
                      <p className="empty-state">No review yet.</p>
                    )}
                  </div>
                </RailSection>
                <RailSection label="Ask for review" defaultOpen={!locked}>
                  <div className="refine-panel refine-panel--rail">
                    <button type="button" className="btn sm ghost" onClick={() => setAdvancedOpen((value) => !value)}>
                      <Icon name={advancedOpen ? "chevronU" : "chevronD"} className="ic-sm" />
                      Advanced roles
                    </button>
                    {advancedOpen ? (
                      <div className="rail-row two">
                        <div className="rail-mini">
                          <label>Reviewer</label>
                          <select
                            className="rail-input"
                            value={reviewer}
                            onChange={(event) => setReviewer(event.target.value as AgentName)}
                            disabled={locked || busy}
                          >
                            {readyAgents.map((agent) => (
                              <option key={agent.agent_id} value={agent.agent_id}>
                                {agent.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : null}
                    <label className="rail-mini">
                      <span>Review instructions</span>
                      <input
                        className="rail-input"
                        value={reviewInstructions}
                        onChange={(event) => setReviewInstructions(event.target.value)}
                        disabled={locked || busy}
                        placeholder="Optional"
                      />
                    </label>
                    <button type="button" className="btn" onClick={askReview} disabled={locked || busy || !body.trim()}>
                      Ask for review
                    </button>
                    {error ? (
                      <p role="alert" className="room-card__error">
                        {error}
                      </p>
                    ) : null}
                  </div>
                </RailSection>
                <RailSection label="Request revision" defaultOpen={!locked}>
                  <div className="refine-panel refine-panel--rail">
                    {advancedOpen ? (
                      <div className="rail-mini">
                        <label>Reviser</label>
                        <select
                          className="rail-input"
                          value={reviser}
                          onChange={(event) => setReviser(event.target.value as AgentName)}
                          disabled={locked || busy}
                        >
                          {readyAgents.map((agent) => (
                            <option key={agent.agent_id} value={agent.agent_id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <label className="rail-mini">
                      <span>Revision instructions</span>
                      <input
                        className="rail-input"
                        value={revisionInstructions}
                        onChange={(event) => setRevisionInstructions(event.target.value)}
                        disabled={locked || busy}
                        placeholder="What should change?"
                      />
                    </label>
                    <button type="button" className="btn" onClick={askRevision} disabled={locked || busy || !body.trim()}>
                      Request revision
                    </button>
                  </div>
                </RailSection>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
