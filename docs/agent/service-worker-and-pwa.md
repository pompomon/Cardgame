# Service worker and PWA

The application installs a custom service worker from `public/sw.js`. Keep its
URL handling consistent with Vite's configured non-root base path.

## Cache strategy

The worker derives its base path from the registration URL's `base` query
parameter.

- **Vite assets (`/assets/*`)** are hashed and cache-first.
- **Card art and board imagery (`/cards/*`, `/boards/*`)** keep stable public
  paths and are network-first with cache fallback.
- **Navigations** are network-first and fall back to the cached app shell.
- Cross-origin requests and unrelated paths pass through unchanged.

Do not precache `404.html` into the app-shell slot. It contains GitHub Pages
redirect logic, not the SPA.

Three.js remains a dynamic Vite entry outside the initial bundle. After one
successful online load its hashed chunk is cached by the `/assets/*` policy.
There is no gameplay fallback if that chunk is unavailable; `RendererHost`
shows an accessible recovery screen. A failed chunk import requires reload;
graphics failures after the chunk loads can retry in-page with preserved
controller state.

The production build emits `asset-manifest.json`. The worker registration URL
includes the hashed entry filename, so every changed entry build runs a distinct
installation. The new worker reads a no-store manifest, fetches a fresh HTML
shell, verifies that its hashed references match, and fills its build cache with
the entry JavaScript/CSS and lazy Three.js JavaScript/CSS before calling
`skipWaiting()`. The shell cache is populated with HTML and static resources in
the same transaction. If any current asset cannot be cached,
installation fails and the previous worker and cache set remain active.
The active worker may return newer network HTML for a navigation, but it never
stores that unverified response over its manifest-validated offline shell.
Before activation, cached `/cards/*` and `/boards/*` responses are moved from
the compatible legacy cache into the runtime-asset cache. Removed renderer
chunks, sprite responses, and other obsolete entries are deliberately not
migrated. Activation then deletes only older managed Cardgame caches; never
delete unrelated origin-wide Cache Storage entries.

## Catalog-slugged card art

Public card filenames come exclusively from the ASCII `assetSlug` stored in
`src/app/card-catalog.ts`. Never derive a URL from a Unicode display name or the
legacy serialized `BasicLand` key. Keep literal `import.meta.env.BASE_URL`
access in the shared card-art URL helper so every candidate remains below the
configured project path.

Runtime source selection is shared by the WebGL Board and native HTML cards:

- Classic uses the cached procedural creature source.
- HD tries `hd/<slug>.png`, then `hd-fallback/<slug>.png`, then the procedural
  source.
- Monochrome tries `monochrome/<slug>.png`, then the procedural source.

Raster consumers must remove a failed image immediately, remember failed URLs
for the session, and skip them on subsequent renders. Online recovery may reset
that suppression and try the shared candidate chain again. The service worker
keeps every `/cards/*` request network-first with runtime-cache fallback; it
must not turn these stable public paths into cache-first resources.

See [`../../public/cards/README.md`](../../public/cards/README.md) for the exact
five-file inventory, deterministic generation, and artwork review workflow.

## Versioning

- Bump `RUNTIME_ASSET_VERSION` when replacing same-path card/board images or
  intentionally invalidating their offline copies. A documentation-only change
  or a new hashed application build does not require this bump.
- Bump `CACHE_VERSION` when changing the worker's cache schema or migration
  behavior.
- Normal deployments rotate shell/build caches automatically using the hashed
  entry filename; no manual bump is needed for hashed assets.
- Activation deletes older Cardgame caches only after the new version has
  successfully cached its complete Vite asset graph.

When changing public assets, update their README and verify old installations
as well as clean installation.

## GitHub Pages base path

Never assume `/` is the deployed application root.

- Use literal `import.meta.env.BASE_URL` in TypeScript so Vite can statically
  replace it.
- Use `%BASE_URL%…` or relative paths in `index.html`.
- Normalize `joinBasePath` results to exactly one leading slash.
- Never emit a `//host/path` scheme-relative redirect.
- Keep search parameters and hashes when restoring a deep link.

The 404 redirect script encodes the original route in the query string and
`src/main.ts` restores it before legacy renderer parameters are removed.

## Installation UI

`src/app/install-support.ts` owns the install prompt and display-mode
observation. `ThreeInterface` renders the native installation controls. Keep the
adapter exception-safe because not every browser exposes install events.

## Validation

After changing `public/sw.js`, base-path logic, or assets:

1. Run the service-worker, 404, asset, and build-invocation tests.
2. Build with the configured non-root base path.
3. Serve that production output under the same path.
4. Verify an online first load, offline reload, and an upgrade from the previous
   worker/cache version.
5. Inspect requests: hashed Three.js chunks should use `/assets/*`; cards and
   boards should retain the network-first paths.
6. Confirm `asset-manifest.json` includes the lazy Three.js entry, matches the
   fetched HTML shell, and an interrupted install leaves the prior worker active.
7. Confirm no obsolete renderer chunk or removed asset-family request appears.

Do not claim offline verification from a dev-server session; it must exercise
the built service worker.
