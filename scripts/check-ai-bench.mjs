import { readFileSync, unlinkSync } from 'node:fs'

const BENCHMARK_NAME = 'hard ai chooses from targeted scenario'
const BASELINE_MS_PER_OP = 0.55
const MAX_SLOWDOWN = 1.5
const MAX_MS_PER_OP = BASELINE_MS_PER_OP * MAX_SLOWDOWN

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// Vitest's benchmark JSON (`vitest bench --outputJson`) nests results as
// `files[].groups[].benchmarks[]`, but the exact shape is experimental and has
// shifted between releases. Walk the structure generically so the gate keeps
// finding the benchmark by name even if the nesting changes.
function findBenchmark(report, name) {
  const stack = [report]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const item of node) {
        stack.push(item)
      }
      continue
    }
    if (node && typeof node === 'object') {
      if (node.name === name && (typeof node.hz === 'number' || typeof node.mean === 'number')) {
        return node
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
          stack.push(value)
        }
      }
    }
  }
  return null
}

// Vitest reports benchmark timings via tinybench, whose `mean` is already in
// milliseconds. Derive ms/op from `hz` (operations per second) when available
// so the comparison is immune to any seconds-vs-milliseconds ambiguity in the
// raw fields, and fall back to `mean` only when `hz` is missing.
function msPerOp(benchmark) {
  if (typeof benchmark.hz === 'number' && benchmark.hz > 0) {
    return 1000 / benchmark.hz
  }
  if (typeof benchmark.mean === 'number') {
    return benchmark.mean
  }
  return null
}

const reportPath = process.argv[2]

if (!reportPath) {
  throw new Error('usage: node scripts/check-ai-bench.mjs <benchmark-json>')
}

let benchmark
try {
  benchmark = findBenchmark(readReport(reportPath), BENCHMARK_NAME)
} finally {
  if (!process.env.KEEP_AI_BENCH_REPORT) {
    try { unlinkSync(reportPath) } catch { /* ignore if already gone */ }
  }
}

if (!benchmark) {
  throw new Error(`benchmark '${BENCHMARK_NAME}' was not found in ${reportPath}`)
}

const meanMsPerOp = msPerOp(benchmark)

if (typeof meanMsPerOp !== 'number' || !Number.isFinite(meanMsPerOp)) {
  throw new Error(`benchmark '${BENCHMARK_NAME}' in ${reportPath} has no usable timing (hz/mean)`)
}

if (meanMsPerOp > MAX_MS_PER_OP) {
  throw new Error(
    [
      `AI benchmark regression: ${meanMsPerOp.toFixed(4)} ms/op exceeds ${MAX_MS_PER_OP.toFixed(4)} ms/op.`,
      `Baseline is ${BASELINE_MS_PER_OP.toFixed(4)} ms/op with a ${MAX_SLOWDOWN}x gate.`,
    ].join(' '),
  )
}

// eslint-disable-next-line no-console
console.log(
  `AI benchmark OK: ${meanMsPerOp.toFixed(4)} ms/op <= ${MAX_MS_PER_OP.toFixed(4)} ms/op`,
)
