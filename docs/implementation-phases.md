# Roundtable Implementation Phases

Implement Roundtable in phases that preserve the core product shape early, while delaying the trickier autonomy and safety parts until the base loop works.

## Phase 1: Local Thread App

Build the browser and backend shell.

- Create, list, and open threads
- Store threads under `~/.roundtable/threads`
- Create `thread.json` and `thread.md`
- Render the thread body
- Add human top-level discussion points
- Add human one-level replies
- Add basic WebSocket/live refresh

Exit criteria:

```txt
You can use Roundtable as a local single-user forum without agents.
```

## Phase 2: Canonical State Layer

Make storage boring and reliable before adding agents.

- Add shared schemas and types
- Route all writes through the backend
- Implement atomic JSONL append
- Generate comment IDs and timestamps in the backend
- Add pending discussion storage
- Add approve, edit, and reject for pending roots
- Add proposal and revision storage skeleton

Exit criteria:

```txt
No frontend or future agent path writes raw state directly.
```

## Phase 3: Attachments And Snapshots

Add context files.

- Copy attachments into `attachments/`
- Store URL links
- Add optional project snapshot
- Add git-tracked snapshot mode
- Add non-git confirm flow
- Add manual snapshot refresh
- Detect and list added files

Exit criteria:

```txt
A thread workspace is useful as an agent working directory.
```

## Phase 4: Agent Room MVP

Wire Claude and Codex into live thread rooms.

- Preflight for `claude`, `codex`, and `tmux`
- Start and stop per-thread tmux rooms
- Launch one Claude pane and one Codex pane
- Prefer CLI resume flows, such as `claude resume`, when recovering an existing room session
- Set working directory to the thread workspace
- Add helper-backed readiness handshake with `roundtable ready`
- Keep the room in `starting` until both agents acknowledge readiness
- Send basic nudges
- Show room status and tmux attach command

Exit criteria:

```txt
Both CLIs can be started, helper-acknowledge readiness, and be manually nudged from the UI.
```

## Phase 5: Helper Commands And Turns

Replace "hope the agent writes correctly" with the real turn contract.

- Add a reusable bounded job runner substrate
- Track backend-owned job state, start time, timeout, logs, result, and failure reason
- Use the job runner for single agent turns before using it for consolidation
- Add `roundtable comment --body-file`
- Add `.roundtable/current-turn.json`
- Validate active turns in the backend
- Mark an agent turn complete after successful helper submission
- Add thread-level Ask
- Add discussion-level Ask
- Add timeout handling with `needs_attention`

Exit criteria:

```txt
Claude and Codex can add approved comments through the canonical backend path, and those turns run through the same bounded job lifecycle that consolidation will reuse later.
```

## Phase 6: Auto Discussion

Add bounded autonomy.

- Add fixed N-turn scheduler
- Enforce per-room turn serialization
- Add Pause
- Add turn-limit-reached state
- Add pending agent root queue
- Add per-run bypass for direct agent roots

Exit criteria:

```txt
"Let them discuss" works without corrupting state or running forever.
```

## Phase 7: Consolidation Flow

Build the main payoff.

- Launch consolidation through the Phase 5 bounded job runner from canonical state
- Pause or serialize against any active room turn before consolidation
- Ask the configured drafter agent to draft the proposal
- Ask the configured reviewer agent to review the draft
- Ask the configured reviser agent to perform one automatic revision
- Add consolidation review page
- Make proposal body editable
- Save human proposal revisions
- Add Reject
- Add Apply
- Make Apply create a derived thread, archive the old thread, and stop the old room if one exists

Exit criteria:

```txt
Roundtable can turn a messy discussion into a clean next thread.
```

## Phase 8: Hardening

Harden only after the full loop works.

- Reconnect existing tmux sessions on app restart
- Detect unexpected canonical file mutations
- Improve room failure recovery
- Add snapshot reports
- Add storage cleanup
- Add focused tests around state machines and storage
- Add saved-output discovery for closed threads, including a direct UI link/panel for the final saved revision
- Polish the UI

Exit criteria:

```txt
The MVP is reliable enough for repeated real use.
```

## Implementation Bias

Do not start with tmux or agent orchestration. Build the human-only forum and canonical storage first. Otherwise, every agent bug will be mixed with basic product-state bugs.
