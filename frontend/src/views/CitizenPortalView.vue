<script setup lang="ts">
// Citizen Portal — applicant-facing console for every step of the
// 8-step development application process: draft, submit, track,
// upload documents, respond to objections, pay fees, request
// inspections, claim the occupation certificate, and lodge appeals.
//
// Visual system: DESIGN.md tokens scoped to .cp-root so other role
// portals are unaffected. Mobile: app bar + bottom tabs. Desktop:
// sidebar + canvas. Accent is used for actions and current selection.

import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { provideCitizenCase } from '@/composables/useCitizenCase'
import { permitStatusToLifecycle } from '@/services/citizenPortalService'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'

import DashboardSection      from './citizen/sections/DashboardSection.vue'
import ServicesDeskSection   from './citizen/sections/ServicesDeskSection.vue'
import NewApplicationSection from './citizen/sections/NewApplicationSection.vue'
import ApplicationsSection   from './citizen/sections/ApplicationsSection.vue'
import MapSection            from './citizen/sections/MapSection.vue'
import DocumentsSection      from './citizen/sections/DocumentsSection.vue'
import NoticesSection        from './citizen/sections/NoticesSection.vue'
import PaymentsSection       from './citizen/sections/PaymentsSection.vue'
import InspectionsSection    from './citizen/sections/InspectionsSection.vue'
import CertificatesSection   from './citizen/sections/CertificatesSection.vue'
import AppealsSection        from './citizen/sections/AppealsSection.vue'
import ComplaintsSection     from './citizen/sections/ComplaintsSection.vue'
import ServiceDeskTicketSection from './citizen/sections/ServiceDeskTicketSection.vue'
import ProfileSection        from './citizen/sections/ProfileSection.vue'
import ReferenceSection      from './citizen/sections/ReferenceSection.vue'
import RatesClearanceSection from './citizen/sections/RatesClearanceSection.vue'

