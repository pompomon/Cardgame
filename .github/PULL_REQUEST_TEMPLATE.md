# Pull request

## Summary

<!-- One-paragraph overview of the change and why. -->

## Changes

<!-- Bullet list of concrete edits, grouped by area (app / renderer / engine / docs / tests). -->

## Risk / migration notes

<!--
Call out anything reviewers must double-check:
- recording schema or snapshot shape changes (back-fill / validator updates)
- service-worker `CACHE_VERSION` bump (e.g. same-path card-art replacement)
- new `localStorage` keys or value-shape changes
- Vite base-path / asset URL changes
- behavior changes that affect saved adventure runs
Leave "None" if nothing applies.
-->

None.

## References

Contributor guide: [`AGENTS.md`](../AGENTS.md) and [`docs/agent/`](../docs/agent/).

## Validation

<!--
End the description with the one-line validation block below (documented
in `docs/agent/pr-workflow.md`). Replace pending only with observed outcomes:
passed (✔), failed, blocked, or not run (reason). For a tool-directed skip,
use "not run (skipped: reason)", not "0 alerts". Add the actual passing test
count when tests run; never copy an earlier revision's count.
Record baseline and post-change checks separately, with exit codes/output
references. Code validation, visual evidence, and agent-run status are independent.
For no UI changes, mark visual stages not run with that reason; otherwise
blocked visual verification stays pending maintainer review.
Keep the validation line as the final content — no sections or prose after it.
-->

- Tested revision / included uncommitted changes: pending
- Node/npm versions: pending
- Command exit codes, observed test count, and output references: pending
- AI benchmark (deployment reproduction / AI hot-loop changes): pending
- Agent-run status / run link / blocker: pending
- Browser/device/viewport and exercised scenarios: pending
- Unverified browser/device coverage: not recorded
- Evidence reference / expiry if applicable: pending

| Visual evidence stage | Outcome / evidence or reason |
| --- | --- |
| Browser interaction completed | pending |
| Screenshot captured | pending |
| Screenshot inspected | pending |
| Evidence attached and reviewer-accessible | pending |

Validation: lint pending / tests pending / build pending / CodeQL pending
