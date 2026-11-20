# Auto battle plan

> [!IMPORTANT]
> Plan only: nothing below is implemented. Line numbers refer to baseline
> `main` at `a1eec3c`. When the last PR lands, replace this file with a
> `docs/history/` summary under
> [Archiving completed plans](../agent/pr-workflow.md#archiving-completed-plans).

An **Auto battle** switch for Human vs AI games: single games (`local-hvai`)
and Adventure encounters (`adventure-hvai`). While it is on, the **Hard** AI
plays the human's seat, whatever level the opponent uses. **Take control**
hands the seat back at once.

## Goals

- One switch, in the Game Menu and on the Adventure map, hands the human seat
  to Hard and back.
- While Hard plays, a **Take control** button stays on screen in every shell,
  and an AI move redrawing the screen never swallows its click, tap or key.
- Auto moves use the existing scheduler, legality check and recording path, so
  auto-played games record, replay and score like any other game.
- Nothing new is saved. Saves, recordings, the engine and the AI policies keep
  their formats and behavior.

## Non-goals

- Auto battle in the tutorial, Hot Seat (`local-hvh`), AI vs AI, P2P, replay
  or the terminal CLI.
- A level picker for the auto player: it is always Hard.
- Choosing Adventure nodes, rewards or retries automatically
  ([Q3](#open-questions)).
- Fixing the redraws that already close the Cards dialog and drop Game Menu
  clicks on every AI move (as in AI vs AI). This plan only keeps its own
  controls clear of them ([risks](#risks-and-fallbacks)).

## Baseline findings

| Area | Finding at `a1eec3c` | Consequence |
| --- | --- | --- |
| Seats | `local-hvai`, `adventure-hvai` and `tutorial` use `controllers: ['human', 'ai']`; seat 0 is the human (`src/app/types.ts:18-19`). Adventure has no per-node level; it uses the global `state.aiLevel`. | The auto seat is the seat whose controller is `'human'`. |
| Scheduler | `scheduleAiIfNeeded` (`src/app/controller.ts:644-688`) acts only when `controllers[actor] === 'ai'`, checked before arming and again in the 350 ms timer. It calls `chooseAiAction(game, actor, { level: state.aiLevel, seed: state.seed })`, then `applyRecordedAction(action, 'ai', true)`. A null or illegal action returns without acting. | Auto battle only changes which seats count as AI and their level. The timer's re-check makes turning it off immediate. |
| Submission | `submitAction` (`controller.ts:1276-1283`) applies any legal action as `'human'`; only a pending P2P rematch blocks it. | A stale human submission needs a guard against acting for the auto seat. |
| Redaction | `shouldHideHandFromViewer` (`src/app/game-presentation.ts:179-184`), the board's `presentation.resolve` (`src/app/board-presentation.ts:36-58`) and `src/renderers/three/interaction.ts:66` derive the viewer from `controllers`. | Setting seat 0 to `'ai'` in `controllers` would reveal the opponent's hand. **Never mutate `controllers`.** |
| Swamp reveal | `shouldRevealEnemyHandForSwamp` (`game-presentation.ts:227-242`) shows the opponent's hand to a human choosing a Swamp discard. | Must not reveal while Hard chooses for seat 0. |
| View model | `actorControl = state.controllers[actor]` and `canInput` (`src/app/view-model.ts:286-287`) gate the board, dock, targets and responses (`board.ts:505`, `interface-model.ts:163,177`, `interaction.ts:77`). | The auto seat must read exactly like an AI turn. |
| Desktop HUD | `renderThreeHud` (`src/renderers/three/interface-model.ts:763-789`) prints turn, phase, actor, status and "Waiting for the other player." (`:786`). `ThreeInterface.render` rewrites `hudHost.innerHTML` whenever that changes (`src/renderers/three/interface.ts:750-752`). | A button in the HUD is replaced on every move. A click whose press spans a redraw is lost: about one in three at the 350 ms cadence (estimate: a 100 ms press). |
| Game Menu | `renderMenu` (`interface-model.ts:336-346`) embeds the log, so an open menu is rebuilt on every move. | A menu switch has the same loss while both seats auto-play. |
| Stale clicks | `latestForAction` (`interface.ts:548-557`) drops a click when `threeDecisionKey` (`interface-model.ts:153-159`) changed since the render. | Every AI move changes the key, so Take control can't go through it. |
| Touch dock | `threeDockModel` (`interface-model.ts:836-940`) branches: replay, game over, targets, response, `!canInput` "Waiting for the other player." (`:914`), main. The actions node is rewritten only when its markup changes (`interface.ts:730-754`). | A constant dock model survives moves, so its button is never replaced. |
| Focus | When the focused control disappears, `render` restores it by `focusKey` (`interface.ts:80-85`) or, from the dock, calls `focusDock` (`:786-796`), which can land on the primary button (End Turn). `dispatchAdventure` (`:524-540`) sends lost in-game focus to Menu. | Removing Take control must send focus to Menu, never End Turn. |
| AI cost | Hard runs on the main thread: 3.54 ms mean, 7.42 ms p95 in Node ([Off-main-thread decisions](hard-ai-search-roadmap.md#off-main-thread-decisions)). | Auto battle adds a Hard call for every human-seat action. |
| Determinism | AI randomness comes from state, seat, seed and budget ([Seeded AI randomness](../../AGENTS.md#seeded-ai-randomness)). | Hard for seat 0 with `state.seed` is reproducible and independent of seat 1. |

## Decisions

Defaults chosen in autopilot; each is reversible and repeated under
[open questions](#open-questions).

- **D1 A seat override, not a controller change.** `AppState.autoBattle`
  makes the human seat play as Hard. `state.controllers`, `view.controllers`,
  redaction, board perspective, log, recordings and saves keep
  `['human', 'ai']`.
- **D2 Always Hard, seeded from the game.** The auto seat calls
  `chooseAiAction(game, actor, { level: 'hard', seed: state.seed })`. The
  opponent keeps `state.aiLevel`.
- **D3 In memory only.** Never persisted, so it is off after a reload. It
  carries across rematches and Adventure encounters. Back to Lobby, Pause,
  Reset, a new game or run, resuming a run and importing a recording clear it.
- **D4 Set, not toggle.** Each control carries the state it sets
  (`setAutoBattle(enabled)`), so a duplicate or stale click can't flip it back.
- **D5 On from a switch, off from Take control.** The switch is in the Game
  Menu and on the Adventure map. Take control lives in a node that moves never
  replace: the touch dock, or a desktop HUD column. The menu switch also turns
  it off.
- **D6 Adventure counts normally.** Auto-played encounters use chances and
  count toward streaks, the high score and rewards. Map decisions stay manual.
- **D7 No engine or AI changes.** `src/game/` is untouched, so
  `npm run test:bench` is not required.

## Design

### State and `src/app/auto-battle.ts`

A new leaf module with type-only imports (`AppState`, `ControllerKind`,
`Mode`, `AiLevel`): no storage, DOM, controller or renderer imports. It uses
equality checks, not switches. A boundary test pins its imports, as
`src/test/adventure-setup.test.ts:461` does.

```ts
type AutoBattleInput = Pick<AppState,
  'autoBattle' | 'mode' | 'replay' | 'game' | 'controllers' | 'adventure' | 'aiLevel'>

export const AUTO_BATTLE_AI_LEVEL: AiLevel = 'hard'
export function isAutoBattleMode(mode: Mode | null): boolean
export function canEnableAutoBattle(state: AutoBattleInput): boolean
export function isAutoBattleSeat(state: AutoBattleInput, actor: number): boolean
export function aiLevelForSeat(state: AutoBattleInput, actor: number): AiLevel | null
export function effectiveControllers(state: AutoBattleInput): [ControllerKind, ControllerKind]
```

- `isAutoBattleMode`: `local-hvai` or `adventure-hvai`.
- `canEnableAutoBattle`: the mode qualifies, `replay === null`,
  `adventure.pendingCompletion === null`, and in `adventure-hvai` the run is
  `active` or `paused` (the map's `resumable`, `interface-model.ts:657`).
- `isAutoBattleSeat`: `autoBattle`, `canEnableAutoBattle`, a game whose phase
  is not `gameOver`, and `controllers[actor] === 'human'`.
- `aiLevelForSeat`: `AUTO_BATTLE_AI_LEVEL` for the auto seat, `aiLevel` for an
  `'ai'` seat, otherwise `null`.
- `effectiveControllers`: a new tuple with the auto seat as `'ai'`. Only
  `actorControl` and the Swamp reveal use it.

`AppState.autoBattle: boolean` (`types.ts:164-197`) starts `false`
(`controller.ts:214-238`). `src/app/ai-levels.ts` exports
`aiLevelLabel(level)`, so copy names the level from `AI_LEVEL_LABELS` and
follows `AUTO_BATTLE_AI_LEVEL`
([Reuse shared helpers](../../AGENTS.md#reuse-shared-helpers)).

### Controller

**`ControllerApi.setAutoBattle(enabled: boolean): void`** (`controller.ts:166`):

1. Unchanged state: return without notifying.
2. `enabled` while `canEnableAutoBattle` is false: return without notifying.
   Turning off is always allowed.
3. Set the flag and the status ([copy](#copy)). A pending Adventure result
   keeps its warning: only the flag changes
   ([Status-message ordering](../../AGENTS.md#status-message-ordering)).
4. `notify()`, then `scheduleAiIfNeeded()`, the existing order.

**Scheduler.** Both `controllers[actor] !== 'ai'` checks in
`scheduleAiIfNeeded` (`controller.ts:651-654`, `:663-665`) become
`aiLevelForSeat(this.state, actor)`. A `null` returns; otherwise the level goes
to `chooseAiAction` with `seed: this.state.seed`. The tutorial branch is
unchanged (Auto battle is never available there). The timer re-reads the flag,
so a timer armed before Take control can't act for the human, and
`setAutoBattle` clears it anyway.

**Submission guard.** `submitAction` returns before `applyRecordedAction` when
`isAutoBattleSeat(state, action.actor)`, after setting the refusal status and
notifying. The game, recording and log stay unchanged.

**Lifecycle.**

| Entry point | Flag | Note |
| --- | --- | --- |
| `startGame` (`:1109`) | cleared after the pending-result guard | A game started from the lobby starts manual. |
| `startAdventure` (`:797`) | cleared after a successful persist | Not in `enterAdventureHub`, which every encounter passes through. |
| `resumeAdventure` (`:950`) | cleared after its guards | Includes a restored mid-game snapshot. |
| `importRecordingJson` (`:1346`) | cleared after the pending-result guard | The import sets its own mode and controllers. |
| `resetToLobby` (`:1177`) | cleared | Covers Pause (`:1075`), Reset (`:1097`) and Back to Lobby (`:1204`). |
| `rematch` (`:1285`) | kept; status adds the notice | An armed rematch starts auto-played. |
| `startAdventureNode` (`:835`) | kept; status adds the notice | Encounters chain under one switch. |
| `enterAdventureHub` (`:331`), `launchAdventureGame` (`:350`), `commitAdventureResult` (`:399`), rewards (`:885-889`), `retryAdventureCompletion` (`:938`) | kept | The map shows the switch's state. |
| `startReplay` (`:1441`), `exitReplay` (`:1526`) | kept; replay pauses auto play; `exitReplay`'s status adds the notice | `exitReplay` already reschedules. |

The notice is appended only to the success status; any later warning is still
assigned last.

### View model

- `actorControl` is `effectiveControllers(state)[actor]` and `canInput` keeps
  its formula (`view-model.ts:286-287`). The auto seat reads as an AI turn:
  board input, drag, primary button, targets and responses close.
- The Swamp reveal (`:298-303`) takes `effectiveControllers(state)`, so Hard's
  Swamp choice never shows the opponent's hand.
- `projectPlayersForPresentation` (`:305`), `view.controllers`, the log and
  recording metadata keep `state.controllers`.
- `AppViewModel.autoBattle` is a frozen `{ available, enabled, active }` in the
  no-game branch (`:250-282`, the map) and the game branch (`:350-406`):
  `available` is `canEnableAutoBattle(state)`, `enabled` is
  `state.autoBattle`, and `active` is both plus a game that is not over
  ([Immutable view-model snapshots](../../AGENTS.md#immutable-view-model-snapshots)).
- `threeDecisionKey` (`interface-model.ts:153-159`) adds
  `view.autoBattle.enabled`. Every flip is a new decision, so selections,
  previews, hover and peeks reset even when `actorControl` doesn't change (the
  opponent's turn, game over, the map).

### Interface

#### Switch

A helper beside `button` (`interface-model.ts:264`), which escapes its label
and can't hold a state span:

```html
<button type="button" class="three-auto-battle-switch" data-action="auto-battle"
  data-auto-battle="on" role="switch" aria-checked="false">Auto battle
  <span aria-hidden="true">Off</span></button>
```

- `aria-checked` and the visible On/Off show the current state.
  `data-auto-battle` holds the state a click sets.
- No `id`. `focusKey` matches it by `data-action` across rebuilds, so it keeps
  focus after a flip. Don't add `data-auto-battle` to `focusKey`.
- **Game Menu** (`renderMenu`, `interface-model.ts:336-346`): in the actions
  row after Cards while `view.autoBattle.available`. At a `local-hvai` game
  over it stays, to arm or disarm the rematch.
- **Adventure map** (`renderThreeAdventureHub`, `:654-686`): in the
  "Adventure options" nav after Recording while the run is resumable and
  `available`. Tab order becomes "…, then Settings, Recording and Auto
  battle" ([Adventure hub](../agent/three-interface.md#adventure-hub)).
- No lobby setting (D3).

#### Take control

`<button type="button" data-action="auto-battle" data-auto-battle="off">Take control</button>`
is an action, not a switch. It renders only while `view.autoBattle.active`:

- **Touch shells** (`narrow`, `dock`, `rail`): `threeDockModel` returns a
  constant model right after the game-over branch, before targets:
  `{ prompt: 'Auto battle: the Hard AI is playing for you.', actions: <Take
  control>, quiet: true }`. The markup is identical across moves, so
  `dockActions` is never rewritten and a tap can't be lost. The primary slot
  (End Turn) stays hidden because `canInput` is false. `quiet` keeps the dock
  prompt's live region off; the status announcer already speaks the change.
- **Desktop:** the HUD bar below. While active, the desktop HUD drops its
  "Waiting for the other player." line (`interface-model.ts:786`), and the bar
  says who is playing.

#### Desktop HUD bar

Rejected alternatives:

- Inside the HUD markup: replaced on every move.
- A fixed overlay: covers the board and needs its own focus order.
- The board's primary button: it captures its action on pointer down and
  Enter (`src/renderers/three/board.ts:832-851`), so reuse risks a double
  activation ending the turn.
- Deferring HUD redraws while a pointer is down: complex, and it delays status.

Chosen:

- `ThreeInterface` creates two persistent children of `hudHost`:
  `div.three-hud-content`, which receives today's HUD markup, and
  `div.three-hud-bar`, diffed against its own markup cache.
  `hudBar.hidden = !barMarkup`; `hudHost.hidden = !hudMarkup && !barMarkup`.
- Bar markup, desktop shell only, while active:
  `<div class="three-auto-battle-bar" role="group" aria-label="Auto battle"><p>The Hard AI is playing for you.</p><button …>Take control</button></div>`.
  It is constant while active, so it is written once per activation.
- Without a `hudHost` (the `three-interface.test.ts` default,
  `separateHud = false`), the bar follows the inline HUD markup. Production
  always passes one (`src/renderers/three/index.ts:74`).
- CSS, `src/renderers/three/renderer.css`:
  - `.three-root--game .three-hud-mount` (`:22-28`) becomes `display: grid;
    grid-template-columns: minmax(0, 1fr) auto; align-items: start;
    overflow: hidden`, keeping `height: 100%; min-height: 0`. It stays above
    `.three-hud-mount[hidden]` (`:51`): equal specificity, so `[hidden]` must
    remain later.
  - `.three-root--game .three-hud-content` takes the mount's old scroll:
    `height: 100%; min-height: 0; overflow: auto; overscroll-behavior:
    contain; scrollbar-gutter: stable`.
  - The touch rule (`:143-149`) adds `.three-hud-content` with
    `overflow: hidden; scrollbar-gutter: auto`, so touch shells keep today's
    clipping.
- CSS, `src/renderers/three/interface.css`: `.three-auto-battle-bar` with
  `max-height: 100%`, its own `overflow: auto` and a `max-width`; a 44×44
  button. It sits in the HUD row, whose height is fixed (`grid-template-rows:
  clamp(96px, 16dvh, 144px) …`), so it never moves or covers the board.

#### Clicks, keys and focus

- `handleClick` (`interface.ts:944`) handles `data-action="auto-battle"`
  after the `data-mode` branch and before `latestForAction()`. It reads
  `data-auto-battle` as `'on'` or `'off'` with equality checks (anything else
  is ignored, [No string-to-enum casts](../../AGENTS.md#no-string-to-enum-casts)),
  then reads `controller.getViewModel().autoBattle`. It calls `setAutoBattle`
  once, only when the target differs from `enabled` (and, for on, while
  `available`). Otherwise it dispatches nothing and refreshes from the latest
  view, as `latestForAction` does.
- The existing modal and drag guards still apply: Take control is inert under
  an open dialog or during a card drag.
- `handleKeydown` (`interface.ts:866`) prevents the default of a repeated
  Enter or Space on an Auto battle control (`event.repeat`), as the board's
  primary button does (`board.ts:836-840`).
- Take control sets a one-shot focus fallback, consumed by the next `render`:
  when the focused control is gone, focus `[data-action="menu"]` instead of
  calling `focusDock`. Focus never passes through End Turn, even briefly.
  Guard against disposal as `dispatchAdventure` does.

#### Copy

| Moment | Text |
| --- | --- |
| On, game in progress | Auto battle on: the Hard AI is playing for you. Choose Take control to play yourself. |
| On, no game in progress (map, game over) | Auto battle on: the Hard AI will play your next game. |
| Off | Auto battle off: you play your own turns. |
| Refused human submission | Auto battle is playing for you. Choose Take control first. |
| Rematch, node start or replay exit while on | The existing status, then " Auto battle is on." |
| Dock prompt | Auto battle: the Hard AI is playing for you. |
| Desktop bar | The Hard AI is playing for you. (group "Auto battle") |

"Hard" comes from `aiLevelLabel(AUTO_BATTLE_AI_LEVEL)`. Status reaches
assistive technology only through `view.status` and the existing announcer
([Status announcements](../agent/three-interface.md#status-announcements)); no
new live region. The Cards dialog keeps "Player 1 (human)"
(`interface-model.ts:719`).

### Recordings and replay

- Auto moves go through `applyRecordedAction(action, 'ai', true)`, so their
  steps record `source: 'ai'`. The parser validates `source`
  (`src/app/game-recording.ts:537`) and the UI never shows it. Metadata
  (`controllers`, `aiLevel`) still describes the human-vs-AI game and the
  opponent's level.
- An auto-played recording replays like any other.
- `startReplay` mid-game pauses auto play (the scheduler ignores replay);
  `exitReplay` resumes it.

### Adventure

- Pause, Reset and resume clear the flag. The mid-game snapshot keeps the real
  controllers, so the run schema stays at version 2
  ([Adventure run schema version 2](../agent/state-and-persistence.md#adventure-run-schema-version-2)).
- A committed result goes straight to the map (`interface-model.ts:855-856`).
  The flag stays, and the next node start auto-plays.
- A refused result (pending completion) hides the switch. Retry and Reset stay
  manual, and their status is never replaced.
- Scoring is unchanged ([Q2](#open-questions)).
- If the [Adventure difficulty](hard-ai-search-roadmap.md#adventure-difficulty)
  follow-up adds per-tier budgets, they apply to the opponent only. The auto
  seat keeps Hard's default budget.

### Performance

- With Auto battle on, every action of the human seat is a Hard decision, at
  most one per 350 ms tick, on the main thread. No new
  `structuredClone(GameState)`
  ([No GameState clones in hot loops](../../AGENTS.md#no-gamestate-clones-in-hot-loops)).
- PR-3 measures decision latency in the production preview with 4× and 6× CPU
  throttling. A p95 above 16 ms triggers
  [Off-main-thread decisions](hard-ai-search-roadmap.md#off-main-thread-decisions),
  which is outside this plan.

## Delivery sequence

```text
PR-1  Controller and view model ──┐
                                  ├─► PR-3  Auto battle UI
PR-2  HUD mount split ────────────┘
```

- PR-1 and PR-2 are independent and change nothing visible. PR-3 needs both.
- Each PR follows `.github/PULL_REQUEST_TEMPLATE.md`, runs the
  [validation sequence](../agent/validation-and-build.md#sequence)
  (`npm run lint`, `npm run test`, `npm run build`, CodeQL) and reports
  baseline and post-change results separately
  ([Validation status](../agent/pr-workflow.md#validation-status)).
- Each PR fits one agent session: hand the agent its section of this plan.

### PR-1: Controller and view model

1. `src/app/auto-battle.ts` with `src/test/auto-battle.test.ts`;
   `aiLevelLabel` in `src/app/ai-levels.ts`.
2. `types.ts`: `AppState.autoBattle` and `AppViewModel.autoBattle`.
3. `controller.ts`: `setAutoBattle`, the scheduler, the submission guard, the
   lifecycle and the status notice.
4. `view-model.ts`: `actorControl`, the Swamp reveal and `autoBattle`.
5. Fixtures: `autoBattle: false` in the `AppState` literals
   (`src/test/action-resolution.test.ts:20`,
   `adventure-route-graph.test.ts:79`, `three-battlefield-controls.test.ts:134`,
   `view-model.test.ts:67`); `autoBattle: { available: false, enabled:
   false, active: false }` in the `AppViewModel` literals
   (`three-interface.test.ts:44` `makeView`, `three-interaction.test.ts:107`
   `createView`); `setAutoBattle: vi.fn()` in the `satisfies ControllerApi`
   mock (`three-interface.test.ts:284-294`). `three-renderer.test.ts` mocks
   the interface and needs nothing.
6. Docs: [AI decisions](../agent/architecture.md#ai-decisions) (the auto seat
   and its level); [Controller hygiene](../agent/state-and-persistence.md#controller-hygiene)
   (lifecycle, set semantics, never persisted);
   [View-model hygiene](../agent/state-and-persistence.md#view-model-hygiene)
   (effective controllers for input only, real controllers for redaction).

### PR-2: HUD mount split

No behavior change.

1. `ThreeInterface` creates `hudContent` and an empty, hidden `hudBar` in
   `hudHost`. `render` writes the HUD markup to `hudContent`; `dispose`
   (`interface.ts:1223`) clears both.
2. CSS moves the scroll from the mount to `.three-hud-content`, with the touch
   rule, as in [Desktop HUD bar](#desktop-hud-bar).
3. Tests:
   - The `three-interface.test.ts` harness exposes `hudContent`
     (`hud.children[0]`) and `hudBar` (`hud.children[1]`). The 18
     `h.hud!.innerHTML` and 4 `h.hud!.builds` reads move to `hudContent`
     (lines 841, 850, 1050, 1060, 1119, 1141, 2176, 2279, 2420, 2424, 2500,
     2512, 2521, 2586, 2686, 2689, 2705, 2738, 2739, 2767, 2799, 3884).
   - `src/test/three-card-preview-layout.test.ts:33` asserts the scroll on
     `.three-hud-content` and the grid on the mount.
   - `src/test/three-layout.test.ts:389` and `:533` stay as they are.
4. Docs: the HUD mount structure in
   [three-interface](../agent/three-interface.md#mobile-layout).
5. Browser evidence that nothing moved: desktop 1280×800 and the
   [Fold4 postures](../agent/browser-checks.md#fold4-posture-check) at 100%
   and 200% text.

### PR-3: Auto battle UI

1. `interface-model.ts`: the switch helper, the Game Menu and map switches,
   the dock model, the bar markup, the desktop "Waiting" line, and
   `view.autoBattle.enabled` in `threeDecisionKey`.
2. `interface.ts`: the bar diff and inline fallback, the click branch, the key
   repeat guard and the focus fallback.
3. CSS: the bar and the switch's on and off states.
4. Docs: an Auto battle paragraph under the README's
   [AI levels](../../README.md#ai-levels) (the AI vs AI sentence stays);
   [three-interface](../agent/three-interface.md#rules) rules, status copy,
   the map tab order and the touch dock; an "Auto battle controls" subsection
   under the
   [Stateful UI regression matrix](../agent/testing.md#stateful-ui-regression-matrix);
   an "Auto battle check" in [browser-checks](../agent/browser-checks.md).
5. Evidence ([Screenshots](../agent/pr-workflow.md#screenshots)): the Auto
   battle check below, and throttled latency.

## Test plan

Fake timers come from `withFakeTimers` or `installFakeTimerHooks`, and AI
tests pass explicit seeds ([testing rules](../agent/testing.md#rules)).

**`auto-battle.test.ts` (PR-1).** Availability per mode: only `local-hvai`
and `adventure-hvai`. Replay, a pending result, a finished run and game over
turn the seat off. `aiLevelForSeat` returns Hard, the global level or `null`.
`effectiveControllers` never changes seat 1 or the input tuple. Import
boundary.

**`controller-ai-level.test.ts` (PR-1)**, which mocks `chooseAiAction`:

- On the human's turn with the flag on, the timer calls
  `chooseAiAction(game, 0, { level: 'hard', seed: state.seed })` for every
  `aiLevel`; seat 1 still gets `aiLevel`.
- Turning off before 350 ms makes no call and applies nothing.
- A node start with the flag on schedules Hard for seat 0.
- A `null` choice stalls as today, and `setAutoBattle(false)` returns input.

**`controller.test.ts` (PR-1):**

- Each lifecycle entry point clears or keeps the flag as tabled.
- `setAutoBattle(true)` does nothing, without notifying, in the lobby,
  tutorial, Hot Seat, AI vs AI, P2P and replay. A repeated call notifies once.
- The submission guard leaves the game, recording and log unchanged.
- Auto moves record `source: 'ai'`, and the recording replays to the same
  final state.
- A mid-game replay pauses auto play; `exitReplay` resumes it.
- One full `local-hvai` game with a fixed seed, Hard against Basic, reaches
  `gameOver` within a bounded number of ticks.

**`adventure-controller.test.ts` (PR-1):**

- The flag survives commit, map and the next node start, with the notice.
- Pause, Reset, resume and a new run clear it.
- With a refused result, `setAutoBattle(true)` does nothing and
  `setAutoBattle(false)` keeps the warning.
- Tracked storage records no new keys.

**`view-model.test.ts` (PR-1):**

- Auto seat: `actorControl: 'ai'` and `canInput: false`, while
  `view.controllers` stays `['human', 'ai']`.
- The opponent's hand stays hidden, and the Swamp reveal stays `null` while
  Hard picks a Swamp discard.
- `autoBattle` is frozen and present with and without a game.

**`three-interface.test.ts` (PR-3).** The switch and Take control join the
[Stateful UI regression matrix](../agent/testing.md#stateful-ui-regression-matrix)
with a real `AppController`, as the
[Adventure decision controls](../agent/testing.md#adventure-decision-controls)
do with `hold()` and `release()`:

- Markup: role, `aria-checked`, target and visible state; present in both
  Human vs AI modes and on the map after Recording, with the tab order;
  absent in other modes, in replay and with a pending result.
- Stale input: a click whose view moved on behind the interface still applies
  its target once.
- Duplicate activation before or after the redraw dispatches once; an unknown
  `data-auto-battle` dispatches nothing.
- Persistence: across simulated AI moves, the dock actions and the bar keep
  their nodes (`builds` unchanged) in every shell.
- Focus: Take control by click, Enter and Space moves focus to Menu, never End
  Turn; a double click neither submits nor ends the turn; repeated Enter or
  Space is prevented.
- Disposal during notification throws nothing and writes nothing.
- Desktop: no "Waiting for the other player." line while active.

**CSS tests (PR-2, PR-3).** The mount grid stays before the `[hidden]` rule;
the scroll is on `.three-hud-content`; touch shells clip; the bar has 44×44
targets.

**Auto battle check (PR-3, browser-checks).** On the production preview:

- Turn on from the Game Menu and the map; play through a node and a rematch.
- Take control mid-move 20 times each by mouse, touch and keyboard, with zero
  misses, and focus on Menu each time.
- The opponent's hand never shows, including Swamp turns.
- Desktop 1280×800 and the Fold4 postures at 100% and 200% text: no
  overflow, nothing covered, every control at least 44 CSS pixels.
- Decision latency p95 with 4× and 6× CPU throttling.

## Docs updates

| Doc | Change | PR |
| --- | --- | --- |
| [architecture](../agent/architecture.md#ai-decisions) | The auto seat, its level and seed | PR-1 |
| [state-and-persistence](../agent/state-and-persistence.md#controller-hygiene) | Lifecycle, set semantics, in memory only; effective vs real controllers | PR-1 |
| [three-interface](../agent/three-interface.md#rules) | HUD mount children; switch and Take control rules, copy, map tab order, touch dock | PR-2, PR-3 |
| [testing](../agent/testing.md#stateful-ui-regression-matrix) | Auto battle controls in the matrix | PR-3 |
| [browser-checks](../agent/browser-checks.md) | Auto battle check | PR-3 |
| [README](../../README.md#ai-levels) | Auto battle paragraph | PR-3 |
| This plan | `docs/history/` summary; pending device checks to the maintainer-gates issue | After PR-3 |

## Risks and fallbacks

| Risk | Mitigation |
| --- | --- |
| Hand reveal through a controller change | D1; view-model tests assert hidden hands and a `null` Swamp reveal. |
| Take control misses a click | A node that moves never replace, set semantics, and a check that bypasses the stale-click drop; tests pin node identity; the browser check counts misses. |
| An open Game Menu drops clicks on every move (it embeds the log) | Pre-existing in AI vs AI. Take control is the reliable off path; a follow-up could stop the log rebuilding the dialog. |
| The Cards dialog and previews close on every AI move | Pre-existing during AI turns. Documented; a follow-up could keep them across decisions when the viewer has no input. |
| Hard returns no action for the auto seat | Pre-existing stall for AI seats. Take control returns the seat; tested. |
| Hard is slow on throttled phones | Measured in PR-3; the off-main-thread follow-up has a trigger and shape. |
| The bar crowds the desktop HUD at 200% text | Its own `max-width` and overflow; the HUD row keeps its fixed height; browser check. |
| The HUD wrapper changes touch layout | PR-2 lands alone with no behavior change and its own evidence. |
| Focus lands on End Turn after Take control | The one-shot Menu fallback; focus and double-click tests. |
| The game ends while Take control has focus | Existing dock rule: focus moves to the first game-over action, as after a human's winning move. |
| Auto-played Adventure scores feel unearned | [Q2](#open-questions). |

## Open questions

Defaults are applied; a different answer changes only the PR named.

- **Q1 Lifetime.** Default: in memory, kept across rematches and encounters,
  cleared by Back to Lobby, Pause, Reset, a new game or run, resume, import
  and reload (PR-1). Alternatives: a persisted preference (a new validated
  storage key), or clear at every game end.
- **Q2 Adventure scoring.** Default: auto-played encounters count normally.
  Alternatives: mark the run as assisted (schema version 3 with a migration),
  or keep auto-played wins out of the high score (PR-1).
- **Q3 Map decisions.** Default: nodes, rewards and Retry stay manual.
  Alternative: a full auto mode that also picks them, which needs its own
  policy and plan.
- **Q4 Placement.** Default: on from the Game Menu and the map, off from Take
  control or the menu (PR-3). Alternatives: an always-visible in-game switch
  in the dock and the desktop bar, or a lobby setting.
- **Q5 Scope.** Default: Human vs AI only, with no keyboard shortcut.
  Alternative: a shortcut listed under Cards & keyboard controls (PR-3).
- **Q6 Opponent level.** Default: unchanged. Alternative: always Hard vs Hard
  while Auto battle is on (PR-1).
- **Q7 Turning off.** Default: immediately, cancelling the pending move.
  Alternative: finish the current turn first (PR-1).
- **Q8 Pace.** Default: the existing 350 ms per action. Alternative: a slower
  watching pace tied to the animation-speed setting (PR-1).
- **Q9 Hidden information.** Default: Hard keeps its usual view, including the
  opponent's hand, as when it plays the opponent; the UI never shows that
  hand. Alternative: wait for
  [a hand-blind level](hard-ai-search-roadmap.md#a-hand-blind-hard-or-expert-level).
- **Q10 Replay and Pause.** Default: replay pauses auto play and exiting
  resumes it; Pause clears the flag. Alternative: keep the flag through Pause
  and resume, which needs it persisted (PR-1).
- **Q11 Game over.** Default: the menu switch stays at a `local-hvai` game
  over to arm the rematch; Take control hides. Alternative: clear the flag at
  game over (PR-1).
