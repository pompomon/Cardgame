---
applyTo: "public/sw.js,public/404.html,public/manifest.webmanifest,public/cards/**,public/boards/**,src/app/card-visual-recipes.ts,scripts/generate-*.mjs,tools/board-backgrounds/**,index.html,vite.config.ts,src/app/service-worker-registration.ts,src/app/url-path.ts"
---

# Service worker, PWA and base path

Details: [service-worker-and-pwa](../../docs/agent/service-worker-and-pwa.md).
GitHub Pages serves the app from a non-root base path.

- Network-first for unhashed `/cards/*` and `/boards/*`; cache-first for
  hashed `/assets/*`. Bump `RUNTIME_ASSET_VERSION` in `public/sw.js` when a
  same-path PNG is replaced, including by a `generate:*` script. After a
  `src/app/card-visual-recipes.ts` change, run `npm run generate:card-art`
  and bump if it rewrites a committed PNG.
- Never precache `404.html` into the SPA shell slot.
- In `index.html`, use `%BASE_URL%…` or `./…`, never absolute `/…` paths.
- `joinBasePath` and `404.html` normalize to exactly one leading `/` and
  never redirect to a scheme-relative (`//host`) URL.
- The worker takes its base path from the registration URL's `base` query.
  Install checks the fresh shell against `asset-manifest.json` and caches
  all its build assets, or fails and leaves the previous worker active.
- Known bug [#161](https://github.com/pompomon/Cardgame/issues/161): the
  network-first branch clones the response too late, so the runtime cache
  stays empty. Clone before `caches.open()`, as the `/assets/*` branch does.
- A dev server does not verify Pages asset loading: preview a finished
  production build at the configured non-root path (normally `/Cardgame/`).
