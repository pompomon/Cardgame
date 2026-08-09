---
name: code-review
description: Review Cardgame pull requests with repository context, focusing on performance, user experience, and correctness of implementation.
---

# Cardgame code review skill

Use this skill when reviewing pull requests for `pompomon/Cardgame`. Focus on
high-confidence findings that materially affect correctness, performance, user
experience, maintainability, or repository invariants. Avoid style-only feedback
unless it prevents a known project rule from being followed.

## Start every review with repository context

Before commenting, identify the touched areas and load the most relevant project
guidance:

- `AGENTS.md` and `.github/copilot-instructions.md` for non-negotiable rules.
- `docs/agent/architecture.md` for layering and module ownership.
- `docs/agent/state-and-persistence.md` for trust-boundary validation.
- `docs/agent/phaser-renderer.md` for Phaser 4 renderer pitfalls.
- `docs/agent/dom-and-css.md` for DOM/CSS behavior and accessibility pitfalls.
- `docs/agent/service-worker-and-pwa.md` for GitHub Pages base-path, service
  worker, offline, and PWA install behavior.
- `docs/agent/testing.md` for test conventions.
- `docs/agent/validation-and-build.md` for required validation.

## Review priorities

### Correctness

- Preserve the dependency direction `renderers/{dom,phaser}/ -> app/ -> game/`.
  `src/game/` must stay pure and independent of DOM, Phaser, browser storage, and
  app orchestration concerns.
- Verify game actions remain legal under `isLegalActionForState` and engine
  equality rules, including exact fields such as `effectTargetId`.
- Check that every value crossing a trust boundary is deeply validated before
  use: `localStorage`, imported recordings, P2P payloads, snapshot migrations,
  and other parsed JSON.
- Reject non-finite, negative, or fractional counters such as `turn`,
  `nextInstanceId`, and `landsPlayedThisTurn`.
- Validate discriminated unions element-by-element and include a safe
  `default:` branch in switches over persisted or event shapes.
- Cap imported or rendered arrays by keeping the tail so the newest user-visible
  events survive.
- Keep view-model outputs immutable snapshots. Do not pass controller-owned
  `state.game`, `state.adventure`, players, hands, or arrays by reference into
  renderers.
- Preserve hidden-hand boundaries. Do not unredact AI hand card names in shared
  `players[].handCards`; expose narrowly scoped reveal fields only when a rule
  explicitly requires them.
- Avoid string-to-enum casts from untrusted UI/storage input. Use existing guards
  such as `isAiLevel`, `isCardVisualStyle`, `isAnimationSpeed`, and related
  validators.

### Performance

- Flag `structuredClone(GameState)` or equivalent deep cloning in hot paths such
  as AI evaluation, render loops, animation frames, or per-action candidate
  scoring.
- Watch for unnecessary full-state JSON serialization on frequent actions.
  Large `localStorage` writes should happen at commit boundaries or be otherwise
  bounded.
- In Phaser renderer changes, avoid creating many small GameObjects per card,
  icon, log row, pixel tile, or render pass. Prefer existing cached textures,
  bucketed sizes, reusable helpers, and pure layout modules.
- Ensure long logs, imported recordings, replay views, target pickers, and
  accessibility mirrors are capped or culled.
- Verify event listeners, timers, tweens, intervals, and Phaser containers are
  cleaned up on scene shutdown, unmount, lobby transitions, replay exits, and new
  games.
- Preserve reduced-quality and reduced-motion behavior. Performance fallbacks
  must not alter rules, queue ordering, completion semantics, or user decisions.

### User experience

- Check DOM and Phaser parity for observable behavior: game rules, settings,
  replay, adventure flow, install UI, animation settings, and card visual style.
- Verify mobile layouts remain usable in portrait and landscape, including safe
  area handling and touch targets.
- Preserve accessibility mirrors for Phaser UI and semantic/keyboard behavior in
  DOM UI.
- Ensure status messages do not overwrite important warnings, especially storage
  unavailable or persistence-failure messages.
- Review visible error, fallback, and empty states for clarity. Users should know
  whether a recording, saved adventure, asset, install prompt, or P2P flow failed
  and what remains available.
- For visual or UI changes, prefer comments that identify concrete regressions:
  clipping, overlap, contrast, lost focus, stale render state, duplicate IDs,
  broken fallback art, or inaccessible controls.

### Service worker, assets, and deployment

- Preserve literal `import.meta.env.BASE_URL` access. Do not alias it; Vite only
  statically replaces literal member expressions.
- In `index.html`, prefer `%BASE_URL%...` or relative `./...` paths instead of
  root-absolute URLs.
- Keep public asset caching intentional: network-first for same-path card, board,
  and sprite assets; cache-first for hashed Vite assets.
- If same-path public card, board, or sprite assets change, check whether
  `CACHE_VERSION` and release notes need updates.
- Do not let `404.html` replace the SPA shell cache entry.
- Ensure base-path helpers and `404.html` normalize paths without producing
  scheme-relative URLs.

### Testing and validation

- Expect behavior changes to include focused tests near the changed module or
  behavior under `src/test/`.
- For bundler-dependent behavior, prefer tests that invoke `vite build`, following
  the existing base-path regression pattern.
- Use `src/test/helpers/timers.ts` helpers instead of open-coded fake timer
  setup.
- Do not recommend removing unrelated tests or weakening assertions to make a
  change pass.
- Validate the required sequence for implementation PRs: `npm run lint`,
  `npm run test`, `npm run build`, then CodeQL.

## MCP context

When MCP tools are available and relevant, use them to improve review precision:

- Use GitHub MCP context for pull request metadata, changed files, linked issues,
  review threads, check runs, and CI failures.
- Use Playwright MCP context when the pull request, screenshots, or description
  involve UI flows, visual regressions, responsiveness, accessibility, install
  prompts, offline behavior, or renderer parity.
- Do not require MCP usage for every review. Prefer it when the PR description
  references issues, screenshots, deployments, incidents, CI/check failures, or
  user-facing flows.
- If MCP context influences a finding, make the comment self-contained so a human
  reviewer can understand the issue without opening tool logs.

## Comment style

- Report only actionable, high-signal findings.
- Explain the user-visible or correctness impact, not just the code smell.
- Point to the smallest affected area and suggest the expected project pattern or
  document to consult.
- Prefer one clear finding per comment.
- Do not block on speculative concerns. If a concern depends on unverified
  runtime behavior, ask for evidence or validation instead of asserting a bug.
