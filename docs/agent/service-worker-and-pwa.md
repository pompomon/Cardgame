# Service worker and PWA

How `public/sw.js` caches the app under its non-root GitHub Pages base.

## Rules

- Hashed `/assets/*` are cache-first; unhashed `/cards/*` and `/boards/*`
  stay network-first with cache fallback, never cache-first.
- Bump `RUNTIME_ASSET_VERSION` when replacing same-path card or board PNGs;
  `src/test/cache-version-check.test.ts` warns when the bump is missing.
- Never precache `404.html` into the SPA shell slot; it holds the Pages
  redirect script, not the app.
- Never assume `/` is the app root; follow
  [Vite base URL](../../AGENTS.md#vite-base-url). `index.html` uses
  `%BASE_URL%…` or `./…`, never absolute `/…` paths.
- `joinBasePath` and `404.html` emit exactly one leading `/` and never
  redirect to a scheme-relative `//host/path` URL.
- Verify offline behavior with the built worker, never the dev server.

## Cache strategy

The registration URL passes the base path (`base`) and hashed entry name
(`build`), so each changed build installs a new worker.
`src/test/service-worker.test.ts` covers this section.

- **Navigations:** network-first, falling back to the cached shell; network
  HTML is never cached, so only installation replaces the shell.
- **`/cards/*`, `/boards/*`:** a network failure falls back to the runtime
  cache. Known bug [#161](https://github.com/pompomon/Cardgame/issues/161):
  the response is cloned after `respondWith()` starts streaming it, so a
  swallowed `clone()` error leaves that cache empty.
- **`/assets/*` and static files:** cache-first. Other requests pass through.
- **Install** reads a no-store `asset-manifest.json`, fetches a fresh shell,
  checks its hashed references and caches the whole Vite asset graph,
  including the lazy Three.js entry, before `skipWaiting()`. Any failure
  keeps the previous worker and caches.
- **Migration** copies only compatible prefixes: v1-v4 runtime caches keep
  `/boards/*` but not `/cards/*`, whose art was replaced at the same paths.
  Activation then deletes only older managed `cardgame-*` caches.

## Versioning

- Also bump `RUNTIME_ASSET_VERSION` when removing card or board paths or
  deliberately invalidating their offline copies, not for docs or hashed
  builds.
- Bump `CACHE_VERSION` when the cache schema or migration changes. Shell and
  build caches rotate automatically with each hashed build.
- When changing public assets, update their README.

## Catalog-slugged card art

- File names come only from the ASCII `assetSlug` in
  `src/app/card-catalog.ts`, never a display name or the `BasicLand` key.
- `src/app/card-art.ts`, the shared URL helper, keeps every candidate under
  the base.
- The source chain, Monochrome filter and failed-URL suppression are in
  [card art runtime behavior](../../public/cards/README.md#runtime-behavior).

## GitHub Pages base path

- `public/404.html` encodes the route as `__gh_path` and `__gh_hash`;
  `src/main.ts` restores it, keeping search and hash, before stripping
  legacy renderer parameters.
- Tests: `url-path.test.ts` (`joinBasePath`), `browser-metadata.test.ts`
  (`index.html` and manifest paths), `service-worker-registration.test.ts`
  and `card-art-base-path.test.ts` in `src/test/`.

## Installation UI

`src/app/install-support.ts` owns the install prompt and display-mode
observation; keep it exception-safe, as not every browser has install events.
`ThreeInterface` renders the controls.

## Validation

After changing `public/sw.js`, base-path logic or public assets:

1. Run the tests above, then build with the non-root base and serve that
   output under the same path.
2. Verify a clean online install, an offline reload and an upgrade from
   the previous worker and caches.
3. Check requests: Three.js chunks come from `/assets/*`, art stays
   network-first, and no obsolete chunk or removed asset family appears.
4. Confirm `asset-manifest.json` lists the lazy Three.js entry and matches
   the fetched shell, and an interrupted install keeps the prior worker.
