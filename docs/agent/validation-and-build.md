# Validation and build

The canonical local validation sequence run by every recent PR. Run them in
order; do not skip steps.

## Sequence

1. **Install** (first time / after dependency changes):

   ```bash
   npm install
   ```

2. **Lint** — typecheck only, no emit:

   ```bash
   npm run lint    # tsc --noEmit
   ```

3. **Tests** — full vitest run:

   ```bash
   npm run test    # vitest run
   ```

   PR descriptions typically state the exact current test count (see
   `pr-workflow.md`). If your change adds or removes tests, update the
   count in the PR description.

4. **Build** — typecheck + production bundle:

   ```bash
   npm run build   # tsc && vite build
   ```

   The build also exercises `import.meta.env.BASE_URL` static replacement,
   so it must pass before merge. There is a regression test
   (`src/test/card-art-base-path.test.ts`) that invokes `vite build` with a
   custom `VITE_BASE_PATH` to verify the base is baked into the bundle.

5. **CodeQL** — run `codeql_checker`. Investigate every alert. Fix true
   positives; document false positives. Re-run after each fix.

## Optional / situational scripts

- `npm run dev` — local Vite dev server.
- `npm run preview` — preview the production bundle locally.
- `npm run generate:card-art` — regenerates `public/cards/hd/*.png` and
  `public/cards/monochrome/*.png` from
  `scripts/generate-card-art.mjs`. **Re-run after any change to that
  script or its land recipes.** Commit the regenerated PNGs.

## What "good" looks like

A well-validated change has all of:

- All four validation checks (lint, tests, build, CodeQL) passing locally
  on top of a clean `npm install`.
- A PR description that ends with a validation block (see `pr-workflow.md`):
  ```
  Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
  ```
- For user-visible changes: a UI screenshot attached and referenced from
  the PR description.
- Tests added or updated alongside any non-trivial behavior change.

## Skipping rules

- **Docs-only changes** still run `npm run lint` (TypeScript can break if
  docs reference moved exports) but may skip CodeQL — declare the change as
  trivial when invoking `codeql_checker`.
- **Test-only changes** still go through all four steps; tests can affect
  the build (e.g. new ambient declarations in `src/test/node-shims.d.ts`).

## Common gotchas

- `tsc --noEmit` will catch base-URL aliasing only indirectly (through the
  regression test). The lint step alone does not protect against the
  Vite static-replacement trap; run the full sequence.
- The `vite build` step downloads no network assets at build time; if it
  hits the network, something is misconfigured.
- The card-art generator is deterministic; non-deterministic output points
  to an accidental `Math.random()` somewhere in the recipe.
