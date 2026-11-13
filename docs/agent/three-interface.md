# Three.js native interface and CSS

Native HTML and CSS of the Three.js renderer in `src/renderers/three/`.

## Rules

- Escape every `innerHTML` value, attributes and IDs included, with
  `escapeHtml()` (`native-html.ts`); add no second markup renderer.
- `ThreeInterface.latestForAction` drops input once `threeDecisionKey`
  changes, so each new hub decision (node, reward offer) must change
  `adventure.decisionKey` (built in `src/app/view-model.ts`).
- Element `id`s are unique; a button in both the lobby and the in-game menu
  uses `class`/`data-action` (the `abandon-adventure` pattern).
- Create live regions once, never in markup `render()` rebuilds; status text
  goes through `view.status`.
- A raster `onerror` records the URL in module state, so the next render skips
  it, and strips the raster classes as it swaps in non-raster art.
- `image-rendering: pixelated` follows `crisp-edges` when preferred; overrides
  follow the equally specific base rule (`css-image-rendering.test.ts`).
- Plain fallbacks precede `env(safe-area-inset-*)` (`three-layout.test.ts`);
  `@supports (padding: max(0px))` is invalid: `max()` needs two arguments.
- Never put a hidden card's name, slug, image URL or ability copy in markup,
  accessible text, data attributes or preview state.
- Every control has an accessible name, a keyboard path and a 44×44 CSS px
  target; modals and subviews return focus to their opener.

## Creature copy and accessible labels

