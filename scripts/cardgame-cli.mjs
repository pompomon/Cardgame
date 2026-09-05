#!/usr/bin/env node

import process from 'node:process'
import { createInterface } from 'node:readline'
import { runCli } from '../src/cli/main.ts'

const abortController = new AbortController()
const queuedLines = []
const lineWaiters = []
let inputClosed = false
const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
})

function abort() {
  abortController.abort()
  readline.close()
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    if (milliseconds <= 0 || abortController.signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      clearTimeout(timeout)
      abortController.signal.removeEventListener('abort', finish)
      resolve()
    }
    const timeout = setTimeout(finish, milliseconds)
    abortController.signal.addEventListener('abort', finish, { once: true })
  })
}

readline.on('line', (line) => {
  const waiter = lineWaiters.shift()
  if (waiter) {
    waiter(line)
    return
  }
  queuedLines.push(line)
})
readline.on('close', () => {
  inputClosed = true
  for (const waiter of lineWaiters.splice(0)) {
    waiter(null)
  }
})
readline.on('SIGINT', abort)
process.once('SIGINT', abort)
process.once('SIGTERM', abort)

const io = {
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  signal: abortController.signal,
  async read(prompt) {
    if (abortController.signal.aborted) {
      return null
    }
    process.stdout.write(prompt)
    const queued = queuedLines.shift()
    if (queued !== undefined) {
      return queued
    }
    if (inputClosed) {
      return null
    }
    return await new Promise((resolve) => {
      lineWaiters.push(resolve)
    })
  },
  write(message) {
    process.stdout.write(`${message}\n`)
  },
  writeError(message) {
    process.stderr.write(`${message}\n`)
  },
  delay,
}

try {
  process.exitCode = await runCli(process.argv.slice(2), io)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
} finally {
  process.removeListener('SIGINT', abort)
  process.removeListener('SIGTERM', abort)
  readline.close()
}
