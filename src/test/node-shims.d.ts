// Minimal ambient declarations to let `tsc --noEmit` type-check Node-only
// test helpers without depending on @types/node. Vitest runs these tests in
// a Node environment so the actual implementations exist at runtime.

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { size: number }
  export function existsSync(path: string): boolean
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function mkdtempSync(prefix: string): string
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string
  export function join(...segments: string[]): string
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: string[],
    options?: {
      cwd?: string
      env?: Record<string, string | undefined>
      encoding?: 'utf8'
      stdio?: unknown
      timeout?: number
    },
  ): { status: number | null; stdout: string; stderr: string; error?: Error }
}

declare const __dirname: string

declare const Buffer: {
  from(data: ArrayLike<number>): Uint8Array
}

declare const process: {
  env: Record<string, string | undefined>
  execPath: string
}
