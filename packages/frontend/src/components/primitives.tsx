// Shared visual primitives — faithful port of the design mockup.
// Icon SVG set, colored-initial Avatar, AgentTag, AgentStack, StatusPill, TypeBadge.

import type { CSSProperties, ReactNode } from 'react'
import type { Agent, CommentType, ThreadAgentInvite, ThreadDisplayStatus } from '@roundtable/shared'

// ── Agent identity ────────────────────────────────────────────────
interface AgentMeta {
  label: string
  color: string
  initial: string
}

const AGENTS: Record<string, AgentMeta> = {
  claude: { label: 'claude', color: 'claude', initial: 'C' },
  codex: { label: 'codex', color: 'codex', initial: 'X' },
  human: { label: 'you', color: 'human', initial: 'H' },
  system: { label: 'system', color: 'system', initial: 'S' },
}

function agentMeta(author: string, agent?: Pick<Agent, 'name' | 'color'> | Pick<ThreadAgentInvite, 'name' | 'color'>): AgentMeta {
  if (agent) return { label: agent.name, color: agent.color, initial: agent.name.charAt(0).toUpperCase() }
  return AGENTS[author] ?? AGENTS.human
}

// ── Icon ──────────────────────────────────────────────────────────
const ICON_PATHS: Record<string, ReactNode> = {
  arrowLeft: <path d="M11 2 4 8l7 6" />,
  arrowRight: <path d="M5 2l7 6-7 6" />,
  chevronD: <path d="M3 6l5 4 5-4" />,
  chevronR: <path d="M6 3l4 5-4 5" />,
  chevronU: <path d="M3 10l5-4 5 4" />,
  chevronL: <path d="M10 3 6 8l4 5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  play: <path d="M4 3v10l9-5z" fill="currentColor" stroke="none" />,
  stop: <rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="4" y="3" width="3" height="10" fill="currentColor" stroke="none" />
      <rect x="9" y="3" width="3" height="10" fill="currentColor" stroke="none" />
    </>
  ),
  send: <path d="m2 8 12-5-4 12-3-5-5-2z" />,
  spark: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" />,
  reply: <path d="M6 4 3 7l3 3M3 7h6a4 4 0 0 1 4 4v1" />,
  link: <path d="M7 4H5a3 3 0 0 0 0 6h2M9 12h2a3 3 0 0 0 0-6H9M6 8h4" />,
  paperclip: <path d="M11 5 6 10a2 2 0 1 0 3 3l5-5a4 4 0 0 0-6-6L3 7a6 6 0 0 0 9 9" />,
  file: (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </>
  ),
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <path d="m3 12 3-3 3 3 2-2 3 2" />
    </>
  ),
  quote: <path d="M5 4c-1 1-2 2-2 4v3h3V8H4M11 4c-1 1-2 2-2 4v3h3V8h-2" />,
  collapse: <path d="M3 7h10M5 4l3 3 3-3M5 12l3-3 3 3" />,
  expand: <path d="M5 6 8 3l3 3M5 10l3 3 3-3" />,
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" />
      <path d="M3 6v7h10V6M6 9h4" />
    </>
  ),
  dot: <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 4 4" />
    </>
  ),
  filter: <path d="M2 4h12M4 8h8M6 12h4" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
    </>
  ),
  moon: <path d="M12 9.5A5.5 5.5 0 1 1 6.5 4a4.5 4.5 0 0 0 5.5 5.5z" />,
  bell: (
    <>
      <path d="M4 11h8l-1-2V7a3 3 0 0 0-6 0v2zM6 13a2 2 0 0 0 4 0" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="m5 7 2 1.5L5 10M8 10h3" />
    </>
  ),
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" />,
  more: (
    <>
      <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  flag: <path d="M4 2v12M4 3h8l-2 3 2 3H4" />,
  check: <path d="m3 8 3 3 7-7" />,
  minus: <path d="M3 8h10" />,
  trash: (
    <>
      <path d="M3 4h10M6 4V2.5h4V4M5 6v7M8 6v7M11 6v7" />
      <path d="M4 4l1 10h6l1-10" />
    </>
  ),
}

export type IconName = keyof typeof ICON_PATHS

export function Icon({ name, className = 'ic' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

// ── Avatar (colored square initial) ───────────────────────────────
export function Avatar({ author, agent, size = 22, isWorking = false }: { author: string; agent?: Pick<Agent, 'name' | 'color'> | Pick<ThreadAgentInvite, 'name' | 'color'>; size?: number; isWorking?: boolean }) {
  const meta = agentMeta(author, agent)
  return (
    <span
      className={`avatar avatar-${meta.color}${isWorking ? ' is-working' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      {meta.initial}
    </span>
  )
}

// ── Agent tag (colored dot + label) ───────────────────────────────
export function AgentTag({ author, agent, label }: { author: string; agent?: Pick<Agent, 'name' | 'color'> | Pick<ThreadAgentInvite, 'name' | 'color'>; label?: string }) {
  const meta = agentMeta(author, agent)
  return (
    <span className={`agent-tag agent-${meta.color}`}>
      <span className="agent-tag-dot" />
      {label ?? meta.label}
    </span>
  )
}

// ── Overlapping stack of avatars ──────────────────────────────────
export function AgentStack({ agents, size = 18 }: { agents: string[]; size?: number }) {
  return (
    <span className="agent-stack" style={{ '--av-size': `${size}px` } as CSSProperties}>
      {agents.map((a) => (
        <Avatar key={a} author={a} size={size} />
      ))}
    </span>
  )
}

// ── Status pill (with pulsing dot for live states) ────────────────
const PILL_CLASS: Record<ThreadDisplayStatus, string> = {
  setup: 'setup',
  discussing: 'discussing',
  consolidating: 'consolidating',
  needs_attention: 'needs-attention',
  error: 'error',
  closed: 'closed',
  archived: 'archived',
}

const PILL_LABEL: Record<ThreadDisplayStatus, string> = {
  setup: 'Setup',
  discussing: 'Discussing',
  consolidating: 'Consolidating',
  needs_attention: 'Needs attention',
  error: 'Error',
  closed: 'Closed',
  archived: 'Archived',
}

export function StatusPill({
  status,
  label,
  pendingCount = 0,
}: {
  status: ThreadDisplayStatus
  label?: string
  pendingCount?: number
}) {
  const live = status === 'discussing' || status === 'consolidating'
  const showSuffix =
    pendingCount > 0 && status !== 'needs_attention' && status !== 'error'
  return (
    <span className={`pill ${PILL_CLASS[status]}`}>
      {live ? <span className="pdot" /> : null}
      {label ?? PILL_LABEL[status]}
      {showSuffix ? <span className="pill-suffix"> · {pendingCount} pending</span> : null}
    </span>
  )
}

// ── Type badge ────────────────────────────────────────────────────
export function TypeBadge({ type }: { type: CommentType }) {
  if (!type || type === 'comment') return null
  return <span className={`type-badge type-${type}`}>{type}</span>
}
