# Cardgame

## Contributing / Agent docs

Contributor and AI-agent conventions live in [`AGENTS.md`](AGENTS.md), with
topic deep-dives under [`docs/agent/`](docs/agent/) (architecture,
validation/build, state and persistence, Three.js renderer and native interface,
service worker and PWA, testing, PR workflow). Read those before making
non-trivial changes; they capture recurring review findings.

## Browser rendering

Three.js is the browser application's sole renderer. It combines a fixed-camera
WebGL2 tabletop with native HTML menus, dialogs, P2P and recording controls, card
lists, and accessible keyboard actions.

Old links containing `?renderer=dom`, `?renderer=phaser`, or `?renderer=three`
remain usable. Startup removes that obsolete parameter while preserving other
query parameters and the hash, then discards the old stored renderer preference.

### Three.js controls and compatibility

- Requires WebGL2. Unsupported devices, initialization failures, or context loss
  show an accessible retry/reload screen. In-page retry preserves the controller
  and current match; there is no non-WebGL gameplay fallback.
- The lobby groups options into **Settings** and **Recording** submenus.
  During a match, the HUD above the table keeps Menu, turn/phase, status, and
  decision prompts available without opening the native card controls.
- Drag a playable hand card onto your battlefield. Touch and pen movement must
  cross a threshold; tapping opens a preview. Multiple legal targets are selected
  before committing the action.
- Both battlefield headers show Hand, Deck, and Graveyard counts. **End Turn**
  or **Pass Response** appears in the near-player battlefield header when
  appropriate; neither is available during replay or after game over.
- When responding with Island, click or tap an eligible card in your hand to
  counter immediately, discarding that card plus the first Island automatically.
  Pink rings mark eligible discards; the blue-ringed Island is included, not a
  separate choice. Another Island can be the additional discard. The hand overlaps
  cards as needed while keeping every choice on the table. Use **Pass Response**
  to decline. With animations enabled, a resolved counter briefly shows both
  discarded cards over the countering player's battlefield; the animation-speed
  setting controls the display duration, and **Off** skips it.
- **Game Menu → Cards & keyboard controls** opens the viewport-bounded native
  controls. Native play and target buttons provide the same actions without
  dragging. During a response, each eligible native hand-card control names the
  full discard cost and supports keyboard activation instead of opening a
  preview. Escape or **Back** returns to Game Menu; previews return to the Cards
  dialog, with focus and internal scroll positions preserved.
- Mouse hover shows a non-modal preview without taking focus; click, tap, or
  native keyboard controls still open the explicit preview. Hover is suppressed
  while dragging, choosing responses/targets, or using a menu.
- The game menu contains a collapsible **Replay Log** with the latest 200
  structured events, or legacy text for older recordings. Scrolling back stops
  automatic following; **Follow latest** resumes it.
- Card rows remain centered and overlap cards as needed so the entire hand and
  both battlefields stay visible without pagination. Short landscape layouts
  place player information beside the cards. Active gameplay fits the viewport
  without document or battlefield scrolling; dialogs scroll internally when
  space or enlarged text requires it. The camera stays fixed during dragging,
  and deck/graveyard stacks distinguish empty piles.
- Card Style, Board Theme, Render Quality, and Animations use their existing
  preferences. Startup does not force HD over a saved artwork style.
  Backgrounds use aspect-correct cropping and keep the previous theme visible
  while a replacement loads. Reduced motion, animation-off settings, and hidden
  pages suppress card movement, themed ambience, and cosmetic effects.
- Three.js loads on demand. Its chunk may not be available on a first offline
  visit; reconnect and reload, then open the game online once to cache its bundle
  and selected artwork. No external CDN, font service, or runtime art-generation
  API is required.
- Real-device performance varies. Lower Render Quality if interaction is slow;
  mobile Safari/Android hardware testing is recommended before wider rollout.

## Card visual styles

