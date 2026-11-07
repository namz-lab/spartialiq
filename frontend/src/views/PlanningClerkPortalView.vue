<script setup lang="ts">
// Planning Clerk console.
//
// Everything a local-authority planning clerk does across a day, in one
// workspace: take applications over the counter, verify what was lodged with
// them, receipt the fee, write the file into the Development Register, get the
// acknowledgement out inside five working days, advertise, serve the
// neighbours, keep the correspondence, watch the statutory clocks, hand over
// the permit or the refusal, know where the paper file physically is, and
// answer the public's right to inspect the register.
//
// SECTIONS (seventeen)
//   counter    Dashboard · File search · Application receipt · Document
//              verification · Public inspection
//   clocks     Statutory deadlines · Acknowledgements · Public notices · Refusals
//   registers  Development Register · Correspondence · Fees · File movement
//   outcomes   Permit dispatch · Enforcement records · Appeals
//   device     Console preferences
//
// WHAT CHANGED, AND WHY IT MATTERED
// Seven of this console's registers used to live in the browser's
// localStorage: correspondence, fee receipts, acknowledgement letters, permit
// dispatch, refusals, newspaper certificates and abutter notices. Every one of
// those is the council's evidence that it did what the Act requires, and every
// one was a cleared cache away from gone; a second clerk on a second machine
// saw an empty book. They are now nine server-side registers with no delete
// (migration 125, src/routes/planning-clerk.js).
//
// URL
// The section, the open file and each section's filters live in the URL
// (src/planning-clerk/console.ts). The open file is deliberately NOT cleared
// on a section change — the clerk's real loop at the counter is one file
// across four sections, and re-finding it each time means somebody waits.
//
// RESPONSIVE
//   ≥1024px  labelled rail with count badges
//   768–1023 rail collapsed to icons by default (overridable, remembered)
//   ≤767px   bottom navigation, four slots plus More
//
// The primitives are the shared ins-* sheet (views/inspector/inspector.css)
// and the --ent-* UI kit: one console vocabulary across every staff role
// rather than a seventh that drifts.

import {
  computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component,
} from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useClerkNav, useClerkPreferences } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { GROUP_LABELS, type SectionGroup, type SectionKey } from '@/planning-clerk/console'
import { num, searchFiles, type SearchHit } from '@/services/planningClerk'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import './inspector/inspector.css'

import DashboardSection        from './planning-clerk/sections/DashboardSection.vue'
import FileSearchSection       from './planning-clerk/sections/FileSearchSection.vue'
import ApplicationReceiptSection from './planning-clerk/sections/ApplicationReceiptSection.vue'
import IdentityReviewSection   from './planning-clerk/sections/IdentityReviewSection.vue'
import PublicInspectionSection from './planning-clerk/sections/PublicInspectionSection.vue'
import DeadlinesSection        from './planning-clerk/sections/DeadlinesSection.vue'
import AcknowledgementsSection from './planning-clerk/sections/AcknowledgementsSection.vue'
import PublicNoticesSection    from './planning-clerk/sections/PublicNoticesSection.vue'
import RefusalsSection         from './planning-clerk/sections/RefusalsSection.vue'
import DevelopmentRegisterSection from './planning-clerk/sections/DevelopmentRegisterSection.vue'
import CorrespondenceSection   from './planning-clerk/sections/CorrespondenceSection.vue'
import FeesSection             from './planning-clerk/sections/FeesSection.vue'
import FileMovementSection     from './planning-clerk/sections/FileMovementSection.vue'
import PermitDispatchSection   from './planning-clerk/sections/PermitDispatchSection.vue'
import EnforcementRecordsSection from './planning-clerk/sections/EnforcementRecordsSection.vue'
import AppealsSection          from './planning-clerk/sections/AppealsSection.vue'
import PreferencesSection      from './planning-clerk/sections/PreferencesSection.vue'
import DevelopmentMatrixManager from '@/components/admin/land-use/DevelopmentMatrixManager.vue'

