/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_MAP_STYLE: string
  readonly VITE_MAP_ACCESS_TOKEN: string
  /** Cloudflare Turnstile site key (public). Required in production builds. */
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
