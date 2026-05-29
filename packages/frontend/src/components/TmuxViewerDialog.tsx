import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { type TmuxPaneInput, type TmuxPaneInputKey, type TmuxPaneSnapshot } from "@roundtable/shared";
import { Icon } from "./primitives";

export const TMUX_VIEW_POLL_MS = 1000;

const TMUX_INPUT_KEYS: Array<{ key: TmuxPaneInputKey; label: string }> = [
  { key: "Enter", label: "Enter" },
  { key: "Escape", label: "Esc" },
  { key: "Tab", label: "Tab" },
  { key: "Backspace", label: "Backspace" },
  { key: "ArrowUp", label: "Up" },
  { key: "ArrowDown", label: "Down" },
  { key: "ArrowLeft", label: "Left" },
  { key: "ArrowRight", label: "Right" },
  { key: "CtrlC", label: "Ctrl+C" },
  { key: "CtrlD", label: "Ctrl+D" },
  { key: "CtrlL", label: "Ctrl+L" },
  { key: "CtrlU", label: "Ctrl+U" },
];

export function TmuxViewerDialog({
  open,
  agents,
  selectedAgent,
  snapshot,
  loading,
  stale,
  error,
  sendingInput,
  onClose,
  onSelectAgent,
  onSendInput,
}: {
  open: boolean;
  agents: Array<{ agent_id: string; name: string }>;
  selectedAgent: string | null;
  snapshot: TmuxPaneSnapshot | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  sendingInput: boolean;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
  onSendInput: (input: TmuxPaneInput) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [inputMode, setInputMode] = useState(false);
  const [inputText, setInputText] = useState("");
  const selected = agents.find((agent) => agent.agent_id === selectedAgent) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !stickToBottomRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [snapshot?.captured_at, selectedAgent]);

  async function sendKey(key: TmuxPaneInputKey) {
    try {
      await onSendInput({ type: "key", key });
    } catch {
      // The parent renders the send error in the viewer alert.
    }
  }

  async function sendText(event: FormEvent) {
    event.preventDefault();
    if (!inputText) return;
    try {
      await onSendInput({ type: "text", text: inputText });
      setInputText("");
    } catch {
      // Keep the text in place so the user can retry or edit it.
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel tmux-viewer-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Agent tmux viewer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 className="h-2">Agent Output</h2>
            <p className="tmux-viewer-sub">{selected ? selected.name : "No active agent view"} · read-only tmux snapshot</p>
          </div>
          <button className="btn icon" type="button" aria-label="Close tmux viewer" onClick={onClose}>
            <Icon name="close" className="ic-sm" />
          </button>
        </div>

        {agents.length > 0 ? (
          <div className="tmux-viewer-tabs" role="tablist" aria-label="Viewable agents">
            {agents.map((agent) => (
              <button
                key={agent.agent_id}
                type="button"
                className={`tmux-viewer-tab${selectedAgent === agent.agent_id ? " is-active" : ""}`}
                onClick={() => onSelectAgent(agent.agent_id)}
              >
                {agent.name}
              </button>
            ))}
          </div>
        ) : null}

        {loading && !snapshot ? (
          <div className="tmux-viewer-meta tmux-viewer-meta--loading" aria-hidden="true">
            <span className="sk tmux-viewer-meta-skeleton tmux-viewer-meta-skeleton--status" />
            <span className="sk tmux-viewer-meta-skeleton tmux-viewer-meta-skeleton--time" />
          </div>
        ) : (
          <div className="tmux-viewer-meta">
            <span>
              {stale ? "Updates paused" : "Live"} · refreshes every {Math.round(TMUX_VIEW_POLL_MS / 1000)}s
            </span>
            <span className="mono">
              {snapshot?.captured_at
                ? new Date(snapshot.captured_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "No snapshot"}
            </span>
          </div>
        )}

        <div className="tmux-viewer-input-head">
          <button
            type="button"
            className={`btn sm${inputMode ? " primary" : ""}`}
            aria-pressed={inputMode}
            disabled={!selectedAgent}
            onClick={() => setInputMode((value) => !value)}
          >
            <Icon name="terminal" className="ic-sm" />
            Input mode
          </button>
          <span>{inputMode ? "Use buttons below to send input to the selected tmux pane." : "Input is off."}</span>
        </div>

        {inputMode ? (
          <div className="tmux-viewer-input-panel">
            <div className="tmux-viewer-key-grid" aria-label="Tmux input keys">
              {TMUX_INPUT_KEYS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="tmux-viewer-key"
                  disabled={!selectedAgent || sendingInput}
                  onClick={() => void sendKey(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <form className="tmux-viewer-text-row" onSubmit={sendText}>
              <input
                className="rail-input"
                aria-label="Literal tmux text"
                value={inputText}
                maxLength={500}
                disabled={!selectedAgent || sendingInput}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="Literal text to send..."
              />
              <button type="submit" className="btn sm" disabled={!selectedAgent || sendingInput || !inputText}>
                Send text
              </button>
            </form>
          </div>
        ) : null}

        {error ? (
          <p className="tmux-viewer-alert" role="alert">
            {error}
          </p>
        ) : null}

        {loading && !snapshot ? (
          <div className="tmux-viewer-note tmux-viewer-note--loading" aria-hidden="true">
            <span className="sk tmux-viewer-note-skeleton tmux-viewer-note-skeleton--full" />
            <span className="sk tmux-viewer-note-skeleton tmux-viewer-note-skeleton--mid" />
          </div>
        ) : snapshot?.truncated ? (
          <p className="tmux-viewer-note">Showing the most recent 200 lines of pane history.</p>
        ) : null}

        <div
          ref={scrollRef}
          className="tmux-viewer-frame"
          onScroll={(event) => {
            const node = event.currentTarget;
            stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          }}
        >
          {loading && !snapshot ? (
            <div className="tmux-viewer-skeleton" aria-hidden="true">
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--wide" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--short" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--wide" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--short" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--wide" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--short" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--wide" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--short" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--wide" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--short" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--full" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--wide" />
              <span className="sk tmux-viewer-skeleton__line tmux-viewer-skeleton__line--mid" />
            </div>
          ) : (
            <pre className="tmux-viewer-pre">{snapshot?.text || "No tmux output available."}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
