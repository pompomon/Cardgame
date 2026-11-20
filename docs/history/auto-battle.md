# Auto battle (archived plan)

Archived from `docs/implementation/auto-battle-plan.md`. Recover it with
`git fetch origin pull/173/head`, then
`git show 31b892d:docs/implementation/auto-battle-plan.md`.

## Delivered
- In #173, in stages: the plan, with the default answers to Q1–Q11; the
  controller and view model; the HUD mount split; the switch, desktop bar,
  touch dock and Take control guard; held-key repeats kept inert; throttled
  latency.

## Durable decisions
- A seat override that Hard plays, never a `controllers` change; in memory
  only, kept by rematch, encounters and the map, paused by replay: now in
  `docs/agent/architecture.md` › AI decisions and
  `docs/agent/state-and-persistence.md` › Controller hygiene, › View-model
  hygiene.
- Set, never toggle; constant Take control markup, its guard and focus: now
  in `docs/agent/three-interface.md` › Auto battle.
- Duplicate activation, stale input and held keys: now in
  `docs/agent/testing.md` › Auto battle controls and
  `docs/agent/browser-checks.md` › Auto battle check.

## Open follow-ups
- Device checks (Fold4 touch and 200% text, OS key repeat, screen readers,
  phone latency): tracked in
  [#163](https://github.com/pompomon/Cardgame/issues/163).
- Off-main-thread decisions: triggered in emulation; see the
  [roadmap](../implementation/hard-ai-search-roadmap.md#off-main-thread-decisions).
- Accepted limits, no issue: an AI move can drop a click in the open Game
  Menu, and closes the Cards dialog.

## Lessons
- Headless SwiftShader runs a guard timer only after held-key input stops;
  a 2-second first-repeat delay exposed what a time window cannot cover.
- Chrome clicks a focused button on each repeated Enter keydown unless the
  keydown is `defaultPrevented`.
- Only a new or resumed run enters `enterAdventureHub`; encounters do not.
