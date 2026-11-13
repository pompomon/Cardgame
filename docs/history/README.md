# Historical documents

Short summaries of completed implementation plans. Each records what shipped,
where its durable rules now live in `docs/agent/`, what is still open, and
how to recover the full plan from git. They do not describe the current
codebase.

For the **current** contributor / agent guidance, read:

- [`README.md`](../../README.md) — product features and deployment.
- [`AGENTS.md`](../../AGENTS.md) — non-negotiable contributor rules.
- [`docs/agent/`](../agent/) — topic deep-dives (architecture, validation,
  state, renderers, testing, PR workflow).

## Files

- [`adventure-map-and-relics.md`](adventure-map-and-relics.md) — the
  branching Adventure map, boons and relics, and the route graph.
- [`fold4-touch-ui.md`](fold4-touch-ui.md) — touch shells, drag and peek for
  the Galaxy Z Fold4 and other phones.
- [`creature-terminology.md`](creature-terminology.md) — urban-fantasy
  creature names, rules copy and artwork.

Deleted without a summary, because nothing in them is still needed:
`initial-implementation-plan.md` (the original Rules-v1 plan; see `README.md`
and `docs/agent/`) and `docs/implementation/rich-phaser-renderer-plan.md`
(superseded by ADR 0002). Recover any archived file with
`git show da7c3c9:<path>`.
