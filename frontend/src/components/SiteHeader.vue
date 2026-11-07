<script setup lang="ts">
/**
 * The public site's top navigation — home, about, the council pages, services,
 * the map and contact.
 *
 * THREE THINGS THIS FIXES
 * 1. There was no mobile navigation at all. The nav was `hidden md:flex` with
 *    no hamburger behind it, so on a phone — which is how most of this
 *    district reaches the internet — the council website had a logo, a Login
 *    button and no way to get to any page.
 * 2. It did not know whether you were signed in. A planner who was already
 *    authenticated was still shown "Login / Get Started", so the way back to
 *    their own workspace was to type the URL.
 * 3. The dropdown opened on `:hover` only, which a keyboard and a touch
 *    screen both fail. It is now a real disclosure button.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Menu as MenuIcon, ChevronDown, ChevronRight, LogIn, LayoutGrid,
  Home as HomeIcon, Landmark, Layers, Briefcase, Mail, Map as MapIcon,
} from 'lucide-vue-next'
import UiSheet from '@/components/ui/UiSheet.vue'
import { useAuthStore } from '@/stores/auth'
import { roleHome } from '@/router'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menuOpen = ref(false)
const councilOpen = ref(false)
const scrolled = ref(false)

/** The council pages carried over from vungurdc.org.zw (see content/siteContent.ts). */
const COUNCIL_PAGES = [
  { to: '/council/our-profile', label: 'Our profile' },
  { to: '/council/executive-arm', label: 'Executive arm' },
  { to: '/council/deliberative-arm', label: 'Deliberative arm' },
  { to: '/council/departments', label: 'Departments' },
  { to: '/council/publications', label: 'Publications & documents' },
  { to: '/council/stand-application', label: 'Stand applications' },
]

const PRIMARY = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/about', label: 'About', icon: Landmark },
  { to: '/services', label: 'Services', icon: Briefcase },
  { to: '/explorer', label: 'District map', icon: MapIcon },
  { to: '/contact', label: 'Contact', icon: Mail },
]

/**
 * Where a signed-in visitor's own work lives. Uses the router's `roleHome`
 * rather than a second copy of the mapping — the two drifting apart is how
 * a header ends up sending an inspector to the citizen portal.
 */
const workspace = computed(() => roleHome(auth.user?.role ?? ''))
const displayName = computed(() => {
  const name = auth.userName || auth.userEmail
  return name ? name.split(/[\s@]/)[0] : 'My account'
})

/** `/council/*` keeps the Council trigger marked active. */
const councilActive = computed(() => route.path.startsWith('/council'))

function onScroll() {
  scrolled.value = window.scrollY > 8
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('keydown', onEscape)
  document.addEventListener('click', onDocumentClick)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('keydown', onEscape)
  document.removeEventListener('click', onDocumentClick)
})

function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') councilOpen.value = false
}
function onDocumentClick(e: MouseEvent) {
  if (!councilOpen.value) return
  const el = e.target as HTMLElement
  if (!el.closest?.('.home-nav-dropdown')) councilOpen.value = false
}

// A navigation must close the menu it was chosen from, including when the
// destination is the page you are already on (router-link does not navigate,
// so waiting for a route change would leave the drawer open for ever).
watch(() => route.fullPath, () => { menuOpen.value = false; councilOpen.value = false })

function goto(to: string) {
  menuOpen.value = false
  router.push(to)
}
</script>

