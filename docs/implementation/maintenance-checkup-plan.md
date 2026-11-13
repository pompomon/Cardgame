# Maintenance checkup plan

> [!IMPORTANT]
> Plan only: nothing below is implemented. Line numbers refer to baseline
> `main` at `94eda5b`. When the last PR lands, replace this file with a short
> `docs/history/` summary under the archive rule that PR-4 introduces.

## Goals

- **Smaller agent context.** Always-on instructions go from 13.3 KB to
  ≤5.3 KB and `docs/agent/` from 157 KB to about 60 KB. Completed plans
  (324 KB of text plus 623 KB of figures) become short history summaries.
- **Same principles.** Every core rule is moved, merged or condensed, never
  silently dropped (see the [retention checklist](#retention-checklist)).
- **Current toolchain.** Latest TypeScript, Vite, Vitest, three.js, Node LTS
  and Actions, kept current by Dependabot.
- **Faster agent loops.** PR CI, a preinstalled agent environment, a faster
  typecheck and build, and quieter test output.

Non-goals: gameplay, engine, renderer or persistence behavior changes; new
features; broader workflow permissions; Pages changes beyond action versions.

## Baseline findings

| Area | Finding |
| --- | --- |
| Always-on instructions | `AGENTS.md` (6.0 KB) and `.github/copilot-instructions.md` (7.4 KB) largely repeat each other. Copilot cloud agent, Copilot CLI and github.com code review load both, plus path-specific files, without deduplication ([support table](https://docs.github.com/en/copilot/reference/custom-instructions-support)). github.com Chat loads only `copilot-instructions.md`. |
| Topic docs | `docs/agent/` totals 156.9 KB; four files exceed 20 KB. `state-and-persistence.md` has a 22.3 KB milestone-ordered section with no subheadings. |
| Implementation docs | Five completed or superseded plans (324 KB plus 623 KB of figures). Only `hard-ai-search-roadmap.md` (3.9 KB) is live. |
| Hidden rules | The ten approved Adventure product decisions exist only in the roadmap that is about to be archived. |
| Stale citations | `src/app/safe-storage.ts:11` cites "AGENTS.md rule #9 — status message ordering", which is now rule 10. `src/test/ai-no-state-clone.test.ts:5` cites "rule 8". Rule numbers rot on every edit. |
| Dependencies | Locked: three 0.185.1, @types/three 0.185.4, typescript 6.0.3, vite 8.0.10, vitest 3.2.4 (which bundles a nested vite 7.3.2). `npm audit`: 8 dev-only findings (2 critical, 4 high, 1 moderate, 1 low); production: 0. |
| Actions | [`deploy-pages.yml`](../../.github/workflows/deploy-pages.yml) is the only workflow. checkout@v5 and setup-node@v5 (Node 24) are two majors behind; the Pages actions are current. |
| Checks | Validation runs only after merge. There is no PR CI, CodeQL default setup, Dependabot or `copilot-setup-steps.yml`, so cloud agents install dependencies by trial. |
| Node | Docs pin Node 24 (Maintenance LTS). Node 26 is Active LTS since 2026-10-28 (EOL 2029-04-30), and the baseline passes lint, tests, bench and build on Node 26.12.1. |

## Decisions

Defaults chosen in autopilot; each is reversible and repeated under
[open questions](#open-questions).

- **D1 Node 26.** Add `.nvmrc` containing `26`; workflows read it through
  `node-version-file`. Docs say "the Node version in `.nvmrc`" instead of a
  number. Node 24 remains a validated fallback.
- **D2 TypeScript 7** (`~7.0.2`, native compiler) in its own commit; fallback
  `~6.0.3`.
- **D3 Vitest 5.** The AI performance gate moves into the bench file (the
  `bench` test fixture plus `expect`), removing `scripts/check-ai-bench.mjs`
  and its JSON report. Gates and baselines stay the same.
- **D4 No dependency cache.** Every `actions/setup-node@v7` step sets
  `package-manager-cache: false`, because v7 caches automatically once
  `package.json` declares a `packageManager`. The README storage policy (no
  persisted dependency cache) stays true.
- **D5 Dependabot** for npm (weekly) and GitHub Actions (monthly), grouped,
  with cooldowns, plus grouped security updates.
- **D6 Archive rule.** A completed plan becomes a `docs/history/` summary of at
  most 40 lines; superseded plans are deleted. Originals stay recoverable with
  `git show <sha>:<path>`. Pending manual gates move to one GitHub issue.
- **D7 Instruction tiers.** `AGENTS.md` is canonical. `copilot-instructions.md`
  shrinks to a pointer plus five diff-checkable rules for surfaces that read
  only that file. Area rules move to path-specific
  `.github/instructions/*.instructions.md` files, which apply only when
  matching files are involved.
- **D8 CodeQL in PR checks.** The maintainer enables CodeQL default setup.
  When `codeql_checker` is unavailable, agents cite the PR's CodeQL check
  instead of running the local CodeQL bundle (a policy change that needs
  approval).

## Target versions

| Package | Locked now | Target | Notes |
| --- | --- | --- | --- |
| `three` (dependency) | 0.185.1 | `^0.187.0` | No code changes; the three chunk grows 1.6%. |
| `@types/three` | 0.185.4 | `^0.187.0` | Moves with `three`. |
| `vite` | 8.0.10 | `^8.3.8` | Rename `build.rollupOptions` to `build.rolldownOptions` in `vite.cli.config.ts:18`. |
| `vitest` | 3.2.4 | `^5.1.0` | Three typing fixes and the bench rewrite; drops the nested vite 7. |
| `typescript` | 6.0.3 | `~7.0.2` | Native `tsc`; the lockfile gains 20 optional `@typescript/typescript-<platform>` packages. Keep the tilde range. |

| Action | Now | Target |
| --- | --- | --- |
| `actions/checkout` | v5 | v7 (7.0.1) |
| `actions/setup-node` | v5 | v7 (7.1.0) |
| `actions/configure-pages` | v6 | v6 (current) |
| `actions/upload-pages-artifact` | v5 | v5 (current) |
| `actions/deploy-pages` | v5.0.1 | v5.0.1 (current); keep the DEP0040 `NODE_OPTIONS` workaround until a release notes the fix |
| `actions/dependency-review-action` | none | v5 (new, PR CI) |

All actions are GitHub-owned, so major-version tags are acceptable and
Dependabot bumps them.

## Spike evidence

Feasibility was checked in throwaway copies outside the repository. PR authors
must re-run everything; none of this counts as PR validation.

| Check | Baseline `94eda5b`, Node 26.12.1 | Target stack, Node 24.22.3 |
| --- | --- | --- |
| `npm ci` | not timed | 1.6 s |
| `npm run lint` | 4.7 s | 1.1 s |
| `npm run test` | 90 files, 2,512 passed, 42.5 s | 2,512 passed, 38.7 s |
| `npm run test:bench`, Advanced / Hard ms/op (gates 0.825 / 21) | 0.24 / 5.81 | about 0.25 / 6.4–6.8 |
| `npm run build` | 5.5 s | 1.9 s |
| `npm audit` | 8 (dev-only) | 0 |

- The target stack also passes on Node 26.12.1. Node 25 and later print a
  harmless `ExperimentalWarning: localStorage is not available…` during tests.
- Browser smoke test on a production `vite preview` at `/Cardgame/` (Chromium,
  SwiftShader WebGL2):
  - The lobby rendered, and Local AI vs AI played to "Game over".
  - Card art, the board background, the Banish effect and a tooltip rendered.
  - There was no recovery screen and no console error. Four SwiftShader "GPU
    stall due to ReadPixels" warnings appear on the baseline too.
  - The service worker activated at `/Cardgame/` with its shell, build-asset
    and runtime caches.
  - `asset-manifest.json` kept its shape, and the three chunk grew from
    701,427 to 712,579 bytes.
- In agent sessions Vitest 5 selects a compact reporter: passing files are
  hidden, but the `Tests N passed` summary remains. That reporter also hides
  the bench's ms/op lines, so the bench script forces `--reporter=default`.
- The YAML blocks in this plan were extracted and checked. `actionlint` 1.7.12
  reports no problems in either workflow. `dependabot.yml` validates against
  the SchemaStore `dependabot-2.0` schema, including the `cooldown` and
  `applies-to` keys.

## Delivery sequence

```text
PR-1  PR CI + Copilot setup steps + Actions + Node 26
  └─► PR-2  Toolchain (TypeScript 7, Vite 8.3, Vitest 5, three 0.187)
        ├─► PR-3  Dependabot
        └─► PR-5  Compact agent guidance
PR-4  Archive plans + docs-link test ──► PR-5
```

- PR-4 is independent and can land first or in parallel.
- PR-5 waits for PR-2, whose validation docs it condenses, and for PR-4, whose
  docs-link test guards anchors during the rewrite.
- This plan lands first, in its own docs-only PR, so later agent sessions can
  read it from `main`.
- Each PR follows `.github/PULL_REQUEST_TEMPLATE.md`, runs the
  [validation sequence](../agent/validation-and-build.md#sequence), and ends
  with the validation line. Each PR fits one agent session: hand the agent the
  PR's section of this plan as its task.
- The maintainer settings (M1–M3) can happen at any time. Enabling CodeQL
  before PR-1 puts CodeQL on every later PR.

### PR-1: PR CI, Copilot setup steps, Actions and Node 26

1. Add `.nvmrc` containing `26`.
2. Update `deploy-pages.yml`; keep everything else, including the cleanup job:

   ```diff
          - name: Checkout
   -        uses: actions/checkout@v5
   +        uses: actions/checkout@v7

          - name: Setup Node
   -        uses: actions/setup-node@v5
   +        uses: actions/setup-node@v7
            with:
   -          node-version: 24
   +          node-version-file: .nvmrc
   +          package-manager-cache: false
   ```

3. Add `.github/workflows/ci.yml`:

   ```yaml
   name: CI

   on:
     pull_request:
     workflow_dispatch:

   permissions:
     contents: read

   concurrency:
     group: ci-${{ github.event.pull_request.number || github.ref }}
     cancel-in-progress: true

   jobs:
     validate:
       runs-on: ubuntu-latest
       timeout-minutes: 20
       steps:
         - uses: actions/checkout@v7
           with:
             persist-credentials: false
         - uses: actions/setup-node@v7
           with:
             node-version-file: .nvmrc
             package-manager-cache: false
         - run: npm ci
         - run: npm run lint
         - run: npm run test
         - run: npm run test:bench
         - name: Build
           env:
             VITE_BASE_PATH: ${{ vars.VITE_BASE_PATH || format('/{0}/', github.event.repository.name) }}
           run: npm run build

     dependency-review:
       if: github.event_name == 'pull_request'
       runs-on: ubuntu-latest
       timeout-minutes: 10
       steps:
         - uses: actions/checkout@v7
           with:
             persist-credentials: false
         - uses: actions/dependency-review-action@v5
           with:
             fail-on-severity: high
   ```

4. Add `.github/workflows/copilot-setup-steps.yml`. The job must be named
   `copilot-setup-steps`. Only `steps`, `permissions`, `runs-on`, `services`,
   `snapshot` and `timeout-minutes` (at most 59) are honored, and the file
   takes effect only from the default branch.

   ```yaml
   name: Copilot Setup Steps

   on:
     workflow_dispatch:
     push:
       paths:
         - .github/workflows/copilot-setup-steps.yml
     pull_request:
       paths:
         - .github/workflows/copilot-setup-steps.yml

   jobs:
     copilot-setup-steps:
       runs-on: ubuntu-latest
       timeout-minutes: 15
       permissions:
         contents: read
       steps:
         - uses: actions/checkout@v7
         - uses: actions/setup-node@v7
           with:
             node-version-file: .nvmrc
             package-manager-cache: false
         - run: npm ci
   ```

5. Update docs for Node and CI only; compaction waits for PR-5.
   - Replace "Use Node 24" with "Use the Node version in `.nvmrc`" in
     `AGENTS.md:21`, `.github/copilot-instructions.md:17`,
     `docs/agent/validation-and-build.md:8` and `public/cards/README.md:75`.
     Also fix the comment at `scripts/generate-card-art.mjs:2`.
   - `validation-and-build.md:20-30`: replace the Node 26 paragraph with one
     line about the localStorage warning. Drop the esbuild install-script
     note; it is harmless and becomes obsolete when PR-2 removes esbuild from
     the lockfile.
   - `validation-and-build.md:53-55`: pull requests now run the same sequence
     in CI; deployment remains main/master-only; neither replaces CodeQL.
   - README "Build and deploy pipeline": add the PR CI workflow. "Actions
     storage policy": no workflow persists a dependency cache.

Acceptance:

- On the PR, the `validate`, `dependency-review` and `copilot-setup-steps`
  runs succeed.
- After merge:
  - The deploy run succeeds on Node 26, and the site loads at `/Cardgame/`.
  - The run's `github-pages` artifact is deleted.
  - Actions → Caches shows no new `node-cache-…` entry.
  - A manual run of Copilot Setup Steps on `main` succeeds.
- Do not dispatch the deploy workflow from a branch; it would deploy that
  branch.

### PR-2: Toolchain upgrade

Four commits, each passing lint, tests, bench and build:

| # | Command | Code changes |
| --- | --- | --- |
| 1 | `npm install three@^0.187.0`, then `npm install -D @types/three@^0.187.0 vite@^8.3.8` | `vite.cli.config.ts:18`: `rollupOptions` becomes `rolldownOptions`. If Vitest 3 rejects the new Vite, fold this commit into commit 2. |
| 2 | `npm install -D vitest@^4.1.12` | Mock typings. In `src/test/three-assets.test.ts` (lines 1, 44) and `src/test/three-background.test.ts` (lines 1, 20), import `type Mock` and declare `let invalidate: Mock<() => void>`. In `src/test/three-effects.test.ts:159,163`, use `vi.fn<() => void>(done)`. |
| 3 | `npm install -D vitest@^5.1.0` | Rewrite the bench gate ([Appendix B](#appendix-b-bench-gate-for-vitest-5)). Delete `scripts/check-ai-bench.mjs` and the `.ai-bench-report.json` line in `.gitignore`. Set `"test:bench": "vitest bench --run --reporter=default src/test/ai-perf.bench.ts"`. Update the bench paragraph in `validation-and-build.md` (lines 50-62). |
| 4 | `npm install -D typescript@~7.0.2` | None. Fallback: `typescript@~6.0.3`. |

Acceptance:

- Lint, tests (record the observed count; the spike saw 2,512), the bench
  (both `AI benchmark:` lines print and pass) and build succeed locally on
  Node 26 and in PR CI.
- `npm audit` reports 0 vulnerabilities.
- Browser smoke test on the production preview at `/Cardgame/`, following
  [browser verification](../agent/testing.md#browser-verification-and-evidence):
  - Lobby, then Local AI vs AI to game over.
  - Card art, the board background and an effect render.
  - No recovery screen and no console errors.
  - The service worker is active with its shell, build-asset and runtime
    caches.
  - Record the three chunk size (baseline 701,427 bytes).
- Visual evidence follows the PR template stages. If capture is blocked, the
  visual stage stays pending maintainer review.

Watch-outs:

- Vitest 5 enables `clearMocks` by default; the suite passes unchanged.
- `--outputJson` is gone in Vitest 5; use `--reporter=json --outputFile` if a
  JSON report is ever needed.
- The tools config behind `ai:tournament` and `ai:tune` works unchanged.

### PR-3: Dependabot

Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    cooldown:
      default-days: 7
      semver-major-days: 14
    commit-message:
      prefix: deps
    groups:
      three:
        patterns: ["three", "@types/three"]
      build-tooling:
        patterns: ["vite", "vitest", "@vitest/*", "typescript"]
        update-types: ["minor", "patch"]
      security:
        applies-to: security-updates
        patterns: ["*"]

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    cooldown:
      default-days: 7
    commit-message:
      prefix: ci
    groups:
      actions:
        patterns: ["*"]
```

- Cooldowns delay version updates only; security updates open immediately.
  GitHub Actions supports `default-days` but not the `semver-*-days` options.
- `build-tooling` groups only minor and patch updates, so each TypeScript,
  Vite or Vitest major opens its own PR, to be handled like PR-2.
- Every Dependabot PR runs PR CI and, through the MainReviews ruleset, gets a
  Copilot review. Groups, cooldowns and the schedules keep that to a few PRs a
  week.
- Add a short "Dependency updates" section to `docs/agent/pr-workflow.md`:
  - Merge patch and minor groups when CI is green, after skimming release
    notes.
  - For majors, follow the PR-2 pattern: one tool per commit, full validation,
    and a browser smoke test for three or Vite.
  - Never hand-edit `package-lock.json`.
- This lands after PR-2 so the first run doesn't reopen the toolchain majors.

Acceptance: Insights → Dependency graph → Dependabot lists both ecosystems
with a recent check and no configuration errors.

### PR-4: Archive completed plans and add a docs-link test

Commit 1 adds `src/test/docs-links.test.ts`
([Appendix A](#appendix-a-docs-link-test)) and widens the `statSync` shim.
Spike results:

- At `94eda5b` it checks 152 links and finds 0 problems. With this plan
  added, it checks 163.
- Both toolchains pass the 2 tests.
- Deleting a linked plan and renaming a linked heading produced 4 precise
  failures.
- Simulating this PR's deletions drops the count to 82 and leaves 3 dangling
  links: `docs/agent/testing.md:385` and `:400`, and
  `docs/history/README.md:15`. The edits below fix all three. Archiving
  shrinks the count, so the test asserts only that it is nonzero.

Later commits archive the plans:

| Path | Size | Action |
| --- | --- | --- |
| `docs/implementation/rich-phaser-renderer-plan.md` | 64.7 KB | Delete; superseded by ADR 0002. |
| `docs/history/initial-implementation-plan.md` | 4.2 KB | Delete; covered by the README and `docs/agent/`. |
| `docs/implementation/adventure-map-and-relics-roadmap.md`, `adventure-map-graph-plan.md` and `adventure-map-graph/` | 131 KB + 2 figures | Replace with `docs/history/adventure-map-and-relics.md`. Before deleting, copy the ten approved product decisions (roadmap lines 9-31) into an "Adventure product decisions" list in [state-and-persistence](../agent/state-and-persistence.md#adventure-run-schema-version-2). |
| `docs/implementation/fold4-touch-ui-uplift-plan.md` and `fold4-touch-ui-uplift/` | 75.7 KB + 7 figures | Replace with `docs/history/fold4-touch-ui.md`. |
| `docs/implementation/urban-fantasy-creature-terminology-plan.md` | 52.5 KB | Replace with `docs/history/creature-terminology.md`. |
| [`hard-ai-search-roadmap.md`](hard-ai-search-roadmap.md) | 3.9 KB | Keep: a live follow-up list linked from ADR 0003. |

The 623 KB of figures are deleted with their plans.

Summary template (at most 40 lines):

```markdown
# <Feature> (archived plan)

Archived from `docs/implementation/<file>.md`. Recover it with
`git show <sha>:docs/implementation/<file>.md`, where `<sha>` is the last
commit that contains it.

## Delivered
- <Milestone>: <one line> (#<PR>).

## Durable decisions
- <Decision>: now in `docs/agent/<file>.md` › <heading>.

## Open follow-ups
- <Item>: tracked in #<issue>.

## Lessons
- <Pitfall that is not already a rule in docs/agent>.
```

Other edits:

- Open the maintainer-gates issue ([Appendix C](#appendix-c-maintainer-gates-issue)),
  copying each pending item verbatim from its plan. If issues aren't wanted,
  use `docs/history/maintainer-gates.md` instead.
- Point `docs/agent/testing.md:385` and `:400` (Fold4 device checklist and
  device measurements) at that issue.
- In [`docs/history/README.md`](../history/README.md), replace the
  `initial-implementation-plan.md` entry with the new summaries.
- Add the archive rule (D6) to `docs/agent/pr-workflow.md`.

Acceptance:

- The docs-link test passes.
- `docs/implementation/` holds only the hard-AI roadmap and this plan, and
  `git grep` finds no mention of a deleted file outside `docs/history/` and
  this plan.
- Each summary is at most 40 lines.

### PR-5: Compact agent guidance

#### Instruction tiers

| Tier | Files | Loaded | Budget |
| --- | --- | --- | --- |
| 0 | `AGENTS.md` (canonical) and `.github/copilot-instructions.md` | Every prompt | ≤4.5 KB and ≤0.8 KB |
| 1 | `.github/instructions/<area>.instructions.md` | When matching files are involved | ≤2 KB each |
| 2 | `docs/agent/*.md`; `.github/skills/code-review/SKILL.md` | On demand | About 60 KB in total; skill ≤4 KB |
| 3 | `docs/history/` and git history | Rarely | Summaries ≤40 lines |

`copilot-instructions.md` keeps a pointer to `AGENTS.md` plus five rules a
reviewer can check from a diff:

1. Literal `import.meta.env.BASE_URL`.
2. Validated and capped untrusted JSON.
3. `default:` in union switches.
4. Seeded AI randomness with no `structuredClone` in hot loops.
5. Explicit WebGL2 failure handling.

github.com Chat and IDE code review read only this file.

#### Path-specific instructions

Each file has `applyTo` frontmatter and holds area rules that are not in
`AGENTS.md`. Candidate content comes from `copilot-instructions.md` sections
and recurring review findings; verify each rule against the code before moving
it.

| File | `applyTo` | Content |
| --- | --- | --- |
| `renderer.instructions.md` | `src/renderers/**,src/style.css` | The "Native HTML / CSS" section, plus: change `decisionKey` for every new hub decision so stale input goes inert; how hand paging follows the selection; narrow-layout geometry. |
| `sw-pwa.instructions.md` | `public/sw.js,public/404.html,public/manifest.webmanifest,index.html,vite.config.ts,src/app/service-worker-registration.ts,src/app/url-path.ts` | The "Service worker and base path" section. |
| `tests.instructions.md` | `src/test/**` | The "Tests" section, plus: `narrowStage()` sizes for layout tests; the `innerHTML` stub needs closed SVG elements. |
| `app-state.instructions.md` | `src/app/**` | Save before every Adventure transition; per-attempt idempotency and setup reuse; schema dispatch; leaf-module import boundaries. |
| `game-ai.instructions.md` | `src/game/**` | Engine purity; the counter-growth budget for new draws, land plays or instances; folding seed high bits; a pointer to ADR 0003. |

#### Per-file targets

| File | Now | Target | Main moves |
| --- | --- | --- | --- |
| `AGENTS.md` | 6.0 KB | ≤4.5 KB | Keep the overview, the validation pointer, the 12 hard rules (one or two lines each, with stable names) and the topic index. Failure-triage prose moves to validation-and-build. |
| `copilot-instructions.md` | 7.4 KB | ≤0.8 KB | Pointer plus five rules. Area sections move to tier 1; the rest duplicates `AGENTS.md`. |
| `SKILL.md` | 7.3 KB | ≤4 KB | Keep the review priorities as checklists and link to rules instead of restating them. Shorten the MCP and comment-style sections. |
| PR template | 2.2 KB | ≤1.2 KB | Keep the sections, the validation fields, the visual-stage table and the final line; shorten the comment to a link to pr-workflow. |
| validation-and-build | 13.8 KB | 6–8 KB | Drop the incident walkthroughs (line 208 onward). Condense failure triage and the optional scripts. |
| pr-workflow | 5.4 KB | 3–4 KB | Gains the archive and dependency-update notes. |
| testing | 23.9 KB | 10–13 KB | Move the Adventure hub check (line 320), the Fold4 posture check (line 381) and the terminology release matrix (line 201) to a new on-demand `docs/agent/browser-checks.md`. |
| state-and-persistence | 34.2 KB | 10–13 KB | Regroup "Adventure run schema (version 2)" (lines 200-544) by topic: product decisions, versioning and migration, the save path and identity, attempts and setup, rewards, counters and limits, resume. Drop the milestone narrative. |
| three-interface | 22.7 KB | 5–7 KB | Adventure hub (lines 136-292, 9.6 KB) and status announcements (5 KB) become rules only. |
| three-renderer | 20.2 KB | 7–9 KB | Touch shells (line 240 onward) become rules; the measurements move to the Fold4 summary. |
| service-worker-and-pwa | 6.1 KB | 3–4 KB | Keep the caching-strategy rules. |
| architecture | 12.3 KB | 4–5 KB | The module map becomes one directory table. |
| ADR 0001 and ADR 0002 | 3.6 and 2.6 KB | About 1.5 KB each | Context, decision and consequences only. |
| ADR 0003 | 12.0 KB | 3–4 KB | Drop the measurement tables (line 114); keep the decision, invariants, budgets and the roadmap link. |

#### Compaction rules

1. Rules, not history: drop milestone narratives, incident stories,
   measurements and "changed in PR #N" notes unless the reason prevents a
   likely regression.
2. One home per rule: other files link to it by heading.
3. Cite `AGENTS.md` rules by name, never by number. Fix
   `src/app/safe-storage.ts:11` and `src/test/ai-no-state-clone.test.ts:5`.
4. Keep heading anchors stable, or update every referrer in the same commit.
   The docs-link test enforces this.
5. When a test enforces a rule, state the rule in one line and name the test.
6. Open each topic doc with a short "Rules" list; details follow.

#### Anchors with inbound links

Keep these headings, or update every link to them. Counts are baseline links
and exclude this plan's own links:

| Doc | Anchors |
| --- | --- |
| testing | `#browser-verification-and-evidence` (7 links), `#stateful-ui-regression-matrix` (3), `#seeded-ai-and-the-hard-search` (2), `#conventions`, `#threejs-tests` |
| pr-workflow | `#screenshots` (6), `#validation-status` |
| state-and-persistence | `#adventure-run-schema-version-2` (4), `#reentrant-ui-submissions` (3) |
| validation-and-build | `#sequence` (3), `#failure-triage-and-recovery` (2), `#validation-evidence-and-production-preview`, `#skipping-rules` |
| three-interface | `#adventure-hub` (2), `#status-announcements`, `#mobile-layout` |
| three-renderer | `#touch-shells`, `#layout`, `#interaction`, `#drag-geometry` |
| architecture | `#ai-decisions` |

Source comments also cite whole docs: `src/app/types.ts:23`,
`src/app/validators.ts:6,51`, `src/game/ai-levels.ts:10`,
`src/game/ai-policies/hard.ts:5`, `src/game/ai-search.ts:27`,
`src/game/ai-weights.ts:5` and `src/test/three-interface.test.ts:4336`.

#### Retention checklist

The PR-5 description maps every item to its new home (file and heading), and
the reviewer checks the mapping.

- [ ] All 12 `AGENTS.md` hard rules, including the catalog presentation
      boundary and artwork acceptance.
- [ ] Validation: Node from `.nvmrc`, `npm ci`, lint, tests, the bench where
      required, build and CodeQL. Record real exit codes, counts and revisions,
      keeping baseline and post-change results separate. Keep the skipping
      rules.
- [ ] Failure triage: classify the first meaningful error, allow at most one
      safe retry, and never weaken tests or permissions.
- [ ] PR conventions: the template, the final validation line, per-round
      review checklists, replies with commit hashes, the four visual-evidence
      stages, and checkpointing before handling images.
- [ ] Persistence:
  - [ ] Validation guards; caps that keep the tail.
  - [ ] Schema v2 dispatch; reading never writes.
  - [ ] A single save path that saves before each transition.
  - [ ] Run and mid-game save identity; counters and counter growth.
  - [ ] Resume preconditions; re-entrant submissions.
- [ ] Adventure:
  - [ ] The ten product decisions.
  - [ ] Idempotent attempt restarts; setup planned once per attempt.
  - [ ] Leaf-module boundaries.
- [ ] Interface: `decisionKey` stale-input protection, status announcements,
      unique IDs, raster `onerror` tracking, CSS order, safe-area fallbacks,
      mobile layout.
- [ ] Renderer: GPU lifecycle and disposal, context loss, the recovery screen,
      touch shells, drag geometry, hand paging.
- [ ] Service worker: per-path caching strategies, `RUNTIME_ASSET_VERSION`,
      `404.html`, base-path normalization.
- [ ] Testing: timer helpers, legal AI actions, bundler-behavior tests, the
      stateful UI matrix, browser verification and evidence.
- [ ] AI: ADR 0003 search invariants and the performance gate.

After PR-4 and PR-5 merge, agents using Copilot Memory should re-verify and
re-store memories whose citations moved. Affected topics include testing
commands, the CodeQL fallback, the Adventure roadmap, attempts, setup,
rewards, persistence and the map module, game counters, stale UI input, hand
paging and visual verification.

## Maintainer settings

These need repository-admin access and can't be done from a PR. In this
session the SBOM endpoint returned 404, the Dependabot and dependency-graph
endpoints returned 403, and `main` has no CodeQL check runs. Confirm the
current state before changing anything.

| # | Setting | Why |
| --- | --- | --- |
| M1 | Settings → Advanced Security: enable the dependency graph, Dependabot alerts and Dependabot security updates. | Required by `dependency-review` and the security group. |
| M2 | Settings → Advanced Security → CodeQL analysis → Default setup: JavaScript/TypeScript and GitHub Actions, extended query suite. | PR CodeQL checks (D8). |
| M3 | MainReviews ruleset (23695457), or a new default-branch ruleset: require the `validate` and `dependency-review` checks once PR-1 has created them. | Blocks merging red PRs. |

## Risks and fallbacks

| Risk | Mitigation |
| --- | --- |
| TypeScript 7 behaves differently | Commit 4 is isolated; revert to `~6.0.3`. |
| The Vitest 5 bench API is new | Use Vitest `^4.1.12` and restore the script with `git show 94eda5b:scripts/check-ai-bench.mjs`. |
| The bench flakes on shared runners | Gates are unchanged (1.5× over baselines already set at 2.1× the dev-container mean). Re-run once; never loosen a gate to pass. |
| Node 26 misbehaves | `.nvmrc` is the single switch; Node 24 is validated too. |
| The dependency graph is off, so `dependency-review` fails | Do M1 before merging PR-1, or drop the job. |
| Compaction drops a rule | The retention checklist, the old-to-new mapping in PR-5 and the docs-link test. |
| Deleted plans held needed context | Summaries carry `git show` recovery commands. |
| Review noise from Dependabot PRs | Groups, cooldowns and weekly or monthly schedules. |
| setup-node v7 starts caching | `package-manager-cache: false` on every setup-node step. |

## Expected gains

| Metric | Before | After |
| --- | --- | --- |
| Always-on instructions | 13.3 KB | ≤5.3 KB |
| `docs/agent/` | 156.9 KB | About 60 KB |
| Implementation and history docs | 333 KB of text, 623 KB of figures | 3.9 KB live plus about 10 KB of summaries |
| `npm run lint` / `npm run build` (spike) | 4.7 s / 5.5 s | 1.1 s / 1.9 s |
| `npm audit` findings | 8 (dev-only) | 0 |
| Pre-merge checks | None | CI, dependency review, CodeQL (after M2) |
| Cloud-agent setup | Installs by trial | Preinstalled by setup steps |

## Open questions

Defaults are applied; a different answer changes only the PR named.

- **Q1** Use Node 26 as the project Node? Default yes (PR-1); alternative:
  stay on 24.
- **Q2** Move to TypeScript 7 now? Default yes (PR-2, commit 4); alternative:
  `~6.0.3`.
- **Q3** Track pending manual gates in one issue? Default yes (PR-4);
  alternative: `docs/history/maintainer-gates.md`.
- **Q4** When `codeql_checker` is unavailable, rely on the PR's CodeQL check
  instead of the local bundle? Default yes, after M2 (PR-5 docs).
- **Q5** Make `validate` a required check? Default yes (M3).
- **Q6** Delete superseded plans and figures instead of keeping them under
  `docs/history/`? Default yes; git keeps them (PR-4).
- **Q7** Keep the five-rule subset in `copilot-instructions.md`? Default yes;
  alternative: a pure pointer, which saves 0.5 KB but leaves github.com Chat
  and IDE reviews without rules (PR-5).
- **Q8** github.com code review also reads a root `REVIEW.md`. Move the review
  priorities there so the automatic reviewer applies them too? Default no;
  revisit after PR-5.

## Appendix A: docs-link test

Shim change in `src/test/node-shims.d.ts`:

```diff
-  export function statSync(path: string): { size: number }
+  export function statSync(path: string): { size: number; isDirectory(): boolean }
```

`src/test/docs-links.test.ts`:

````ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from './helpers/ai-source-files'

// Keeps contributor and agent docs navigable after archiving or compaction:
// every relative Markdown link must resolve, every #anchor must match a
// GitHub heading slug, and source comments citing `docs/<file>.md#<anchor>`
// must still reach a heading. Walks fixed roots only, because other tests
// create scratch directories at the repository root.

const MARKDOWN_ROOTS = ['AGENTS.md', 'README.md', '.github', 'docs', 'public']
const SOURCE_ROOTS = ['index.html', 'scripts', 'src', '.github/workflows']
const SOURCE_FILE = /\.(?:html|m?js|ts|ya?ml)$/
const DOC_CITATION = /\b((?:docs|public)\/[\w./-]+\.md)(?:#([\w-]+))?/g
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

function walk(path: string, files: string[] = []): string[] {
  if (!existsSync(path)) return files
  if (!statSync(path).isDirectory()) {
    files.push(path)
    return files
  }
  for (const entry of readdirSync(path)) {
    if (entry !== 'node_modules') walk(join(path, entry), files)
  }
  return files
}

function filesUnder(roots: readonly string[], keep: (path: string) => boolean): string[] {
  return roots.flatMap((root) => walk(join(REPO_ROOT, root))).filter(keep)
}

// Lines with fenced code blanked, so line numbers stay accurate.
function proseLines(text: string): string[] {
  let fenced = false
  return text.split('\n').map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
      return ''
    }
    return fenced ? '' : line
  })
}

const anchorCache = new Map<string, Set<string>>()

function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file)
  if (cached) return cached
  const anchors = new Set<string>()
  const seen = new Map<string, number>()
  for (const line of proseLines(readFileSync(file, 'utf8'))) {
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1])
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    const slug = heading[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-')
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    anchors.add(count === 0 ? slug : `${slug}-${count}`)
  }
  anchorCache.set(file, anchors)
  return anchors
}

function problemFor(target: string, anchor: string | undefined): string | null {
  if (!existsSync(target)) return 'missing file'
  if (anchor && target.endsWith('.md') && !anchorsOf(target).has(anchor)) return `missing anchor #${anchor}`
  return null
}

function where(file: string, index: number): string {
  return `${file.slice(REPO_ROOT.length + 1)}:${index + 1}`
}

describe('documentation links', () => {
  it('resolves relative Markdown links and heading anchors', () => {
    const problems: string[] = []
    let checked = 0
    for (const file of filesUnder(MARKDOWN_ROOTS, (path) => path.endsWith('.md'))) {
      proseLines(readFileSync(file, 'utf8')).forEach((line, index) => {
        for (const match of line.replace(/`[^`]*`/g, '').matchAll(MARKDOWN_LINK)) {
          const link = match[1]
          if (/^[a-z][a-z\d+.-]*:/i.test(link)) continue
          const [path, anchor] = link.split('#')
          const target = path ? resolve(file, '..', decodeURIComponent(path)) : file
          checked += 1
          const problem = problemFor(target, anchor)
          if (problem) problems.push(`${where(file, index)} ${link}: ${problem}`)
        }
      })
    }
    // Archiving shrinks the count, so only guard against a walk or pattern
    // that silently matches nothing.
    expect(checked).toBeGreaterThan(0)
    expect(problems).toEqual([])
  })

  it('resolves docs cited from source comments', () => {
    const problems: string[] = []
    for (const file of filesUnder(SOURCE_ROOTS, (path) => SOURCE_FILE.test(path))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        for (const [citation, path, anchor] of line.matchAll(DOC_CITATION)) {
          const problem = problemFor(join(REPO_ROOT, path), anchor)
          if (problem) problems.push(`${where(file, index)} ${citation}: ${problem}`)
        }
      })
    }
    expect(problems).toEqual([])
  })
})
````

## Appendix B: bench gate for Vitest 5

In `src/test/ai-perf.bench.ts`, the scenario, `BENCH_OPTIONS`, the
legal-action precheck and `void actionSink` stay unchanged. The import becomes
`import { describe, expect, test } from 'vitest'`, and the `bench` blocks
become:

```ts
// Baselines in ms/op; each gate allows a 1.5x slowdown.
const GATES = [
  { name: 'advanced ai chooses from targeted scenario', level: 'advanced', baselineMs: 0.55 },
  { name: 'hard ai search chooses from targeted scenario', level: 'hard', baselineMs: 14 },
] as const
const MAX_SLOWDOWN = 1.5

describe('AI performance gate', () => {
  for (const { name, level, baselineMs } of GATES) {
    test(name, async ({ bench }) => {
      const result = await bench(name, () => {
        actionSink = chooseAiAction(scenario, 0, { level, seed: SCENARIO_SEED })
      }).run(BENCH_OPTIONS)
      const msPerOp = result.latency.mean
      console.log(`AI benchmark: '${name}' ${msPerOp.toFixed(4)} ms/op (gate ${(baselineMs * MAX_SLOWDOWN).toFixed(4)})`)
      expect(msPerOp).toBeLessThanOrEqual(baselineMs * MAX_SLOWDOWN)
    })
  }
})
```

In the header comment, replace the references to `scripts/check-ai-bench.mjs`
and `KEEP_AI_BENCH_REPORT` with: baselines live in `GATES`; re-baseline only
after intentional AI-performance work, from the logged ms/op of three idle
runs, and update `GATES` and this comment in the same PR.

## Appendix C: maintainer-gates issue

Title: "Maintainer verification gates (devices, assistive technology, visual
review)". Body:

```markdown
Pending manual checks from archived implementation plans (see docs/history/).
Agents cannot complete these; each needs real devices, assistive technology
or human visual judgment.

### Adventure map and relics
- [ ] M7 release gate: compatibility matrix (legacy saves, recordings, game
      modes, tutorial, CLI, P2P, non-root build, offline reload) and recorded
      visual outcomes. Agents can prepare the docs and automated rows.
- [ ] Phone and tablet at the largest text size
- [ ] Windows forced colors
- [ ] VoiceOver, TalkBack and NVDA/JAWS
- [ ] Speech input
- [ ] Visual review against plan Figures 1–2
- [ ] Safari and Firefox, including the route trail at 320 px
- [ ] Hub render time under 4× CPU throttling

### Fold4 touch UI (physical Galaxy Z Fold4)
- [ ] M0 device measurements
- [ ] Figure 3, 4, 5–6 and 7 checks
- [ ] M5 remote drag profiling, TalkBack, maximum font size, Remove animations
- [ ] Device checklist (copy the items from the plan's "Fold4 device checklist")

### Creature terminology
- [ ] Human art review and production-browser visual acceptance
- [ ] Production-browser evidence for restored-art revision
      6623a7514ef5e479bfa0f4a5544cbe420f09ea96
- [ ] Historical recording acceptance with a maintainer-provided captured
      fixture
```