import {
  FileText, LayoutDashboard, Search, FileInput, ShieldCheck, Eye,
  AlarmClock, Mail, Megaphone, FileX, BookOpen, Inbox, Receipt, FolderInput,
  Send, ShieldAlert, Scale, Settings2, Menu, X, CornerDownLeft, RefreshCw,
  AlertTriangle, FolderOpen, Table2, Landmark,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const { isMobile, isTablet } = useBreakpoint()
const { prefs } = useClerkPreferences()
const nav = useClerkNav()
const overview = useClerkOverview()

type Section = BottomNavItem & { key: SectionKey; desc: string; group: SectionGroup }

// Order matters below 768px: the first four fill the bottom bar. The clerk's
// counter loop is checking the day, finding a file, taking the next
// application and watching the clocks; the rest are downstream paperwork and
// sit behind More. `short` exists because "Document verification" is
// unreadable in a 70px bar slot.
const SECTIONS: readonly Omit<Section, 'badge'>[] = [
  { key: 'dashboard',         label: 'Dashboard',            short: 'Home',     icon: LayoutDashboard, group: 'counter',
    desc: 'Today’s counter, the day’s takings and what is running late' },
  { key: 'search',            label: 'Find a file',          short: 'Find',     icon: Search,          group: 'counter',
    desc: 'Reference, stand number or applicant name — the counter lookup' },
  { key: 'receipt',           label: 'Application receipt',  short: 'Receipt',  icon: FileInput,       group: 'counter',
    desc: 'Take a TPD over the counter: checklist, fee, acknowledgement' },
  { key: 'matrix',            label: 'Development matrix',   short: 'Matrix',   icon: Table2,          group: 'counter',
    desc: 'What each zone permits, so the counter can tell an applicant before they lodge' },
  { key: 'deadlines',         label: 'Statutory deadlines',  short: 'Clocks',   icon: AlarmClock,      group: 'clocks',
    desc: 'Every clock the council is answerable for, soonest first' },

  { key: 'verification',      label: 'Document verification', short: 'Verify',  icon: ShieldCheck,     group: 'counter',
    desc: 'AI-checked documents awaiting an officer’s confirmation' },
  { key: 'public_inspection', label: 'Public inspection',    short: 'Public',   icon: Eye,             group: 'counter',
    desc: 'Register inspections, certified copies and planning searches' },

  { key: 'acknowledgements',  label: 'Acknowledgements',     short: 'Ack',      icon: Mail,            group: 'clocks',
    desc: '5 working days from receipt; starts the 3-month clock' },
  { key: 'notices',           label: 'Public notices',       short: 'Notices',  icon: Megaphone,       group: 'clocks',
    desc: 'Newspaper certificates and the abutting-owner log' },
  { key: 'refusals',          label: 'Refusal letters',      short: 'Refusals', icon: FileX,           group: 'clocks',
    desc: '7 days from the Council resolution; reasons are mandatory' },

  { key: 'register',          label: 'Development Register', short: 'Register', icon: BookOpen,        group: 'registers',
    desc: 'The statutory public-inspection register of every application' },
  { key: 'correspondence',    label: 'Correspondence',       short: 'Post',     icon: Inbox,           group: 'registers',
    desc: 'Every letter, email, call and counter visit, in and out' },
  { key: 'fees',              label: 'Fees & cashbook',      short: 'Fees',     icon: Receipt,         group: 'registers',
    desc: 'Counter receipts in both currencies, and the day’s reconciliation' },
  { key: 'movements',         label: 'File movement',        short: 'Files',    icon: FolderInput,     group: 'registers',
    desc: 'Where the paper file is and who signed for it' },

  { key: 'dispatch',          label: 'Permit dispatch',      short: 'Dispatch', icon: Send,            group: 'outcomes',
    desc: 'Hand over the sealed instrument and keep the proof of delivery' },
  { key: 'enforcement',       label: 'Enforcement records',  short: 'Enforce',  icon: ShieldAlert,     group: 'outcomes',
    desc: 'The public enforcement register of orders the planner has issued' },
  { key: 'appeals',           label: 'Appeals',              short: 'Appeals',  icon: Scale,           group: 'outcomes',
    desc: 'Appeals against refusal, on the shared statutory register' },

  { key: 'preferences',       label: 'Console preferences',  short: 'You',      icon: Settings2,       group: 'device',
    desc: 'How this console behaves on this device' },
]

/**
 * The rail's order, which is NOT the order above.
 *
 * SECTIONS is ordered for the phone, where the first four fill the bottom bar
 * and must be the four things a clerk reaches for standing at a counter. The
 * rail has room to be ordered by group instead, which is how someone scanning
 * a menu expects to find things. Sorting here rather than keeping two arrays
 * means a new section is added once.
 */
const GROUP_ORDER: SectionGroup[] = ['counter', 'clocks', 'registers', 'outcomes', 'device']

/**
 * Badges are work waiting, never totals.
 *
 * A rail that says "412" beside the Development Register teaches the clerk to
 * stop reading the rail. Each number here is something somebody has to do
 * today: a letter past its statutory date, a file that has not come back, an
 * application whose fee is still outstanding.
 */
const badges = computed<Partial<Record<SectionKey, number>>>(() => {
  const o = overview.data.value
  if (!o) return {}
  return {
    acknowledgements: num(o.acknowledgements.overdue) || undefined,
    refusals: num(o.refusals.overdue) || undefined,
    movements: num(o.movements.files_overdue) || undefined,
    deadlines: (num(o.acknowledgements.overdue) + num(o.refusals.overdue)
      + num(o.movements.files_overdue)) || undefined,
    register: num(o.permits.unpaid) || undefined,
  }
})

const sections = computed<Section[]>(() =>
  SECTIONS.map(s => ({ ...s, badge: badges.value[s.key] || undefined })))

const railSections = computed<Section[]>(() =>
  [...sections.value].sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)))

