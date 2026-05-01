import { defineConfig } from 'vite'

function normalizeBasePath(value: string): string {
  if (!value || value === '/') {
    return '/'
  }
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export default defineConfig(({ command }) => {
  const pagesBasePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? '/Cardgame/')
  return {
    base: command === 'build' ? pagesBasePath : '/',
  }
})
