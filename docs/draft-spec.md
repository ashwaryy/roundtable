# Product Spec: Roundtable

## 1. Concept

Roundtable is a local browser-based forum where the user, Claude Code, and Codex CLI discuss a source thread.

The thread is the source artifact. Discussion happens around it as forum-style discussion points and replies. Claude and Codex do not directly mutate the thread. When the user decides the discussion is useful, they click **Consolidate**. The agents turn the current thread plus approved discussion into a proposed derived thread. The user reviews, edits if needed, and applies or rejects it.

Applying a consolidation does not rewrite the old thread in place. It archives the old thread, stops its agent room, and creates a new derived thread seeded from the approved proposal.

The product should feel like:

```txt
Social/forum thread + AI commenters + controlled update flow
```

Not like:

```txt
chatbot randomly editing a document
```

## 2. Core Model

```txt
Thread = source artifact
Discussion points = approved comments around the source
Pending discussion points = agent-suggested roots waiting for human approval
Consolidation = proposed derived thread
Apply = archive old thread and create new thread
```

The thread body is stored as Markdown. Agents and humans discuss it, but the body does not change during discussion.

## 3. Primary User Flow

### Create Thread

The user creates a thread with:

```txt
Title
Body / plan / idea / task
Optional attachments
Optional project snapshot
```

Thread creation is body-first. The user can start with only a title and body, then add attachments or a project snapshot later.

Example:

```txt
Title: Improve TTS queue architecture
Body: I want a queue system that supports cancellation, retries, and app restart recovery.
```

### Add Context

The user can add:

```txt
Local files and images
URLs
Optional read-only project snapshot
```

Local attachments are copied into the thread workspace. URLs are stored as links only. Roundtable does not fetch or archive URL contents in v1.

Project access is read-only through a snapshot, not through the live project directory. Agents run inside the thread workspace, where attachments and the project snapshot are available as files.

### Start Agent Room

The user starts a Claude + Codex room for a thread.

Before launch, the user can choose the startup model for each agent:

```txt
Claude model
Codex model
```

Roundtable passes those choices to the CLIs at startup:

```bash
claude --model <alias-or-model-name>
codex --model <model-name>
```

The app should also support each CLI's default model by leaving the model unset.

Each active thread gets one tmux session:

```txt
roundtable-thread-123
  pane 0: Claude Code
  pane 1: Codex CLI
```

The room contains exactly one Claude Code session and one Codex CLI session while active. Multiple threads may have live rooms at the same time.

Both agents are initialized with the same core rules:

```txt
Read thread.md and the approved discussion.
Use Roundtable helper commands to submit comments and proposals.
Do not edit canonical Roundtable files directly.
Do not edit project files.
Wait for nudges.
Consolidation only happens when the user asks.
```

Room startup includes a readiness handshake. After boot instructions are sent, each agent must acknowledge that it is ready by calling the Roundtable helper:

```bash
roundtable ready --agent claude
roundtable ready --agent codex
```

The room stays in `starting` until both helper calls succeed. Ask, auto-discussion, and discussion-level agent controls are disabled until the room is `idle`.

### Discuss

The user can:

```txt
Add a top-level human discussion point
Reply inline to an existing discussion
Ask Claude
Ask Codex
Let them discuss for N turns
Pause auto mode
Stop the room
Approve, edit, or reject pending agent discussion points
```

The browser renders discussion like a forum:

```txt
Thread source body
Discussion point A
  Reply
  Reply
Discussion point B
  Reply
```

Top-level comments create discussion points. Replies are one level deep. If a user or agent replies to a reply, the new comment is stored as a direct child of the discussion root.

### Ask Agents

Thread-level **Ask Claude** or **Ask Codex** allows the selected agent to create a new top-level discussion point directly.

Discussion-level **Ask Claude** or **Ask Codex** asks the selected agent to reply in that discussion. If the agent thinks the idea should split into a separate discussion, it submits a pending discussion point for human approval instead of creating it directly.

### Let Them Discuss

Auto mode runs a fixed number of turns.

```txt
Claude -> Codex -> Claude -> Codex ...
```

Only one agent turn runs at a time per room. Different thread rooms may run independently.

During auto mode, agents see the whole current thread and approved discussions. They may choose which existing discussion to reply to. By default, agents cannot create new top-level discussion points directly during auto mode; they submit pending discussion points to a queue. When starting auto mode, the user may enable a per-run bypass that allows agents to create new top-level discussion points directly.

