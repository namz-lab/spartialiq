<script setup lang="ts">
/**
 * The frame of a role portal: the indigo sidebar with the council crest, the dusk banner with the
 * page title, date, bell and profile, and the page itself.
 *
 * Each portal passes its own navigation and home title; route meta supplies a page's title
 * (`cwTitle`), breadcrumbs (`cwCrumbs`) and, for a page that belongs under another entry,
 * `cwNav`. The shell reads the finance identity (permissions) once and keeps the unread count
 * fresh; the portal loads its own data.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Bell, Calendar, ChevronDown, ChevronRight, Menu, Power, AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '../../stores/finance'
import { financeRoleLabel } from '../../shell/roleLabels'
import FinanceYearPicker from '../../components/FinanceYearPicker.vue'
import PortalArt from './PortalArt.vue'
import { initials, resetPortalInbox, usePortalInbox } from './usePortal'
import './portal.css'

export interface PortalNavItem { name: string; label: string; icon: Component; badge?: number }
export interface PortalMenuItem { name: string; label: string; icon: Component }

const props = withDefaults(defineProps<{
  nav: PortalNavItem[]
  homeRoute: string
  homeTitle: string
  homeSubtitle?: string
  homeCrumbs?: string[]
  /** "Cashier" gives "Cashier – Receipts"; empty gives the page title alone. */
  titlePrefix?: string
  brandSub: string
  messagesRoute?: string | null
  menu?: PortalMenuItem[]
  showYear?: boolean
  navLabel: string
}>(), { homeSubtitle: '', homeCrumbs: () => [], titlePrefix: '', messagesRoute: null, menu: () => [], showYear: false })

const emit = defineEmits<{ (e: 'boot'): void; (e: 'logout'): void; (e: 'tick'): void }>()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const store = useFinanceStore()
const { inbox, loadUnread } = usePortalInbox()

const activeNav = computed(() => (route.meta.cwNav as string | undefined) ?? String(route.name ?? ''))
const userName = computed(() => auth.user?.name ?? 'Signed in')
const roleLabel = computed(() => financeRoleLabel(store.identity?.role ?? auth.user?.role))

const now = ref(new Date())
const dateText = computed(() => now.value.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', ''))
const timeText = computed(() => now.value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))

const isHome = computed(() => route.name === props.homeRoute)
const title = computed(() => {
  if (isHome.value) return props.homeTitle
  const page = String(route.meta.cwTitle ?? '')
  return props.titlePrefix ? `${props.titlePrefix} – ${page}` : page
})
const crumbs = computed(() => (route.meta.cwCrumbs as { label: string; to?: string }[] | undefined) ?? [])

const navOpen = ref(false)
const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)
watch(() => route.fullPath, () => { navOpen.value = false; menuOpen.value = false })

function onDocClick(e: MouseEvent): void {
  if (menuOpen.value && menuEl.value && !menuEl.value.contains(e.target as Node)) menuOpen.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { menuOpen.value = false; navOpen.value = false }
}

let timer: number | undefined
async function boot(force = false): Promise<void> {
  const identity = await store.loadIdentity(force)
  if (identity && store.readsReference) await store.loadReference(force)
  void loadUnread()
  emit('boot')
}

onMounted(() => {
  void boot()
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
  timer = window.setInterval(() => { now.value = new Date(); void loadUnread(); emit('tick') }, 60_000)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
  window.clearInterval(timer)
})

async function logout(): Promise<void> {
  emit('logout')
  await auth.logout()
  store.reset()
  resetPortalInbox()
  void router.push('/login')
}
</script>

