import { readFileSync } from 'node:fs'

const BENCHMARK_NAME = 'hard ai chooses from targeted scenario'
const BASELINE_MS_PER_OP = 0.55
const MAX_SLOWDOWN = 1.5
const MAX_MS_PER_OP = BASELINE_MS_PER_OP * MAX_SLOWDOWN

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function findBenchmark(report) {
  for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
      const benchmark = (group.benchmarks ?? []).find((entry) => entry.name === BENCHMARK_NAME)
      if (benchmark) {
        return benchmark
      }
    }
  }
  return null
}

const reportPath = process.argv[2]

if (!reportPath) {
  throw new Error('usage: node scripts/check-ai-bench.mjs <benchmark-json>')
}

const benchmark = findBenchmark(readReport(reportPath))

if (!benchmark || typeof benchmark.mean !== 'number') {
  throw new Error(`benchmark '${BENCHMARK_NAME}' was not found in ${reportPath}`)
}

if (benchmark.mean > MAX_MS_PER_OP) {
  throw new Error(
    [
      `AI benchmark regression: ${benchmark.mean.toFixed(4)} ms/op exceeds ${MAX_MS_PER_OP.toFixed(4)} ms/op.`,
      `Baseline is ${BASELINE_MS_PER_OP.toFixed(4)} ms/op with a ${MAX_SLOWDOWN}x gate.`,
    ].join(' '),
  )
}

// eslint-disable-next-line no-console
console.log(
  `AI benchmark OK: ${benchmark.mean.toFixed(4)} ms/op <= ${MAX_MS_PER_OP.toFixed(4)} ms/op`,
)