The goal of auto mode is to improve the main thread. Consensus is useful but secondary. Agents may suggest that the thread is ready for consolidation, but only the user can trigger consolidation.

When the fixed turn limit is reached, the UI offers:

```txt
Extend
Consolidate
Stop
```

### Consolidate

Consolidation is a bounded job launched from canonical thread state, not a continuation of the live discussion room. It does not require the thread's Claude + Codex room to be running.

If a room is active, Roundtable pauses auto mode and serializes against any in-progress turn before starting the consolidation sequence. Live room memory, terminal scrollback, and tmux state are not consolidation inputs unless they have already been captured in approved discussion.

When the user clicks **Consolidate**, Roundtable consolidates:

```txt
Current thread.md
All approved discussion points and replies
Approved attachments and snapshot metadata
Optional user consolidation instructions
```

Pending discussion points are ignored until approved.

The default consolidation sequence is:

```txt
1. Roundtable starts fresh bounded agent invocations for consolidation.
2. The configured drafter agent drafts a proposed derived thread.
3. The configured reviewer agent reviews the draft.
4. The configured reviser agent performs one automatic revision using the review.
5. User reviews the proposal.
6. User can edit, request more revision, apply, or reject.
```

The default drafter, reviewer, and reviser assignments are user/workflow configurable. The review page lets the user edit the proposed body. Human edits are stored as proposal revisions. The user can request additional revisions with instructions and can optionally request re-review from the configured reviewer.

### Apply or Reject

**Apply**:

```txt
1. Saves the latest proposal revision as a new derived thread.
2. Archives the old thread.
3. Stops the old thread's tmux room.
4. Links the new thread to the old thread through metadata.
5. Shows the new thread without auto-starting a room.
```

The derived thread uses the same title by default. Provenance stays in metadata and history UI, not in the new `thread.md` body.

**Reject** marks the proposal rejected, keeps the current thread open, and allows more discussion or a new consolidation.

## 4. Main Product Objects

### Thread

Stored in `thread.json`.

```json
{
  "id": "thread-123",
  "title": "Improve TTS queue architecture",
  "status": "open",
  "parent_thread_id": null,
  "created_from_consolidation_id": null,
  "created_at": "2026-05-23T00:00:00Z",
  "archived_at": null
}
```

Thread statuses:

```txt
open
archived
```

The canonical thread body lives in `thread.md`, not inside `thread.json`.

### Comment

Approved comments are stored as JSONL in `comments.jsonl`.

```json
{
  "id": "c001",
  "thread_id": "thread-123",
  "discussion_id": "c001",
  "parent_id": null,
  "author": "human",
  "type": "comment",
  "body": "We need cancellation semantics before retry policy.",
  "origin_discussion_id": null,
  "origin_comment_id": null,
  "created_at": "2026-05-23T00:00:00Z"
}
```

Rules:

```txt
parent_id = null means this comment is a top-level discussion point.
discussion_id points to the root discussion comment.
Replies are always direct children of the discussion root.
origin_* fields preserve split-from provenance when a pending agent root is approved.
```

Allowed authors:

```txt
human
claude
codex
system
```

Allowed comment types:

```txt
comment
proposal
critique
question
decision
```

Authors suggest the comment type. The backend validates it and defaults human comments to `comment`.

### Pending Discussion

Agent-proposed top-level discussion points that require approval are stored separately in `pending-discussions.jsonl`.

```json
{
  "id": "pd001",
  "thread_id": "thread-123",
  "author": "codex",
  "type": "critique",
  "body": "This should probably split into a separate discussion about restart recovery.",
  "origin_discussion_id": "c001",
  "origin_comment_id": "c004",
  "created_at": "2026-05-23T00:00:00Z"
}
```

The UI shows pending discussion points in a queue with:

```txt
Approve
Edit
Reject
```

Approved pending discussion points are copied into `comments.jsonl` as top-level discussion roots. Rejected pending points remain out of the canonical discussion.

### Consolidation Proposal

Stored as app-owned proposal metadata plus revisions.

```json
{
  "id": "consolidation-001",
  "thread_id": "thread-123",
  "status": "review",
  "summary": "Clarified cancellation, retries, and restart recovery.",
  "created_at": "2026-05-23T00:00:00Z",
  "applied_thread_id": null
}
```

Proposal statuses:

```txt
drafting
review
rejected
applied
```

