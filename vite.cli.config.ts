import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))
const defaultOutDir = resolve(repositoryRoot, 'dist-cli')
const outDir = process.env.CLI_OUT_DIR ?? defaultOutDir

export default defineConfig({
  build: {
    target: 'node22',
    outDir,
    emptyOutDir: outDir === defaultOutDir,
    copyPublicDir: false,
    minify: false,
    sourcemap: false,
    ssr: resolve(repositoryRoot, 'scripts/cardgame-cli.mjs'),
    rollupOptions: {
      output: {
        entryFileNames: 'cardgame-cli.mjs',
        codeSplitting: false,
      },
    },
  },
})