const activeSection = nav.section
const activeMeta = computed(() =>
  sections.value.find(s => s.key === activeSection.value) ?? sections.value[0])

const SECTION_COMPONENTS: Record<SectionKey, Component> = {
  dashboard: DashboardSection, search: FileSearchSection,
  receipt: ApplicationReceiptSection, verification: IdentityReviewSection,
  public_inspection: PublicInspectionSection, matrix: DevelopmentMatrixManager,
  deadlines: DeadlinesSection, acknowledgements: AcknowledgementsSection,
  notices: PublicNoticesSection, refusals: RefusalsSection,
  register: DevelopmentRegisterSection, correspondence: CorrespondenceSection,
  fees: FeesSection, movements: FileMovementSection,
  dispatch: PermitDispatchSection, enforcement: EnforcementRecordsSection,
  appeals: AppealsSection,
  preferences: PreferencesSection,
}

// ── Rail collapse ───────────────────────────────────────────────────────
// A tablet starts collapsed — room for the rail, not for seventeen labels.
// The clerk's own choice (Preferences, or the toggle) wins once made.
const userCollapse = ref<boolean | null>(null)
const railCollapsed = computed(() =>
  userCollapse.value ?? (isTablet.value || prefs.value.railCollapsed))
function toggleRail() { userCollapse.value = !railCollapsed.value }

// ── Counters ────────────────────────────────────────────────────────────
// Re-read on every section change rather than on a timer: a timer would spend
// a rural data allowance idling on a screen nobody is looking at, and the
// moment the numbers matter is the moment the clerk moves to the section they
// belong to.
onMounted(() => { void overview.refresh() })
watch(activeSection, () => { void overview.refresh() })

// ── The open file ───────────────────────────────────────────────────────
// Watched on the id, not on the route object: the route object is a new
// reference on every query change, so an object watcher would re-fetch the
// same file every time the clerk typed a character into a search box.
watch(nav.permit, (id) => { void overview.loadFile(id) }, { immediate: true })

// ── Section change: focus + scroll ──────────────────────────────────────
// A screen-reader user who picks a section is moved to its content; a sighted
// user is not left halfway down the previous section's scroll position.
const mainEl = ref<HTMLElement | null>(null)
watch(activeSection, async () => {
  await nextTick()
  mainEl.value?.scrollTo({ top: 0 })
  mainEl.value?.focus({ preventScroll: true })
})

// ── Jump palette (Ctrl/⌘ K) ─────────────────────────────────────────────
// Seventeen sections and a file register: the fastest route to an applicant's
// file is typing their stand number, not scrolling a rail and then a table.
const paletteOpen = ref(false)
const paletteQuery = ref('')
const paletteIndex = ref(0)
const paletteHits = ref<SearchHit[]>([])
const paletteSearching = ref(false)

