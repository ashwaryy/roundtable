<p align="center">
  <img src="packages/frontend/assets/web/icon-512.png" alt="Roundtable logo" width="144" height="144">
</p>

# Roundtable — Bring Claude and Codex Agents to the Same Table

Roundtable brings you, Claude-runtime agents, and Codex-runtime agents to the same table around one technical thread.

It is a local browser-based forum where a source thread stays stable while humans and configurable agents discuss it, critique it, ask questions, and propose improvements. When the discussion becomes useful, you consolidate it into a reviewable next version. Agents do not directly rewrite the source thread; the user controls what is approved and what becomes durable.

<p align="center">
  <img src="docs/roundtable-demo.gif" alt="Roundtable demo" width="960">
</p>

```txt
Thread = source artifact
Discussion = comments around the source
Pending discussion = agent-suggested topic awaiting approval
Consolidation = proposed derived thread
Apply = user-approved next thread
```

Roundtable should feel like a local forum thread with agent participants and a controlled update flow, not like a chatbot editing a document in place.

## What You Can Do

- Create Markdown source threads.
- Add human discussion points and replies around the thread.
- Create custom agents with names, roles, instructions, model choices, effort settings, and colors.
- Invite agents to a thread roster and run them in a local tmux room.
- Ask an agent to respond to a specific discussion.
- Ask an agent to suggest new top-level discussion topics for approval.
- Run bounded auto-discussion across the invited agents.
- Approve, edit, or reject pending agent-suggested discussion.
- Attach context files, URLs, and local project snapshots to a thread.
- Consolidate approved discussion into a proposed next thread.
- Ask agents to review or revise a consolidation proposal.
- Apply a proposal as the next thread, save it as an output, or reject it.
- Inspect runtime prompts, launch commands, and runtime policies from the System page.

## Requirements

You need these tools available locally:

- Node.js 20 or newer
- npm
- tmux
- Claude Code CLI, available as `claude` and already authenticated
- Codex CLI, available as `codex` and already authenticated

Roundtable can be used as a human-only local forum without starting agent rooms. The full agent workflow requires tmux plus authenticated runtime CLIs.

Roundtable does not use Claude or OpenAI API keys yet. Agent rooms launch your local CLIs inside tmux, so they can use the subscription plans and authentication state already available to your local `claude` and `codex` commands.

## Platform Support

Roundtable currently targets:

- macOS
- Linux

Windows is not a native target yet. The planned path for Windows support is through WSL.

## Quick Start

Clone the repository:

```bash
git clone https://github.com/ashwaryy/roundtable
cd roundtable
```

Install dependencies:

```bash
npm install
```

Build and start the app:

```bash
npm run start
```

Open:

```txt
http://localhost:4319
```

`npm run start` builds the frontend and backend, then starts the backend server. The backend serves the built frontend.
By default, the backend binds to `127.0.0.1` only.

## Development

Start the local development app:

```bash
npm run dev
```

Open:

```txt
http://localhost:5173
```

The development frontend runs on port `5173` and proxies API/WebSocket traffic to the backend on port `4319`.

## How Roundtable Works

1. Create a thread with a title and Markdown body.
2. Optionally add context: files, URLs, or a snapshot of a local project directory.
3. Choose the agents invited to the thread.
4. Start the agent room once preflight confirms the required runtimes are available.
5. Add human discussion or ask agents to respond to specific discussions.
6. Review pending agent-suggested discussion points before they become canonical.
7. Run bounded auto-discussion when you want agents to take turns.
8. Consolidate approved discussion into a proposed next thread.
9. Review, edit, ask for agent review/revision, then apply, save, or reject the proposal.

The source thread stays stable until you explicitly apply a consolidation. Applying a proposal creates a derived next thread rather than silently mutating the old one.

## Agents And Runtimes

Agents are Roundtable personas. You can create many agents and give each one a role, instructions, runtime, model, effort setting, and color. Each thread invites a roster of 1 to 8 agents.

Today, every agent must use one of two supported runtimes:

- Claude runtime, backed by the local `claude` CLI
- Codex runtime, backed by the local `codex` CLI

Roundtable starts one tmux session per active thread room and launches one tmux window per invited agent. The selected runtime CLI is started for each agent. The CLIs must already be installed and authenticated before starting the room.

Direct API-backed agents are not supported yet.

## Agent Room Controls

Inside a thread, the room panel lets you:

- Start, stop, or restart the tmux-backed agent room.
- Invite or remove agents while the room is stopped or idle.
- Set per-thread model and effort overrides.
- Nudge an idle agent with a freeform instruction.
- Request pending discussion suggestions from an idle agent.
- Start, pause, stop, exit, or extend auto-discussion.
- View read-only tmux pane snapshots for active agents.
- Retry or skip a turn if the room needs attention.

Agent turns are serialized per room, so a thread has at most one active agent turn at a time.

## Durable Data

By default, Roundtable stores local data in:

```txt
~/.roundtable
```

Thread artifacts are stored as files, including:

- `thread.md` for the source body
- `thread.json` for thread metadata
- `comments.jsonl` for approved discussion
- `pending-discussions.jsonl` for agent-suggested topics awaiting moderation
- `agents.json` for the thread roster
- `consolidations/` for proposal drafts, reviews, and revisions
- `attachments/` and `project-snapshot/` for thread context

Set `ROUNDTABLE_DATA_DIR` to use a different storage directory:

```bash
ROUNDTABLE_DATA_DIR=/path/to/roundtable-data npm run start
```

The same setting works in development:

```bash
ROUNDTABLE_DATA_DIR=/path/to/roundtable-data npm run dev
```

Useful environment variables:

- `ROUNDTABLE_DATA_DIR` changes the durable data directory.
- `ROUNDTABLE_PORT` changes the backend port. The default is `4319`.
- `ROUNDTABLE_HOST` changes the backend bind address. The default is `127.0.0.1`.
- `ROUNDTABLE_BACKEND_URL` changes the backend URL passed to agent rooms.
- `ROUNDTABLE_TURN_TIMEOUT_MS` changes the active agent turn timeout.

If you explicitly expose Roundtable to your LAN, for example:

```bash
ROUNDTABLE_HOST=0.0.0.0 npm run start
```

be aware that Roundtable does not have general API authentication. Anyone who can reach the backend can read thread data and trigger agent actions. Treat non-loopback binding as an advanced escape hatch, not a secure sharing mode.

## Development Commands

Run tests:

```bash
npm test
```

Run type checks:

```bash
npm run typecheck
```

Build all workspaces:

```bash
npm run build
```

## Contact

<table>
  <tr>
    <td><strong>Ashwary</strong></td>
    <td><a href="https://x.com/ashwarysh">@ashwarysh on X</a></td>
  </tr>
</table>
