# Fold4 touch UI (archived plan)

Archived from `docs/implementation/fold4-touch-ui-uplift-plan.md` and the
`fold4-touch-ui-uplift/` figures. Recover them, and the measurement prose of
`docs/agent/three-renderer.md`, with `git show da7c3c9:<path>`.

## Delivered
- Plan: postures, figures and milestones M0–M5, approved 2026-11-10 (#143).
- M0: pure `threeShellProfile()` classifier with posture tests (#145).
- M1: touch drags drawn above the board chrome, with a landing ghost (#146).
- M2: long-press peek, multi-touch policy and edge auto-scroll (#147).
- M3: unfolded `dock` and `rail` shells with fold continuity (#148).
- M4: short rail for the cover screen and phones held sideways (#149).
- M5: one-time drag geometry, `narrow` dock fit for 200% text, docs (#150).

## Durable decisions
- One touch grammar, fold continuity and the dock prompt as drag and peek
  announcer: now in `docs/agent/three-interface.md` › Status announcements,
  › Touch shells and fold continuity.
- Classifier rules, settled defaults, one drop predicate, the 2D drag layer,
  peek, second-finger guard and one-measurement drags (sizes and timings as
  named constants): now in `docs/agent/three-renderer.md` › Touch shells,
  › Long-press peek, › Second-finger guard, › Drag geometry.
- Posture sweep in touch emulation, never as device proof: now in
  `docs/agent/browser-checks.md` › Fold4 posture check.

## Open follow-ups
- Galaxy Z Fold4 device gates: M0 measurements (then replace the estimates
  in `src/test/helpers/fold4-postures.ts`), Figures 3–7, M5 remote drag
  profiling, TalkBack, maximum font size, Remove animations, the device
  checklist, and any tuning they call for: tracked in
  [#163](https://github.com/pompomon/Cardgame/issues/163).
- Accepted limits, no issue: in `dock`, six or more hand cards shrink below
  108×148; Flex mode (Viewport Segments API) would need its own plan.

## Lessons
- Scrolling drag tests need `three-battlefield-controls.test.ts`: the stub
  board in `three-interaction.test.ts` cannot scroll.
- Headless Chrome fires no long-press `contextmenu` and lacks a hyphenation
  dictionary, so menu suppression and `hyphens: auto` need a device check.
