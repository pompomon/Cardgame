# AGENTS.md

Canonical guide for AI agents and contributors. The hard rules are
non-negotiable; [`docs/agent/`](docs/agent/) holds the detail. Cite rules by
name, never by number.

## Project

An offline-capable, two-player card game SPA: Vite + TypeScript, a
Three.js/WebGL2 renderer with a native HTML interface, vitest, `localStorage`
saves, and GitHub Pages at a non-root base path. `src/game/` is the pure engine.

## Validation

Use Node from `.nvmrc` and `npm ci`, then `npm run lint`, `npm run test`,
`npm run build` and CodeQL (`codeql_checker`); address every alert. Run
`npm run test:bench` before the build for deployment reproduction or AI
hot-loop changes. Record real exit codes, test counts and revisions, baseline
and post-change separately. Classify a failure's first meaningful error before
fixing it, allow at most one safe retry, and never weaken tests or widen
permissions. Details:
[validation-and-build](docs/agent/validation-and-build.md).

## Hard rules

### Vite base URL

Access `import.meta.env.BASE_URL` only as that literal member expression. An
alias defeats Vite's static replacement and breaks `/cards/*` and `/boards/*`
on GitHub Pages.

### Catalog presentation boundary

Player-facing creature names, abilities, rules text and asset slugs come from
`src/app/card-catalog.ts` and shared presentation helpers, including tutorial,
logs and nested Mimic prompts. Never parse or serialize names or slugs
as identity (grouping and cache keys are fine). Keep `BasicLand`, the
`BASIC_LANDS` order, engine/action/event fields, saves, recordings and P2P
payloads unchanged. Generic draws have no ability source: never credit
Listen In.

### No string-to-enum casts

Check untrusted strings with the `isXxx` guards (`isAiLevel`,
`isCardVisualStyle`, …) before assigning them.

### Validate and cap untrusted JSON

Deep-validate `localStorage`, imports, recordings and P2P payloads. Reject
`Infinity`, `NaN`, negative or fractional counters and unknown discriminants.
Cap arrays, keeping the most recent tail.

### Default branch in union switches

Every switch over a discriminated union has a `default:` that returns the
contract's safe placeholder or documented sentinel, never accidental
`undefined`.

### Immutable view-model snapshots

The view-model projects snapshots. Never pass `state.game`, `state.adventure`
or their arrays to renderers by reference.

### Explicit WebGL2 failure

Route load, initialization, render and context-loss failures to
`RendererHost`'s accessible recovery screen, preserving controller state.
Runtime failures retry in-page; failed dynamic imports need a reload. Never add
a hidden renderer fallback.

### No GameState clones in hot loops

No `structuredClone(GameState)`, or an equivalent deep copy, per candidate in AI
evaluation or per frame in render paths.

### Reuse shared helpers

Use `DEFAULT_CARD_VISUAL_STYLE` (never a hard-coded `'classic'`),
`src/renderers/shared/math.ts`, `src/renderers/shared/image-fit.ts`,
`isBasicLand` and the canonical option lists.

### Status-message ordering

A later unconditional status assignment hides a storage-unavailable warning.
Set warnings last, or guard the success message.

### Artwork acceptance

Classic art is procedural. Anime needs reviewed illustrated art, never seed or
fallback copies; Monochrome is a filter, not an asset style. Automated
provenance, dimension and hash checks are not visual acceptance; record that
separately. Only generating new art needs credentials. See
[card art](public/cards/README.md#anime-artwork).

### Seeded AI randomness

AI modules draw randomness only from `src/game/ai-random.ts`, seeded from the
game seed; never `Math.random`, clocks or `crypto`. See
[ADR 0003](docs/agent/adr/0003-hard-ai-search.md).

## Topic index

Area rules also load from `.github/instructions/` for matching files.

- [architecture](docs/agent/architecture.md): modules, layering, AI
- [validation-and-build](docs/agent/validation-and-build.md): sequence, triage
- [pr-workflow](docs/agent/pr-workflow.md): PRs, reviews, evidence, archiving
- [state-and-persistence](docs/agent/state-and-persistence.md): saves
- [three-renderer](docs/agent/three-renderer.md): GPU, interaction, touch
- [three-interface](docs/agent/three-interface.md): HTML, CSS, announcements
- [service-worker-and-pwa](docs/agent/service-worker-and-pwa.md): caching
- [testing](docs/agent/testing.md): conventions, browser checks
- [ADRs](docs/agent/adr/) and [history](docs/history/): past decisions
