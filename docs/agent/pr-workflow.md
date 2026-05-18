# PR workflow

How PRs are structured and how review rounds are tracked in this repo.

## PR description structure

Use the template at `.github/PULL_REQUEST_TEMPLATE.md`. Every description
ends with a validation block:

```
Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
```

`N` is the actual passing test count from `npm run test`. Update it when
your change adds or removes tests.

## Checklists

Use Markdown task lists in the PR body to track work:

```
- [x] Feature A
- [x] Feature B
- [x] PR review feedback (round 1)
- [x] PR review feedback (round 2)
  - [x] Cap parsed log events to most recent N entries
- [x] Lint + 187 tests passing
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
- A note on validation: `Lint clean; N tests pass; CodeQL: 0 alerts.`

If the suggestion is a false positive or out of scope, reply with the
rationale instead of silently dismissing it.

## Re-running validation

- **After each round of edits**, re-run the full sequence in
  [`validation-and-build.md`](validation-and-build.md): lint, tests, build,
  CodeQL.
- For UI changes, capture a fresh screenshot per round and attach it to
  the reply (or to the PR description).

## Screenshots

User-visible changes always ship a screenshot. Reference the file path in
the PR description and reply to the reviewer's UI-related comments with
the same screenshot.

## Scope discipline

- One PR per coherent theme. PRs that bundle three unrelated improvements
  (lobby centering + monochrome art + AI-hand hiding) are acceptable when
  each item is small and the bundling is called out in the description,
  but prefer separate PRs when any item is non-trivial.
- Refactoring touched code is fine; refactoring unrelated code is not.
  Use the "Out of scope" / follow-up sections in the description to
  defer.
