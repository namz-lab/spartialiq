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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Bell, Calendar, ChevronDown, ChevronRight, Menu, Power, AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '../../stores/finance'
import { financeRoleLabel } from '../../shell/roleLabels'
import type { WorkspaceKey } from '../../shell/workspaces'
import WorkspaceSwitcher from '../../shell/WorkspaceSwitcher.vue'
import FinanceYearPicker from '../../components/FinanceYearPicker.vue'
import PortalArt from './PortalArt.vue'
import { initials, resetPortalInbox, usePortalInbox } from './usePortal'
import { usePortalAnnouncer } from './usePortalAnnouncer'
import './portal.css'

export interface PortalNavItem { name: string; label: string; icon: Component; badge?: number; group?: string }
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
  /** Names this workspace on the switcher between the workspaces the person holds. */
  workspace?: WorkspaceKey | null
}>(), { homeSubtitle: '', homeCrumbs: () => [], titlePrefix: '', messagesRoute: null, menu: () => [], showYear: false, workspace: null })

const emit = defineEmits<{ (e: 'boot'): void; (e: 'logout'): void; (e: 'tick'): void }>()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const store = useFinanceStore()
const { inbox, loadUnread } = usePortalInbox()
const { polite: sayPolite, assertive: sayAssertive } = usePortalAnnouncer()

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
  // A route with no cwTitle gives the prefix alone, never a dangling "Cashier – ".
  return props.titlePrefix && page ? `${props.titlePrefix} – ${page}` : props.titlePrefix || page
})
/**
 * WCAG 2.4.2: every page has its own browser title, from its `cwTitle`. "Journals – Accounting –
 * Vungu RDC". The router's global guard writes the workspace's one title on EVERY navigation (a
 * filter, a pager, voucher to voucher), so the shell writes its title again after each one, not only
 * when the title changes: `fullPath` is watched too, and `post` runs it after the guard and the render.
 */
const docTitle = computed(() => [title.value, props.navLabel, 'Vungu RDC'].filter((p, i) => p && (i === 0 || p !== title.value)).join(' – '))
watch([docTitle, () => route.fullPath], ([t]) => { document.title = t }, { immediate: true, flush: 'post' })

/**
 * WCAG 2.4.3: on moving to another page, focus goes to the page (`#cw-main`, tabindex -1, named by
 * the title) instead of staying on the link that was clicked. Only when the path changes: a filter or
 * a pager writes the query and must keep focus where it is. A page that has put focus inside itself
 * already (a form's first field, say) is left alone.
 */
const mainEl = ref<HTMLElement | null>(null)
watch(() => route.path, () => {
  void nextTick(() => {
    const main = mainEl.value
    if (!main) return
    const at = document.activeElement
    if (at && at !== main && main.contains(at)) return
    main.focus({ preventScroll: true })
  })
})
const crumbs = computed(() => (route.meta.cwCrumbs as { label: string; to?: string }[] | undefined) ?? [])

const navOpen = ref(false)
const sideEl = ref<HTMLElement | null>(null)
const toggleEl = ref<HTMLElement | null>(null)
/** The nav in runs of one group (S8): a named group is exposed as role="group", labelled by its heading. */
const navSets = computed(() => {
  const sets: { group?: string; id: string; items: PortalNavItem[] }[] = []
  for (const item of props.nav) {
    const last = sets[sets.length - 1]
    if (last && last.group === item.group) { last.items.push(item); continue }
    sets.push({ group: item.group, id: `cw-nav-g${sets.length}`, items: [item] })
  }
  return sets
})
/** S7: opening the menu moves focus into it (the current page's link, else the first), so it is not left behind the panel. */
watch(navOpen, (open) => {
  if (!open) return
  void nextTick(() => {
    const links = sideEl.value?.querySelectorAll<HTMLElement>('.cw-nav a') ?? []
    ;(sideEl.value?.querySelector<HTMLElement>('.cw-nav a.is-active') ?? links[0])?.focus({ preventScroll: true })
  })
})
const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)
watch(() => route.fullPath, () => { navOpen.value = false; menuOpen.value = false })

function onDocClick(e: MouseEvent): void {
  if (menuOpen.value && menuEl.value && !menuEl.value.contains(e.target as Node)) menuOpen.value = false
  // The dimmed area (anything outside the side panel) closes the mobile menu; its own button toggles it.
  if (navOpen.value && sideEl.value && !sideEl.value.contains(e.target as Node) && !toggleEl.value?.contains(e.target as Node)) navOpen.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  menuOpen.value = false
  if (navOpen.value) {
    navOpen.value = false
    // Focus was inside the panel that is about to be hidden: bring it back to the button that opened it.
    if (!document.activeElement || document.activeElement === document.body || sideEl.value?.contains(document.activeElement)) toggleEl.value?.focus()
  }
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
    <a class="sr-only cw-skip" href="#cw-main">Skip to content</a>
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announce-polite">{{ sayPolite }}</div>
    <div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="announce-assertive">{{ sayAssertive }}</div>

    <aside id="cw-side" ref="sideEl" class="cw-side" :aria-label="navLabel">
      <div class="cw-brand">
        <PortalArt kind="crest" :size="42" />
        <div>
          <p class="cw-brand-name">Vungu<br />Rural District Council</p>
          <p class="cw-brand-sub">{{ brandSub }}</p>
        </div>
      </div>
      <nav class="cw-nav" :aria-label="`${navLabel} pages`">
        <div v-for="set in navSets" :key="set.id" class="cw-nav-set" :role="set.group ? 'group' : undefined" :aria-labelledby="set.group ? set.id : undefined">
          <p v-if="set.group" :id="set.id" class="cw-nav-group">{{ set.group }}</p>
          <RouterLink
            v-for="item in set.items" :key="item.name"
            :to="{ name: item.name }"
            :class="{ 'is-active': activeNav === item.name }"
            :aria-current="activeNav === item.name ? 'page' : undefined"
          >
            <component :is="item.icon" :size="24" aria-hidden="true" />
            <span>{{ item.label }}</span>
            <span v-if="item.badge" class="cw-badge">{{ item.badge }}<span class="sr-only"> pending</span></span>
          </RouterLink>
        </div>
      </nav>
      <div class="cw-side-art"><PortalArt kind="side" /></div>
      <button type="button" class="cw-logout" @click="logout">
        <Power :size="24" aria-hidden="true" /> Log Out
      </button>
    </aside>

    <div class="cw-main">
      <header class="cw-banner">
        <div class="cw-banner-clip"><PortalArt kind="banner" class="cw-banner-art" /></div>
        <button type="button" ref="toggleEl" class="cw-icon-btn cw-menu-toggle" aria-label="Menu" aria-controls="cw-side" :aria-expanded="navOpen ? 'true' : 'false'" @click.stop="navOpen = !navOpen">
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
          <WorkspaceSwitcher v-if="workspace && store.identity" :current="workspace" />
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

      <main id="cw-main" ref="mainEl" class="cw-content" tabindex="-1" :aria-label="title || undefined">
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
