# Validation and build

The canonical local validation sequence. Run checks in order and report actual
results; only the documented [skipping rules](#skipping-rules) allow omissions.

## Sequence

1. **Install** — use Node 22, matching the deployment workflow, and record the
   Node/npm versions and baseline commit. For a fresh checkout or CI reproduction,
   install from the committed lockfile:

   ```bash
   npm ci
   ```

   Use package-manager install/update commands only for intentional dependency
   changes; review and commit the manifest and lockfile together. Do not regenerate
   the lockfile or upgrade dependencies just to recover from an agent-tool error.

2. **Lint** — typecheck only, no emit:

   ```bash
   npm run lint    # tsc --noEmit
   ```

3. **Tests** — full vitest run:

   ```bash
   npm run test    # vitest run
   ```

   Record the observed passing test count in the PR description; do not reuse
   a count from an earlier revision or infer it from a successful tool call.

   **Deployment parity:** after tests and before build, also run
   `npm run test:bench`. This existing AI performance gate is required when
   reproducing [deploy-pages.yml](../../.github/workflows/deploy-pages.yml)
   and for AI hot-loop changes. Record its result separately; do not loosen
   thresholds to conceal a regression. The deployment workflow runs on
   main/master pushes or manual dispatch, not pull requests, and does not
   replace the agent's CodeQL check.

4. **Build** — typecheck + browser and terminal bundles:

   ```bash
   npm run build   # tsc && vite build && npm run build:cli
   ```

   The browser build also exercises `import.meta.env.BASE_URL` static
   replacement, and the CLI build emits the standalone Node 22 ESM bundle at
   `dist-cli/cardgame-cli.mjs`, so both must pass before merge. There is a regression test
   (`src/test/card-art-base-path.test.ts`) that invokes `vite build` with a
   custom `VITE_BASE_PATH` to verify the base is baked into the bundle. Preserve
   this production-build test; source-only assertions are not equivalent.

5. **CodeQL** — after scanning changed files for secrets and committing the
   changes, run `codeql_checker` with an explicit trivial/non-trivial assessment.
   Investigate every alert. Fix true positives; document false positives.
   Scan and commit fixes, then re-run the checker.

## Validation evidence and production preview

- Keep baseline checks separate from post-change checks. Record the tested
  commit, any uncommitted changes included, command, exit code, and relevant
  output for each check. A tool's `success=true` only proves the invocation
  completed, not that the command passed. An unfinished command is pending.
- Collect delegated validation results before marking their checks complete.
  Results apply only to the revision tested; later relevant edits need new
  validation. Do not present baseline results as post-change evidence.
- Finish a successful production build before starting `npm run preview`.
  Freeze its output while smoke-testing: do not rebuild into the same directory
  concurrently. Record the build revision and configured `VITE_BASE_PATH`.
- Open the configured non-root path (normally `/Cardgame/`), not just `/`.
  Development uses a different base; a dev-server check alone does not verify
  Pages asset loading. Record renderer, browser, viewport, exercised behavior,
  and relevant console/network errors. See [browser verification](testing.md#browser-verification-and-evidence).
- Checkpoint code and textual validation results before image inspection or
  upload. Collect final validation results separately from image inspection so
  a transport failure does not obscure them. This isolates operations; it is
  not a proven workaround for upstream runtime failures.

## Optional / situational scripts

- `npm run dev` — local Vite dev server.
- `npm run preview` — preview the production bundle locally.
- `npm run build:cli` — build only the standalone Node terminal bundle.
- `npm run cli -- --mode ai-vs-ai` — build and run the terminal game.
- `npm run generate:card-art` — regenerates `public/cards/hd-fallback/*.png`
  and `public/cards/monochrome/*.png` from
  `scripts/generate-card-art.mjs`. Deterministic and CI-safe (no API
  keys). **Re-run after any change to that script or its land recipes.**
  Commit the regenerated PNGs.
- `npm run generate:photoreal-card-art` — one-off operator script that
  calls a hosted image-generation API (default `gpt-image-1`) to (re)write
  the photoreal HD PNGs at `public/cards/hd/*.png`. Requires an
  `IMAGE_GEN_API_KEY` (or `OPENAI_API_KEY`). **Not** invoked by CI, lint,
  test, or build. See `public/cards/README.md` for flags and env vars.

## What "good" looks like

A well-validated application change has all of:

- All four validation checks (lint, tests, build, CodeQL) passing locally
  on top of a clean `npm ci`, plus the benchmark when required above.
- A PR description that ends with an evidence-backed validation block (see
  [PR workflow](pr-workflow.md#validation-status)). Only when all four passed:
  ```
  Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
  ```
- For user-visible changes: completed visual verification and a reviewer-accessible
  screenshot reference. Blocked evidence remains pending maintainer verification,
  not silently waived.
- Tests added or updated alongside any non-trivial behavior change.

## Skipping rules

- **Docs-only changes** still run `npm run lint` as a policy check (it's
  cheap and catches accidental edits to `src/` that slipped into a
  "docs-only" change). Tests, benchmark, build, and browser checks may be marked
  **not run (docs-only)** unless the documentation has dedicated tests. Still
  scan changed files for secrets before committing and invoke `codeql_checker`
  with a trivial declaration; report a skipped analysis as skipped, not as
  "0 alerts". Check links and command descriptions manually: `tsc --noEmit`
  only typechecks files under `src/` per `tsconfig.json`, not Markdown references.
- **Test-only changes** still go through all four steps; tests can affect
  the build (e.g. new ambient declarations in `src/test/node-shims.d.ts`).

## Common gotchas

- `tsc --noEmit` does not run the base-path regression test or protect against
  the Vite static-replacement trap; run the full sequence.
- The `vite build` step downloads no network assets at build time; if it
  hits the network, something is misconfigured.
- The card-art generator is deterministic; non-deterministic output points
  to an accidental `Math.random()` somewhere in the recipe.

## Failure triage and recovery

1. **Gather evidence first.** For an Actions failure, use the GitHub Actions
   tools to list recent workflow runs, then retrieve the affected job's logs.
   Record workflow name, run/job links, failing step, run attempt, relevant
   commit, first meaningful error, UTC timestamp, and preceding operation.
   Separate observations from hypotheses; the final exit-code annotation alone
   is not a root cause.
2. **Classify the failing layer before changing anything:**

   | Layer | Evidence to inspect | Response |
   | --- | --- | --- |
   | Application validation | Compiler diagnostics, failing assertions, benchmark/build output | Reproduce against the recorded revision and fix the demonstrated regression. |
   | Dependency/environment | Install error, Node/npm versions, lockfile mismatch | Restore the documented environment; do not opportunistically upgrade packages. |
   | Browser tooling | Navigation/launch error, local server readiness, URL/base path | Follow the supported [browser recovery procedure](testing.md#browser-verification-and-evidence). |
   | Artifact transport | Capture/upload/download error and returned artifact reference | Verify the local image and reference; do not equate capture with successful attachment. |
   | Agent service | Runtime/model-request error outside application checks | Preserve available results and escalate if supported recovery fails. |

3. **Bound recovery.** Make at most one supported retry of the failed operation
   when safe, after addressing an evidenced recoverable condition. Do not replay
   submissions, commits, or whole jobs blindly. If it still fails, or no supported
   recovery exists, stop that operation, mark the affected check **blocked**,
   and request maintainer help. Continue independent checks when possible.
   Never weaken tests, alter game logic or deployment cleanup, or expand network
   permissions merely to address an unexplained runtime error. Firewall warnings
   need a demonstrated connection to the failing operation, not an assumption.
4. **Preserve and resume deliberately.** Scan changes for secrets before a
   checkpoint commit and retain textual results in the PR/progress record.
   On resume, inspect branch commits, the working tree, completed changes, and
   outstanding checks before editing or rerunning anything. Do not assume an
   automatic recovery push succeeded. Temporary files and attachment references
   may no longer exist: recreate ephemeral evidence and validate new references.
5. **Escalate with a minimal diagnostic record.** Include run/job links,
   commit, timestamp, request ID if present, redacted error, retry outcome,
   confirmed completed checks, and unresolved checks. Keep code validation,
   visual verification, and agent-run status separate. Do not publish credentials,
   signed download URLs, browser profiles, or unrelated log contents.

### Reference incident and recovery walkthroughs

[Run 34038894955](https://github.com/pompomon/Cardgame/actions/runs/34038894955/job/101501919606)
failed in the dynamic Copilot job's **Processing Request (Linux)** step, not
the Pages workflow. At 14:29:36 UTC on 2026-09-06, the runtime reported
`CAPIError: 400 Error while downloading file. Upstream status code: 404.`
CodeQL had explicitly reported 0 alerts at 14:29:33. An image-view operation
preceded the error, but the missing URL and underlying cause were not disclosed.
Attachment transport is a hypothesis, not proof of a bad screenshot; neither
the CodeQL result nor Chromium firewall warnings establish a repository defect.

- **Browser failure:** preserve the navigation/launch error, check readiness
  and the configured URL, use supported recovery if applicable, then retry once.
  If blocked, retain automated results and textual observations and request
  maintainer visual verification; do not switch to ad hoc browser automation.
- **Attachment-download failure:** preserve completed code-check results and
  the runtime error. If the session survives, verify available image/reference
  evidence before a safe supported retry. If it terminates, the resumed session
  first checks saved commits and recreates ephemeral evidence. Unresolved visual
  inspection/attachment stays blocked even if code checks passed. Guidelines
  reduce lost work and ambiguous reporting; they cannot prevent service outages.