<template>
  <header class="home-header" :class="{ 'is-scrolled': scrolled }">
    <a class="skip-link" href="#main">Skip to content</a>

    <div class="home-header-inner">
      <!-- Brand -->
      <router-link to="/" class="home-brand" aria-label="Vungu Rural District Council — home">
        <span class="home-logo-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 7.5 9 4.5l6 3 6-3v12l-6 3-6-3-6 3z" stroke-linejoin="round" />
            <path d="M9 4.5v12M15 7.5v12" stroke-linecap="round" />
          </svg>
        </span>
        <span class="home-brand-block">
          <span class="home-brand-text">Vungu Rural District Council</span>
          <span class="home-brand-sub">Midlands Province, Zimbabwe</span>
        </span>
      </router-link>

      <!-- Desktop navigation -->
      <nav class="home-nav" aria-label="Primary">
        <router-link to="/" class="home-nav-link">Home</router-link>
        <router-link to="/about" class="home-nav-link">About</router-link>

        <div class="home-nav-dropdown">
          <button
            type="button"
            class="home-nav-link home-nav-trigger"
            :class="{ 'is-active': councilActive }"
            aria-haspopup="true"
            :aria-expanded="councilOpen"
            @click.stop="councilOpen = !councilOpen"
          >
            The Council
            <ChevronDown :size="14" :class="{ 'is-flipped': councilOpen }" />
          </button>
          <div v-show="councilOpen" class="home-nav-menu" role="menu">
            <router-link
              v-for="page in COUNCIL_PAGES"
              :key="page.to"
              :to="page.to"
              role="menuitem"
              @click="councilOpen = false"
            >{{ page.label }}</router-link>
          </div>
        </div>

        <router-link to="/services" class="home-nav-link">Services</router-link>
        <router-link to="/explorer" class="home-nav-link">District map</router-link>
        <router-link to="/contact" class="home-nav-link">Contact</router-link>
      </nav>

      <!-- Account -->
      <div class="home-header-actions">
        <template v-if="auth.isAuthenticated">
          <router-link :to="workspace" class="hero-btn-primary nav-cta">
            <LayoutGrid :size="15" aria-hidden="true" />
            <span>{{ displayName }}’s workspace</span>
          </router-link>
        </template>
        <template v-else>
          <router-link to="/login" class="hero-btn-secondary nav-cta">Sign in</router-link>
          <router-link to="/register" class="hero-btn-primary nav-cta">Create account</router-link>
        </template>

        <button
          type="button"
          class="home-menu-btn"
          aria-label="Open menu"
          :aria-expanded="menuOpen"
          @click="menuOpen = true"
        >
          <MenuIcon :size="22" aria-hidden="true" />
        </button>
      </div>
    </div>
  </header>

  <!-- Mobile navigation -->
  <UiSheet v-model:open="menuOpen" variant="drawer" side="right" title="Menu" tall>
    <nav class="site-menu" aria-label="Site menu">
      <p class="site-menu-council">
        <span class="council-badge-dot" aria-hidden="true"></span>
        Vungu Rural District Council
      </p>

      <ul class="site-menu-list">
        <li v-for="item in PRIMARY" :key="item.to">
          <button type="button" class="site-menu-item" @click="goto(item.to)">
            <component :is="item.icon" :size="18" aria-hidden="true" />
            <span>{{ item.label }}</span>
            <ChevronRight :size="16" class="site-menu-chev" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <p class="site-menu-heading">The Council</p>
      <ul class="site-menu-list">
        <li v-for="page in COUNCIL_PAGES" :key="page.to">
          <button type="button" class="site-menu-item site-menu-item--sub" @click="goto(page.to)">
            <Layers :size="16" aria-hidden="true" />
            <span>{{ page.label }}</span>
            <ChevronRight :size="16" class="site-menu-chev" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <div class="site-menu-ctas">
        <template v-if="auth.isAuthenticated">
          <button type="button" class="hero-btn-primary site-menu-cta" @click="goto(workspace)">
            <LayoutGrid :size="16" aria-hidden="true" />
            Go to my workspace
          </button>
        </template>
        <template v-else>
          <button type="button" class="hero-btn-primary site-menu-cta" @click="goto('/register')">
            Create an account
          </button>
          <button type="button" class="hero-btn-secondary site-menu-cta" @click="goto('/login')">
            <LogIn :size="16" aria-hidden="true" />
            Sign in
          </button>
        </template>
      </div>
    </nav>
  </UiSheet>
</template>