interface PaletteItem { id: string; title: string; meta: string; icon: Component; run: () => void }

const paletteItems = computed<PaletteItem[]>(() => {
  const q = paletteQuery.value.trim().toLowerCase()
  const secs: PaletteItem[] = railSections.value
    .filter(s => !q || s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .map(s => ({
      id: `s:${s.key}`, title: s.label, meta: s.desc, icon: s.icon,
      run: () => nav.go(s.key),
    }))
  if (!q) return secs
  // Files first once something is typed: a clerk who types a stand number
  // wants the file, and a section whose description happens to contain the
  // same letters is not what they meant.
  const files: PaletteItem[] = paletteHits.value.slice(0, 6).map(hit => ({
    id: `f:${hit.id}`,
    title: hit.tpd_reference || hit.dev_register_no || hit.stand_number || hit.applicant_name,
    meta: [hit.applicant_name, hit.stand_number, hit.suburb_ward].filter(Boolean).join(' · '),
    icon: FolderOpen,
    run: () => { nav.openFile(hit.id); nav.go('search') },
  }))
  return [...files, ...secs]
})
watch(paletteQuery, () => { paletteIndex.value = 0 })

// Debounced, and only past two characters. Every keystroke is a round trip on
// a link that is not fast, and the server answers nothing under two anyway.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(paletteQuery, (q) => {
  clearTimeout(searchTimer)
  const term = q.trim()
  if (term.length < 2) { paletteHits.value = []; paletteSearching.value = false; return }
  paletteSearching.value = true
  searchTimer = setTimeout(async () => {
    try {
      paletteHits.value = await searchFiles(term, 6)
    } catch {
      // The palette still offers every section; a failed file search narrows
      // it rather than breaking it, so this is not worth an error banner.
      paletteHits.value = []
    } finally {
      paletteSearching.value = false
    }
  }, 220)
})

function openPalette() {
  paletteQuery.value = ''
  paletteIndex.value = 0
  paletteHits.value = []
  paletteOpen.value = true
}

