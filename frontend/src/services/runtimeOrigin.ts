/**
 * Runtime origin helpers for browser vs Tauri desktop.
 *
 * In the desktop WebView, `window.location.origin` is `http://tauri.localhost`
 * (or `tauri://localhost`). Absolute tile/EventSource URLs built from that
 * origin never reach Fastify on :3000. Prefer VITE_API_BASE_URL when set;
 * otherwise pin desktop traffic to loopback.
 */

export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) return true
    const { protocol, hostname } = window.location
    return protocol === 'tauri:' || hostname === 'tauri.localhost'
  } catch {
    return false
  }
}

/** Origin only, e.g. `http://127.0.0.1:3000` — no trailing slash. */
export function apiOrigin(): string {
  const env = String(import.meta.env.VITE_API_BASE_URL || '').trim()
  if (/^https?:\/\//i.test(env)) {
    return env.replace(/\/api\/?$/i, '').replace(/\/$/, '')
  }
  if (isDesktopShell()) return 'http://127.0.0.1:3000'
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}

/** Axios baseURL, e.g. `/api` or `http://127.0.0.1:3000/api`. */
export function apiBaseUrl(): string {
  const env = String(import.meta.env.VITE_API_BASE_URL || '').trim()
  if (env) return env.replace(/\/$/, '')
  if (isDesktopShell()) return 'http://127.0.0.1:3000/api'
  return '/api'
}

/** Absolute URL for a path under /api (tiles, SSE, etc.). */
export function absoluteApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const origin = apiOrigin()
  if (!origin) return p
  // path may already include /api
  if (p.startsWith('/api')) return `${origin}${p}`
  return `${origin}/api${p}`
}
