# Creature terminology (archived plan)

Archived from `docs/implementation/urban-fantasy-creature-terminology-plan.md`.
Recover it with `git show da7c3c9:<path>`.

## Delivered
- Plan: approved catalog, terminology and compatibility contract (#121).
- Phases 0–1: frozen catalog, deck fixtures, presentation layer (#123, #124).
- Phases 2–3: tutorial, logs, CLI, Three.js UI and app metadata (#125, #126).
- Phase 4: slugged creature art, shared recipes and a cache bump (#127).
- Phases 5–6: compatibility safeguards and documentation audit (#128, #129).
- Gap closure: Mimic rule, rules discovery, counter label, recovery docs (#130).
- Art: restored illustrations under slugs, inequality test, cache v3 (#131).
- Styles: Monochrome checkbox, new Anime art, restored set as Cats (#137–#139).

## Durable decisions
- Legacy keys, order and fields stay, and renaming them needs its own
  versioned migration; copy comes only from the catalog: now in
  `docs/agent/state-and-persistence.md` › Serialized identity versus display
  copy.
- Board, Banish destination, compact labels and the Mimic rule: now in
  `docs/agent/three-interface.md` › Creature copy and accessible labels.
- Slug URLs and network-first art: now in `docs/agent/service-worker-and-pwa.md`
  › Catalog-slugged card art; fallbacks, Monochrome: `public/cards/README.md`.
- Art needs human visual acceptance: now in `AGENTS.md` › Artwork acceptance.
- Release audit and long-label checks: now in `docs/agent/browser-checks.md`
  › Creature catalog and terminology release matrix.

## Open follow-ups
- Human art review, restored-art browser evidence, historical recording
  acceptance and the manual verification matrix: tracked in
  [#163](https://github.com/pompomon/Cardgame/issues/163).
- Stale README style list, unused root PNGs and the `UiCard.name` migration:
  tracked in [#164](https://github.com/pompomon/Cardgame/issues/164).

## Lessons
- Retiring a stored setting (the `monochrome` style) must keep the legacy
  value until its replacement is saved, or a quota failure loses it (#138).
- Synthetic AI goldens and replay scenarios characterize current behavior;
  they cannot close historical-recording or manual gates (#130).