// The palette is typed into the moment it opens. Not `autofocus`: UiSheet
// moves focus to its own close button on open, which would swallow the
// attribute and leave Ctrl K + typing going nowhere. This runs after that.
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
    if (paletteOpen.value) paletteOpen.value = false
    else openPalette()
  }
}
onMounted(() => window.addEventListener('keydown', globalKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', globalKey)
  clearTimeout(searchTimer)
})

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="ck-root">
    <a class="ck-skip" href="#ck-main">Skip to content</a>

    <header class="ck-header">
      <button v-if="!isMobile" class="ins-iconbtn ck-railbtn" type="button"
              :aria-expanded="!railCollapsed" aria-controls="ck-section-rail"
              @click="toggleRail">
        <component :is="railCollapsed ? Menu : X" :size="15" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>

      <div class="ck-brand">
        <div class="ck-mark"><FileText :size="16" aria-hidden="true" /></div>
        <div class="ck-brand-text">
          <span class="ck-title">Planning Clerk</span>
          <span class="ck-sub">Vungu RDC · Development Register &amp; council letters</span>
        </div>
      </div>

      <h1 class="ck-section-title">
        <component :is="activeMeta.icon" :size="15" aria-hidden="true" />
        <span class="ck-section-name">{{ activeMeta.label }}</span>
        <span class="ck-section-sub">{{ activeMeta.desc }}</span>
      </h1>

      <button type="button" class="ck-jump" @click="openPalette">
        <Search :size="14" aria-hidden="true" />
        <span class="ck-jump-label">Find a file…</span>
        <kbd class="ck-kbd" aria-hidden="true">Ctrl K</kbd>
      </button>

      <button type="button" class="ck-sync" :disabled="overview.loading.value"
              title="Re-read the console counters" @click="overview.refresh()">
        <span class="ck-sync-label" aria-live="polite">
          {{ overview.loading.value ? 'Refreshing' : 'Refresh' }}
        </span>
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': overview.loading.value }" />
      </button>

      <button
        type="button"
        class="ck-sync"
        title="Open the finance revenue console"
        data-testid="clerk-open-finance"
        @click="router.push('/finance')"
      >
        <Landmark :size="13" aria-hidden="true" />
        <span class="ck-sync-label">Finance</span>
      </button>

      <ProfileDropdown
        role-label="Planning Clerk"
        avatar-key="planning_clerk_avatar"
        @logout="handleLogout"
      />
    </header>

    <!-- The open file, carried across every section.
         This is the console's one piece of standing chrome, and it is here
         because the clerk's real loop is one file through several sections:
         find it, log the letter that came with it, receipt the fee, sign it
         out. Without this bar the clerk cannot see which file the forms below
         are about to write against, which is how an entry lands on the wrong
         applicant. -->
    <div v-if="nav.permit.value" class="ck-file" role="status">
      <FolderOpen :size="15" aria-hidden="true" />
      <span v-if="overview.fileLoading.value" class="ck-file-text">Opening file…</span>
      <span v-else-if="overview.fileError.value" class="ck-file-text ck-file-bad">
        {{ overview.fileError.value }}
      </span>
      <span v-else-if="overview.file.value" class="ck-file-text">
        <strong class="ins-mono">
          {{ overview.file.value.permit.tpd_reference
             || overview.file.value.permit.dev_register_no || 'Unreferenced' }}
        </strong>
        <span class="ck-file-meta">
          {{ overview.file.value.permit.applicant_name }}
          · Stand {{ overview.file.value.permit.stand_number || '—' }}
          · {{ overview.file.value.permit.suburb_ward || '—' }}
        </span>
      </span>
      <span v-else class="ck-file-text">File not found.</span>
      <button type="button" class="ck-file-close" @click="nav.openFile(null)">
        <X :size="13" aria-hidden="true" />
        <span>Close file</span>
      </button>
    </div>

    <div class="ck-body">
      <nav v-if="!isMobile" id="ck-section-rail" class="ck-nav"
           :class="{ collapsed: railCollapsed }"
           aria-label="Planning clerk console sections">
        <template v-for="(s, i) in railSections" :key="s.key">
          <span v-if="!railCollapsed && (i === 0 || railSections[i - 1].group !== s.group)"
                class="ck-nav-group">
            {{ GROUP_LABELS[s.group] }}
          </span>
          <hr v-else-if="railCollapsed && i > 0 && railSections[i - 1].group !== s.group"
              class="ck-nav-rule" />
          <button type="button"
                  class="ck-nav-item"
                  :class="{ active: activeSection === s.key }"
                  :aria-current="activeSection === s.key ? 'page' : undefined"
                  :title="railCollapsed ? s.label : undefined"
                  @click="nav.go(s.key)">
            <span class="ck-nav-icon">
              <component :is="s.icon" :size="16" aria-hidden="true" />
              <span v-if="railCollapsed && s.badge" class="ck-nav-dot" aria-hidden="true" />
            </span>
            <span v-if="!railCollapsed" class="ck-nav-label">{{ s.label }}</span>
            <span v-if="!railCollapsed && s.badge" class="ck-nav-badge">
              {{ s.badge > 99 ? '99+' : s.badge }}
            </span>
            <span class="ent-sr-only">
              <template v-if="railCollapsed">{{ s.label }}</template>
              <template v-if="s.badge">, {{ s.badge }} needing attention</template>
            </span>
          </button>
        </template>

        <p v-if="!railCollapsed" class="ck-nav-foot">
          Every register here is the council’s evidence. Entries are corrected
          or struck through with a reason — never deleted.
        </p>
      </nav>

      <main id="ck-main" ref="mainEl" class="ck-content"
            :class="{ 'ent-bottomnav-gap': isMobile }" tabindex="-1">
        <!-- A mount-time CSS animation, not <Transition mode="out-in">: out-in
             holds the new section back until the old one has finished leaving,
             which costs every switch a delay and strands the old section
             entirely if frames stop (a backgrounded tab). The swap is instant;
             only the arrival moves. -->
        <component :is="SECTION_COMPONENTS[activeSection]" :key="activeSection" class="ck-section" />
      </main>
    </div>

    <UiBottomNav
      v-if="isMobile"
      :items="sections"
      :model-value="activeSection"
      label="Planning clerk console sections"
      @update:model-value="nav.go($event as SectionKey)"
    />

    <UiSheet :open="paletteOpen" title="Find a file" subtitle="Sections, and applications by reference, stand or name"
             width="36rem" @close="paletteOpen = false" @update:open="paletteOpen = $event">
      <div class="ck-pal">
        <label class="ins-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Search sections and files</span>
          <input ref="paletteInput" v-model="paletteQuery" type="search"
                 placeholder="TPD reference, stand number, or applicant name"
                 role="combobox" aria-controls="ck-pal-list" aria-expanded="true"
                 :aria-activedescendant="paletteItems[paletteIndex] ? `ck-pal-${paletteIndex}` : undefined"
                 @keydown="paletteKey" />
        </label>
        <ul id="ck-pal-list" class="ck-pal-list" role="listbox">
          <li v-for="(item, i) in paletteItems" :id="`ck-pal-${i}`" :key="item.id"
              role="option" :aria-selected="i === paletteIndex"
              class="ck-pal-item" :class="{ on: i === paletteIndex }"
              @mouseenter="paletteIndex = i" @click="runPalette(item)">
            <component :is="item.icon" :size="15" aria-hidden="true" />
            <span class="ck-pal-text">
              <strong>{{ item.title }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <CornerDownLeft v-if="i === paletteIndex" :size="13" class="ck-pal-enter" aria-hidden="true" />
          </li>
          <li v-if="paletteSearching" class="ck-pal-empty">Searching files…</li>
          <li v-else-if="!paletteItems.length" class="ck-pal-empty">
            Nothing matches “{{ paletteQuery }}”. Files are searched by TPD
            reference, register number, stand number, applicant name and ward.
          </li>
        </ul>
      </div>
    </UiSheet>

    <!-- The counters failing is not the same as there being nothing to count:
         a silent zero beside "acknowledgements overdue" tells a clerk their
         letters are up to date, which is the one thing it must never do
         without being true. -->
    <div v-if="overview.error.value" class="ck-toast" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ overview.error.value }}</span>
      <button type="button" @click="overview.refresh()">Retry</button>
    </div>
  </div>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css. Primitives: views/inspector/inspector.css.
   This file styles only the chrome — every section renders on ins-* and the
   --ent-* UI kit, so the console cannot drift from the other staff consoles.
   The pink and slate hexes this file used to hardcode are gone: role identity
   belongs in the brand mark and the title, not in a second palette. */