Proposal revisions may be authored by an agent or the human. Agent reviews are stored with the proposal but do not become the proposed body.

## 5. File Structure

Roundtable stores workspaces in an app data directory by default:

```txt
~/.roundtable/
  threads/
    thread-123/
      thread.json
      thread.md
      comments.jsonl
      pending-discussions.jsonl
      attachments/
      project-snapshot/
      snapshot-history/
      consolidations/
        consolidation-001/
          proposal.json
          revisions/
            r001.md
            r002.md
          reviews/
            codex-001.md
      .roundtable/
        current-turn.json
        room.json
```

User projects are not polluted with Roundtable state.

## 6. Project Snapshots and Attachments

### Attachments

Local file and image attachments are copied into:

```txt
attachments/
```

URLs are stored as links in the thread body or metadata. Roundtable does not fetch or snapshot URL contents in v1. Whether agents can open URLs depends on the user's CLI permissions and environment.

If the user manually copies files into the thread workspace later, Roundtable detects and lists them. The next agent nudge mentions newly added files so the agent can inspect them if relevant.

### Project Snapshot

Project access is read-only through a snapshot:

```txt
project-snapshot/
```

For git repositories, the default snapshot includes git-tracked text/source files and excludes:

```txt
.git/
dependency directories
build outputs
binary files
common generated artifacts
.env* and common secret/key/certificate files
untracked files
```

For non-git folders, Roundtable asks before snapshotting all eligible files.

There are no hard file-count or file-size limits in the product spec. If the snapshot appears very large, Roundtable warns the user and asks for confirmation instead of silently truncating.

Snapshots can be refreshed manually. `project-snapshot/` points to the latest snapshot revision. Older snapshot metadata may be retained for history.

The user can also skip project snapshots entirely and bootstrap a thread from `thread.md`, then add files manually later.

## 7. Agent Room and Turn Architecture

Roundtable is a TypeScript/React/Node local app. The v1 target is macOS/Linux with a runner abstraction that initially uses tmux. Windows support is a later WSL-backed runner path.

Claude Code and Codex CLI are bring-your-own authenticated CLIs. Roundtable performs preflight checks and shows actionable missing-tool errors.

### Model Selection

Roundtable stores optional per-agent model choices on the room configuration:

```json
{
  "claude_model": "sonnet",
  "codex_model": "gpt-5.5"
}
```

If a value is unset, Roundtable starts that CLI without a model flag and lets the CLI use its configured default.

At room startup:

```bash
claude --model <claude_model>
codex --model <codex_model>
```

Claude model values may be aliases or full model names supported by Claude Code. Codex model values must be valid Codex CLI model identifiers. Roundtable should not hard-code the model list as a permanent truth; it should keep user-editable values and may provide docs-backed defaults.

Agents run with the thread workspace as their working directory.

```txt
cwd = ~/.roundtable/threads/thread-123/
```

The backend owns canonical state. The browser UI and agent helpers both call backend APIs. Agents do not edit canonical files directly.

### Helper Commands

Agents submit state through helper commands:

```bash
roundtable ready --agent claude
roundtable ready --agent codex
roundtable comment --body-file .roundtable/tmp/comment.md --type critique
roundtable proposal --body-file .roundtable/tmp/proposal.md
```

Long Markdown bodies are passed by file to avoid shell quoting problems.

`roundtable ready` is the canonical startup acknowledgment. The agent may also print `READY` in the terminal for debugging, but terminal output is not used as the source of truth for readiness.

Roundtable launches each agent process with hidden session context, such as backend URL and session token. Dynamic turn context lives in:

```txt
.roundtable/current-turn.json
```

The current-turn file records:

```txt
turn id
target agent
suggested discussion id
whether new agent roots are allowed directly
whether new roots must go to pending queue
turn kind: comment, proposal draft, review, revision
```

When a helper command succeeds, the backend marks the turn complete. There are no `.agent_status/*.done` files in the core design.

### Orchestrator Responsibilities

The orchestrator is deliberately narrow.

It does:

```txt
- create and reconnect tmux sessions
- start Claude/Codex panes
- send nudges
- write current-turn context
- accept helper submissions
- validate schema/status transitions
- append canonical comments/proposals atomically
- prevent simultaneous turns inside one room
- stop after max auto-mode turns
- launch bounded consolidation jobs from canonical state
- pause or serialize active room turns before consolidation
- track room and proposal status
```

It does not:

```txt
- own agent reasoning
- rewrite agent comments semantically
- judge whether proposals are good
- let agents apply consolidations
- edit project files
```

Validation means structural validation only:

```txt
required fields exist
IDs/timestamps are app-generated
comment type is allowed
target thread and turn match current state
proposal status transition is legal
body is non-empty
canonical writes are atomic
```

## 8. Room Lifecycle and Failure Handling

Room statuses:

```txt
stopped
starting
idle
running
paused
needs_attention
```

On app startup, Roundtable discovers existing `roundtable-*` tmux sessions and reconnects room status to thread records when possible.

**Pause** stops scheduling new auto-mode turns and lets the current turn finish.

**Stop room** terminates the tmux session for the thread. Thread files and discussion remain.

Stopping a room does not prevent consolidation. Consolidation can still run from canonical files and starts its own bounded agent invocations for draft, review, and revision using the configured consolidation roles.

If an agent does not submit a valid turn before timeout, the room enters `needs_attention`. The UI offers:

```txt
Retry
Skip
Show tmux attach command
```

The UI does not embed terminal panes in v1. It shows the command needed to attach to the relevant tmux session for debugging.

## 9. Browser UI

### Thread Page

Main area:

```txt
Thread title
Current thread.md body
Top-level human comment box
Discussion points with one-level replies
Inline reply boxes
Pending discussion queue indicator
```

Sidebar:

```txt
Thread status
Room status
Selected Claude model
Selected Codex model
Attachment and snapshot status
Pending discussion queue
Buttons:
- Ask Claude
- Ask Codex
- Let them discuss
- Pause
- Stop room
- Consolidate
```

Thread-level Ask buttons create broad agent turns. Discussion-level Ask buttons create targeted turns for a specific discussion.

### Pending Discussion Queue

Pending agent discussion points are shown outside the approved timeline, preferably in the sidebar or a queue panel.

Each pending item supports:

```txt
Approve
Edit
Reject
```

### Consolidation Review Page

Shows:

```txt
Current thread
Approved discussion summary/context
Latest proposed derived thread body
Proposal revision history
Agent review
Buttons:
- Apply
- Reject
- Ask configured reviser to revise
- Ask configured reviewer to re-review
```

The proposed body is editable. Apply uses the latest saved proposal revision.

Live updates use WebSocket between browser UI and local backend.

## 10. Safety Rules

Hard rules:

```txt
Agents cannot apply consolidation.
Agents cannot edit project files.
Agents cannot directly mutate canonical Roundtable state.
Only the user can approve pending discussion roots.
Only the user can apply a consolidation.
Only one agent can be active at a time per room.
Auto mode stops after the configured turn count.
```

Roundtable protects canonical files pragmatically:

```txt
prompt agents to use helper commands
make canonical files read-only where practical
hash/watch canonical files
flag or repair unexpected mutations from app-owned state
```

The default discussion mode allows inspection of the thread workspace and snapshot files. It does not allow project file edits.

## 11. MVP Scope

Build only:

```txt
1. Create a thread from title/body.
2. Render thread.md in the browser.
3. Add copied attachments and URL links.
4. Optionally create and refresh a read-only project snapshot.
5. Start a per-thread Claude + Codex tmux room with optional per-agent model choices.
6. Add human top-level discussion points and replies.
7. Ask Claude / Ask Codex at thread or discussion level.
8. Let agents discuss for N turns.
9. Queue and approve/edit/reject agent-proposed discussion roots.
10. Consolidate the whole current thread.
11. Review, edit, revise, apply, or reject proposals.
12. Apply creates a new derived thread and archives the old one.
```

Do not build yet:

```txt
multi-user collaboration
cloud sync
MCP
full project editing
agent marketplace
native Windows runner
embedded browser terminal
full web archiving for URLs
unlimited nested comment trees
```

## 12. Success Criteria

The MVP works if:

```txt
- User can create a rough thread quickly.
- User can add optional files, links, or a project snapshot.
- Claude and Codex can discuss the thread in approved discussion points.
- User can jump in with new discussion points and replies.
- Agent-created new discussion roots are controlled by human approval or an explicit per-run bypass.
- The thread body does not mutate during discussion.
- Consolidation creates a useful proposed derived thread.
- User can edit and apply the proposal.
- Applying archives the old thread and creates a clean new thread.
```

## 13. One-Line Positioning

> A local forum where you, Claude Code, and Codex turn messy dev threads into clean, approved next threads.
