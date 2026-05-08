export function joinBasePath(basePath: string, relativePath: string): string {
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`
  const normalizedRelative = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  if (normalizedBase === '/') {
    return normalizedRelative
  }
  const baseWithoutTrailingSlash = normalizedBase.slice(0, -1)
  return normalizedRelative === '/' ? normalizedBase : `${baseWithoutTrailingSlash}${normalizedRelative}`
}
