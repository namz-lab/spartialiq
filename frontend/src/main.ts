import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { invoke, isTauri } from '@tauri-apps/api/core'
import router from './router'
import App from './App.vue'
// Scroll-reveal motion for the public pages (registered globally so any
// public view can use v-reveal / v-stagger). Gated on prefers-reduced-motion
// inside the directive — see src/composables/reveal.ts.
import { vReveal, vStagger } from './composables/reveal'
import './styles/main.css'
// Enterprise design-system token SSOT (--ent-*). Imported after main.css so
// new/migrated chrome reads from one source; legacy civic tokens stay until
// each screen migrates. See docs/enterprise-design-system.md.
import './styles/enterprise.css'
// Device dimension of the design system: breakpoints, safe-area insets, touch
// density, responsive type scale, layout utilities. Must load AFTER
// enterprise.css because it re-values --ent-* control/row/type tokens under
// `pointer: coarse` and `max-width: 767px`. See src/styles/responsive.css.
import './styles/responsive.css'
// MapLibre's stylesheet — styles the navigation/zoom controls, scale,
// attribution and popup. Imported once globally so it ships in the
// initial CSS chunk and every map view picks it up without per-component
// duplicate imports.
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/maplibre-polish.css'
// Shared styling for the public marketing pages (Home / About / Services)
// and the SiteHeader / SiteFooter components.
import './styles/public-pages.css'
// The five screens an anonymous visitor can reach — sign in, create account,
// forgot password, reset password, accept invite. One file so they cannot
// drift apart; reads only --ent-* tokens. See src/styles/auth.css.
import './styles/auth.css'
import { escapeHtml } from './utils/escapeHtml'

function alreadyOnHostedServer(): boolean {
  const host = window.location.hostname
  return host.endsWith('trycloudflare.com') || host.endsWith('ngrok-free.app')
}

async function launch() {
  const host = document.querySelector('#app')
  // The hosted page also runs inside the desktop window. Asking for the
  // address again never mounts the council screens, so the window stays white.
  if (host && isTauri() && !alreadyOnHostedServer()) {
    try {
      const hosted = await invoke<string | null>('hosted_web_url')
      if (hosted && !alreadyOnHostedServer()) {
        host.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;font:16px system-ui;color:#343a40">Opening the council server…</div>'
        return
      }
    } catch (error) {
      console.error('Hosted council address was not read:', error)
    }
    host.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;font:16px system-ui;color:#343a40">Starting local PostGIS and council services…</div>'
    try {
      await invoke('start_local_stack')
    } catch (error) {
      console.error('Local desktop services did not start:', error)
      if (host) {
        host.innerHTML = `<div style="max-width:680px;margin:12vh auto;padding:24px;font:16px system-ui;color:#343a40"><h1>Local services could not start</h1><p>${escapeHtml(String(error))}</p><p>Check the desktop setup guide for PostgreSQL/PostGIS prerequisites, then restart the application. The web interface will still open, but database-backed features will not work.</p></div>`
      }
      return
    }
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.directive('reveal', vReveal)
  app.directive('stagger', vStagger)
  app.mount('#app')
}

void launch()