.ck-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }

.ck-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:var(--ent-fw-semibold); text-decoration:none; transform:translateY(-220%);
}
.ck-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

/* ── Header ──────────────────────────────────────────────────────────── */
.ck-header { display:flex; align-items:center; gap:var(--ent-s3);
  min-height:var(--ent-topbar-h); padding:var(--ent-s2) var(--ent-s4);
  padding-left:calc(var(--ent-s4) + var(--ent-safe-left));
  padding-right:calc(var(--ent-s4) + var(--ent-safe-right));
  background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-shrink:0; }
.ck-railbtn { width:var(--ent-control-h-sm); height:var(--ent-control-h-sm); }

.ck-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.ck-mark { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.9rem; height:1.9rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.ck-brand-text { min-width:0; }
.ck-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold);
  line-height:1.15; white-space:nowrap; }
.ck-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); white-space:nowrap; }

/* HEADER BUDGET — why the title has a floor and the name truncates.
   At 1034px (an ordinary laptop) the brand, the jump button, the refresh
   pill and the profile menu together want more than the bar has, and the
   only child that can give way is this one. With min-width:0 and a
   non-shrinking name it was crushed to 17 of the 97 pixels it needed, so the
   header read "Planning Clerk … D … Find a file". The title is the only
   thing in the bar that says where the clerk IS, so it gets a floor; the
   brand text goes instead, at the width where the two stop fitting. */