<template>
  <div class="cw" :class="{ 'is-nav-open': navOpen }">
    <a class="sr-only" href="#cw-main">Skip to content</a>

    <aside class="cw-side" :aria-label="navLabel">
      <div class="cw-brand">
        <PortalArt kind="crest" :size="42" />
        <div>
          <p class="cw-brand-name">Vungu<br />Rural District Council</p>
          <p class="cw-brand-sub">{{ brandSub }}</p>
        </div>
      </div>
      <nav class="cw-nav" :aria-label="`${navLabel} pages`">
        <RouterLink
          v-for="item in nav" :key="item.name" :to="{ name: item.name }"
          :class="{ 'is-active': activeNav === item.name }"
          :aria-current="activeNav === item.name ? 'page' : undefined"
        >
          <component :is="item.icon" :size="24" aria-hidden="true" />
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="cw-badge">{{ item.badge }}</span>
        </RouterLink>
      </nav>
      <div class="cw-side-art"><PortalArt kind="side" /></div>
      <button type="button" class="cw-logout" @click="logout">
        <Power :size="24" aria-hidden="true" /> Log Out
      </button>
    </aside>

    <div class="cw-main">
      <header class="cw-banner">
        <PortalArt kind="banner" class="cw-banner-art" />
        <button type="button" class="cw-icon-btn cw-menu-toggle" aria-label="Open the menu" @click.stop="navOpen = !navOpen">
          <Menu :size="22" aria-hidden="true" />
        </button>
        <div class="cw-banner-text">
          <h1>{{ title }}</h1>
          <p v-if="isHome && homeSubtitle">{{ homeSubtitle }}</p>
          <ol v-else-if="isHome && homeCrumbs.length" class="cw-crumbs" aria-label="Breadcrumb">
            <template v-for="(c, i) in homeCrumbs" :key="c">
              <li v-if="i" aria-hidden="true"><ChevronRight :size="14" /></li>
              <li>{{ c }}</li>
            </template>
          </ol>
          <ol v-else-if="!isHome" class="cw-crumbs" aria-label="Breadcrumb">
            <li><RouterLink :to="{ name: homeRoute }">Home</RouterLink></li>
            <template v-for="(c, i) in crumbs" :key="c.label">
              <li aria-hidden="true"><ChevronRight :size="14" /></li>
              <li>
                <RouterLink v-if="c.to && i < crumbs.length - 1" :to="{ name: c.to }">{{ c.label }}</RouterLink>
                <span v-else aria-current="page">{{ c.label }}</span>
              </li>
            </template>
          </ol>
        </div>
        <div class="cw-banner-tools">
          <div v-if="showYear && store.identity && store.readsReference" class="cw-chip cw-year"><FinanceYearPicker /></div>
          <span class="cw-chip cw-chip-date">
            <Calendar :size="22" aria-hidden="true" />
            <span>{{ dateText }}<template v-if="!isHome"><br />{{ timeText }}</template></span>
          </span>
          <component
            :is="messagesRoute ? RouterLink : 'span'" :to="messagesRoute ? { name: messagesRoute } : undefined"
            class="cw-chip cw-bell" :aria-label="inbox.unread ? `Messages, ${inbox.unread} unread` : 'Messages'"
          >
            <Bell :size="24" aria-hidden="true" />
            <span v-if="inbox.unread" class="cw-bell-dot" />
          </component>
          <div ref="menuEl" style="position: relative">
            <button type="button" class="cw-chip cw-profile" :aria-expanded="menuOpen" aria-haspopup="menu" @click="menuOpen = !menuOpen">
              <span class="cw-avatar">{{ initials(userName) }}</span>
              <span class="cw-profile-text"><strong>{{ userName }}</strong><span>{{ roleLabel }}</span></span>
              <ChevronDown :size="18" aria-hidden="true" />
            </button>
            <div v-if="menuOpen" class="cw-menu" role="menu">
              <RouterLink v-for="m in menu" :key="m.name" role="menuitem" :to="{ name: m.name }"><component :is="m.icon" :size="17" aria-hidden="true" /> {{ m.label }}</RouterLink>
              <button type="button" role="menuitem" @click="logout"><Power :size="17" aria-hidden="true" /> Log out</button>
            </div>
          </div>
        </div>
      </header>

      <main id="cw-main" class="cw-content" tabindex="-1">
        <p v-if="store.loadingIdentity && !store.identity" class="cw-empty" role="status">Reading your finance permissions…</p>
        <div v-else-if="!store.identity" class="cw-banner-msg cw-banner-msg--neg" role="alert">
          <AlertTriangle :size="18" aria-hidden="true" />
          <span>{{ store.identityError ?? 'Your finance permissions could not be read.' }}</span>
          <button type="button" class="cw-btn cw-btn--small" @click="boot(true)"><RefreshCw :size="14" aria-hidden="true" /> Retry</button>
        </div>
        <template v-else>
          <slot name="notices" />
          <RouterView />
        </template>
      </main>
    </div>
  </div>
</template>
