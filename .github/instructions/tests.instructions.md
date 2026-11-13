---
applyTo: "src/test/**"
---

# Tests

Details: [testing](../../docs/agent/testing.md).

- Use `withFakeTimers(...)` or `installFakeTimerHooks()` from
  `src/test/helpers/timers.ts`; never open-code fake-timer setup/teardown.
- AI-policy assertions use actions that pass `isLegalActionForState`,
  including `effectTargetId` when the opponent hand is non-empty.
- When correctness depends on bundler output, run a real build as
  `card-art-base-path.test.ts` does.
- Stateful UI tests cover synchronous notifications, rejected retries, stale
  input, duplicate activation, cancellation/disposal and target cardinality;
  see [the matrix](../../docs/agent/testing.md#stateful-ui-regression-matrix).
- Narrow board geometry tests take stage sizes from `narrowStage()` in
  `three-layout.test.ts` (viewport minus chrome and safe areas, at 100% and
  200% text), never raw viewport sizes.
- The `innerHTML` stub in `three-interface.test.ts` treats only
  INPUT/IMG/BR/HR/META/LINK as void and ignores `/>`, so close every inline
  SVG element (`<line …></line>`).
- `docs-links.test.ts` checks relative Markdown links, their anchors and
  `docs/…md#anchor` citations in source comments: update referrers when
  renaming a heading.
- Never weaken or delete an unrelated test to make a change pass.
