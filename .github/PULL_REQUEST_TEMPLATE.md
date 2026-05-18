# Pull request

## Summary

<!-- One-paragraph overview of the change and why. -->

## Changes

<!-- Bullet list of concrete edits, grouped by area (app / renderer / engine / docs / tests). -->

## Validation

- [ ] `npm run lint` (= `tsc --noEmit`) passes
- [ ] `npm run test` (= `vitest run`) passes — **count:** `N` tests
- [ ] `npm run build` (= `tsc && vite build`) passes
- [ ] `codeql_checker` run; no actionable alerts (or alerts addressed inline)
- [ ] UI screenshot attached (only when the change is user-visible)

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
