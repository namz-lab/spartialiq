<script setup lang="ts">
// Environmental Health Officer console — every statutory duty under the Public
// Health Act [Ch. 15:09], the health provisions of the Model Building By-Laws,
// the licensing regime and the council's field programmes, in one workspace.
//
// SECTIONS (eleven)
//   field     Dashboard · Inspections · Surveillance · Enforcement · Programmes
//   desk      Licensing · Plan appraisal · Certificates · Reports · Reference
//   device    Settings
// An EHO does more of their work in the field than any other role here, on a
// phone, standing in a food-handling premises. The first four are the four used
// on site and fill the bottom bar on a phone; the rest sit behind More.
//
// URL
// The section is in the URL (src/environment-officer/console.ts), so Back walks
// the officer's path and a copied link opens the same screen. Section changes
// push; a tab or an opened premises inside a section replaces.
//
// RESPONSIVE
//   ≥1024px  labelled rail with count badges
//   768–1023 rail collapsed to icons by default (overridable, remembered)
//   ≤767px   bottom navigation
//
// The primitives are the shared ins-* sheet (views/inspector/inspector.css):
// one console vocabulary across both field roles rather than two that drift.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { provideHealthCase } from '@/composables/useHealthCase'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useEhoPreferences } from '@/environment-officer/useEhoPreferences'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import type { SectionKey } from '@/environment-officer/console'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import './inspector/inspector.css'

import DashboardSection      from './environment-officer/sections/DashboardSection.vue'
import InspectionsSection    from './environment-officer/sections/InspectionsSection.vue'
import SurveillanceSection   from './environment-officer/sections/SurveillanceSection.vue'
import EnforcementSection    from './environment-officer/sections/EnforcementSection.vue'
import ProgrammesSection     from './environment-officer/sections/ProgrammesSection.vue'
import LicensingSection      from './environment-officer/sections/LicensingSection.vue'
import PlanAppraisalSection  from './environment-officer/sections/PlanAppraisalSection.vue'
import CertificatesSection   from './environment-officer/sections/CertificatesSection.vue'
import ReportsSection        from './environment-officer/sections/ReportsSection.vue'
import ReferenceSection      from './environment-officer/sections/ReferenceSection.vue'
import SettingsSection       from './environment-officer/sections/SettingsSection.vue'

import {
  HeartPulse, LayoutDashboard, ClipboardCheck, Building, Activity, ShieldAlert,
  BadgeCheck, BarChart3, BookOpen, Menu, X, Truck, Stamp, Settings, RefreshCw,
  CloudOff, Cloud, Search, CornerDownLeft, Store,
} from 'lucide-vue-next'

// `embedded` suppresses this view's own brand block and profile menu when it
// is hosted as the console pane of RoleWorkspaceShell, which supplies both.
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()
const authStore = useAuthStore()
const hc = provideHealthCase()
const { isMobile, isTablet } = useBreakpoint()
const { prefs } = useEhoPreferences()
const nav = useEhoNav()

type Section = BottomNavItem & { key: SectionKey; desc: string; group: 'field' | 'desk' | 'device' }

const SECTIONS: readonly Omit<Section, 'badge'>[] = [
  { key: 'dashboard',    label: 'Dashboard',      short: 'Today',   icon: LayoutDashboard, group: 'field',
    desc: 'What needs you today' },
  { key: 'inspections',  label: 'Inspections',    short: 'Inspect', icon: Building,        group: 'field',
    desc: 'Premises register · routine and joint inspections' },
  { key: 'surveillance', label: 'Surveillance',   short: 'Surveil', icon: Activity,        group: 'field',
    desc: 'Outbreaks · water quality · nuisance complaints' },
  { key: 'enforcement',  label: 'Enforcement',    short: 'Enforce', icon: ShieldAlert,     group: 'field',
    desc: 'Abatement notices · closure · prosecution' },
  { key: 'programmes',   label: 'Field programmes', short: 'Programmes', icon: Truck,      group: 'field',
    desc: 'Refuse · sanitation · vector control · health education' },
  { key: 'licensing',    label: 'Licence clearance', short: 'Licensing', icon: Stamp,      group: 'desk',
    desc: 'Health clearance for shop, liquor and hawker licences' },
  { key: 'appraisal',    label: 'Plan appraisal', short: 'Plans',   icon: ClipboardCheck,  group: 'desk',
    desc: 'Ventilation · sanitation · hygiene · floor area' },
  { key: 'certificates', label: 'Certificates',   short: 'Certs',   icon: BadgeCheck,      group: 'desk',
    desc: 'Food handlers · premises fitness · burial permits' },
  { key: 'reports',      label: 'Reports',        short: 'Reports', icon: BarChart3,       group: 'desk',
    desc: 'Periodic returns to Council and the Ministry of Health' },
  { key: 'reference',    label: 'Reference',      short: 'Ref',     icon: BookOpen,        group: 'desk',
    desc: 'Public Health Act · minimum standards · referrals' },
  { key: 'settings',     label: 'Settings',       short: 'Settings', icon: Settings,       group: 'device',
    desc: 'How this console behaves on this device' },
]

