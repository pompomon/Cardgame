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
- The native Cards dialog exposes visible **Hand**, **Board**, and **Discard
  pile** creatures with inline ability/rules text. Full previews include primary
  and response rules, especially Signal Siren's entire Intercept cost. Keep this
  discoverability browser-only: no new CLI command or hidden-card access.
- Mimic's exact rule is “Repeat the ability of one of your creatures other than
  Echo Doppelgänger.” Nested target prompts must retain the chosen source and
  use its catalog-backed ability, not a hardcoded Reclaim/Banish/Drain Memory hint.
- Adventure uses **Summons attempted (both players)** instead of “Cards Played.”
  It displays the existing counter, including intercepted submissions, rather
  than counting only creatures that reach the Board.

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

## Status announcements

One persistent, visually hidden region speaks the status line in every mode:
`p#three-status-announcer.three-sr-only` with `role="status"`,
`aria-live="polite"` and `aria-atomic="true"`. It is appended to the host
after the rebuilt content, and only `dispose()` removes it. The lobby, hub
and HUD status paragraphs are plain `<p>` elements with no live role. A live
region created by an `innerHTML` rebuild is not reliably announced, and
several regions would speak the same text twice.

- `showModal()` makes everything outside the dialog inert, which silences a
  live region there. While a dialog is open, `render()` moves the region
  into it (`placeAnnouncer`). Before replacing that dialog's markup,
  `render()` moves the region back to the host. Each move clears its text, so a
  screen reader neither repeats an old status nor reads one as part of the
  dialog. A status set while the Game Menu is open, such as a refused Pause
  or Retry Saving Result, is therefore spoken.
- A moved region is newly inserted. Safari can miss a change made soon after
  a live region is inserted, and React Aria's announcer waits 100 ms for this
  reason. After each move, `announce()` therefore holds the status until the
  region has stayed in place for `THREE_ANNOUNCER_SETTLE_MS` (100 ms). A
  further move restarts the wait, a newer status replaces a waiting one, and
  `dispose()` drops it with the timer. This covers a status that arrives in
  the same update as a move: Start Replay closing the menu, a replay control,
  or the final step rebuilding the open menu, or Pause leaving the game. A
  region that has not moved speaks at once.
- `update()` sets the region's text after rendering and focus, and only
  when `view.status` changes.
- A status that stays the same is spoken again only after a command routed
  through `dispatchAdventure`, such as a retried write. The controller says
  "still" for a second identical refusal. For any repeat after that, the
  interface toggles a trailing no-break space, which screen readers do not
  read, so the region's text still changes.
- During playback, only the step status of each tick stays quiet. The
  interface compares the status against `replayStepStatus(step,
  totalSteps)` from `game-presentation.ts`, which the controller also uses.
  Any other status is announced, such as a refused recording save, and so
  are starting, pausing, stepping and reaching the final state.
- The narrow dock prompt (`#three-dock-prompt`, `role="status"`) is a
  second persistent region. It speaks decisions that the status line does
  not, such as the winner of a finished game. During replay it shows the
  transport's step count, which changes on every playback tick and repeats
  what the status line announces. `ThreeDockModel.quiet` marks that prompt,
  and `render()` then sets `aria-live="off"`. Each politeness change comes
  before the new text, so a replay's first prompt stays silent and the
  first prompt after it, such as the winner, is spoken. The prompt keeps
  its role, id and text, and still describes the docked primary button.
- The dock prompt is also the narrow drag announcer. `ThreeBoard` reports
  `ThreeDragFeedback` (`cardId`, `accepted`) or `null`, and
  `setDragFeedback()` re-renders the interface without calling `onChange`, so
  the board never re-presents mid-gesture. `renderThreeDock` replaces only the
  prompt, with copy built from catalog names, and keeps the actions and
  selection. Stale or unsummonable feedback, an open menu, Cards, or a
  preview leave the prompt alone. In the narrow profile the board
  instruction sets `aria-live="off"` before any drag text changes, so each
  drag message is spoken once. Outside it, the board instruction stays the
  live region.
- The dock prompt also announces a long-press peek. `setPeek()` re-renders
  the interface without `onChange`, and `renderThreeDock` replaces only the
  prompt with the card's name and primary ability. The actions and selection
  stay as they were. A peek prompt is never `quiet`, so it is spoken even
  during a replay. When the peek closes, the prompt goes quiet again before
  the replay text returns.
- The peek itself (`renderThreePeek`) is decorative: an `aria-hidden` panel
  in the hover overlay with the same rules as Details and no buttons. Its
  inline style holds the whole-pixel placement from the board. The panel
  clips instead of scrolling, so `peekFits()` measures a probe of the same
  markup in the overlay and refuses a placement that would hide any rules.
  On the cover screen its tile is only about 114 px wide, so the peek name
  uses less padding, 13 px type and `hyphens: auto`. This keeps a long word
  such as "Doppelgänger" on one line instead of breaking it mid-word.
- Keep live regions persistent. Create them once, like this region, the
  board captions and the dock prompt, and never put a live role in markup
  that `render()` rebuilds. Send status-line text through `view.status`.

## Adventure hub

`isThreeAdventureHub(view)` is true in Adventure mode when there is no game
and no replay. In that state `renderThreeAdventureHub` replaces the lobby:

- An encounter result section with a heading.
- A progress list, followed by the owned relics with charges and rules text.
- A seven-tier route, or the reward panel while an offer is pending.
- The run actions:
  - While the run is open: **Pause Adventure** and **Reset Adventure Run**.
  - After it ends: **Start New Adventure** and **Back to Lobby**.
- Settings and Recording pages.

Rules:

- **Node buttons.** Only `current` and `available` nodes render as
  `button[data-action="adventure-node"][data-node-id]`, labeled **Choose this
  path**, **Start encounter** or **Retry encounter**. The click handler checks
  the node ID against `actionableAdventureNodes()` in the latest view before
  calling `startAdventureNode()`, which checks again. Other nodes are plain
  text.
- **Reward panel.** While `adventure.pendingReward` is set, a **Choose a
  reward** panel replaces the route:
  - Each choice shows its catalog name, exact rules text, and cap or charge
    context, with a
    `button[data-action="adventure-reward-choose"][data-offer-id][data-reward-id]`
    labeled **Choose <name>**.
  - A distinct `adventure-reward-skip` button (**Skip reward**) carries only
    `data-offer-id`.
  - The click handler requires the root hub page and checks the offer ID and
    the choice against the latest view. The controller checks again, so a
    stale or tampered button does nothing.
  - Reward copy comes from the view model, which takes it from the reward
    catalog. Escape every value, including the IDs in attributes.
  - The panel uses no element `id`s.
  - `actionableAdventureNodes()` returns no nodes while an offer is pending.
- **Not color alone.** Each node status has an `aria-hidden` icon and visible
  text (Completed, Current, Available, Bypassed, Locked). Boss nodes also show
  a text **Boss** label. The current tier has `aria-current="step"`.
- **Focus.** Entering the hub, or a change of `adventure.decisionKey` (a
  committed result, a resolved reward or a new run), moves focus to the first
  of these that exists:
  1. the result heading, if there is a result;
  2. the reward heading, if an offer is pending (for example after a reload);
  3. the current tier heading;
  4. the page heading.

  Choose and Skip clear the result, so focus moves to the current tier. A
  refused write keeps the decision key, so focus stays on the activated
  control. `focusKey` includes `data-reward-id`, so a re-render restores
  focus to the same choice.
- **Transition focus.** Every Adventure command runs through
  `dispatchAdventure`. Focus moves only when the command changes the session
  or removes the activated control:
  - Pause, Reset, and Back to Lobby in Adventure mode go to the lobby heading
    (`[data-lobby-heading]`).
  - A node start, or a Resume that restores a saved game, goes to the Game
    Menu button (`[data-action="menu"]`).
  - Anything that lands on the hub goes to the hub's decision, in the order
    above.

  Each destination takes focus without `preventScroll`, so the browser
  scrolls it into view. The lobby keeps the page scroll of a long map, which
  would otherwise leave its heading above the fold.

  Focus stays put when a write is refused, when nothing was focused before
  the command (Safari does not focus clicked buttons), while a modal or an
  inline target panel is open, and after disposal. The move runs after the
  controller call returns, so it wins over `render()` restoring focus as a
  menu closes.
- **Result description.** The result heading has
  `aria-describedby="three-adventure-result-detail"`, so focusing it also
  reads the detail: chances left, relic charges used, and what to do next.
- **Tab order.** On the hub, Tab reaches the route's node buttons (or the
  reward's Choose buttons and Skip), then Pause and Reset, then Settings
  and Recording. A finished run offers Start New Adventure and Back to
  Lobby instead of Pause and Reset. Headings take focus only from script
  (`tabindex="-1"`), and the relic list has no tab stops.
- **No motion.** The hub, reward panel, result and announcer use no CSS
  transitions or animations, so reduced motion needs no override. A test
  reads `interface.css` and fails if an Adventure or `three-sr-only` rule
  adds a transition or animation, or if the file adds `@keyframes`.
- **Pending result.** While storage refuses a result, the finished board stays
  open. The Game Menu, the wide game-controls panel and the narrow dock offer
  **Retry Saving Result** and **Reset Adventure Run** instead of Pause. The
  wide panel is a fixed-height row that scrolls, so both buttons share its
  header row with Menu instead of falling below the fold. There, as in the
  dock, they show the short labels Retry and Reset and keep the full labels
  as accessible names. The
  hub never opens over an unsaved result. Retry does not reset the
  interface, so a refused write keeps the Game Menu open with focus on Retry;
  a saved result leaves the encounter and the session change closes the menu.
- **Replay** is refused while Adventure is open, so its controls are hidden in
  Adventure mode. The recording from the last encounter can still be exported.

## IDs, actions, and focus

- Keep every document `id` unique. The interface reserves
  `three-status-announcer` and `three-adventure-result-detail`.
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
Include inline Hand/Board/Discard pile rules and full preview text in this
check; automated HTML assertions alone do not prove readable browser layout.

Safe-area values need plain fallbacks for engines that reject `env()`. Bottom
actions must remain reachable above browser chrome and display cutouts.

## Visual verification

Use the production build and its configured non-root base path. Capture separate
evidence for lobby, game board, menu/dialog flow, narrow portrait, short
landscape, and the WebGL2 failure screen. Follow
[`pr-workflow.md`](pr-workflow.md#screenshots): interaction, capture,
inspection, and reviewer-accessible attachment are separate completion steps.
If these stages are unavailable, preserve textual results and leave visual
acceptance blocked for maintainer verification; do not infer a pass from mocks
or asset hashes.