.ck-section-title { flex:1 1 auto; min-width:8rem; display:flex; align-items:center;
  gap:var(--ent-s2); margin:0 0 0 var(--ent-s2);
  padding-left:var(--ent-s4); border-left:1px solid var(--ent-line);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.ck-section-title > svg { flex-shrink:0; }
/* The name never gives way; the description does. Which section the clerk is
   in is the point of the heading, and "Dashboa…" beside a full sentence of
   description is the wrong thing to have kept. */
.ck-section-name { flex-shrink:0; white-space:nowrap; }
.ck-section-sub { flex:1 1 auto; min-width:0;
  color:var(--ent-text-3); font-weight:var(--ent-fw-normal); font-size:var(--ent-fs-xs);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ck-section-sub::before { content:'— '; }

.ck-jump { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2) 0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text-3);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r);
  cursor:pointer; transition:border-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.ck-jump:hover { border-color:var(--ent-line-strong); color:var(--ent-text-2); }
.ck-jump:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ck-kbd { font-family:var(--ent-font-mono); font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  padding:1px 5px; border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); background:var(--ent-surface); }

.ck-sync { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium);
  color:var(--ent-text-2); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-pill); cursor:pointer; white-space:nowrap;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.ck-sync:hover:not(:disabled) { background:var(--ent-surface-2); }
.ck-sync:disabled { opacity:0.7; cursor:progress; }
.ck-sync:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* ── Open-file bar ───────────────────────────────────────────────────── */
.ck-file { display:flex; align-items:center; gap:var(--ent-s3); flex-shrink:0;
  padding:var(--ent-s2) var(--ent-s4);
  padding-left:calc(var(--ent-s4) + var(--ent-safe-left));
  padding-right:calc(var(--ent-s4) + var(--ent-safe-right));
  font-size:var(--ent-fs-sm); color:var(--ent-accent);
  background:var(--ent-accent-soft); border-bottom:1px solid var(--ent-accent-line);
  animation:ck-file-in var(--ent-dur) var(--ent-ease) backwards; }
@keyframes ck-file-in { from { opacity:0; transform:translateY(-4px); } }
.ck-file > svg { flex-shrink:0; }
.ck-file-text { flex:1; min-width:0; display:flex; align-items:baseline; gap:var(--ent-s3);
  overflow:hidden; }
.ck-file-text strong { flex-shrink:0; font-weight:var(--ent-fw-semibold); }
.ck-file-meta { color:var(--ent-text-2); font-size:var(--ent-fs-xs);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ck-file-bad { color:var(--ent-tone-negative-fg); }
.ck-file-close { display:inline-flex; align-items:center; gap:var(--ent-s1); flex-shrink:0;
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); background:var(--ent-surface);
  border:1px solid var(--ent-accent-line); border-radius:var(--ent-r); cursor:pointer; }
.ck-file-close:hover { background:var(--ent-surface-2); }
.ck-file-close:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* ── Rail ────────────────────────────────────────────────────────────── */
.ck-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.ck-nav { display:flex; flex-direction:column; gap:2px;
  width:var(--ent-rail-w); padding:var(--ent-s3) var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line); overflow-y:auto; flex-shrink:0; }
.ck-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }

.ck-nav-group { display:block; padding:var(--ent-s3) var(--ent-s3) var(--ent-s1);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.06em;
  text-transform:uppercase; color:var(--ent-text-3); }
.ck-nav-group:first-child { padding-top:0; }
.ck-nav-rule { width:60%; margin:var(--ent-s2) auto; border:0; border-top:1px solid var(--ent-line); }

.ck-nav-item { position:relative; display:flex; align-items:center; gap:var(--ent-s3);
  width:100%; min-height:var(--ent-control-h); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  background:none; border:1px solid transparent; border-radius:var(--ent-r);
  color:var(--ent-text-2); text-align:left; cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.ck-nav.collapsed .ck-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.ck-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.ck-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
/* Tinted, not solid: the accent stays well under a tenth of the surface. */
.ck-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); font-weight:var(--ent-fw-semibold); }
.ck-nav-icon { position:relative; display:inline-flex; flex-shrink:0; }
.ck-nav-dot { position:absolute; top:-2px; right:-3px; width:7px; height:7px; border-radius:50%;
  background:var(--ent-danger); box-shadow:0 0 0 2px var(--ent-surface); }