// Badges are work waiting, never totals: a rail that says "412" beside
// Inspections teaches the officer to stop reading the rail.
const badges = computed<Partial<Record<SectionKey, number>>>(() => {
  const s = hc.summary.value
  if (!s) return {}
  return {
    inspections: s.premisesOverdue + s.followUpsDue,
    surveillance: s.outbreaksOpen + s.complaintsOpen,
    enforcement: s.noticesOverdue,
    licensing: s.clearancesPending,
    programmes: s.programmesDue,
    certificates: s.handlerCertsExpired,
  }
})

const sections = computed<Section[]>(() =>
  SECTIONS.map(s => ({ ...s, badge: badges.value[s.key] || undefined })))

const activeSection = nav.section
const activeMeta = computed(() => sections.value.find(s => s.key === activeSection.value) ?? sections.value[0])

const SECTION_COMPONENTS: Record<SectionKey, Component> = {
  dashboard: DashboardSection, inspections: InspectionsSection, surveillance: SurveillanceSection,
  enforcement: EnforcementSection, programmes: ProgrammesSection, licensing: LicensingSection,
  appraisal: PlanAppraisalSection, certificates: CertificatesSection, reports: ReportsSection,
  reference: ReferenceSection, settings: SettingsSection,
}

// ── Rail collapse ─────────────────────────────────────────────────
// A tablet starts collapsed — room for the rail, not for the labels. The
// officer's own choice (Settings, or the toggle) wins once made this session.
const userCollapse = ref<boolean | null>(null)
const railCollapsed = computed(() => userCollapse.value ?? (isTablet.value || prefs.value.railCollapsed))
function toggleRail() { userCollapse.value = !railCollapsed.value }

// ── Sync + counters ───────────────────────────────────────────────
const refreshing = ref(false)
async function refreshAll() {
  refreshing.value = true
  try {
    await Promise.all([hc.refresh(), hc.refreshSummary(prefs.value.inspectionCycleDays)])
  } finally {
    refreshing.value = false
  }
}
onMounted(() => { void hc.refreshSummary(prefs.value.inspectionCycleDays) })
watch(() => prefs.value.inspectionCycleDays, (d) => { void hc.refreshSummary(d) })
// Counters drift as the officer works; re-read them on every section change
// rather than on a timer that would spend a rural data allowance idling.
watch(activeSection, () => { void hc.refreshSummary(prefs.value.inspectionCycleDays) })

const syncLabel = computed(() => {
  if (hc.syncState.value === 'loading' || refreshing.value) return 'Syncing'
  if (hc.syncState.value === 'offline') {
    const n = hc.pendingCount.value
    return n ? `Offline · ${n} held` : 'Offline'
  }
  return hc.pendingCount.value ? `${hc.pendingCount.value} to send` : 'Up to date'
})

// ── Section change: focus + scroll ────────────────────────────────
// A screen reader user who picks a section is moved to its content; a sighted
// user is not left halfway down the previous section's scroll position.
const mainEl = ref<HTMLElement | null>(null)
watch(activeSection, async () => {
  await nextTick()
  mainEl.value?.scrollTo({ top: 0 })
  mainEl.value?.focus({ preventScroll: true })
})

// ── Jump palette (Ctrl/⌘ K) ───────────────────────────────────────
// Eleven sections and a premises register that runs to hundreds of rows: the
// fastest route to "Mkoba Bakery" is typing it, not scrolling a rail.
const paletteOpen = ref(false)
const paletteQuery = ref('')
const paletteIndex = ref(0)

interface PaletteItem { id: string; title: string; meta: string; icon: Component; run: () => void }

