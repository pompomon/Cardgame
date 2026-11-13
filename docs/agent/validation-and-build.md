# Validation and build

The single home for the validation sequence, evidence and failure triage.

## Rules

- Use the Node version in `.nvmrc` and `npm ci`; keep intentional dependency
  updates separate from environment recovery.
- Run the [sequence](#sequence) in order; omit a check only under the
  [skipping rules](#skipping-rules).
- Record actual exit codes, observed test counts and the tested revision;
  keep baseline and post-change results separate.
- Classify a failure's first meaningful error before editing. Allow at most
  one safe, supported retry; otherwise record the blocker and ask a maintainer.
- Never weaken tests, change game logic, improvise browser automation or
  widen network permissions to get past an unexplained tool failure.
- Checkpoint code and textual results before handling images.
- Report a skipped analysis as skipped, never as "0 alerts".
- Add or update tests with every non-trivial behavior change.

## Sequence

1. **Install:** `npm ci`; record Node/npm versions and the baseline commit.
   Commit manifest and lockfile together; never regenerate the lockfile or
   upgrade packages to recover from a tool error. On Node 25+, the test
   `ExperimentalWarning: localStorage is not available…` is harmless.
2. **Lint:** `npm run lint` (`tsc --noEmit`) typechecks `src/` only and
   can't catch the base-path trap, so it never replaces the build.
3. **Tests:** `npm run test` (`vitest run`). Record the passing count observed
   for this revision, never an earlier or inferred count.
4. **Bench**, after tests and before build, when reproducing
   [deploy-pages.yml](../../.github/workflows/deploy-pages.yml) or changing
   an AI hot loop: `npm run test:bench`; record it separately. `GATES` in
   `src/test/ai-perf.bench.ts` allows 1.5× each level's baseline (logged as
   `AI benchmark:` lines). Never loosen a gate; re-baseline only after
   intentional AI-performance work, from the ms/op of three idle runs,
   updating `GATES` and its comment together.
5. **Build:** `npm run build` (`tsc && vite build && npm run build:cli`)
   makes the browser bundle and the Node 22 ESM CLI bundle
   `dist-cli/cardgame-cli.mjs`; both must pass, and neither may fetch from
   the network.
   Keep `src/test/card-art-base-path.test.ts`, which runs `vite build` with
   a custom `VITE_BASE_PATH`: source-only assertions can't catch a broken
   [Vite base URL](../../AGENTS.md#vite-base-url).
6. **CodeQL:** after scanning changed files for secrets and committing, run
   `codeql_checker` with an explicit trivial or non-trivial assessment. Fix
   true positives, document false positives, then scan, commit and re-run.
   Without `codeql_checker`, cite the PR's CodeQL code-scanning check
   (repository default setup); with no such check, report **not run
   (skipped: reason)**. A local CodeQL CLI run is optional; if used, record
   the CLI version, query suite and result count.

PR CI ([ci.yml](../../.github/workflows/ci.yml)) runs steps 1-5 with a
non-root base (`validate`) plus `dependency-review` (fails on new
high-severity vulnerabilities); `deploy-pages.yml` runs them and deploys on
main/master pushes or dispatch. Neither runs CodeQL.

## Validation evidence and production preview

- For each check, record the commit, any uncommitted changes included, the
  command, exit code and relevant output. A tool's `success=true` proves only
  that the invocation completed; an unfinished command is pending.
- Collect delegated results before marking checks complete. Results cover
  only the revision tested; later relevant edits need new validation.
- Start `npm run preview` only after a successful production build, and
  don't rebuild into the same directory while smoke-testing. Record the build
  revision and `VITE_BASE_PATH`.
- Open the configured non-root path (normally `/Cardgame/`), not `/`; the
  dev server uses another base, so it can't verify Pages asset loading.
  Record the renderer, browser, viewport, exercised behavior and console or
  network errors; see
  [browser verification](testing.md#browser-verification-and-evidence).
- Collect final results apart from image inspection or upload so a
  transport failure can't hide them.

## Skipping rules

- **Docs-only changes** still run `npm run lint` (it catches stray `src/`
  edits), scan for secrets and invoke `codeql_checker` with a trivial
  declaration. Tests, bench, build and browser checks may be **not run
  (docs-only)**, except dedicated doc tests: `src/test/docs-links.test.ts`
  (part of `npm run test`) checks relative Markdown links and anchors.
  Check command descriptions by hand.
- **Test-only changes** run the full sequence; tests can affect the build
  (e.g. ambient declarations in `src/test/node-shims.d.ts`).

## Other scripts

- `npm run cli -- --mode ai-vs-ai` builds and runs the terminal game.
- `npm run generate:card-art` deterministically rewrites the Classic and
  HD-fallback PNGs; re-run and commit them after any generator or recipe
  change. `src/test/card-art-generator.test.ts` checks byte parity; drift
  between runs means a stray `Math.random()`.
- `npm run generate:anime-card-art` is operator-only (hosted image API,
  `IMAGE_GEN_API_KEY`), never part of validation, and overwrites PNGs only
  with `-- --force`; see
  [Artwork acceptance](../../AGENTS.md#artwork-acceptance) and
  [card art](../../public/cards/README.md#anime-artwork).

## Failure triage and recovery

1. **Gather evidence.** For an Actions failure, read the failing job's logs,
   not just the red status. Record workflow, run and job links, failing step,
   attempt, commit, first meaningful error, UTC time and the preceding
   operation. A final exit-code annotation is not a root cause; separate
   observations from hypotheses.
2. **Classify the layer** before changing anything:
   - **Application** (compiler, test, bench or build output): reproduce at
     the recorded revision and fix the demonstrated regression.
   - **Dependency/environment** (install, Node/npm or lockfile errors):
     restore the documented environment; don't upgrade packages.
   - **Browser** (launch, navigation, server readiness, URL or base path):
     use the supported
     [browser recovery](testing.md#browser-verification-and-evidence).
   - **Artifact transport** (capture, upload or download): verify the local
     image and returned reference; a capture is not an attachment.
   - **Agent service** (runtime or model-request errors outside the checks):
     preserve results and escalate. An agent image-download error
     (`CAPIError: 400 Error while downloading file. Upstream status code:
     404.`) is never evidence of a Pages defect.
3. **Bound recovery.** Retry only after addressing an evidenced, recoverable
   condition; never blindly replay submissions, commits or whole jobs. If the
   retry fails or no supported recovery exists, mark the check **blocked**
   and continue independent checks. Unresolved visual checks stay pending
   maintainer review under the [evidence procedure](pr-workflow.md#screenshots),
   even when code checks pass.
4. **No speculative fixes.** Don't alter deployment cleanup or edit Actions
   workflows without evidence; a firewall warning needs a demonstrated link
   to the failing operation. For managed-agent failures, improve
   investigation or checkpoint steps instead.
5. **Preserve and resume.** Scan for secrets before a checkpoint commit;
   keep textual results in the PR or progress record. On resume, inspect
   commits, the working tree and outstanding checks before editing or
   rerunning, and don't assume an automatic recovery push succeeded.
   Recreate missing temporary evidence and validate new references.
6. **Escalate** with the step 1 record, any request ID, the redacted error,
   the retry outcome and each check's status, keeping code validation, visual
   verification and agent-run status separate. Never publish credentials,
   signed download URLs, browser profiles or unrelated logs.
