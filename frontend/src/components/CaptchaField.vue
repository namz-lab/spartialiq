<script lang="ts">
// Bot check: Cloudflare Turnstile (free tier). The widget runs in a Cloudflare
// iframe and usually passes without a puzzle; when it does ask, the puzzle is
// accessible. The token it hands back is redeemed once by the backend
// (src/utils/captchaChallenge.js), so after any submit the server saw, the
// widget must be reset for a fresh one.
//
// This is the one deliberate exception to the self-hosted rule: the script
// has to come from challenges.cloudflare.com, and only the auth forms load it.
type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: Turnstile } }

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
// Cloudflare's published always-pass test key, used only by `npm run dev`
// when VITE_TURNSTILE_SITE_KEY is unset. The backend pairs it with the test secret.
const TEST_SITE_KEY = '1x00000000000000000000AA'
const SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? TEST_SITE_KEY : '')

// One script tag for the whole app, however many forms mount.
let loading: Promise<Turnstile> | null = null
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => { loading = null; s.remove(); reject(new Error('turnstile blocked')) }
    document.head.appendChild(s)
  })
  return loading
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const token = defineModel<string>({ default: '' })
const website = defineModel<string>('website', { default: '' }) // honeypot

const host = ref<HTMLElement | null>(null)
const error = ref('')
let widgetId: string | null = null
let api: Turnstile | null = null
let waiters: Array<(t: string) => void> = []

function settle(t: string) {
  token.value = t
  const ready = waiters
  waiters = []
  ready.forEach((resolve) => resolve(t))
}

onMounted(async () => {
  if (!SITE_KEY) {
    error.value = 'The security check is not configured. Contact the council.'
    return
  }
  try {
    api = await loadTurnstile()
  } catch {
    error.value = 'The security check could not load. Check your connection and reload the page.'
    settle('')
    return
  }
  if (!host.value) return
  widgetId = api.render(host.value, {
    sitekey: SITE_KEY,
    theme: 'auto',
    size: 'flexible',
    callback: (t: string) => { error.value = ''; settle(t) },
    'expired-callback': () => { token.value = '' }, // Turnstile refreshes it itself
    'error-callback': () => {
      error.value = 'The security check failed. It will try again.'
      settle('')
    },
  })
})

onBeforeUnmount(() => {
  if (api && widgetId) api.remove(widgetId)
  settle('')
})

/** The token, waiting (up to 30 s) if a quick submit beat the widget. '' on failure. */
function ensure(): Promise<string> {
  if (token.value || !api || !widgetId) return Promise.resolve(token.value)
  return new Promise((resolve) => {
    waiters.push(resolve)
    setTimeout(() => {
      waiters = waiters.filter((w) => w !== resolve)
      resolve(token.value)
    }, 30_000)
  })
}

/** A token is single-use: after any submit the server saw, get a fresh one. */
function refresh() {
  token.value = ''
  if (api && widgetId) api.reset(widgetId)
}

defineExpose({ ensure, refresh })
</script>

<template>
  <div class="cap">
    <!-- Honeypot: hidden from users, bots often fill it -->
    <label class="cap-hp" aria-hidden="true">
      Leave blank
      <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off" />
    </label>

    <div ref="host" class="cap-widget" />
    <p v-if="error" class="cap-err" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
/* Tokens only — src/styles/enterprise.css. The widget itself is Cloudflare's
   iframe and styles itself; this only lays it out inside the auth form. */
.cap { display: flex; flex-direction: column; gap: 6px; }

/* Honeypot: off-screen rather than display:none, because some bots skip
   fields that are not rendered. aria-hidden + tabindex -1 keep it away from
   anyone using the form properly. */
.cap-hp {
  position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden;
}

/* Reserve the widget's 65px so the form does not jump when it loads. */
.cap-widget { min-height: 65px; }

.cap-err { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-danger); }
</style>
