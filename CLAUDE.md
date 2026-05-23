# Roundtable

Roundtable is a local browser-based forum for developing and refining technical threads with help from AI agents.

The product is built around a source thread and a surrounding discussion. The source thread stays stable while humans and agents discuss it. When the discussion becomes useful, it can be consolidated into a proposed next thread for the user to review and approve.

The core model is:

```txt
Thread = source artifact
Discussion points = comments around the source
Consolidation = proposed derived thread
Apply = user-approved next thread
```

Roundtable should feel like:

```txt
local forum thread + AI commenters + controlled update flow
```

It should not feel like:

```txt
chatbot directly editing a document
```

## Product Principles

- The thread is the source artifact.
- Discussion happens around the thread, not inside it.
- Agents can comment, critique, ask questions, and propose changes.
- The user controls when discussion becomes a proposed thread update.
- The user controls whether a proposed update is applied.
- Durable files are the source of truth, not terminal scrollback or hidden agent memory.

## Main Artifacts

Roundtable works with a few core artifacts:

- `thread.md` — the current source thread body.
- `thread.json` — metadata for the thread.
- `comments.jsonl` — approved discussion comments.
- Consolidation proposals — candidate derived threads for user review.

## Agent Participation

Claude Code and Codex CLI are intended to participate as AI commenters in the thread. Their roles should be configurable by the user or workflow.

Agents should contribute through comments, critiques, questions, and proposals. They should not directly apply changes to the source thread. User approval is the boundary between discussion and durable thread evolution.
