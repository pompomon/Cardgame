// Minimal ambient declarations to let `tsc --noEmit` type-check Node-only
// test helpers without depending on @types/node. Vitest runs these tests in
// a Node environment so the actual implementations exist at runtime.

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array
  export function statSync(path: string): { size: number }
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string
}

declare const __dirname: string

declare const Buffer: {
  from(data: ArrayLike<number>): Uint8Array
}