const paletteItems = computed<PaletteItem[]>(() => {
  const q = paletteQuery.value.trim().toLowerCase()
  const secs: PaletteItem[] = SECTIONS
    .filter(s => !q || s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .map(s => ({ id: `s:${s.key}`, title: s.label, meta: s.desc, icon: s.icon, run: () => nav.go(s.key) }))
  if (!q) return secs
  const prem: PaletteItem[] = hc.registry.value
    .filter(p => `${p.name} ${p.reference ?? ''} ${p.stand_number} ${p.operator_name}`.toLowerCase().includes(q))
    .slice(0, 8)
    .map(p => ({
      id: `p:${p.id}`, title: p.name,
      meta: [p.reference, p.stand_number && `Stand ${p.stand_number}`, p.suburb_ward].filter(Boolean).join(' · '),
      icon: Store, run: () => nav.go('inspections', { premises: p.id }),
    }))
  return [...prem, ...secs]
})
watch(paletteQuery, () => { paletteIndex.value = 0 })

function openPalette() { paletteQuery.value = ''; paletteIndex.value = 0; paletteOpen.value = true }

// The palette is typed into the moment it opens. Not `autofocus`: UiSheet moves
// focus to its first control (the close button) on open, which blocks the
// attribute and would leave Ctrl K + typing going nowhere. This runs after the
// sheet's own focus step, in a later task.
const paletteInput = ref<HTMLInputElement | null>(null)
watch(paletteOpen, (open) => {
  if (open) setTimeout(() => paletteInput.value?.focus(), 0)
})
function runPalette(item?: PaletteItem) {
  const target = item ?? paletteItems.value[paletteIndex.value]
  if (!target) return
  paletteOpen.value = false
  target.run()
}
function paletteKey(e: KeyboardEvent) {
  const n = paletteItems.value.length
  if (!n) return
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex.value = (paletteIndex.value + 1) % n }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex.value = (paletteIndex.value - 1 + n) % n }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette() }
}
function globalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value ? (paletteOpen.value = false) : openPalette()
  }
}
onMounted(() => window.addEventListener('keydown', globalKey))
onBeforeUnmount(() => window.removeEventListener('keydown', globalKey))

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="ew-root" :class="{ embedded: props.embedded }">
    <a class="ew-skip" href="#ew-main">Skip to content</a>

    <header class="ew-header">
      <button v-if="!isMobile" class="ins-iconbtn ew-railbtn" type="button"
              :aria-expanded="!railCollapsed" aria-controls="ew-section-rail"
              @click="toggleRail">
        <component :is="railCollapsed ? Menu : X" :size="15" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>

      <div v-if="!props.embedded" class="ew-brand">
        <div class="ew-mark"><HeartPulse :size="16" aria-hidden="true" /></div>
        <div class="ew-brand-text">
          <span class="ew-title">Environmental Health</span>
          <span class="ew-sub">Vungu RDC · Public Health Act [Ch. 15:09]</span>
        </div>
      </div>

      <h1 class="ew-section-title">
        <component :is="activeMeta.icon" :size="15" aria-hidden="true" />
        <span class="ew-section-name">{{ activeMeta.label }}</span>
        <span class="ew-section-sub">{{ activeMeta.desc }}</span>
      </h1>

      <button type="button" class="ew-jump" @click="openPalette">
        <Search :size="14" aria-hidden="true" />
        <span class="ew-jump-label">Jump to…</span>
        <kbd class="ew-kbd" aria-hidden="true">Ctrl K</kbd>
      </button>

      <button type="button" class="ew-sync" :class="`is-${hc.syncState.value}`"
              :disabled="refreshing" :title="'Refresh registers'" @click="refreshAll">
        <component :is="hc.syncState.value === 'offline' ? CloudOff : Cloud" :size="14" aria-hidden="true" />
        <span class="ew-sync-label" aria-live="polite">{{ syncLabel }}</span>
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': refreshing || hc.syncState.value === 'loading' }" />
      </button>

      <ProfileDropdown
        v-if="!props.embedded"
        role-label="Environmental Health Officer"
        avatar-key="env_officer_avatar"
        @logout="handleLogout"
      />
    </header>

    <div class="ew-body">
      <nav v-if="!isMobile" id="ew-section-rail" class="ew-nav"
           :class="{ collapsed: railCollapsed }"
           aria-label="Environmental health console sections">
        <template v-for="(s, i) in sections" :key="s.key">
          <span v-if="!railCollapsed && (i === 0 || sections[i - 1].group !== s.group)" class="ew-nav-group">
            {{ s.group === 'field' ? 'Field' : s.group === 'desk' ? 'Desk' : 'Device' }}
          </span>
          <hr v-else-if="railCollapsed && i > 0 && sections[i - 1].group !== s.group" class="ew-nav-rule" />
          <button type="button"
                  class="ew-nav-item"
                  :class="{ active: activeSection === s.key }"
                  :aria-current="activeSection === s.key ? 'page' : undefined"
                  :title="railCollapsed ? s.label : undefined"
                  @click="nav.go(s.key)">
            <span class="ew-nav-icon">
              <component :is="s.icon" :size="16" aria-hidden="true" />
              <span v-if="railCollapsed && s.badge" class="ew-nav-dot" aria-hidden="true" />
            </span>
            <span v-if="!railCollapsed" class="ew-nav-label">{{ s.label }}</span>
            <span v-if="!railCollapsed && s.badge" class="ew-nav-badge">{{ s.badge > 99 ? '99+' : s.badge }}</span>
            <span class="ent-sr-only">
              <template v-if="railCollapsed">{{ s.label }}</template>
              <template v-if="s.badge">, {{ s.badge }} waiting</template>
            </span>
          </button>
        </template>
      </nav>

      <main id="ew-main" ref="mainEl" class="ew-content" :class="{ 'ent-bottomnav-gap': isMobile }" tabindex="-1">
        <!-- A mount-time CSS animation, not <Transition mode="out-in">: out-in holds
             the new section back until the old one finishes leaving, which costs
             every switch a delay and strands the old section entirely if frames
             stop (a backgrounded tab). The swap is instant; only the arrival moves. -->
        <component :is="SECTION_COMPONENTS[activeSection]" :key="activeSection" class="ew-section" />
      </main>
    </div>

    <UiBottomNav
      v-if="isMobile"
      :items="sections"
      :model-value="activeSection"
      label="Environmental health console sections"
      @update:model-value="nav.go($event as SectionKey)"
    />

    <UiSheet :open="paletteOpen" title="Jump to" subtitle="Sections and premises" width="34rem"
             @close="paletteOpen = false" @update:open="paletteOpen = $event">
      <div class="ew-pal">
        <label class="ins-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Search sections and premises</span>
          <input ref="paletteInput" v-model="paletteQuery" type="search"
                 placeholder="Section, premises name, stand or reference"
                 role="combobox" aria-controls="ew-pal-list" aria-expanded="true"
                 :aria-activedescendant="paletteItems[paletteIndex] ? `ew-pal-${paletteIndex}` : undefined"
                 @keydown="paletteKey" />
        </label>
        <ul id="ew-pal-list" class="ew-pal-list" role="listbox">
          <li v-for="(item, i) in paletteItems" :id="`ew-pal-${i}`" :key="item.id"
              role="option" :aria-selected="i === paletteIndex"
              class="ew-pal-item" :class="{ on: i === paletteIndex }"
              @mouseenter="paletteIndex = i" @click="runPalette(item)">
            <component :is="item.icon" :size="15" aria-hidden="true" />
            <span class="ew-pal-text">
              <strong>{{ item.title }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <CornerDownLeft v-if="i === paletteIndex" :size="13" class="ew-pal-enter" aria-hidden="true" />
          </li>
          <li v-if="!paletteItems.length" class="ew-pal-empty">
            Nothing matches “{{ paletteQuery }}”. Premises are searched by name, stand and reference.
          </li>
        </ul>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
.ew-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }
.ew-root.embedded { height:100%; }

