export type ThreadStatus = 'open' | 'archived'

export interface Thread {
  id: string
  title: string
  status: ThreadStatus
  parent_thread_id: string | null
  created_from_consolidation_id: string | null
  created_at: string
  archived_at: string | null
}

/** A thread plus its markdown body (read from thread.md). */
export interface ThreadDetail extends Thread {
  body: string
}

export type CommentAuthor = 'human' | 'claude' | 'codex' | 'system'

export type CommentType =
  | 'comment'
  | 'proposal'
  | 'critique'
  | 'question'
  | 'decision'

export interface Comment {
  id: string
  thread_id: string
  /** Root discussion comment id. Equals `id` for a top-level discussion point. */
  discussion_id: string
  /** null for a top-level discussion point; otherwise the discussion root id. */
  parent_id: string | null
  author: CommentAuthor
  type: CommentType
  body: string
  origin_discussion_id: string | null
  origin_comment_id: string | null
  /** Pending discussion id this comment was approved from, if any. */
  approved_from_pending_id: string | null
  created_at: string
}

export interface CreateThreadInput {
  title: string
  body: string
}

export interface CreateCommentInput {
  body: string
  type?: CommentType
  /** Id of the comment being replied to. Omit/null for a top-level discussion point. */
  reply_to?: string | null
}

/** An agent-proposed top-level discussion point awaiting human approval. */
export interface PendingDiscussion {
  id: string
  thread_id: string
  author: CommentAuthor
  type: CommentType
  body: string
  origin_discussion_id: string | null
  origin_comment_id: string | null
  created_at: string
}

export interface CreatePendingDiscussionInput {
  author: CommentAuthor
  type?: CommentType
  body: string
  origin_discussion_id?: string | null
  origin_comment_id?: string | null
}

export interface EditPendingDiscussionInput {
  body?: string
  type?: CommentType
}

export type ConsolidationStatus = 'drafting' | 'review' | 'rejected' | 'applied'

export interface ConsolidationProposal {
  id: string
  thread_id: string
  status: ConsolidationStatus
  summary: string | null
  created_at: string
  applied_thread_id: string | null
}

export interface CreateConsolidationInput {
  summary?: string | null
}

/** Metadata for one revision of a consolidation proposal. Body is in a sibling .md file. */
export interface ProposalRevision {
  id: string
  proposal_id: string
  thread_id: string
  author: CommentAuthor
  created_at: string
}

export type ContextItemKind = 'file' | 'url'

export interface FileContextItem {
  id: string
  thread_id: string
  kind: 'file'
  filename: string
  original_name: string
  path: string
  media_type: string | null
  size_bytes: number
  created_at: string
}

export interface UrlContextItem {
  id: string
  thread_id: string
  kind: 'url'
  url: string
  label: string | null
  created_at: string
}

export type ContextItem = FileContextItem | UrlContextItem

export type ProjectSnapshotMode = 'git-tracked' | 'non-git'

export interface SnapshotPreflight {
  source_path: string
  mode: ProjectSnapshotMode
  requires_confirmation: boolean
  file_count: number
  total_bytes: number
  excluded_count: number
  warnings: string[]
}

export interface ProjectSnapshot {
  source_path: string
  mode: ProjectSnapshotMode
  created_at: string
  refreshed_at: string
  file_count: number
  total_bytes: number
  warnings: string[]
  added_since_last_refresh: string[]
}

export interface WorkspaceAddedFile {
  path: string
  size_bytes: number
  modified_at: string
}

export interface ThreadContext {
  items: ContextItem[]
  snapshot: ProjectSnapshot | null
  workspace_added_files: WorkspaceAddedFile[]
}

export interface CreateUrlContextInput {
  url: string
  label?: string | null
}

export interface SnapshotPreflightInput {
  source_path: string
}

export interface CreateProjectSnapshotInput {
  source_path: string
  confirmed?: boolean
}

export type AgentName = 'claude' | 'codex'

export type RoomStatus =
  | 'not_started'
  | 'starting'
  | 'idle'
  | 'running'
  | 'paused'
  | 'turn_limit_reached'
  | 'needs_attention'
  | 'stopped'
  | 'error'

export interface RoomAgentState {
  ready_at: string | null
}

export type AutoDiscussionStatus =
  | 'running'
  | 'paused'
  | 'turn_limit_reached'

export interface AutoDiscussionState {
  run_id: string
  status: AutoDiscussionStatus
  total_turns: number
  completed_turns: number
  remaining_turns: number
  next_agent: AgentName
  allow_direct_roots: boolean
  pause_requested: boolean
  started_at: string
  updated_at: string
  ended_at: string | null
}

export interface AgentInputPrompt {
  agent: AgentName
  excerpt: string
  detected_at: string
}

export interface AgentRoom {
  thread_id: string
  status: RoomStatus
  tmux_session: string
  attach_command: string
  claude_model: string | null
  codex_model: string | null
  agents: Record<AgentName, RoomAgentState>
  created_at: string
  updated_at: string
  started_at: string | null
  stopped_at: string | null
  last_error: string | null
  active_job_id: string | null
  auto: AutoDiscussionState | null
  input_prompt: AgentInputPrompt | null
}

export interface RoomToolPreflight {
  name: 'tmux' | 'claude' | 'codex'
  available: boolean
  path: string | null
  version: string | null
  error: string | null
}

export interface RoomPreflight {
  ok: boolean
  tools: Record<'tmux' | 'claude' | 'codex', RoomToolPreflight>
}

export interface StartRoomInput {
  claude_model?: string | null
  codex_model?: string | null
}

export interface NudgeRoomInput {
  agent: AgentName
  body?: string | null
}

export interface ReadyInput {
  agent: AgentName
}

export type AgentTurnScope = 'thread' | 'discussion'

export interface AskAgentInput {
  agent: AgentName
  body?: string | null
  discussion_id?: string | null
}

export interface StartAutoDiscussionInput {
  turn_count: number
  allow_direct_roots?: boolean
}

export interface ExtendAutoDiscussionInput {
  turn_count: number
}

export interface SendRoomInputResponseInput {
  agent: AgentName
  response: 'yes' | 'no'
}

export interface AgentTurn {
  id: string
  thread_id: string
  agent: AgentName
  kind: 'comment'
  scope: AgentTurnScope
  discussion_id: string | null
  instructions: string | null
  allow_direct_roots: boolean
  pending_roots_only: boolean
  auto_run_id: string | null
  auto_turn_index: number | null
  created_at: string
  timeout_at: string
}

export type BoundedJobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'skipped'

export interface BoundedJob {
  id: string
  thread_id: string
  kind: 'agent_turn'
  status: BoundedJobStatus
  agent: AgentName
  started_at: string
  timeout_at: string
  completed_at: string | null
  logs: string[]
  result: { comment_id: string } | { pending_discussion_id: string } | null
  failure_reason: string | null
  turn: AgentTurn
}

export interface HelperCommentInput {
  turn_id: string
  agent: AgentName
  body: string
  type?: CommentType
  discussion_id?: string | null
}

export interface HelperPendingDiscussionInput {
  turn_id: string
  agent: AgentName
  body: string
  type?: CommentType
  origin_discussion_id?: string | null
  origin_comment_id?: string | null
}
