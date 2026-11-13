# Adventure map and relics (archived plan)

Archived from `docs/implementation/adventure-map-and-relics-roadmap.md`,
`adventure-map-graph-plan.md` and the `adventure-map-graph/` figures.
Recover them with `git show da7c3c9:<path>`.

## Delivered
- Milestone 0: approved design and atomic delivery plan (#132).
- Milestone 1: schema-v2 run state with in-memory v1 migration (#134).
- Milestone 2: pure map module with seeded branching and route rules (#135).
- Milestone 3: branching map hub end to end (#136).
- Milestone 4: pure reward and relic rules, engine `openingHandSizes` (#140).
- Milestone 5: reward panel, saved offers and relic effects end to end (#141).
- Milestone 6: malformed-save fuzzing, status announcer, browser sweep (#142).
- Map graph milestones 1–3: route graph, SVG map and 18em trail (#152–#154).

## Durable decisions
- Product decisions, schema, migration, seeds, rewards and relics: now in
  `docs/agent/state-and-persistence.md` › Adventure run schema (version 2).
- Saving only at commit points: now in
  `docs/agent/state-and-persistence.md` › Controller hygiene.
- Route map, trail and route constraints (native HTML and SVG, 300 KB
  markup budget): now in `docs/agent/three-interface.md` › Adventure hub.
- Announcer: now in `docs/agent/three-interface.md` › Status announcements.
- Save fuzzing: now in `docs/agent/testing.md` › Malformed Adventure saves.
- Browser sweep: now in `docs/agent/testing.md` › Adventure hub check.

## Open follow-ups
- Milestone 7 compatibility matrix (legacy saves, recordings, modes,
  tutorial, CLI, P2P, non-root build, offline reload) and the device,
  forced-colors, screen-reader, speech-input, Safari/Firefox, 4× throttling
  and figure checks: tracked in
  [#163](https://github.com/pompomon/Cardgame/issues/163).
- On wide layouts a non-Adventure game over speaks no winner: tracked in
  [#164](https://github.com/pompomon/Cardgame/issues/164).

## Lessons
- `.three-interface` sets `overflow-wrap: anywhere`, so a narrow graph splits
  names mid-word; a trail threshold below 18em brings that back.
