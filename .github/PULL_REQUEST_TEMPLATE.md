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
in `docs/agent/pr-workflow.md`). Replace `N` with the actual passing test
count from `npm run test`. Attach a UI screenshot only when the change is
user-visible. Keep the validation line as the final content of the PR
description — do not add sections or prose after it.
-->

Validation: lint ✔ / tests ✔ (N) / build ✔ / CodeQL ✔