.ew-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:var(--ent-fw-semibold); text-decoration:none; transform:translateY(-220%);
}
.ew-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

/* ── Header ──────────────────────────────────────────────────────── */
.ew-header { display:flex; align-items:center; gap:var(--ent-s3);
  min-height:var(--ent-topbar-h, 52px); padding:var(--ent-s2) var(--ent-s4);
  background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-shrink:0; }
.ew-railbtn { width:var(--ent-control-h-sm); height:var(--ent-control-h-sm); }

.ew-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.ew-mark { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.9rem; height:1.9rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.ew-brand-text { min-width:0; }
.ew-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold); line-height:1.15; white-space:nowrap; }
.ew-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); white-space:nowrap; }

.ew-section-title { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2);
  margin:0 0 0 var(--ent-s2); padding-left:var(--ent-s4); border-left:1px solid var(--ent-line);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.ew-section-name { flex-shrink:0; }
.ew-section-sub { color:var(--ent-text-3); font-weight:var(--ent-fw-normal); font-size:var(--ent-fs-xs);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ew-section-sub::before { content:'— '; }

.ew-jump { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2) 0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text-3);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r);
  cursor:pointer; transition:border-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.ew-jump:hover { border-color:var(--ent-line-strong); color:var(--ent-text-2); }
.ew-jump:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ew-kbd { font-family:var(--ent-font-mono); font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  padding:1px 5px; border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); background:var(--ent-surface); }

