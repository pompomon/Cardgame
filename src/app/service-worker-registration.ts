export function serviceWorkerRegistrationUrl(baseUrl: string, moduleUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const modulePath = new URL(moduleUrl).pathname
  const buildId = modulePath.slice(modulePath.lastIndexOf('/') + 1) || 'entry'
  const search = new URLSearchParams({
    base: normalizedBaseUrl,
    build: buildId,
  })
  return `${normalizedBaseUrl}sw.js?${search}`
}
