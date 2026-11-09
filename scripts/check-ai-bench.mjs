import { readFileSync, unlinkSync } from 'node:fs'

// One gate per benchmark in `src/test/ai-perf.bench.ts`. The bench comment
// explains how the baselines were measured; change both together.
const GATES = [
  { name: 'advanced ai chooses from targeted scenario', baselineMs: 0.55, maxSlowdown: 1.5 },
  { name: 'hard ai search chooses from targeted scenario', baselineMs: 14, maxSlowdown: 1.5 },
]

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

let report
try {
  report = readReport(reportPath)
} finally {
  if (!process.env.KEEP_AI_BENCH_REPORT) {
    try { unlinkSync(reportPath) } catch { /* ignore if already gone */ }
  }
}

const failures = []

for (const { name, baselineMs, maxSlowdown } of GATES) {
  const benchmark = findBenchmark(report, name)
  if (!benchmark) {
    failures.push(`benchmark '${name}' was not found in ${reportPath}`)
    continue
  }

  const meanMsPerOp = msPerOp(benchmark)
  if (typeof meanMsPerOp !== 'number' || !Number.isFinite(meanMsPerOp)) {
    failures.push(`benchmark '${name}' in ${reportPath} has no usable timing (hz/mean)`)
    continue
  }

  const maxMsPerOp = baselineMs * maxSlowdown
  if (meanMsPerOp > maxMsPerOp) {
    failures.push(
      [
        `AI benchmark regression in '${name}': ${meanMsPerOp.toFixed(4)} ms/op exceeds ${maxMsPerOp.toFixed(4)} ms/op.`,
        `Baseline is ${baselineMs.toFixed(4)} ms/op with a ${maxSlowdown}x gate.`,
      ].join(' '),
    )
    continue
  }

  // eslint-disable-next-line no-console
  console.log(`AI benchmark OK: '${name}' ${meanMsPerOp.toFixed(4)} ms/op <= ${maxMsPerOp.toFixed(4)} ms/op`)
}

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}