import {
  Landmark, LayoutDashboard, LayoutGrid, FilePlus, FolderOpen, Map as MapIcon, Upload, Megaphone,
  CreditCard, ClipboardCheck, BadgeCheck, Scale, BookOpen, UserCog, MoreHorizontal, Bell, X,
  ShieldAlert, Ticket, FileBadge,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const ctx = provideCitizenCase()
onMounted(() => { ctx.refreshApplications(); ctx.refreshAppeals() })

type SectionKey =
  | 'dashboard' | 'services' | 'new' | 'applications' | 'map' | 'documents' | 'notices'
  | 'payments' | 'inspections' | 'certificates' | 'rates_clearance' | 'appeals' | 'complaints'
  | 'service_desk' | 'profile' | 'reference'

const sections = [
  { key:'dashboard',    label:'Home',                icon: LayoutDashboard },
  { key:'services',     label:'Reception / services', icon: LayoutGrid },
  { key:'new',          label:'New application',     icon: FilePlus },
  { key:'applications', label:'My applications',     icon: FolderOpen },
  { key:'map',          label:'Map',                 icon: MapIcon },
  { key:'documents',    label:'Documents',           icon: Upload },
  { key:'notices',      label:'Public notices',      icon: Megaphone },
  { key:'payments',     label:'Payments',            icon: CreditCard },
  { key:'inspections',  label:'Inspections',         icon: ClipboardCheck },
  { key:'certificates', label:'Certificates',        icon: BadgeCheck },
  { key:'rates_clearance', label:'Rates clearance',  icon: FileBadge },
  { key:'appeals',      label:'Appeals',             icon: Scale },
  { key:'complaints',   label:'Report building',     icon: ShieldAlert },
  { key:'service_desk', label:'Service requests',    icon: Ticket },
  { key:'profile',      label:'Profile',             icon: UserCog },
  { key:'reference',    label:'Reference',           icon: BookOpen },
] as const

// Mobile: Home, Services, Applications, More.
const BOTTOM_KEYS: SectionKey[] = ['dashboard', 'services', 'applications']
const bottomTabs = computed(() => sections.filter(s => BOTTOM_KEYS.includes(s.key as SectionKey)))
const moreSections = computed(() => sections.filter(s => !BOTTOM_KEYS.includes(s.key as SectionKey)))
const noticeAlert = computed(() =>
  ctx.applications.value.some(p => {
    const s = permitStatusToLifecycle(p)
    return s === 'public_notice' || s === 'objection_response'
  }))

function tabLabel(key: SectionKey, label: string) {
  if (key === 'applications') return 'Applications'
  if (key === 'services') return 'Services'
  if (key === 'dashboard') return 'Home'
  return label
}

// Section is deep-linkable via ?section=… so external CTAs (footer, map,
// stand card) and the unified intake redirects can land the citizen on the
// right tab, and the browser back button works. Previously the query was
// ignored and every entry opened the dashboard.
const VALID_SECTIONS = sections.map(s => s.key) as readonly SectionKey[]
function sectionFromQuery(): SectionKey {
  const s = route.query.section
  return typeof s === 'string' && (VALID_SECTIONS as readonly string[]).includes(s)
    ? (s as SectionKey)
    : 'dashboard'
}

const activeSection = ref<SectionKey>(sectionFromQuery())
const moreOpen = ref(false)
const moreActive = computed(() => !BOTTOM_KEYS.includes(activeSection.value))

function go(key: SectionKey, serviceId?: string) {
  activeSection.value = key
  moreOpen.value = false
  const query: Record<string, string | string[] | null | undefined> = {
    ...route.query,
    section: key,
  }
  if (key === 'service_desk') {
    if (serviceId) query.service = serviceId
  } else {
    delete query.service
  }
  router.replace({ query })
}

// React to query changes (redirects, deep links, back/forward navigation).
watch(() => route.query.section, () => {
  const next = sectionFromQuery()
  if (next !== activeSection.value) activeSection.value = next
})

// A section switch is a page change: new title, back to the top, and focus
// on the content so screen readers announce the new page.
const mainEl = ref<HTMLElement | null>(null)
watch(activeSection, async key => {
  document.title = `${sections.find(s => s.key === key)?.label ?? 'Citizen services'} · Vungu RDC`
  await nextTick()
  mainEl.value?.scrollTo?.({ top: 0 })
  mainEl.value?.focus({ preventScroll: true })
}, { immediate: false })
onMounted(() => {
  document.title = `${sections.find(s => s.key === activeSection.value)?.label ?? 'Citizen services'} · Vungu RDC`
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && moreOpen.value) moreOpen.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="cp-root">
    <a class="cp-skip" href="#cp-main">Skip to content</a>
    <!-- ── Top app bar (full width) ──────────────────────────────── -->
    <header class="cp-appbar">
      <div class="cp-appbar-brand">
        <div class="cp-logo" aria-hidden="true"><Landmark :size="16" /></div>
        <span class="cp-appbar-word">Citizen Services</span>
        <span class="cp-appbar-word-sm">Vungu RDC</span>
      </div>
      <div class="cp-appbar-actions">
        <button class="cp-bell" type="button"
                :aria-label="noticeAlert ? 'Public notices, action required' : 'Public notices'"
                title="Public notices" @click="go('notices')">
          <Bell :size="17" />
          <span v-if="noticeAlert" class="cp-bell-dot" />
        </button>
        <ProfileDropdown
          role-label="Client"
          avatar-key="citizen_avatar"
          @logout="handleLogout"
        />
      </div>
    </header>

    <div class="cp-body">
      <!-- ── Desktop sidebar ─────────────────────────────────────── -->
      <aside class="cp-sidebar">
        <div class="cp-brand">
          <div class="cp-logo lg"><Landmark :size="20" /></div>
          <div class="cp-brand-text">
            <span class="cp-brand-title">Citizen Services</span>
            <span class="cp-brand-sub">Vungu RDC Portal</span>
          </div>
        </div>
        <nav class="cp-side-nav" aria-label="Citizen services">
          <button v-for="s in sections" :key="s.key" type="button"
                  class="cp-side-item" :class="{ active: activeSection === s.key }"
                  :aria-current="activeSection === s.key ? 'page' : undefined"
                  @click="go(s.key as SectionKey)">
            <component :is="s.icon" :size="17" />
            <span>{{ s.label }}</span>
          </button>
        </nav>
      </aside>

      <!-- ── Main canvas ─────────────────────────────────────────── -->
      <main id="cp-main" ref="mainEl" class="cp-content" tabindex="-1">
        <DashboardSection      v-if="activeSection === 'dashboard'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
        <ServicesDeskSection   v-else-if="activeSection === 'services'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
        <NewApplicationSection v-else-if="activeSection === 'new'" />
        <ApplicationsSection   v-else-if="activeSection === 'applications'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
        <MapSection            v-else-if="activeSection === 'map'" />
        <DocumentsSection      v-else-if="activeSection === 'documents'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
        <NoticesSection        v-else-if="activeSection === 'notices'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
        <PaymentsSection       v-else-if="activeSection === 'payments'" />
        <InspectionsSection    v-else-if="activeSection === 'inspections'" />
        <CertificatesSection   v-else-if="activeSection === 'certificates'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
        <RatesClearanceSection v-else-if="activeSection === 'rates_clearance'" />
        <AppealsSection        v-else-if="activeSection === 'appeals'" />
        <ComplaintsSection     v-else-if="activeSection === 'complaints'" />
        <ServiceDeskTicketSection v-else-if="activeSection === 'service_desk'" />
        <ProfileSection        v-else-if="activeSection === 'profile'" />
        <ReferenceSection      v-else-if="activeSection === 'reference'"
                                @open-section="(k: SectionKey, sid?: string) => go(k, sid)" />
      </main>
    </div>

    <!-- ── Mobile bottom tab bar ───────────────────────────────────── -->
    <nav class="cp-bottomnav" aria-label="Primary">
      <button v-for="t in bottomTabs" :key="t.key" type="button"
              class="cp-tab" :class="{ active: activeSection === t.key }"
              :aria-current="activeSection === t.key ? 'page' : undefined"
              @click="go(t.key as SectionKey)">
        <component :is="t.icon" :size="20" />
        <span>{{ tabLabel(t.key as SectionKey, t.label) }}</span>
      </button>
      <button type="button" class="cp-tab" :class="{ active: moreActive || moreOpen }"
              :aria-expanded="moreOpen"
              aria-controls="cp-more-sheet"
              @click="moreOpen = !moreOpen">
        <MoreHorizontal :size="20" />
        <span>More</span>
      </button>
    </nav>

    <!-- ── Mobile "More" sheet ─────────────────────────────────────── -->
    <transition name="cp-fade">
      <div v-if="moreOpen" class="cp-scrim" @click="moreOpen = false" />
    </transition>
    <transition name="cp-slide">
      <div v-if="moreOpen" id="cp-more-sheet" class="cp-sheet" role="dialog" aria-modal="true" aria-label="More services">
        <header class="cp-sheet-head">
          <span>More services</span>
          <button type="button" class="cp-sheet-close" @click="moreOpen = false" aria-label="Close">
            <X :size="18" />
          </button>
        </header>
        <div class="cp-sheet-grid">
          <button v-for="s in moreSections" :key="s.key" type="button"
                  class="cp-sheet-item" :class="{ active: activeSection === s.key }"
                  @click="go(s.key as SectionKey)">
            <component :is="s.icon" :size="18" />
            <span>{{ s.label }}</span>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* DESIGN.md tokens, scoped so other role portals stay untouched. */
.cp-root {
  --cp-primary:#1a73e8; --cp-primary-hover:#1557b0; --cp-on-primary:#ffffff;
  --cp-primary-tint:#e8f0fe; --cp-primary-tint-border:#c3d7f7;
  --cp-page:#f5f3ee; --cp-surface:#ffffff; --cp-surface-2:#ece9e0;
  --cp-border:#dadce0; --cp-border-strong:#bdc1c6;
  --cp-text:#3c4043; --cp-text-2:#5a5a5a; --cp-muted:#5a5a5a; --cp-faint:#9aa0a6;
  --cp-blue-bg:#e8f0fe;  --cp-blue-fg:#1557b0;
  --cp-green-bg:#e6f4ea; --cp-green-fg:#1e8e3e;
  --cp-amber-bg:#fef7e0; --cp-amber-fg:#b06000;
  --cp-red-bg:#fce8e6;   --cp-red-fg:#d93025;
  --cp-danger:#d93025; --cp-danger-bg:var(--cp-red-bg); --cp-danger-fg:var(--cp-red-fg);
  --cp-warn-bg:var(--cp-amber-bg); --cp-warn-fg:var(--cp-amber-fg);
  --cp-info-bg:var(--cp-blue-bg);  --cp-info-fg:var(--cp-blue-fg);
  --cp-stage-bg:#e8f0fe; --cp-stage-fg:#1557b0;
  --cp-success-bg:var(--cp-green-bg); --cp-success-fg:var(--cp-green-fg);
  --cp-radius:10px; --cp-radius-sm:6px; --cp-radius-pill:9999px;
  --cp-shadow:0 1px 2px rgba(15,23,42,0.04);
  --cp-shadow-pop:0 8px 28px rgba(15,23,42,0.14);
  --cp-sans:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --cp-mono:ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --cp-dur:160ms; --cp-ease:cubic-bezier(0.16, 1, 0.3, 1);
  --cp-appbar-h:56px; --cp-sidebar-w:236px; --cp-bottomnav-h:64px;

  display:flex; flex-direction:column; height:var(--ent-vh); overflow:hidden;
  background:var(--cp-page); color:var(--cp-text);
  font-family:var(--cp-sans);
  font-size:15px; line-height:1.45;
  font-feature-settings:'tnum' 1;
  caret-color:var(--cp-primary);
  -webkit-font-smoothing:antialiased;
}
.cp-root :deep(*) { font-family:inherit; }
.cp-root :deep(::selection) { background:var(--cp-primary-tint); color:var(--cp-text); }
.cp-root :deep(button:focus-visible),
.cp-root :deep(a:focus-visible),
.cp-root :deep(select:focus-visible),
.cp-root :deep(input:focus-visible),
.cp-root :deep(textarea:focus-visible) {
  outline:2px solid var(--cp-primary);
  outline-offset:2px;
}
.cp-root :deep(button:disabled) { opacity:0.55; }

.cp-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:0.45rem 0.75rem; background:var(--cp-surface); color:var(--cp-primary);
  border:1px solid var(--cp-primary); border-radius:var(--cp-radius-sm);
  font-weight:600; text-decoration:none; transform:translateY(-220%);
}
.cp-skip:focus-visible { transform:translateY(0); outline-offset:2px; }

/* ── App bar ──────────────────────────────────────────────────────── */
.cp-appbar {
  display:flex; align-items:center; gap:0.75rem; flex-shrink:0;
  height:var(--cp-appbar-h); padding:0 1rem;
  background:var(--cp-surface); border-bottom:1px solid var(--cp-border);
}
.cp-appbar-brand { display:flex; align-items:center; gap:0.6rem; min-width:0; }
.cp-logo {
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:32px; height:32px; border-radius:var(--cp-radius-sm);
  background:var(--cp-primary); color:var(--cp-on-primary);
}
.cp-logo.lg { width:38px; height:38px; }
.cp-appbar-word    { font-size:1rem; font-weight:700; color:var(--cp-text); letter-spacing:-0.01em; }
.cp-appbar-word-sm { font-size:0.95rem; font-weight:700; color:var(--cp-text); display:none; }
.cp-appbar-actions { margin-left:auto; display:flex; align-items:center; gap:0.5rem; }
.cp-bell {
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  width:36px; height:36px; border:1px solid transparent; border-radius:var(--cp-radius-sm);
  background:none; color:var(--cp-muted); cursor:pointer; transition:background var(--cp-dur) var(--cp-ease), color var(--cp-dur) var(--cp-ease);
}
.cp-bell:hover { background:var(--cp-surface-2); color:var(--cp-text); }
.cp-bell-dot {
  position:absolute; top:7px; right:8px; width:7px; height:7px; border-radius:50%;
  background:var(--cp-primary); border:1.5px solid var(--cp-surface);
}

/* ── Body: sidebar + content ──────────────────────────────────────── */
.cp-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.cp-sidebar {
  width:var(--cp-sidebar-w); flex-shrink:0; display:flex; flex-direction:column;
  background:var(--cp-surface); border-right:1px solid var(--cp-border); overflow-y:auto;
}
.cp-brand {
  display:flex; align-items:center; gap:0.6rem;
  padding:0.85rem 1rem; border-bottom:1px solid var(--cp-border);
}
.cp-brand-text { display:flex; flex-direction:column; min-width:0; }
.cp-brand-title { font-size:0.82rem; font-weight:700; color:var(--cp-text); line-height:1.2; }
.cp-brand-sub   { font-size:0.68rem; color:var(--cp-muted); line-height:1.3; }

.cp-side-nav { display:flex; flex-direction:column; gap:2px; padding:0.6rem; }
.cp-side-item {
  display:flex; align-items:center; gap:0.65rem;
  height:38px; padding:0 0.7rem; border:0; border-radius:var(--cp-radius-sm);
  background:none; color:var(--cp-muted); font-size:0.82rem; font-weight:500;
  text-align:left; cursor:pointer; transition:background var(--cp-dur) var(--cp-ease), color var(--cp-dur) var(--cp-ease);
  min-height:40px;
}
.cp-side-item:hover { background:var(--cp-surface-2); color:var(--cp-text); }
.cp-side-item.active { background:var(--cp-primary-tint); color:var(--cp-primary); font-weight:600; }
.cp-side-item.active :deep(svg) { color:var(--cp-primary); }

/* ── Content canvas ───────────────────────────────────────────────── */
.cp-content { flex:1; min-width:0; overflow-y:auto; background:var(--cp-page); }
.cp-content:focus { outline:none; }

/* ── Mobile bottom tab bar ────────────────────────────────────────── */
.cp-bottomnav { display:none; }
.cp-tab {
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
  border:0; background:none; color:var(--cp-muted); cursor:pointer;
  font-size:11px; line-height:16px; font-weight:600; padding:8px 2px;
  min-height:44px; transition:color var(--cp-dur) var(--cp-ease);
}
.cp-tab span { white-space:nowrap; }
.cp-tab.active { color:var(--cp-primary); }

/* ── Mobile "More" sheet ──────────────────────────────────────────── */
.cp-scrim { position:fixed; inset:0; background:rgba(15,23,42,0.4); z-index:40; }
.cp-sheet {
  position:fixed; left:0; right:0; bottom:0; z-index:50;
  background:var(--cp-surface); border-top-left-radius:16px; border-top-right-radius:16px;
  box-shadow:var(--cp-shadow-pop); padding:0.5rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
  max-height:70vh; overflow-y:auto;
}
.cp-sheet-head {
  display:flex; align-items:center; justify-content:space-between;
  padding:0.6rem 0.25rem; font-size:0.8rem; font-weight:700; color:var(--cp-text);
}
.cp-sheet-close {
  display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px;
  border:0; border-radius:var(--cp-radius-sm); background:var(--cp-surface-2); color:var(--cp-muted); cursor:pointer;
}
.cp-sheet-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:0.5rem; padding-bottom:0.5rem; }
.cp-sheet-item {
  display:flex; align-items:center; gap:0.6rem;
  padding:0.75rem 0.8rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  background:var(--cp-surface); color:var(--cp-text); font-size:0.8rem; font-weight:500;
  text-align:left; cursor:pointer;
}
.cp-sheet-item.active { border-color:var(--cp-primary-tint-border); background:var(--cp-primary-tint); color:var(--cp-primary); }
.cp-sheet-item :deep(svg) { color:var(--cp-muted); flex-shrink:0; }
.cp-sheet-item.active :deep(svg) { color:var(--cp-primary); }

