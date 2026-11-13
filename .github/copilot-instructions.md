# Copilot instructions

Follow [`AGENTS.md`](../AGENTS.md): validation, hard rules and the topic
index. Review with the `code-review` skill when available. Check every diff:

1. `import.meta.env.BASE_URL` is accessed only as that literal expression.
2. Untrusted JSON is deep-validated with the `isXxx` guards: no non-finite,
   negative or fractional counters; arrays are capped, keeping the tail.
3. Every switch over a discriminated union has a `default:` returning a safe
   placeholder or documented sentinel.
4. AI randomness comes only from `src/game/ai-random.ts`; no
   `structuredClone(GameState)` in AI or render hot loops.
5. WebGL2 failures reach `RendererHost`'s recovery screen; no hidden
   renderer fallback.