.ck-nav-label { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  animation:ck-rail-label var(--ent-dur) var(--ent-ease); }

/* RAIL COLLAPSE — why the width does not animate.
   Animating width made every frame of the collapse relayout the whole
   workspace: the rail, the content pane and everything in it. It also animated
   a box whose contents had already gone, because the labels are mounted and
   unmounted rather than faded. So the width changes in one step and the motion
   rides on the labels instead, in transform and opacity only, which the
   compositor handles without touching layout. */
@keyframes ck-rail-label { from { opacity:0; transform:translateX(-6px); } }

.ck-nav-badge { flex-shrink:0; min-width:1.35rem; padding:0 6px; text-align:center;
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums;
  line-height:1.35rem; border-radius:var(--ent-r-pill);
  color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }
.ck-nav-item.active .ck-nav-badge { color:var(--ent-accent); background:var(--ent-surface); }

.ck-nav-foot { margin:auto 0 0; padding:var(--ent-s4) var(--ent-s3) var(--ent-s2);
  font-size:var(--ent-fs-micro); line-height:var(--ent-lh); color:var(--ent-text-3); }

.ck-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; outline:none; }

/* Section arrival: a short rise and fade, on the compositor only. */
.ck-section { animation:ck-section-in var(--ent-dur-lg) var(--ent-ease) backwards; }
@keyframes ck-section-in { from { opacity:0; transform:translateY(6px); } }

/* ── Jump palette ────────────────────────────────────────────────────── */
.ck-pal { display:flex; flex-direction:column; gap:var(--ent-s3); }
.ck-pal-list { list-style:none; margin:0; padding:0; max-height:min(55vh, 26rem); overflow-y:auto; }
.ck-pal-item { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r); cursor:pointer; color:var(--ent-text-2); }
.ck-pal-item.on { background:var(--ent-accent-soft); color:var(--ent-accent); }
.ck-pal-text { flex:1; min-width:0; }
.ck-pal-text strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ck-pal-text small { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ck-pal-enter { color:var(--ent-accent); flex-shrink:0; }
.ck-pal-empty { padding:var(--ent-s5) var(--ent-s3); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }

/* ── Counter failure ─────────────────────────────────────────────────── */
.ck-toast { position:fixed; left:50%; bottom:var(--ent-s5); transform:translateX(-50%);
  z-index:var(--ent-z-toast); display:flex; align-items:center; gap:var(--ent-s3);
  max-width:min(92vw, 34rem); padding:var(--ent-s3) var(--ent-s4);
  font-size:var(--ent-fs-sm); color:var(--ent-tone-negative-fg);
  background:var(--ent-surface); border:1px solid var(--ent-tone-negative-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e3);
  animation:ck-toast-in var(--ent-dur-lg) var(--ent-ease) backwards; }
@keyframes ck-toast-in { from { opacity:0; transform:translate(-50%, 10px); } }
.ck-toast > span { flex:1; min-width:0; }
.ck-toast button { flex-shrink:0; font-family:var(--ent-font); font-size:var(--ent-fs-xs);
  font-weight:var(--ent-fw-semibold); color:var(--ent-accent);
  background:none; border:0; cursor:pointer; text-decoration:underline; }

@media (max-width: 1279px) {
  .ck-section-sub { display:none; }
  /* The council's name and the role are already on the sign-in, the profile
     menu and the page title. The section name is not. */
  .ck-brand-text { display:none; }
}
@media (max-width: 1023px) { .ck-jump-label, .ck-kbd { display:none; } }
@media (max-width: 767px) {
  .ck-section-title { margin-left:0; padding-left:0; border-left:none; font-size:var(--ent-fs-md); }
  .ck-brand-text, .ck-sync-label { display:none; }
  /* The jump palette is a keyboard affordance and there is no Ctrl K on a
     phone; the bottom bar is the navigation there. Removing it gives the
     section title back the width it needs to be readable. */
  .ck-jump { display:none; }
  .ck-file { font-size:var(--ent-fs-xs); }
  .ck-file-meta { display:none; }
}
@media (prefers-reduced-motion: reduce) {
  .ck-section, .ck-nav-label, .ck-toast, .ck-file { animation:none; }
}
</style>
