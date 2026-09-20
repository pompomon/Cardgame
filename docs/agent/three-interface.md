# Three.js native interface and CSS

The Three.js renderer uses native HTML for the lobby, HUD, settings, recording,
P2P flows, dialogs, card lists, installation UI, and accessibility controls.
Behavior lives in `src/renderers/three/interface.ts`; projection and escaped
markup live in `interface-model.ts` and `native-html.ts`. Component styles live
in `interface.css`, while `src/style.css` contains only the page shell and
host-level renderer failure screen.

## Markup safety

`ThreeInterface` rebuilds substantial interface markup during updates. Any
string interpolated into `innerHTML` must pass through `escapeHtml()` from
`native-html.ts`. This includes player names, status, room codes, imported
recording metadata, card names, and error text.

Prefer element creation and `textContent` for host-level or incremental UI. Do
not introduce a second generic markup renderer.

## Creature copy and accessible labels

- Source card names, ability/rules copy, and asset slugs from
  `src/app/card-catalog.ts`, and consume shared action/phase labels from the app
  presentation layer. Do not add renderer-local identity maps or derive a slug
  from display text.
- The visible zone name is **Board**. Internal state fields, DOM data values,
  and renderer geometry may retain `battlefield` for compatibility.
- Use **Creature**, **Summon**, **Discard pile**, **Banish**, **Intercept**,
  **Interception window**, **Let It Through**, and **Action phase** consistently.
  Every Banish explanation must say that the creature goes to its owner's
  discard pile.
- Compact visual labels such as `Action`, `Intercept`, and `Discard` are allowed
  only when the accessible name keeps the full approved term.
- Never put a hidden card's catalog name, slug, image URL, or ability copy in
  markup, accessible text, data attributes, or preview state.

## Stable interaction state

An interface update can happen synchronously inside a controller submission.
State used after submission must be guarded by the same decision/session key
that produced it. Preserve:

- Legal retry selections after a rejected action.
- Draft P2P room text across unrelated lobby notifications.
- Dialog focus origin and scroll when previewing a card.
- The newest decision when an older submission triggers reentrant rendering.

Opening Cards from Game Menu returns to the menu on Back/Escape. Opening a card
preview from Cards returns to Cards with its focus and scroll restored.

## IDs, actions, and focus

- Keep every document `id` unique.
- Use `data-action` for delegated repeated actions and `class` for repeated
  styling.
- Avoid duplicate handlers after rerender or remount.
- Modal and subview transitions restore focus to their originating control.
- The renderer failure panel focuses Retry after announcing its
  `role="alert"` content.
- Every interactive control needs an accessible name and keyboard path.
- Maintain at least 44-by-44 CSS pixel targets.

## Native card tiles

Native card markup uses the `three-card*` class family and is scoped under
`.three-interface`. Preserve the card tile's grid/flex layout and square art
frame sizing. The WebGL mesh and native card tile use the same card-art URL
policy, visual-style setting, and redacted view-model data.

Raster image error handling must:

1. Remove the raster class and image immediately so the fallback is visible.
2. Record the failed URL in module state.
3. Skip that URL during subsequent renders.

Do not expose an opponent's hidden card through native markup, labels, data
attributes, or image URLs.

## CSS ordering

- Put plain safe-area padding fallbacks before `env(safe-area-inset-*)`.
- `max()` requires at least two arguments; do not use
  `@supports (padding: max(0px))`.
- Put an override after an equally specific base selector.
- Keep `image-rendering: pixelated` after `crisp-edges` when pixelated is the
  preferred value.
- Scope renderer components under `.three-interface` or `.three-root`; keep
  only truly global shell/failure styles in `src/style.css`.
- Use `box-sizing: border-box` for measured controls.
- Do not let transient prompts resize measured battlefield rows during a drag.

## Mobile layout

Test narrow portrait, short landscape, and coarse-pointer layouts. Native chrome
must not hide the canvas, cover required game actions, or create inaccessible
off-screen dialogs. Keep long labels and imported text wrappable, and give
scrolling panels an explicit size boundary.

Exercise Gravebloom Dryad, Echo Doppelgänger, the full Signal Siren Intercept
cost, and the Rooftop Gargoyle Banish destination at normal and 200% text.
Names, instructions, and controls must wrap instead of truncating; touch targets
remain at least 44 CSS pixels. Keep action prompts in stage-level overlays so a
wrapped copy change cannot resize measured card rows and cancel a drag.

Safe-area values need plain fallbacks for engines that reject `env()`. Bottom
actions must remain reachable above browser chrome and display cutouts.

## Visual verification

Use the production build and its configured non-root base path. Capture separate
evidence for lobby, game board, menu/dialog flow, narrow portrait, short
landscape, and the WebGL2 failure screen. Follow
[`pr-workflow.md`](pr-workflow.md#screenshots): interaction, capture,
inspection, and reviewer-accessible attachment are separate completion steps.
