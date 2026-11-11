# Adventure map graph plan

> [!IMPORTANT]
> This document is an implementation plan. Its
> [checklist](#implementation-checklist) records which milestones have landed;
> nothing here is evidence of visual or assistive-technology verification.
> Figures 1 and 2 are screenshots of a throwaway HTML mockup, not of the game:
> their creature icons are colored squares and their opponents are
> illustrative. See [Evidence and limitations](#evidence-and-limitations).

## Summary

The Adventure hub lists the seven-tier route as bordered boxes, one per tier.
Each holds one or two node boxes with a status line, the opponent label and,
on playable nodes, an action. A fork shows as two boxes side by side, or
stacked when its node row is narrower than 448 px. Nothing joins one tier to
the next: the route's shape (where it forks, which branch the player took and
where it rejoins before the boss) has to be pieced together from each box's
status text.

This plan redraws the route as a top-down branching map, still in native HTML:

- each node is a round token with its opponent's creature icons and a status
  badge, above a short caption;
- lines join each node to the nodes of the next tier, styled by state: the
  route taken, the next step, a branch not taken, and the route ahead;
- a numbered badge marks each tier, a double ring marks the current tier, and
  a crown marks the boss;
- when the route is narrow (small phones, or large text), the map becomes a
  single-column trail.

Playable nodes stay the same `<button>`s, with the same accessible names,
actions, focus rules and tab order. The lines are one decorative inline SVG per
tier. The change is presentation only: the view model, saves, recordings, P2P,
the CLI and the service worker are untouched.

The work lands in three pull requests:

1. **Route graph model.** A pure helper turns the projected tiers into lane
   positions and line states. It has tests and no callers.
2. **Map rendering.** Markup, styles (graph, trail and forced colors), test
   updates and agent docs. The trail lands with the graph, so no pull request
   makes large text worse than today.
3. **Browser sweep, docs and release gate.** The Adventure hub check plus map
   checks, threshold tuning, and the remaining docs.

## Status and decisions

Status: **approved** by @pompomon on 2026-11-11, together with the working
defaults in [Open questions](#open-questions). Each milestone lands as its own
pull request, stacked on the previous one. Visual and assistive-technology
verification stays pending until a maintainer performs it.

The approved decisions are:

1. **Presentation only.** No change to the view model, `AdventureUiState`,
   saves, recordings, P2P payloads, the CLI, the service worker or assets. Node
   buttons keep their `aria-label`, `data-action="adventure-node"`,
   `data-node-id`, tab order, focus rules and decision-key guards. One
   activation still starts a node.
2. **Native HTML and inline SVG.** Tokens, captions and buttons are HTML, and
   each tier's lines are one `aria-hidden` inline `<svg>`. There is no WebGL,
   `<canvas>`, new dependency, raster asset or script measurement. This keeps
   the [roadmap](adventure-map-and-relics-roadmap.md#native-threejs-interface)
   rule: "Do not place the route in WebGL or create a second browser renderer."
3. **The same semantic skeleton.** The route stays an ordered list of seven
   tiers. Each tier starts with its heading, and the current tier has
   `aria-current="step"`. Static nodes stay text; only `current` and
   `available` nodes are buttons.
4. **Geometry by construction.** A tier's line band and its node slots share
   one grid column, and lines use percentage coordinates of that column. Lines
   therefore meet the tokens at any width without measuring the layout.
5. **Never color alone.** Every node status keeps its glyph and word. Line
   states also differ by dash pattern and width, and forced-colors mode maps
   them to system colors.
6. **Procedural tokens.** Token icons use
   `renderLandIcon(…, { forceProcedural: true })` with the player's card style
   and monochrome setting, so the hub requests no images.
7. **A pure, memoized graph helper.** `src/app/adventure-route-graph.ts`
   derives lane positions and line and stem states from the projected tiers.
   The renderer only formats them.
8. **A trail for narrow routes.** When the route is 18em wide or less (288 px
   at 100% text, 576 px at 200%), a container query switches to a
   single-column trail. Browsers without container queries keep the graph.
9. **Calm and top-down.** Tier 1 is at the top and the boss at the bottom,
   matching reading, DOM and Tab order. There is no motion and no new tab stop.

## Implementation checklist

- [x] Plan — Record the analysis, mockup figures, design and milestones
- [x] Approval — Maintainer approval of the plan and its working defaults
- [x] Milestone 1 — Route graph model
  - [x] `adventure-route-graph.ts` with lane, line, stem, memo and boundary
    tests; no callers
  - [x] `displayAdventureOpponentKind` in `game-presentation.ts`, with tests
  - [x] `architecture.md` module map entry
- [x] Milestone 2 — Map rendering
  - [x] Tier badges, line bands, node slots, tokens and captions
  - [x] Map key
  - [x] Graph, trail and forced-colors CSS replacing the route rules
  - [x] Hub test updates and new map tests; markup size and render time
    recorded
  - [x] Agent docs: the Adventure hub section of `three-interface.md`, and the
    test DOM stub rule in `testing.md`
- [ ] Milestone 3 — Browser sweep, docs and release gate
  - [ ] Adventure hub check at the documented viewports plus 320×568, with
    line, word-break, forced-colors and focus checks
  - [ ] Trail threshold and spacing tuned from the sweep
  - [ ] `testing.md` hub check, README and roadmap updates
  - [ ] Visual and assistive-technology check (pending maintainer)

## Current baseline

### Data

- `AdventureUiState.tiers` holds seven frozen `AdventureTierSummary` objects
  (`src/app/types.ts:86–89`). `projectAdventureTiers`
  (`src/app/view-model.ts:57–78`) caches them in a `WeakMap`, so every render
  of the same run state reuses the same tier array.
- Each `AdventureNodeSummary` (`types.ts:77–84`) has an `id`, a `tierIndex`, a
  `lane` (`left`, `center` or `right`), a `status`, a `boss` flag and an
  `opponent` with an `id`, `label`, `kind` and `lands` (`types.ts:69–74`).
- `adventureNodeStatus` (`src/app/adventure-map.ts:640–658`) sets each status.
  Earlier tiers are `completed` or `bypassed`. The current tier's nodes are
  `current` or `available`, and once the player commits to one side of a fork
  the other side is `bypassed`. Later tiers, and the tier where a run failed,
  are `locked`.
- Forks follow one of four patterns (`ADVENTURE_FORK_PATTERNS`,
  `adventure-map.ts:99–109`): 0-based tiers [0, 2, 4], [0, 2, 5], [0, 3, 5]
  or [1, 3, 5]. Forks are never adjacent and never at the boss, so each pair
  of tiers joins one node to one, one to two, or two to one.
- The opponent kinds (`buildAdventureOpponentPools`,
  `adventure-map.ts:181–218`) are `standard`, `dual` (ten pairs), `random` and
  `mono` (the boss). Standard and random both list all five creatures, so token
  emblems key on `kind`, not on the number of lands.

### Rendering

- `renderThreeAdventureHub` (`src/renderers/three/interface-model.ts:540–574`)
  renders the result, progress and relics. Then it renders either the reward
  panel or `section.three-adventure-map[aria-label="Adventure route"]`, which
  holds an `h2` (Route) and `ol.three-adventure-route` (561–563).
- `renderAdventureTier` (469–482) renders
  `li.three-adventure-tier[data-tier][data-tier-state]`, with
  `aria-current="step"` on the current tier. It holds an `h3` such as
  `Tier 2 of 7 · Current` and a `ul.three-adventure-nodes[data-count]`. The
  current tier's `h3` has `tabindex="-1"` and `data-adventure-current-tier`.
- `renderAdventureNode` (448–467) renders completed, bypassed and locked nodes
  as a `div`, and current and available nodes as a `button`. Each shows the
  status glyph with `{Lane} · {Status}`, the opponent label and, for the boss,
  a Boss line. Buttons add **Choose this path**, **Start encounter** or
  **Retry encounter**.
- The CSS (`src/renderers/three/interface.css:530–608`) draws tiers and nodes
  as bordered boxes. Their shared border color `#476478` has a contrast of
  2.67:1 against the panel (`#0e2029`). An auto-fit grid stacks a fork when
  its node row is narrower than 448 px (two 220 px columns and an 8 px gap).
- `ThreeInterface.render` (`src/renderers/three/interface.ts:710–735`) skips
  unchanged markup. `focusAdventureHub` (508–512) focuses
  `[data-adventure-current-tier]`. The `adventure-node` click handler
  (1046–1054) checks the node against `actionableAdventureNodes()` in the
  latest view, and `latestForAction` (548–558) drops clicks from a stale
  decision.

### Behavior that must not change

| Behavior | Source | Pinned by (`three-interface.test.ts`) |
| --- | --- | --- |
| Only `current` and `available` nodes are buttons. | `interface-model.ts:459–466` | Route test (2976) |
| Button names, such as `Choose this path: Tier 2 of 7, left path, Tier 2 left foe. Status: Available.` | `interface-model.ts:462–466` | Route and retry tests (2976, 3018) |
| `<ol class="three-adventure-route">`, seven tiers, and the attribute order `data-tier`, `data-tier-state`, `aria-current` | `interface-model.ts:478` | Route and finished-run tests (2976, 3054) |
| Focus moves to the current tier's `h3`. | `interface-model.ts:479`, `interface.ts:508–512` | Focus tests (3077, 3989) |
| A node starts once per offered decision. | `interface.ts:548–558`, `interface.ts:1046–1054` | Start test (3099) and the regression matrix (4152) |
| Tab order: nodes, Pause, Reset, Settings, Recording | DOM order | Tab-order test (4119) |
| No transitions, animations or `@keyframes` in Adventure rules | `interface.css` | No-motion test (4139) |
| No seeds or opponent decks in the markup | View model | Leak test (4068) |
| Unique element `id`s | All hub markup | Route test (2976) |
| The reward panel replaces the route. | `interface-model.ts:560–563` | Reward tests (3322–3475) |

### Tests that pin the hub

- `describe('Three Adventure hub')` (`src/test/three-interface.test.ts:2975`)
  and the regression matrix
  (`describe.each(['node', 'choose', 'skip'] as const)`, 4152) build views
  from the `hubNode`, `hubTiers` and `hubView` fixtures (2935–2961). In the
  fixture, tier 1 is completed, tier 2 is a fork, and the other tiers have one
  node each; every opponent is `dual`.
- One assertion depends on markup this plan removes: the route test's loop
  over `'Left path · Available'`, `'Center path · Completed'` and
  `'Center path · Locked'` (2991). Buttons stop showing the lane, so the first
  string moves into an accessible-name assertion. The other two strings stay in
  each static node's screen-reader text, as does the retry test's
  `'Left path · Bypassed'`.
- The test DOM stub (`three-interface.test.ts:184–206`) builds its tree with a
  tag stack. Only `INPUT`, `IMG`, `BR`, `HR`, `META` and `LINK` are void, a
  closing tag pops only a matching open tag, and `/>` does not close an
  element. Inline SVG must therefore close every element explicitly
  (`<line …></line>`).

## Goals

- Show the route as a map: where the player has been, which branch they did
  not take, what they can play next, and how the route continues to the boss.
- Keep every current behavior, accessible name, focus rule and tab stop. Every
  hub test passes except the one visible-string assertion above.
- Fit 320 px screens and 200% text with no horizontal overflow and no words
  broken mid-word.
- Pass the [Adventure hub check](../agent/testing.md#adventure-hub-check):
  44 px controls, reachability, Tab order and focus.
- Request no images, and keep the markup size within the in-game log's
  precedent.

## Non-goals

- Changing route rules, statuses, fork patterns, opponents, rewards, saves,
  recordings or P2P payloads.
- WebGL, `<canvas>`, map textures, new artwork or raster icons. The roadmap
  also lists new artwork and map textures as non-goals
  (`adventure-map-and-relics-roadmap.md:88–99`).
- Pan, zoom, a minimap or a left-to-right map.
- Animation, such as drawing paths or pulsing nodes.
- Arrow-key navigation between nodes, or a preview step before a node starts.
- Showing the map next to the reward panel.
- A right-to-left layout: the app has no right-to-left locale.
- Marking the node a failed run was lost to, which needs a view-model change
  (open question 9).

## Target design

### Figures

![Mockup of the proposed graph layout on a 390 by 844 screen at 100% text. A green start dot at the top leads by a solid green line to a completed Duo token with green and purple icons in tier 1, and by a dotted line to a bypassed Mystery token beside it. Both lead to tier 2, a completed Balanced token with five colored dots. Tier 3 has a double gold badge, and dashed gold lines lead to two blue-bordered buttons, Duo: Signal Siren + Rooftop Gargoyle and Balanced roster (10 of each creature), each reading Available and Choose this path. Thin gray lines continue through locked tiers 4 to 6, where tier 5 forks into Mystery and Duo, to a crowned tier 7 with one large purple token captioned Boss, Locked. A map key at the bottom lists the status glyphs with their words, four line samples, and the five creatures: Gravebloom Dryad, Signal Siren, Rooftop Gargoyle, Echo Doppelgänger and Memory Vampire.](adventure-map-graph/fig1-proposed-graph-narrow.webp)

*Figure 1 — Proposed graph layout at 390×844 and 100% text (mockup). Solid
green lines show the route taken, dashed gold lines the next step, dotted
lines a branch not taken, and thin gray lines the route ahead. Colored squares
stand in for the procedural creature icons.*

![Mockup of the proposed trail layout on a 390 by 844 screen at 200% text, scrolled to tier 3. A vertical rail runs down the left side. The underlined heading Tier 3 of 7 · Current sits above two full-width blue-bordered buttons, each with a token beside its label, Available and Choose this path. Below them, Tier 4 of 7 shows one node captioned Duo · Locked, and Tier 5 of 7 shows two nodes captioned Mystery · Locked and Duo · Locked.](adventure-map-graph/fig2-proposed-trail-200-text.webp)

*Figure 2 — Proposed trail layout at 390×844 and 200% text (mockup), scrolled
to tier 3. The route is narrower than 18em, so the tiers stack along a rail and
every tier name is visible.*

### Anatomy

Each tier is a two-column grid. The first column holds the tier badge. The
second, the map column, holds the tier's incoming line band above its node
slots:

```text
tier li (grid)       column 1: badge     column 2: map (one shared track)
row 1 "edges"        (empty)             svg band: lines from the previous
                                         tier's x to this tier's x
row 2 "badge nodes"  h3 badge (N or ♛)   ul with 4 equal tracks:
                                           left slot   = tracks 1–2 → 25%
                                           right slot  = tracks 3–4 → 75%
                                           center slot = tracks 1–4 → 50%
```

### Markup

```html
<li class="three-adventure-tier" data-tier="3" data-tier-state="current" aria-current="step">
  <h3 class="three-adventure-tier-badge" tabindex="-1" data-adventure-current-tier>
    <span class="three-adventure-tier-mark" aria-hidden="true">3</span>
    <span class="three-adventure-tier-name">Tier 3 of 7 · Current</span>
  </h3>
  <svg class="three-adventure-edges" aria-hidden="true">
    <line class="three-adventure-edge" data-edge-state="next" x1="50%" y1="0" x2="25%" y2="100%"></line>
    <line class="three-adventure-edge" data-edge-state="next" x1="50%" y1="0" x2="75%" y2="100%"></line>
  </svg>
  <ul class="three-adventure-nodes" data-count="2">
    <li class="three-adventure-node-slot" data-lane="left" data-stem="future">
      <button type="button" class="three-adventure-node" data-action="adventure-node"
        data-node-id="…" data-status="available" data-lane="left"
        aria-label="Choose this path: Tier 3 of 7, left path, Duo: Signal Siren + Rooftop Gargoyle. Status: Available.">
        <span class="three-adventure-node-token" aria-hidden="true">
          <span class="three-adventure-node-emblem" data-kind="dual"><img …><img …></span>
          <span class="three-adventure-node-badge">◇</span>
        </span>
        <span class="three-adventure-node-text">
          <span class="three-adventure-node-label">Duo: Signal Siren + Rooftop Gargoyle</span>
          <span class="three-adventure-node-status">Available</span>
          <span class="three-adventure-node-action">Choose this path</span>
        </span>
      </button>
    </li>
    <li class="three-adventure-node-slot" data-lane="right" data-stem="future">…</li>
  </ul>
</li>
```

A static node replaces the button with a `div`:

```html
<div class="three-adventure-node" data-status="locked" data-lane="center">
  <span class="three-adventure-node-token" aria-hidden="true">…<span class="three-adventure-node-badge">🔒</span></span>
  <span class="three-adventure-node-caption" aria-hidden="true">Duo · Locked</span>
  <span class="three-sr-only">Center path · Locked. Duo: Signal Siren + Rooftop Gargoyle.</span>
</div>
```

- The tier's `li` start tag is unchanged.
- The `h3` still contains the full tier name, such as `Tier 7 of 7 · Boss`.
  Its visible mark is the tier number, or ♛ for the boss.
- `.three-adventure-tier-name` is visually hidden in the graph with the same
  declarations as `.three-sr-only` (`interface.css:718–726`), under its own
  class so the trail can show it.
- Tier 1's band also draws a start dot,
  `<circle class="three-adventure-start" cx="50%" cy="6" r="6"></circle>`, and
  its lines start at `y1="6"`.
- When the helper gives no stem, the slot has no `data-stem` attribute.
- A button's text sits in `span.three-adventure-node-text`, so the trail can
  place it beside the token as one block.

### Geometry

- The tier `li` is a grid with columns `2.5em minmax(0, 1fr)` and areas
  `". edges" "badge nodes"`. The band (row 1) and the slots (row 2) share the
  map column, so they always have the same width.
- `ul.three-adventure-nodes` has four equal tracks and no column gap. A left
  slot spans tracks 1–2, a right slot tracks 3–4, and a center slot all four.
  Their centers are therefore at 25%, 75% and 50% of the column: the x values
  of the lines.
- The `<svg>` has no `viewBox`. It is `100%` wide and `36px` tall, with
  `overflow: visible`. Each `<line>` runs from the parent's x at `y1="0"` to
  the child's x at `y2="100%"`.
- Tiers and the route have no padding or gap between rows. A band therefore
  starts where the previous tier's slots end, and ends at the top of the next
  tier's nodes.
- Tokens are 56 px circles, centered in their slots.
- A stem (`[data-stem]::before`) continues the line from the token's center
  (28 px down) to the bottom of the slot. Because grid items stretch, that is
  the bottom of the tallest node in the tier. Node content sits above the stem
  (`z-index: 1`), and captions and buttons have opaque backgrounds (`#0e2029`,
  the panel's color, and `#172d3c` for buttons), so the stem shows only
  between nodes.

In the graph layout, the mockup measured 0 px of line error at every viewport
it tried.

### States

Lines and stems use `data-edge-state` and `data-stem`:

| State | Meaning | Style | Contrast on `#0e2029` | Forced colors |
| --- | --- | --- | --- | --- |
| `traveled` | From the start or a completed node to a completed node | `#7fd49a`, solid, 4 px | 9.37:1 | `CanvasText` |
| `next` | From the start or a completed node to a node the player can start | `#ffda7b`, dashed (8 on, 6 off), 3 px | 12.38:1 | `Highlight` |
| `bypassed` | To or from a bypassed node | `#c6d6e4`, dotted (round caps, 1 on, 7 off), 3 px | 11.25:1 | `GrayText` |
| `future` | Everything else, including unknown statuses | `#8aa4b8`, solid, 2 px | 6.43:1 | `GrayText` |

Nodes use `data-status`, with the glyphs and words of
`adventureNodeStatusLabel` (`interface-model.ts:376–386`), unchanged:

| Status | Glyph | Word | Token ring |
| --- | --- | --- | --- |
| `completed` | ✓ | Completed | `#7fd49a`, solid |
| `current` | ▶ | Current | `#ffda7b`, 4 px double |
| `available` | ◇ | Available | `#7bc9ff`, solid (9.26:1) |
| `bypassed` | ↷ | Bypassed | `#8aa4b8`, dashed |
| `locked` | 🔒 | Locked | `#8aa4b8`, dashed |
| Unknown | • | Unavailable | `#8aa4b8`, dashed |

- **Tier badges** are 2.25em circles with a 2 px `#8aa4b8` ring. The current
  tier has a 4 px double `#ffda7b` ring, and the tier where a run failed has a
  dashed `#e59a9a` ring (7.49:1).
- **Playable nodes** keep today's button look: a 2 px border on `#172d3c`,
  `#7bc9ff` when available and `#ffda7b` when current, with the existing focus
  outline.
- **The old border color** `#476478` (2.67:1) is no longer used for any
  route state.

### Tokens and captions

- The emblem depends on `opponent.kind`:
  - `dual`: both creatures' icons at 24 px, in one row with no gap, so they
    fit inside the current token's 4 px double ring;
  - `mono` (the boss): one icon at 36 px;
  - `standard`: five dots, one per creature in `BASIC_LANDS` order. Each is
    colored by `cardVisualPaletteFor(land, style).iconPrimary` through an inline
    custom property, as card tiles do (`native-html.ts:187`);
  - `random`, and any unknown kind (`default:`): a question mark.
- Icons come from `renderLandIcon(land, view.cardVisualStyle, size,
  'three-adventure-node-art', { forceProcedural: true, monochrome:
  view.monochromeCards })`, only for lands that pass `isBasicLand`. With the
  monochrome setting, the dots also get `card-art--monochrome`.
- The status glyph sits in a 22 px badge at the token's lower right.
- A new `displayAdventureOpponentKind(kind)` in `game-presentation.ts` gives
  the short kind label. It matches the prefixes of
  `displayAdventureOpponentLabel` (`game-presentation.ts:35`): Balanced, Duo,
  Boss and Mystery, with Mystery for unknown kinds.
- A static node shows a one-line caption, `{Kind} · {Status}`, or
  `♛ Boss · {Status}` for the boss node. The caption is `aria-hidden`. Screen
  readers get `{Lane} · {Status}. {Full label}.` instead, which, with the tier
  heading, keeps the roadmap's "tier, opponent, route status, and roster
  summary".
- A button shows the full label, the status word and the action. Its
  `aria-label` is unchanged and contains all three, so speech input can use
  the visible words.

### Map key

After the list, inside the route section, `div.three-adventure-map-key` holds
an `h3` (**Map key**) and three short lists, labeled **Node status**, **Route
lines** and **Creatures** with `aria-label`:

- the node statuses: each glyph, hidden from assistive technology, with its
  word;
- the lines: a 32×10 `aria-hidden` SVG sample each for **Route taken**,
  **Next step**, **Not taken** and **Ahead**. The samples share the
  `data-edge-state` styles but use their own class, so tests can count route
  lines separately;
- the creatures: the five icons in `BASIC_LANDS` order, named with
  `displayCardName`.

The key has no buttons, links, `id`s or `<details>`, so it adds no tab stops.

### Trail layout

`ol.three-adventure-route` becomes a size container
(`container: adventure-route / inline-size`). Inside
`@container adventure-route (max-width: 18em)`:

- each tier becomes one column: the tier name, now visible and bold, above
  its nodes. The current tier's name is underlined;
- the line bands, stems and tier marks are hidden;
- nodes stack at full width, 8 px apart, each a row with the token beside its
  text;
- a 2 px rail (`li::before`) runs down the left side, behind the tokens, and
  stops level with the last tier's name. Each tier's segment follows the
  tier's state: solid green when cleared, dashed gold when current, and gray
  otherwise.

In the mockup, the trail appeared at 390 px with 200% text and at 320 px with
both text sizes; every other case kept the graph. The trail also covers
reflow: at 320 CSS px, such as 400% zoom of a 1280 px window, the route needs
no horizontal scrolling. Without the trail, 200% text at 390 px broke words
mid-word ("Balanc|ed"), because `.three-interface` sets
`overflow-wrap: anywhere`.

### Forced colors

Inside `@media (forced-colors: active)`, line `stroke` and stem
`border-color` use `CanvasText` for `traveled`, `Highlight` for `next`, and
`GrayText` for `bypassed` and `future`. Dash patterns and widths still tell the
states apart. The plan adds no `forced-color-adjust: none`, gradients or
background-image lines, so the browser keeps tokens, text, rings and focus
outlines legible.

### Route graph helper

`src/app/adventure-route-graph.ts`:

```ts
import type { AdventureNodeLane, AdventureNodeStatus } from './adventure-map'
import type { AdventureTierSummary } from './types'

export type AdventureRouteEdgeState = 'traveled' | 'next' | 'bypassed' | 'future'
export type AdventureRouteLaneX = 25 | 50 | 75

export interface AdventureRouteGraphNode {
  readonly nodeId: string
  readonly x: AdventureRouteLaneX
  /** The style of the line below the token, or null when no line leaves it. */
  readonly stem: AdventureRouteEdgeState | null
}

export interface AdventureRouteEdge {
  /** null for the start dot above tier 1. */
  readonly fromNodeId: string | null
  readonly toNodeId: string
  readonly fromX: AdventureRouteLaneX
  readonly toX: AdventureRouteLaneX
  readonly state: AdventureRouteEdgeState
}

export interface AdventureRouteGraphRow {
  readonly tierIndex: number
  readonly nodes: readonly AdventureRouteGraphNode[]
  /** The lines that enter this tier from the previous one, or from the start. */
  readonly incoming: readonly AdventureRouteEdge[]
}

export function adventureRouteLaneX(lane: AdventureNodeLane): AdventureRouteLaneX
export function adventureRouteEdgeState(
  from: AdventureNodeStatus | 'start',
  to: AdventureNodeStatus,
): AdventureRouteEdgeState
export function adventureRouteGraph(tiers: readonly AdventureTierSummary[]): readonly AdventureRouteGraphRow[]
```

Rules:

- **Lanes.** `left` is 25, `center` 50 and `right` 75. An unknown lane is 50.
- **Line state.** A line is `bypassed` if either end is bypassed. Otherwise,
  from the start or a completed node, it is `traveled` to a completed node and
  `next` to a current or available node. Everything else is `future`,
  including unknown statuses.
- **Connections.** Every node joins every node of the next tier. The fork
  patterns give one or two lines per band. A two-to-two band, which no route
  has today, would draw four.
- **Start.** Tier 1's lines start at the start dot (`fromNodeId: null`,
  `fromX: 50`).
- **Stems.** A stem is `null` when no line leaves the node: on the last tier,
  or before an empty tier. Otherwise it is `traveled` if any outgoing line is
  traveled, else `next` if any is next, else `bypassed` if all are bypassed,
  else `future`.
- **Purity.** The output is frozen and memoized in a `WeakMap` keyed by the
  tier array, which `projectAdventureTiers` keeps identity-stable. Inputs are
  never mutated.
- **Boundary.** The module has only `import type` imports, from
  `./adventure-map` and `./types`. A boundary test in the style of
  `adventure-setup.test.ts:461–480` rejects any other import and any use of
  `document`, `window`, `localStorage`, `Math.random` or `Date`.

For the hub test fixture (`hubTiers`: tier 1 completed, both sides of the tier
2 fork available, then locked tiers), the helper gives:

| Band | Lines | States |
| --- | --- | --- |
| Start → tier 1 | 1 | `traveled` |
| Tier 1 → tier 2 (fork) | 2 | `next`, `next` |
| Tier 2 → tier 3 | 2 | `future`, `future` |
| Tier 3 → … → tier 7 | 4 | `future` |

The stems are `next` on tier 1, `future` on tiers 2–6, and `null` on tier 7.

### Renderer changes

In `interface-model.ts`:

- `renderAdventureRoute`, called once per hub render, computes
  `adventureRouteGraph(adventure.tiers)` and passes each tier the row with
  the same index. A missing row draws no lines.
- `renderAdventureTier(view, adventure, tier, row, first)` renders the badge
  heading, the band and the slots. The tier state, heading suffix,
  `aria-current` and focus attributes are computed as today.
- `renderAdventureNodeSlot(view, adventure, node, graphNode)` renders the
  slot and its stem. `renderAdventureNode(view, adventure, node)` renders the
  token, then either the caption and screen-reader text or the button
  content. The button's attributes and name are unchanged.
- New helpers: `renderAdventureRoute(view, adventure)`,
  `renderAdventureNodeSlot`, `renderAdventureNodeToken(view, node)`,
  `renderAdventureNodeEmblem(view, opponent)`, `renderAdventureEdges(row,
  first)` and `renderAdventureMapKey(view)`. Every `switch` over a kind,
  status or line state has a `default:` that returns a safe placeholder.
- Every text and attribute value goes through `escapeHtml`, as today. SVG
  coordinates come only from the helper's typed lane values.
- The `.three-adventure-node-heading`, `-icon`, `-opponent` and `-boss`
  classes are removed.

In `interface.css`, the graph, trail and forced-colors rules replace the route
rules (530–608). The list reset and every other hub rule stay, and the new
rules use no transitions or animations.

`interface.ts` needs no change: `focusAdventureHub` still finds
`[data-adventure-current-tier]`, and `render` still skips unchanged markup.

### Performance and markup size

- Procedural icons are URL-encoded SVG data URLs, cached by land, style and
  size (`landIconDataUrl`, `card-visuals.ts:109`). With
  `forceProcedural: true`, each icon measured about 6.6–10.2 K characters at
  24 and 36 px in every style, with no `onerror` handler and no `/cards/` URL.
  Without it, the raster styles (Cats and the default, Anime) would point each
  icon at a full-size PNG of 2.3–2.9 MB.
- A route has at most ten nodes: the boss (1 icon) and nine others. If all
  nine were `dual` (18 icons), the map key's 5 would make 24 icons, about
  245 KB of markup. The in-game log already renders up to 200 icons at 32 px
  (`interface-log.ts:21`, and `MAX_RENDERED_LOG_TILES` in
  `log-presentation.ts:6`). Each measured about 6.6–10.6 K characters in every
  style, because raster styles embed the procedural icon in their `onerror`
  fallback, so the log can reach about 2.1 MB.
- `render` skips unchanged markup, so the browser parses the hub only when the
  view changes.
- Milestone 2 records the markup size of a real run and of the largest
  fixture, and the hub's render time with 4× CPU throttling, against a 300 KB
  budget.

## Atomic milestones

### Milestone 1 — Route graph model

**Scope**

- Record the baseline on Node 24 after `npm ci`: `npm run lint`,
  `npm run test` and `npm run build`.
- Add `src/app/adventure-route-graph.ts` as described in
  [Route graph helper](#route-graph-helper), with no callers.
- Add `displayAdventureOpponentKind(kind)` to `game-presentation.ts`.
- Add the new module to the `src/app` module map in `architecture.md`.

**Primary modules**

- `src/app/adventure-route-graph.ts` (new)
- `src/app/game-presentation.ts`
- `src/test/adventure-route-graph.test.ts` (new)
- `src/test/game-presentation.test.ts`
- `docs/agent/architecture.md`

**Required tests**

- The line state for every pair of statuses and for the start, including an
  unknown status.
- Lane positions, including an unknown lane.
- Each of the four fork patterns, and one route from a seeded run projected
  through the view model.
- Line counts per band: 1 for one-to-one, 2 for one-to-two, 2 for
  two-to-one, and 4 for a two-to-two fixture.
- Start lines and stems, including `null` on the last tier and before an
  empty tier.
- An active run, a committed fork, a retry, a completed run and a failed run.
- Frozen output, the same result for the same tier array, and a new result
  for a new array.
- An empty route and an empty tier.
- The module boundary.
- `displayAdventureOpponentKind` for each kind and an unknown kind.

**Definition of done**

- The validation sequence passes, with test counts recorded against the
  baseline.
- No runtime behavior changes.

### Milestone 2 — Map rendering

**Scope**

- Render the tier badges, line bands, slots, tokens, captions and map key as
  described in [Target design](#target-design).
- Replace the route rules in `interface.css` (530–608) with the graph, trail
  and forced-colors rules.
- Update the [Adventure hub](../agent/three-interface.md#adventure-hub) section
  of `three-interface.md`: describe the map, its line states and the trail, and
  update the **Node buttons** and **Not color alone** rules.
- Add the DOM stub's closing-tag rule to
  [Conventions](../agent/testing.md#conventions) in `testing.md`.
- Check the hub in a production preview at 390×844 and 1280×800, at 100% and
  200% text. The full sweep is Milestone 3.

**Primary modules**

- `src/renderers/three/interface-model.ts`
- `src/renderers/three/interface.css`
- `src/test/three-interface.test.ts`
- `docs/agent/three-interface.md` and `docs/agent/testing.md`

**Required tests**

- In the route test's visible-string loop, `'Center path · Completed'` and
  `'Center path · Locked'` stay. `'Left path · Available'` becomes a check of
  the button's visible status (**Available**) and its unchanged name.
- Each tier has one line band, and tier 1 has the start dot. The fixture draws
  nine `three-adventure-edge` lines: one `traveled`, two `next` and six
  `future`.
- Every `<svg>`, `<line>` and `<circle>` is closed, and the stub's tree has the
  expected nesting.
- Tier 7's slot has no `data-stem`.
- Each kind, and an unknown kind, gets the right emblem.
- For every card style, the hub markup has no `/cards/` URL and no `onerror`.
  The monochrome setting adds `card-art--monochrome`.
- The map key lists five statuses, four line samples and five creatures. The
  tab-order and unique-`id` tests still pass.
- A hostile opponent label is escaped in the button label, the screen-reader
  text and the `aria-label`.
- A failed run draws no `next` line. A completed run draws only `traveled` and
  `bypassed` lines.
- Every other hub test passes unchanged, including focus, tab order, no
  motion, the leak test and the regression matrix.

**Definition of done**

- The validation sequence passes.
- The pull request records the markup size, the render time and the preview
  check. Screenshots follow the
  [screenshot procedure](../agent/pr-workflow.md#screenshots).
- The docs match the shipped markup.

### Milestone 3 — Browser sweep, docs and release gate

**Scope**

- Run the [Adventure hub check](../agent/testing.md#adventure-hub-check) on the
  production preview at the configured base path, adding 320×568.
- At each size, add map checks:
  - in the graph layout, every line end is within 1 px of its token's center;
  - no word breaks mid-word, checked by comparing the line boxes of each word
    (`Range.getClientRects()`);
  - forced colors (`page.emulateMedia({ forcedColors: 'active' })`) and
    reduced motion;
  - focus and Tab order after entering the hub, choosing a fork, a retry and a
    reward.
- Tune the 18em threshold and spacing from the results, and record where the
  trail starts.
- Add the map checks to the hub check in `testing.md`. Update the README
  (`README.md:129–131`) and the roadmap's hub requirements
  (`adventure-map-and-relics-roadmap.md:428–456`).
- Hand the visual and assistive-technology checks to a maintainer.

**Primary modules**

- `src/renderers/three/interface.css` (tuning only)
- `docs/agent/testing.md`, `README.md`,
  `docs/implementation/adventure-map-and-relics-roadmap.md` and this plan

**Required validation**

- The validation sequence.
- A results table with the viewport, text size, layout, overflow, smallest
  control, line error and mid-word breaks.

**Definition of done**

- Every row passes, or a maintainer accepts a recorded exception.
- Visual and assistive-technology verification is recorded as pending
  maintainer review, not waived.

## Acceptance criteria

### Behavior

- The same nodes are buttons, with the same names, `data-*` attributes, tab
  order and focus targets. One activation starts a node once, and stale
  buttons do nothing.
- The route keeps its semantics: one ordered list of seven tiers, each starting
  with its heading, and one `aria-current="step"`.
- The view model, saves, recordings, P2P, the CLI and the service worker are
  unchanged.

### Map

- Lines join each node to the nodes of the next tier, styled by state. In the
  graph layout, they meet token centers within 1 px.
- The current tier and the playable nodes stand out by shape (double ring,
  dashed line) as well as color.
- The trail replaces the graph when the route is 18em wide or less. Both
  layouts show every node's status in words.

### Accessibility

- Every status has a glyph and a word, and every line state differs by dash
  pattern or width.
- Against `#0e2029`, text has a contrast of at least 4.5:1, and lines, rings
  and badges at least 3:1.
- Lines, stems, rings and text stay visible in forced-colors mode.
- There are no new tab stops, `id`s or motion. Screen readers hear each tier's
  heading, and each node's lane, status and full label.

### Layout

- At every hub-check viewport and at 320×568, at 100% and 200% text: no
  horizontal overflow, no words broken mid-word, controls of at least 44 CSS
  px, and every control reachable.

### Performance

- The hub markup for the largest route is at most 300 KB, the hub requests no
  images, and the render time is recorded.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Lines drift from tokens (rounding, fonts, zoom). | The band and the slots share one grid column and percentage coordinates. Milestone 3 checks line ends to 1 px. |
| Large text squeezes forks. | The trail at 18em, tuned in Milestone 3. |
| A browser lacks container queries (before Chrome 105, Safari 16 or Firefox 110). | It ignores the block and keeps the graph, which still fits without overflow; only line breaks get worse. This is the repo's first container query, so Milestone 3 records the browsers checked. |
| The test DOM stub mis-nests SVG. | Close every element explicitly, test the nesting, and document the rule in `testing.md`. |
| The markup grows. | Procedural icons, cached URLs and skipped unchanged renders. Milestone 2 measures against a 300 KB budget. |
| Forced colors hide lines. | System colors in a forced-colors block, checked with emulation in Milestone 3. |
| Players expect a map tap to preview a node, not start it. | Buttons keep their action text (**Choose this path**, **Start encounter**). See open question 1. |
| Short captions hide information on static nodes. | The full label stays in screen-reader text and on buttons, and the map key names the creatures. See open question 3. |
| Glyphs render as empty boxes. | The map adds no new glyph: ♛, 🔒 and the other status glyphs already ship in the hub. |
| Readers mistake the figures for shipped behavior. | Each figure is labeled as a mockup, and the note at the top says so. |
| The map clashes with a card style. | Icons follow the style's palette and the monochrome setting, and other colors reuse the hub's palette. |
| The map is tall on phones (about 930 px at 390 px wide in the mockup). | The hub scrolls as today, and focus on the current tier scrolls it into view. |

## Open questions

Approval adopted the working default after each question. The browser sweep
and maintainer testing can revisit any of them.

1. Should tapping a node show a preview that the player confirms before the
   encounter starts?
   *Working default:* no; one activation starts it, as today.
2. Should the map run top-down or left-to-right?
   *Working default:* top-down, which matches reading and Tab order and fits
   phones.
3. How much should static nodes show?
   *Working default:* a short caption such as `Duo · Locked`, with the full
   label on buttons and in screen-reader text.
4. Should a read-only map stay visible next to the reward panel?
   *Working default:* no; the reward panel replaces the route, as today.
5. Should tokens use the style's raster art instead of procedural icons?
   *Working default:* procedural icons in the style's palette; each PNG is
   2.3–2.9 MB.
6. Should arrow keys move between nodes?
   *Working default:* no; Tab reaches the one or two playable nodes.
7. Should the map add flourishes such as terrain or path-drawing animation?
   *Working default:* none.
8. Is 18em the right width for the trail?
   *Working default:* 18em, tuned in Milestone 3.
9. Should a failed run mark the node it was lost to?
   *Working default:* no, because that needs a new view-model field; the result
   panel already names the opponent.

## Verification plan

### Automated checks

Every milestone runs the
[validation sequence](../agent/validation-and-build.md#sequence): `npm run
lint`, `npm run test`, `npm run build` and `codeql_checker`. Record the exit
codes, test counts and tested revision. `npm run test:bench` is not needed,
because no AI hot loop changes.

### Browser emulation

Follow the
[browser evidence procedure](../agent/testing.md#browser-verification-and-evidence)
on the production preview at the configured base path:

- the [Adventure hub check](../agent/testing.md#adventure-hub-check)
  viewports (390×844, 844×390, 720×360 and 1280×800) plus 320×568, each at
  100% and 200% root font size;
- every card style, with and without monochrome;
- forced colors and reduced motion;
- a new run, a committed fork, a retry, a pending reward, a completed run and
  a failed run.

Record the results as emulation, not device coverage.

### Maintainer checklist

- [ ] A phone and a tablet, in portrait and landscape, at the largest system
  text size.
- [ ] Windows contrast themes (forced colors) in a real browser.
- [ ] Screen readers (VoiceOver, TalkBack, and NVDA or JAWS): tier headings,
  each node's lane, status and label, and the button names.
- [ ] Speech input: **Choose this path** and the opponent names reach the right
  buttons.
- [ ] A visual review of each card style against Figures 1 and 2.

## Evidence and limitations

- **Analyzed revision.** `90c50cc`. On Node v26.12.1, not the project's
  Node 24, `npm ci` and `npm run lint` exited 0. Tests and the build were not
  run for this documentation-only plan.
- **Milestone 1 baseline.** At `90c50cc` on Node v24.22.2 with npm 11.19.1,
  `npm ci`, `npm run lint`, `npm run test` (89 files, 2,479 tests) and
  `npm run build` exited 0.
- **Mockup.** A throwaway static HTML page, not committed, reproduced the
  proposed markup and CSS with colored squares for icons. It ran in headless
  Chromium. For 200% text it doubled the root font size, as the hub check
  does.
- **Mockup measurements.** Every case had 0 px of horizontal overflow and no
  word broken mid-word. In the graph layout, line ends met token centers with
  0 px of error. The shortest button was 102 px tall (320×568, 100% text).

  | Viewport | Text | Layout | Route height |
  | --- | --- | --- | --- |
  | 390×844 | 100% | Graph | 926 px |
  | 390×844 | 200% | Trail | 1,494 px |
  | 320×568 | 100% | Trail | 1,027 px |
  | 320×568 | 200% | Trail | 1,927 px |
  | 844×390 | 100% | Graph | 904 px |
  | 844×390 | 200% | Graph | 1,163 px |
  | 1280×800 | 100% | Graph | 904 px |
  | 1280×800 | 200% | Graph | 1,163 px |

- **Icon measurements.** Throwaway vitest files, since deleted, rendered
  `renderLandIcon` in every style at 24 and 36 px, with and without
  `forceProcedural` and monochrome, and at 32 px as the log calls it.
- **Contrast.** Ratios use the WCAG 2 formula against the panel background
  `#0e2029`.
- **Not covered.** 720×360, forced colors, the real renderer's markup, real
  devices and assistive technology.
- **Figure files.** The figures are lossy WebP (quality 82, about 63 KB in
  total) in `adventure-map-graph/` next to this plan.
  - They are design documentation, not application assets: they are outside
    `public/`, so they are neither deployed nor precached.
  - Maintainers who prefer pull request attachments under
    [`pr-workflow.md`](../agent/pr-workflow.md#screenshots) can move them.
