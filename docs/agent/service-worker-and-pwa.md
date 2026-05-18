# Service worker, base path, and PWA

The service worker is `public/sw.js`. The Vite base path is set via
`VITE_BASE_PATH` and applied in `vite.config.ts`. Base-aware URL helpers
live in `src/app/url-path.ts` and `src/app/card-art.ts`.

## Service-worker caching strategy

Current intentional split (verified at `public/sw.js:99-136`):

- **`/cards/*`** — network-first with cache fallback. Card art URLs are
  **not** content-hashed, so a same-path replacement must reach users
  without waiting for `CACHE_VERSION` bumps or manual cache clears.
- **`/assets/*` and fixed static files** — cache-first. Vite content-hashes
  these, so stale caches are safe between releases.

Rules:

- **Bump `CACHE_VERSION` when same-path card-art binaries change.**
  Note this in the PR's "Risk / migration notes" block.
- **Do not precache `404.html` into the SPA shell slot.** Adding `404.html`
  to `CORE` makes a navigation to `${BASE_PATH}404.html` (which returns
  200) look like a successful `navigate` fetch, and the existing
  navigation handler can then cache it under `INDEX_URL`, overwriting the
  real shell. If you need the 404 redirect installed, install it
  separately and make sure only real index navigations update
  `INDEX_URL`.
- **Document the strategy in the SW file**: keep the inline comments in
  sync with the actual switch on URL path.

## Base path: the Vite `BASE_URL` trap

Vite statically replaces `import.meta.env.BASE_URL` only when accessed as
a literal member expression. The pattern below silently breaks production
bundles on non-root deploys (e.g. GitHub Pages project sites):

```ts
// ❌ Defeats static replacement
const meta = import.meta as unknown as { env?: { BASE_URL?: string } }
const base = meta.env?.BASE_URL
```

```ts
// ✅ Vite replaces this at build time
const base = import.meta.env.BASE_URL
```

There is a regression test (`src/test/card-art-base-path.test.ts`) that
runs `vite build` with `VITE_BASE_PATH=/regression-base/` and asserts:

1. The configured base is present in the built bundle.
2. No `import.meta.env.BASE_URL` reference survives the build.

If you must read the base in code that runs in Node tests (where Vite
doesn't replace anything), keep the literal access behind a `typeof
import.meta` guard and provide a Node fallback path; don't fix the test
by aliasing the source.

In `index.html`, prefer `%BASE_URL%…` placeholders or relative `./…`
references. Absolute `/manifest.webmanifest` style paths break under a
non-root base.

## `joinBasePath` and the 404 redirect

- **Normalize `relativePath` to exactly one leading `/`.** Strip leading
  slashes, then prepend `/`. Otherwise a path that already starts with
  `/` (or `//`) can produce a scheme-relative URL (`//evil`) when joined
  with `basePath === '/'`, which `history.replaceState` may interpret as a
  cross-origin URL and reject with `SecurityError`.
- **Apply the same normalization in `public/404.html`** when building the
  `__gh_path` redirect — `remainder` may already start with `/` if the
  original URL contained `//`.
- **Don't fall back to "first path segment" for the base.**
  `VITE_BASE_PATH` supports multi-segment bases (e.g. `/foo/bar/`).
  Picking only `segments[0]` will redirect deep links to the wrong site.
  Use the full configured base or fall back to `/`. The same applies when
  manifest probing in `findBasePath()` times out — `/` is a safer
  fallback than a guessed single segment.

## PWA install flow (`src/app/install-support.ts`)

- **Wrap `prompt()` / `userChoice` in try/catch.** Browsers can reject
  `prompt()` if it's not allowed (e.g. already used). Wrap, return
  `false` on failure, and still call `notifyChange()` so UI state stays
  consistent.
- **Compatibility fallback for `MediaQueryList`.** Older Safari/iOS
  doesn't support `addEventListener`/`removeEventListener` on
  `MediaQueryList`. Guard and fall back to `addListener`/`removeListener`.
- **Don't introduce UI-state flags without consumers.** If you add a
  `showInstallUi`-style boolean to `InstallUiState`, wire it up; otherwise
  remove it. Multiple unused booleans risk going out of sync.
- **Tests live in `src/test/install-support.test.ts`** with mocked
  `matchMedia` and `beforeinstallprompt`. New state transitions need
  coverage there.
