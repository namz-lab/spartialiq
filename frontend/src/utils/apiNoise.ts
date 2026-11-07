/** Optional-data fetches that should not dump Axios errors into the console. */
export function isQuietApiFailure(err: unknown): boolean {
  const e = err as { code?: string; message?: string; response?: { status?: number } }
  if (e?.code === 'ECONNABORTED') return true
  if (/timeout/i.test(e?.message || '')) return true
  const status = e?.response?.status
  return status === 404 || status === 403
}
