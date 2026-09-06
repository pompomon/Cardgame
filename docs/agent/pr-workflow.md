# PR workflow

How PRs are structured and how review rounds are tracked in this repo.

## PR description structure

Use the template at [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md).
Every description ends with a validation block. The all-green form is only
appropriate when all four checks actually passed:

```
Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
```

`N` is the actual observed passing test count from `npm run test` for the
reported revision, not an earlier run's count. The template starts pending.

## Validation status

- Start each check **pending**. Change it to **passed** (`✔`), **failed**,
  **blocked** (an environment/tool/service prevents completion), or **not run**
  with a reason. Report a tool-directed skipped analysis as **not run (skipped:
  reason)**, never as "0 alerts". Pending, blocked, and failed required checks
  are not completion or merge approval.
- Keep the final line's lint/tests/build/CodeQL fields, replacing each pending
  value with its actual outcome. Required checks reported as pending, blocked,
  failed, or not run are not satisfied. An omission explicitly allowed by the
  [skipping rules](validation-and-build.md#skipping-rules) may be reported as not
  run, but must not be represented as a passed required check.
- Above that line, record the tested revision and any included uncommitted
  changes, Node/npm versions, actual command exit codes and output references,
  and the benchmark result when applicable. Separate baseline from post-change
  results and identify the revision covered by delegated checks.
- Report **code validation**, **visual verification**, and **agent-run status**
  independently. An agent crash does not undo observed code-check results;
  passing checks do not establish that a browser or screenshot was verified.
- For visual evidence, record the browser/device/viewport, exercised scenario,
  unverified coverage, and returned attachment reference. Keep unavailable
  verification pending maintainer review rather than approving your own exception.

## Checklists

Use Markdown task lists in the PR body to track work:

```
- [x] Feature A
- [x] Feature B
- [x] PR review feedback (round 1)
- [x] PR review feedback (round 2)
  - [x] Cap parsed log events to most recent N entries
- [x] Lint + N tests passing
```

- Add a new **"PR review feedback (round N)"** sub-checklist each time a
  fresh round of reviewer comments arrives. Mirror the comment topics as
  sub-items.
- Don't squash rounds together — the round structure is the audit trail.

## Responding to reviewer comments

When you address a reviewer comment in code, reply to the comment thread
with:

- The **commit hash** that applied the fix.
- A **short summary** of what changed and why.
- A note on the actual validation outcomes, including any failed, blocked,
  skipped, or not-run checks and their reasons.

If the suggestion is a false positive or out of scope, reply with the
rationale instead of silently dismissing it.

## Re-running validation

- **After each round of edits**, follow the sequence and documented exceptions in
  [`validation-and-build.md`](validation-and-build.md): lint, tests, build,
  CodeQL, plus the benchmark when applicable. Earlier results are not evidence
  for later relevant edits.
- For UI changes, capture a fresh screenshot per round and attach it to
  the reply (or to the PR description).

## Screenshots

User-visible changes require visual verification and screenshot evidence.
Follow [browser verification](testing.md#browser-verification-and-evidence);
track interaction, capture, inspection, and attachment as separate outcomes.

- Checkpoint code and textual check results before image inspection/upload;
  scan changed files for secrets before committing. Keep incidental captures and
  browser data outside the repository (for example in `/tmp`), not in application
  assets. Never include profiles, credentials, or sensitive page content.
- Attach evidence through a supported, repository-approved GitHub
  attachment/artifact mechanism. Retain the returned reviewer-accessible
  reference, verify it works for intended reviewers, and record expiry when
  applicable. Do not invent an upload URL or treat a local temporary path as
  an attachment. If no approved mechanism is available, ask a maintainer.
- Reference the evidence in the PR and relevant UI-review replies. Preserve the
  local image until inspection and upload finish; on session resume, recreate
  missing captures rather than trusting stale temporary paths or expired links.
- If navigation, inspection, or attachment remains blocked after bounded
  supported recovery, preserve available evidence and report the missing stages,
  error, and unverified coverage. Request maintainer verification and keep visual
  verification pending review; do not mark it passed or substitute a mock test.
  Non-user-visible changes may record **not run (no UI change)**.

## Scope discipline

- One PR per coherent theme. PRs that bundle three unrelated improvements
  (lobby centering + monochrome art + AI-hand hiding) are acceptable when
  each item is small and the bundling is called out in the description,
  but prefer separate PRs when any item is non-trivial.
- Refactoring touched code is fine; refactoring unrelated code is not.
  Use the "Out of scope" / follow-up sections in the description to
  defer.
