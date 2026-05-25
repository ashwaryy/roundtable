export type ThreadStatus = 'open' | 'archived' | 'closed'

export type ThreadDisplayStatus =
  | 'setup'
  | 'discussing'
  | 'consolidating'
  | 'needs_attention'
  | 'error'
  | 'closed'
  | 'archived'

export interface Thread {
  id: string
  title: string
  status: ThreadStatus
  parent_thread_id: string | null
  created_from_consolidation_id: string | null
  created_at: string
  archived_at: string | null
  closed_at: string | null
}

export interface ThreadListItem extends Thread {
  display_status: ThreadDisplayStatus
  pending_count: number
  recovery_action_label: string | null
}

/** A thread plus its markdown body (read from thread.md). */
export interface ThreadDetail extends Thread {
  body: string
}

export type AgentId = string
export type AgentRuntime = 'claude' | 'codex'
export type AgentColorPreset =
  | 'blue'
  | 'green'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'teal'

export interface Agent {
  id: AgentId
  name: string
  runtime: AgentRuntime
  role_description: string
  instructions: string
  model: string | null
  effort: string | null
  color: AgentColorPreset
  logo_url: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export interface ThreadAgentInvite {
  agent_id: AgentId
  name: string
  runtime: AgentRuntime
  role_description: string
  instructions: string
  model: string | null
  effort: string | null
  color: AgentColorPreset
  logo_url: string | null
  order: number
}

export interface CreateAgentInput {
  name: string
  runtime: AgentRuntime
  role_description?: string
  instructions?: string
  model?: string | null
  effort?: string | null
  color?: AgentColorPreset
  logo_url?: string | null
}

export type UpdateAgentInput = Partial<CreateAgentInput> & {
  archived?: boolean
}

export interface InviteAgentInput {
  agent_id: AgentId
  model?: string | null
  effort?: string | null
}

export interface UpdateThreadAgentInviteInput {
  model?: string | null
  effort?: string | null
}

export interface ReorderThreadAgentsInput {
  agent_ids: AgentId[]
}

export type CommentAuthor = 'human' | 'system' | AgentId

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
  agent_ids?: AgentId[]
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

export type ConsolidationStatus =
  | 'drafting'
  | 'review'
  | 'rejected'
  | 'applied'
  | 'saved'

export interface ConsolidationProposal {
  id: string
  thread_id: string
  status: ConsolidationStatus
  summary: string | null
  instructions: string | null
  drafter_agent: AgentName
  reviewer_agent: AgentName
  reviser_agent: AgentName
  created_at: string
  updated_at: string
  applied_thread_id: string | null
  saved_artifact_id: string | null
}

export interface CreateConsolidationInput {
  summary?: string | null
  instructions?: string | null
  drafter_agent?: AgentName
  reviewer_agent?: AgentName
  reviser_agent?: AgentName
}

/** Metadata for one revision of a consolidation proposal. Body is in a sibling .md file. */
export interface ProposalRevision {
  id: string
  proposal_id: string
  thread_id: string
  author: CommentAuthor
  created_at: string
}

/** Metadata for one agent review. Body is in a sibling .md file. */
export interface ProposalReview {
  id: string
  proposal_id: string
  thread_id: string
  author: AgentName
  revision_id: string | null
  created_at: string
}

export interface ConsolidationDetail {
  proposal: ConsolidationProposal
  revisions: ProposalRevision[]
  latest_body: string | null
  reviews: ProposalReview[]
  latest_review_body: string | null
}

export interface CreateProposalRevisionInput {
  body: string
}

export interface StartConsolidationInput extends CreateConsolidationInput {}

export interface RequestProposalRevisionInput {
  instructions?: string | null
  reviewer_agent?: AgentName
  reviser_agent?: AgentName
}

export interface RequestProposalReviewInput {
  instructions?: string | null
  reviewer_agent?: AgentName
}

export interface SavedConsolidation {
  id: string
  source_thread_id: string
  proposal_id: string
  title: string
  body_path: string
  created_at: string
}

export interface SavedOutput extends SavedConsolidation {
  body: string
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

export type ProjectSnapshotMode = 'folder' | 'git-tracked' | 'non-git'

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
  latest_report_id: string | null
}

export interface SnapshotReport {
  id: string
  thread_id: string
  created_at: string
  mode: ProjectSnapshotMode
  file_count: number
  total_bytes: number
  warnings: string[]
  added_paths: string[]
  modified_paths: string[]
  removed_paths: string[]
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

/** @deprecated Prefer AgentId. Retained as an API-compatible alias. */
export type AgentName = AgentId

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

export type RoomSessionState =
  | 'not_started'
  | 'connected'
  | 'recovered'
  | 'missing'
  | 'untracked'
  | 'stopped'

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
  next_agent: AgentId
  allow_direct_roots: boolean
  pause_requested: boolean
  started_at: string
  updated_at: string
  ended_at: string | null
}

export interface AgentInputPrompt {
  agent: AgentId
  excerpt: string
  detected_at: string
}

export interface IdleSuggestionRequest {
  agent: AgentId
  instructions: string | null
  status: 'active' | 'done'
  submitted_count: number
  requested_at: string
  completed_at: string | null
}

export interface AgentRoom {
  thread_id: string
  status: RoomStatus
  tmux_session: string
  attach_command: string
  claude_model?: string | null
  codex_model?: string | null
  roster: ThreadAgentInvite[]
  agents: Record<AgentId, RoomAgentState>
  created_at: string
  updated_at: string
  started_at: string | null
  stopped_at: string | null
  last_error: string | null
  active_job_id: string | null
  auto: AutoDiscussionState | null
  input_prompt: AgentInputPrompt | null
  idle_suggestion_request: IdleSuggestionRequest | null
  session_state: RoomSessionState
}

export type IntegrityIssueKind = 'added' | 'modified' | 'deleted' | 'invalid'

export interface IntegrityIssue {
  kind: IntegrityIssueKind
  path: string
  message: string
  detected_at: string
}

export interface IntegrityReport {
  thread_id: string
  checked_at: string
  acknowledged_at: string | null
  issues: IntegrityIssue[]
}

export interface RoomToolPreflight {
  name: 'tmux' | AgentRuntime
  available: boolean
  path: string | null
  version: string | null
  error: string | null
}

export interface RoomPreflight {
  ok: boolean
  tools: Record<'tmux' | 'claude' | 'codex', RoomToolPreflight>
}

export type SystemPromptRuntime = 'common' | AgentRuntime
export type SystemPromptKind = 'startup_prompt' | 'turn_prompt' | 'runtime_config' | 'runtime_rules' | 'launch_command'

export interface SystemPromptSection {
  id: string
  title: string
  runtime: SystemPromptRuntime
  kind: SystemPromptKind
  used_by: string
  source: string
  notes: string[]
  content: string
}

export interface StartRoomInput {
  /** Legacy built-in override fields; roster APIs are preferred. */
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

export interface RequestIdleSuggestionInput {
  agent: AgentName
  body?: string | null
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
  kind: 'comment' | 'proposal_draft' | 'proposal_review' | 'proposal_revision'
  scope: AgentTurnScope
  discussion_id: string | null
  instructions: string | null
  proposal_id: string | null
  revision_id: string | null
  review_id: string | null
  auto_revision_after_review: boolean
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
  result:
    | { comment_id: string }
    | { pending_discussion_id: string }
    | { proposal_id: string; revision_id: string }
    | { proposal_id: string; review_id: string }
    | { applied_thread_id: string }
    | { saved_artifact_id: string }
    | null
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
  turn_id?: string
  agent: AgentName
  body: string
  type?: CommentType
  origin_discussion_id?: string | null
  origin_comment_id?: string | null
  continue_turn?: boolean
}

export interface HelperProposalInput {
  turn_id: string
  agent: AgentName
  body: string
}

export interface HelperReviewInput {
  turn_id: string
  agent: AgentName
  body: string
}
