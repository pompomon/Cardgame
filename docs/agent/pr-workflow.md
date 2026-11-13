# PR workflow

PR descriptions, review rounds and visual evidence.

## Rules

- Fill in the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md); checks
  start **pending**.
- End the description with the validation line. Write
  `Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔` only when all four
  passed; otherwise report each failed, blocked or not-run check and why.
- Track each review round in a new **PR review feedback (round N)**
  sub-checklist mirroring the comment topics; never merge rounds.
- Answer each addressed comment with the commit hash, a short summary and
  actual validation outcomes; answer false positives and out-of-scope
  suggestions with the rationale.
- Re-run the [validation sequence](validation-and-build.md#sequence) after
  each round.
- One coherent theme per PR; refactor only code you touch.

## Validation status

- Outcomes: **passed** (`✔`), **failed**, **blocked** or **not run
  (reason)**; a skipped analysis is **not run (skipped: reason)**, never
  "0 alerts".
- Pending, blocked, failed or not-run required checks aren't satisfied; an
  omission the [skipping rules](validation-and-build.md#skipping-rules)
  allow is reported as not run, never passed.
- `N` is the passing test count observed for the reported revision.
- Fill every template field above the line, naming the revision that
  each delegated check covered.
- Report code validation, visual verification and agent-run status
  separately; passing checks don't prove visual verification.

## Review rounds

- Pushes to a `main`-based PR trigger an automatic Copilot re-review
  (MainReviews ruleset); other bases, e.g. stacked PRs, get none: request
  one with `gh pr edit <N> --add-reviewer @copilot`.
- A Copilot review may list findings only in its body, with no inline
  thread: read review bodies and answer those findings in a PR comment.
- For UI changes, attach a fresh screenshot each round.

## Screenshots

User-visible changes need visual verification; follow
[browser verification](testing.md#browser-verification-and-evidence).

- Record four stages separately: browser interaction, capture, inspection
  and reviewer-accessible attachment.
- Checkpoint code and textual results first. Keep captures out of the
  repository; never capture profiles, credentials or sensitive content.
- Attach only through a repository-approved GitHub mechanism (else ask a
  maintainer), never an invented URL; a temporary path is not an attachment.
  Check that reviewers can open the reference, note any expiry and cite it
  in the PR and UI replies. Keep the local image until upload finishes.
- If a stage stays blocked after
  [bounded recovery](validation-and-build.md#failure-triage-and-recovery),
  report the missing stages, error and unverified coverage. It stays pending
  maintainer verification, never passed, silently waived or mocked.
- Without a user-visible change, record **not run (no UI change)**.

## Dependency updates

[Dependabot](../../.github/dependabot.yml) opens grouped PRs (npm weekly,
Actions monthly) after a cooldown; security updates open immediately.

- Merge patch and minor groups on green CI after skimming release notes.
- Majors: one tool per commit, the full validation sequence, and a browser
  smoke test for three or Vite.
- Never hand-edit `package-lock.json`.

## Archiving completed plans

`docs/implementation/` holds only in-progress plans. Once one is delivered:

- Move still-needed rules to their `docs/agent/` homes.
- Replace the plan and its figures with a `docs/history/` summary of at most
  40 lines: Delivered, Durable decisions (each naming its `docs/agent/`
  heading), Open follow-ups and Lessons. Delete superseded plans without one.
- Give the recovery command `git show <sha>:<path>`, using the last commit
  containing the file.
- Move pending manual checks (devices, assistive technology, human visual
  review) to the
  [maintainer-gates issue](https://github.com/pompomon/Cardgame/issues/163).