- The lobby includes a **Card Visual Style** selector under **Settings**.
- Available styles:
  - **Classic**
  - **HD**
  - **Monochrome**
- Style selection is a client-side presentation preference persisted in browser local storage.
- Three.js uses static PNG card art for each style in `ALL_CARD_ART`; its native
  interface falls back to generated land icons when an image cannot load.
- Core implementation lives in `src/app/card-visuals.ts` and style options in `src/app/card-visual-styles.ts`.

## AI levels

- The lobby includes an AI level selector for all AI matches under **Settings**.
- Available levels:
  - **Basic**: plays the first legal action.
  - **Advanced**: prioritizes winning progress and disruption when the opponent is near-win.
  - **Hard**: advanced strategy + opponent hand awareness for targeted disruption.
- In **AI vs AI**, both bots use the same selected level from the single lobby selector.
- Recording metadata stores AI level and replay parsing keeps compatibility with older recordings that do not contain an AI level (defaults to `basic`).

### Extending with more AI levels

1. Add the level to `AI_LEVELS` in `src/game/ai-levels.ts` (this derives the `AiLevel` type and the `isAiLevel` guard). Update `DEFAULT_AI_LEVEL` in the same file if the new level should become the default.
2. Add the label to `AI_LEVEL_LABELS` in `src/app/ai-levels.ts` (this auto-generates the lobby `AI_LEVEL_OPTIONS` entry).
3. Implement a policy module in `src/game/ai-policies/`.
4. Register the policy in `AI_POLICY_REGISTRY` in `src/game/ai.ts`.
5. Add/update tests in `src/test/ai.test.ts` and controller/recording tests.

## Terminal CLI

The game can run without a browser or network connection in two modes:

- `human-vs-ai` — the human is Player 1 and the AI is Player 2.
- `ai-vs-ai` — both players use the same selected AI level.

Node.js 22 is required. Install dependencies, then run:

```bash
npm run cli -- --mode human-vs-ai
npm run cli -- --mode ai-vs-ai --ai-level hard --seed 42 --delay-ms 0
```

Supported options:

- `--mode human-vs-ai|ai-vs-ai` (required for piped/non-interactive input)
- `--ai-level basic|advanced|hard` (default: `basic`)
- `--seed <non-negative integer>` for deterministic games
- `--delay-ms <0-60000>` between AI decisions (default: `350`)
- `--help`

Omit `--mode` in an interactive terminal to choose from a prompt. During a
Human vs AI game, enter a displayed action number or `q` to quit. The AI hand
stays hidden except while the human is choosing a legal Swamp discard target.

To create a copyable standalone Node ESM bundle:

```bash
npm run build:cli
node dist-cli/cardgame-cli.mjs --mode ai-vs-ai --seed 42 --delay-ms 0
```

The generated `dist-cli/cardgame-cli.mjs` uses the same engine and AI policies
as the SPA. It intentionally excludes networking, Human vs Human, adventure,
tutorial, browser persistence, recording/replay, and browser presentation.

## Game recording and replay

- You can save a game recording at any point, including after the game has ended.
- Save options:
  - **Download save file** (`.json`)
  - **Save to browser local storage**
- Load options:
  - **Load from browser local storage**
  - **Upload a saved `.json` file**
- Recording files are versioned and include:
  - Match metadata (seed, mode, controller types, timestamps, completion status)
  - Full timeline (initial game state + ordered action snapshots)
- Replay modes:
  - Step play-by-play (previous/next)
  - Auto-play (play/pause)
  - Jump directly to final recorded state
  - Exit replay to keep the final recorded game state visible

## GitHub Pages deployment

- Publishing target: **project site** at `https://pompomon.github.io/Cardgame/`.
- Deployment source: **GitHub Actions** via `.github/workflows/deploy-pages.yml`.
- Triggers:
  - Push to `main` or `master`
  - Manual `workflow_dispatch`

## Required repository settings

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Save settings.

## Build and deploy pipeline

The workflow runs:

1. `npm ci`
2. `npm run lint`
3. `npm run test`
4. `npm run test:bench`
5. `npm run build`
6. Upload `dist` as a one-day Pages artifact
7. Deploy the artifact to Pages
8. Delete that exact artifact after a successful deployment

## Actions storage policy

- The workflow deliberately does not persist an npm dependency cache. Each run
  installs from `package-lock.json` so old dependency caches do not occupy
  Actions storage between deployments.
- The Pages artifact is retained for at most one day and its unique ID is passed
  to the deploy job. A successful deployment deletes that artifact immediately;
  failed or cancelled deployments leave it available for diagnosis until it
  expires.
- After this policy is first deployed, obsolete setup-node entries can be
  removed from **Actions → Caches**, or left to expire under GitHub's cache
  policy. Only remove the `node-cache-…-npm-…` entries created by this workflow;
  dynamic Copilot artifacts are unrelated.
- Rerun the complete workflow when redeploying an older commit because a
  successfully deployed run no longer retains its transfer artifact.

After rollout, trigger the workflow manually and confirm that the site deploys,
the run's `github-pages` artifact is deleted, and no npm cache is created.
Monitor Actions storage for at least 48 hours; if a persistent baseline remains,
inventory artifacts from the dynamic Copilot workflows separately.

## Base path + service worker behavior

- Production build uses Vite base path `/Cardgame/`.
- The workflow derives `VITE_BASE_PATH` from the repository name by default (for example, `/Cardgame/`).
- You can override the production base path with a repository variable named `VITE_BASE_PATH` (for forks/renamed repos).
- Service worker registration uses the app base URL and passes it to the worker.
- The worker caches and falls back to the base-aware index path, which avoids root-path (`/`) mismatches on project Pages hosting.
- PWA install metadata (`manifest.webmanifest`, apple touch icon, launcher icons) is served from `public/` and must remain base-path-safe.

## Install on Android / iOS

### Android (Chrome)

1. Open the deployed app URL.
2. Use the in-app **Install App** button when shown (or browser install prompt).
3. Confirm installation.
4. Launch from home screen and verify it opens standalone.

### iOS (Safari)

1. Open the deployed app URL in Safari.
2. Use **Share** → **Add to Home Screen**.
3. Confirm icon/title and add.
4. Launch from home screen and verify standalone behavior.

## PWA runtime and offline expectations

- First online load primes service-worker caches for app shell and install-critical assets.
- After first successful load, navigation falls back to cached app shell when offline.
- `public/404.html` redirects deep links back into the SPA entry so shared non-root paths keep working on GitHub Pages project hosting.
- Hashed app builds rotate caches automatically. If same-path card or board art
  must be invalidated, bump `RUNTIME_ASSET_VERSION` in `public/sw.js`.

## PWA assets and metadata maintenance

- Keep these files in sync with branding/theme changes:
  - `public/manifest.webmanifest`
  - `public/apple-touch-icon.png`
  - `public/pwa-192.png`
  - `public/pwa-512.png`
  - `public/pwa-maskable-512.png`
- If icon names/paths change, update both `index.html` metadata links and `public/sw.js` static asset cache list.

## Post-deploy verification checklist

1. Open `https://pompomon.github.io/Cardgame/`.
2. Confirm assets load without 404 errors.
3. Confirm game modes render and can start.
4. Confirm P2P mode initializes (HTTPS context requirement is satisfied on Pages).

## Cache refresh guidance

- Shell/build cache schema and runtime-art epochs are handled separately in
  `public/sw.js`.
- If same-path card or board assets remain stale, increment
  `RUNTIME_ASSET_VERSION`, redeploy, and hard-refresh.

## Rollback / redeploy guidance

- Roll back by reverting the last bad commit on `main` or `master` and pushing that revert so the workflow deploys the reverted state.
- Redeploy by re-running the successful workflow run for the commit you want to restore from the Actions tab (or by pushing a no-op commit to `main` or `master`).