.ew-sync { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium);
  color:var(--ent-text-2); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-pill); cursor:pointer; white-space:nowrap;
  transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.ew-sync:hover { background:var(--ent-surface-2); }
.ew-sync:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ew-sync.is-offline { color:var(--ent-tone-warning-fg); background:var(--ent-tone-warning-bg); border-color:var(--ent-tone-warning-line); }

/* ── Rail ────────────────────────────────────────────────────────── */
.ew-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.ew-nav { display:flex; flex-direction:column; gap:2px;
  width:var(--ent-rail-w); padding:var(--ent-s3) var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line); overflow-y:auto; flex-shrink:0; }
.ew-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }

.ew-nav-group { display:block; padding:var(--ent-s3) var(--ent-s3) var(--ent-s1);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.06em;
  text-transform:uppercase; color:var(--ent-text-3); }
.ew-nav-group:first-child { padding-top:0; }
.ew-nav-rule { width:60%; margin:var(--ent-s2) auto; border:0; border-top:1px solid var(--ent-line); }

.ew-nav-item { position:relative; display:flex; align-items:center; gap:var(--ent-s3);
  width:100%; min-height:var(--ent-control-h); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  background:none; border:1px solid transparent; border-radius:var(--ent-r);
  color:var(--ent-text-2); text-align:left; cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.ew-nav.collapsed .ew-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.ew-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.ew-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
/* Tinted, not solid: the accent stays under a tenth of the surface. */
.ew-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); font-weight:var(--ent-fw-semibold); }
.ew-nav-icon { position:relative; display:inline-flex; flex-shrink:0; }
.ew-nav-dot { position:absolute; top:-2px; right:-3px; width:7px; height:7px; border-radius:50%;
  background:var(--ent-danger); box-shadow:0 0 0 2px var(--ent-surface); }
.ew-nav-label { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  animation:ew-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes ew-rail-label { from { opacity:0; transform:translateX(-6px); } }
.ew-nav-badge { flex-shrink:0; min-width:1.35rem; padding:0 6px; text-align:center;
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums;
  line-height:1.35rem; border-radius:var(--ent-r-pill);
  color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }
.ew-nav-item.active .ew-nav-badge { color:var(--ent-accent); background:var(--ent-surface); }

.ew-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; outline:none; }

/* Section arrival: a short rise and fade on the compositor only. */
.ew-section { animation:ew-section-in var(--ent-dur-lg) var(--ent-ease) backwards; }
@keyframes ew-section-in { from { opacity:0; transform:translateY(6px); } }

/* ── Jump palette ────────────────────────────────────────────────── */
.ew-pal { display:flex; flex-direction:column; gap:var(--ent-s3); }
.ew-pal-list { list-style:none; margin:0; padding:0; max-height:min(55vh, 26rem); overflow-y:auto; }
.ew-pal-item { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r); cursor:pointer; color:var(--ent-text-2); }
.ew-pal-item.on { background:var(--ent-accent-soft); color:var(--ent-accent); }
.ew-pal-text { flex:1; min-width:0; }
.ew-pal-text strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ew-pal-text small { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ew-pal-enter { color:var(--ent-accent); flex-shrink:0; }
.ew-pal-empty { padding:var(--ent-s5) var(--ent-s3); text-align:center; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }

@media (max-width: 1279px) { .ew-section-sub { display:none; } }
@media (max-width: 1023px) { .ew-jump-label, .ew-kbd { display:none; } }
@media (max-width: 767px) {
  .ew-section-title { margin-left:0; padding-left:0; border-left:none; font-size:var(--ent-fs-md); }
  .ew-brand-text, .ew-sync-label { display:none; }
}
@media (prefers-reduced-motion: reduce) {
  .ew-section { animation:none; }
  .ew-nav-label { animation:none; }
}
</style>