Copy follows the
[Catalog presentation boundary](../../AGENTS.md#catalog-presentation-boundary).

- Say Board (`battlefield` stays internal), Creature, Summon, Discard pile,
  Banish (to the owner's discard pile), Intercept, Interception window, Let It
  Through and Action phase.
- Compact labels (`Action`, `Intercept`, `Discard`) keep the full term in
  their accessible names.
- Cards lists visible Hand, Board and Discard pile creatures with inline
  rules; previews show every rule, all of Signal Siren's Intercept cost
  included. Browser only: no CLI command or hidden-card access.
- Mimic's nested prompts keep the chosen source and its catalog ability.

## Stable interaction state

Beyond
[reentrant submissions](state-and-persistence.md#reentrant-ui-submissions),
keep P2P room drafts across unrelated lobby notifications. Back or Escape
from Cards or a preview returns to its opener (Game Menu or Cards), restoring
focus and scroll. Add no duplicate handlers on re-render or remount. The
renderer failure panel focuses Retry, else Reload (`renderer-host.test.ts`).

## Status announcements

- Only `#three-status-announcer` (`role="status"`, polite, atomic) speaks the
  status line; status paragraphs get no live role. Appended after the
  content, it leaves only on `dispose()`.
- `showModal()` inerts the rest, so `render()` moves the region into an open
  dialog (`placeAnnouncer`) and back before replacing it; each move clears it.
- After a move, a status waits `THREE_ANNOUNCER_SETTLE_MS`; a move restarts
  the wait, a newer status replaces it, `dispose()` drops it.
- `update()` writes after render and focus, only on a new `view.status`.
  Repeats speak only after `dispatchAdventure`: "still", then a toggled
  trailing no-break space. Playback silences only `replayStepStatus()`.
- `#three-dock-prompt` (`role="status"`), the touch shells' second region,
  speaks what the status line does not (the winner) and describes the docked
  primary button. `ThreeDockModel.quiet` (replay counts) sets
  `aria-live="off"` before the text changes.
- `setDragFeedback()` and `setPeek()` re-render without `onChange`, replacing
  only the dock prompt, never for stale feedback or under a menu, Cards or
  preview. Peek prompts are never `quiet`.
- Touch shells set the board instruction `aria-live="off"` before drag text
  changes; `desktop` keeps it live.
- The peek panel is `aria-hidden`, with no buttons; its name never breaks
  mid-word (`three-card-preview-layout.test.ts`).

## Adventure hub

- **Nodes.** Only `current` and `available` nodes are
  `button[data-action="adventure-node"]`, whose `aria-label` names opponent,
  status and action. Node and reward handlers recheck the latest view
  (`actionableAdventureNodes()`, offer, choice), as does the controller.
- **Route map.** Every rule drawing a slot's trail half also draws the
  playable button's (`three-interface.test.ts`); forced colors use system
  colors.
- **Route constraints.** Presentation only: native HTML and one `aria-hidden`
  inline `<svg>` per tier, in CSS percentages; no WebGL, `<canvas>`, map
  textures, raster icons, dependency, script measurement or image requests
  (icons are procedural, with no `onerror`). The largest route's hub markup
  stays at or under 300 KB (its icons take about 245 KB). One activation
  starts a node, with no preview; Tab, not arrow keys, moves between nodes;
  a failed run leaves its node unmarked.
- **Reward panel.** `adventure.pendingReward` swaps the route for **Choose a
  reward**: per choice, catalog name, exact rules text and cap or charge
  context, and
  `button[data-action="adventure-reward-choose"][data-offer-id][data-reward-id]`
  (**Choose <name>**); **Skip reward** (`adventure-reward-skip`) carries only
  `data-offer-id`. Its handler also requires the root hub page. Escape all
  copy (reward catalog via view model) and IDs; use no element `id`s.
  `actionableAdventureNodes()` returns none while an offer is pending.
- **Not color alone.** Status glyphs (`aria-hidden`) pair with words, line
  states differ by dash or width, and the map key names both; the current
  tier has `aria-current="step"`.
- **Focus.** Entering the hub or a new `adventure.decisionKey` focuses the
  first of the result, reward, current tier and page headings. A refused
  write keeps the key and focus; `focusKey` includes `data-reward-id`.
- **Transition focus.** After a `dispatchAdventure` command changes the
  session or removes the focused control, focus goes to the hub decision,
  `[data-action="menu"]` (node start, Resume) or `[data-lobby-heading]`
  (Pause, Reset, Back to Lobby), without `preventScroll` so it scrolls into
  view; never under a modal or inline target panel, or after disposal.
- **Result.** `three-adventure-result-detail` describes its heading: chances
  left, relic charges used, next step.
- **Tab order.** Nodes (or Choose and Skip), Pause and Reset (Start New
  Adventure and Back to Lobby after the run), then Settings and Recording.
  Headings are `tabindex="-1"`; relics and the map key have no tab stops
  (`three-interface.test.ts`).
- **No motion** in hub, reward, result or announcer CSS: no transitions,
  animations or `@keyframes` (`three-interface.test.ts`).
- **Pending result.** The hub stays closed over an unsaved result. Retry
  Saving Result and Reset Adventure Run replace Pause in the Game Menu, the
  dock and the wide game-controls header, beside Menu so they never scroll
  out of view; short labels Retry and Reset keep the full names accessible.
  A refused Retry keeps the menu open, focused on Retry.
- **Replay** controls are hidden in Adventure mode; the last encounter's
  recording still exports.

## CSS ordering

- Scope components under `.three-interface` or `.three-root`; `src/style.css`
  holds only the page shell and host failure screen.
- Measured controls use `box-sizing: border-box`.
- `three-card*` tiles keep their square art frame
  (`three-card-preview-layout.test.ts`) and share the WebGL mesh's
  [art URLs](service-worker-and-pwa.md#catalog-slugged-card-art), visual
  style and redacted data.

## Mobile layout

- In narrow portrait, short landscape and coarse-pointer layouts, native chrome
  never hides the canvas, covers required actions or strands a dialog
  off-screen; bottom actions clear browser chrome and display cutouts.
- Long labels and imported text wrap, never truncate; scrolling panels get an
  explicit size boundary. Prompts stay in stage overlays
  ([renderer rules](three-renderer.md#rules)).
- HTML assertions do not prove readable layout: run the
  [browser checks](browser-checks.md).

### Touch shells and fold continuity

Classification and geometry: [Touch shells](three-renderer.md#touch-shells).

- One touch grammar (`touchShellActive()`): a tapped hand card offers Summon,
  Details and Clear in the dock; a touch or pen tap on a target or Intercept
  discard waits for dock confirmation, a mouse click submits.
- The dock (prompt, then actions) keeps one order and the same unique ids in
  every shell; a rail outgrown by large text scrolls the whole dock, End Turn
  included.
- Switching touch shells keeps the selection, dock and open target list
  (`threeDecisionKey` is unchanged, so buttons stay live); `desktop` or a new
  decision clears them, and a pending summon moves to the desktop picker with
  no target chosen.

## Visual verification

Follow
[Browser verification and evidence](testing.md#browser-verification-and-evidence)
and [Screenshots](pr-workflow.md#screenshots).
