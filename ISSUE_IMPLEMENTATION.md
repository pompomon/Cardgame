## Title
Plan: Web-based 2-player Card Game (P2P, Human/AI, SPA Offline)

## Summary
This issue documents the implementation of a simplified Magic-style 2-player card game as a web SPA with local play, AI play, manual-signaled P2P support, and offline capability.

## Scope and rules baseline (Rules v1)
- 2 players only.
- Starting life: 20.
- Deck composition: deterministic starter deck with lands and creatures.
- Turn flow: untap + sickness clear, draw, main, declare attackers, declare blockers, combat resolve.
- Land play limit: 1 per turn.
- Mana: lands tap automatically to pay creature costs.
- Combat: one blocker per attacker; simultaneous combat damage.
- Win conditions: opponent life <= 0 or opponent loses by empty-deck draw.
- Non-goals: advanced stack interactions, >2 players, ranked matchmaking.

## Product requirements coverage
- Human vs Human (local): implemented.
- Human vs AI: implemented.
- AI vs AI (simulation): implemented.
- P2P online mode: implemented via WebRTC data channel + manual offer/answer exchange.
- Offline SPA support: implemented via service worker caching strategy.

## Architecture
- SPA shell: Vite + TypeScript.
- Shared game engine: pure TS module (`src/game/engine.ts`).
- AI module: heuristic policy (`src/game/ai.ts`).
- Networking module: P2P wrapper (`src/net/p2p.ts`).
- UI orchestration: `src/main.ts`.
- Persistence: browser cache for app shell assets (service worker runtime caching).

## Game engine implementation details
- Entity modeling:
  - `Card`, `BattlefieldCard`, `PlayerState`, `GameState`, `GameAction`.
- Deterministic deck generation and seeded shuffle in `src/game/cards.ts`.
- Rule enforcement:
  - phase- and actor-gated actions,
  - mana affordability,
  - land-per-turn restrictions,
  - attack/block legality,
  - combat death and life updates.
- Replay/debug log:
  - append-only textual log in `state.log` shown in UI.

## P2P implementation details
- Uses browser `RTCPeerConnection` + data channel.
- Manual signaling workflow:
  - Host creates encoded offer.
  - Joiner accepts offer and returns encoded answer.
  - Host accepts answer.
- Synchronization model:
  - lockstep action replication (`action` packets),
  - shared deterministic seed for game start/rematch (`start`, `rematch` packets).

## AI implementation details
- Heuristic policy ordering:
  1. play land,
  2. cast highest-cost available creature,
  3. attack when possible,
  4. submit blockers,
  5. fallback to first legal action.
- Deterministic behavior for reproducible tests.

## SPA + offline support
- Service worker at `public/sw.js`.
- App-shell caching on install and runtime cache fill for same-origin GET requests.
- Offline fallback to cached `/index.html`.

## UX/screens implemented
- Lobby mode selection.
- P2P signaling panel for host/join.
- In-game board:
  - life/hand/deck/graveyard summaries,
  - battlefield rendering with tapped/sick flags,
  - phase-specific action panels.
- Replay log panel.
- Rematch and return-to-lobby controls.

## Testing and quality
- Added unit tests with Vitest:
  - `src/test/engine.test.ts`: land-play limit + unblocked combat damage scenario.
  - `src/test/ai.test.ts`: AI action priority.
- Validation scripts:
  - `npm run lint` (TypeScript no-emit check),
  - `npm run build`,
  - `npm run test`.

## Milestone mapping
- M1 Rules spec + engine skeleton: complete.
- M2 Playable local Human vs AI: complete.
- M3 Playable Human vs Human P2P: complete (manual signaling).
- M4 Offline hardening + PWA baseline: complete for app-shell caching.
- M5 QA and balancing: partially complete (initial automated tests included).

## Acceptance criteria status
- Two players can complete a full match under Rules v1: ✅
- Human/AI and Human/Human playable: ✅
- P2P match with synchronized turn actions: ✅
- SPA loads and supports offline local gameplay: ✅
- Core rules + behavior covered by automated tests: ✅ (baseline suite)

## Open questions
- Expand or customize card pool and deck constraints.
- Add richer stack/priority model or keep permanently out-of-scope.
- Optional hosted signaling service for easier matchmaking.
- Reconnect recovery and persisted match-state depth.
