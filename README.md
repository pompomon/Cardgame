# Cardgame

## Rendering options

The app now supports two rendering backends:

- **DOM renderer** (default): existing HTML/CSS UI.
- **Phaser renderer**: graphic board with drag-and-drop card play.

Choose renderer by query string:

- `?renderer=dom`
- `?renderer=phaser`

The selected renderer is also stored in `localStorage` for later visits.

### Phaser drag-and-drop controls

- In main phase, when it is your human turn, drag a card from your hand to the battlefield drop zone.
- If the card has multiple legal targets (for example Forest/Swamp/Mountain/Plains target variants), an in-scene picker appears before action commit.
- In response phase, use explicit response buttons (counter/pass).
- Phaser renderer fills the full available viewport and continuously reflows on resize.
- Cards and battlefield zones scale from available width/height to remain usable in portrait and landscape.
- Phaser lobby groups controls into top-level actions plus **Settings** and **Recording** submenus.
- Card faces render pixel-art land icons (Forest/Island/Mountain/Plains/Swamp) plus text labels.

## Card visual styles

- Lobby includes a shared **Card Visual Style** selector for both renderers (under **Settings** in Phaser).
- Available styles:
  - **Classic**
  - **HD**
  - **Monochrome**
- Style selection is a client-side presentation preference persisted in browser local storage.
- Phaser uses static HD PNG card art when available. DOM (and Phaser fallback when textures are missing) uses generated land icons for the selected style, cached by land/style/size bucket.
- Core implementation lives in `src/app/card-visuals.ts` and style options in `src/app/card-visual-styles.ts`.

## AI levels

- Lobby now includes a shared AI level selector for all AI matches (under **Settings** in Phaser).
- Available levels:
  - **Basic**: plays the first legal action.
  - **Advanced**: prioritizes winning progress and disruption when the opponent is near-win.
  - **Hard**: advanced strategy + opponent hand awareness for targeted disruption.
- In **AI vs AI**, both bots use the same selected level from the single lobby selector.
- Recording metadata stores AI level and replay parsing keeps compatibility with older recordings that do not contain an AI level (defaults to `basic`).

### Extending with more AI levels

1. Add the level to `AiLevel` in `src/app/types.ts`.
2. Add the label to `AI_LEVEL_OPTIONS` in `src/app/ai-levels.ts`.
3. Implement a policy module in `src/game/ai-policies/`.
4. Register the policy in `AI_POLICY_REGISTRY` in `src/game/ai.ts`.
5. Add/update tests in `src/test/ai.test.ts` and controller/recording tests.

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
4. `npm run build`
5. Upload `dist` artifact
6. Deploy artifact to Pages

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
- If users report stale content after deployment, bump `CACHE_VERSION` in `public/sw.js`, redeploy, then hard-refresh.

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

- Cache versioning is handled in `public/sw.js` via `CACHE_VERSION`.
- If stale assets are observed after deployment, increment `CACHE_VERSION`, redeploy, and hard-refresh.

## Rollback / redeploy guidance

- Roll back by reverting the last bad commit on `main` or `master` and pushing that revert so the workflow deploys the reverted state.
- Redeploy by re-running the successful workflow run for the commit you want to restore from the Actions tab (or by pushing a no-op commit to `main` or `master`).