/* ── Transitions ──────────────────────────────────────────────────── */
.cp-fade-enter-active, .cp-fade-leave-active { transition:opacity var(--cp-dur) var(--cp-ease); }
.cp-fade-enter-from, .cp-fade-leave-to { opacity:0; }
.cp-slide-enter-active, .cp-slide-leave-active { transition:transform var(--cp-dur) var(--cp-ease); }
.cp-slide-enter-from, .cp-slide-leave-to { transform:translateY(100%); }

/* ── Responsive: collapse to mobile shell below 1024px ────────────── */
@media (max-width: 1023px) {
  .cp-sidebar { display:none; }
  .cp-appbar-word { display:none; }
  .cp-appbar-word-sm { display:inline; }
  .cp-bottomnav {
    display:flex; flex-shrink:0; height:calc(var(--cp-bottomnav-h) + env(safe-area-inset-bottom));
    padding-bottom:env(safe-area-inset-bottom);
    background:var(--cp-surface); border-top:1px solid var(--cp-border);
  }
}
@media (min-width: 1024px) {
  .cp-sheet, .cp-scrim { display:none; }
}
@media (prefers-reduced-motion: reduce) {
  .cp-root, .cp-root :deep(*) {
    transition-duration:0ms !important;
    animation-duration:0ms !important;
  }
}
</style>
