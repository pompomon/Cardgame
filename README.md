# Cardgame

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
