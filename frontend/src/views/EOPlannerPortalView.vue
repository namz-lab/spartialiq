<script setup lang="ts">
// Executive Officer (Planning) console — every duty of the planning office in
// one workspace, with one case open across all of them.
//
// SECTIONS (fifteen, in three groups)
//   casework  Dashboard · Register · Intake · Due diligence · Public notice ·
//             Circulation · Committee · Determination
//   records   Permits · Enforcement · Appeals · Building plans
//   office    Reports · Reference · Settings
//
// The casework group is the statutory path of one application, in the order
// the Act puts it: s.26 lodging and completeness, assessment, s.26(3) notice,
// departmental circulation, the committee, the determination. The records
// group is what the council keeps afterwards and answers questions from — a
// permit register, enforcement, appeals to the Administrative Court, building
// plans. The office group is periodic and reference work.
//
// ONE OPEN CASE
// ?case=<uuid> in the URL, read by every casework section through useEoCase.
// The case bar under the header shows which file is open, what the statutory
// clock says about it, and where it is in the workflow. Before this, each
// section carried its own picker and an officer chose the same application
// five times in a row.
//
// URL
//   ?section= where you are · ?case= what is open · ?tab=/?q= the section's own
// Section changes push (Back walks them); opening a case and moving a tab
// replace. The rules are in src/eo-planner/console.ts, where they are tested.
//
// RESPONSIVE
//   ≥1024  labelled rail, grouped, with badges
//   768–1023  rail collapsed to icons by default (overridable, remembered)
//   ≤767   bottom navigation: the four sections that move a case, then More
//
// The primitives are the shared ins-* sheet (views/inspector/inspector.css) —
// one console vocabulary across the officer consoles rather than three that
// drift.

import {
  computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component,
} from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useOrProvidePlannerCase } from '@/composables/usePlannerCase'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { useEoNav } from '@/eo-planner/useEoNav'
import { useEoPreferences } from '@/eo-planner/useEoPreferences'
import { useEoWorkload } from '@/eo-planner/useEoWorkload'
import { useEoCase } from '@/eo-planner/useEoCase'
import { SECTION_GROUP, isCaseSection, type SectionKey } from '@/eo-planner/console'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import './inspector/inspector.css'

import DashboardSection     from './eo-planner/sections/DashboardSection.vue'
import RegisterSection      from './eo-planner/sections/RegisterSection.vue'
import IntakeReviewSection  from './eo-planner/sections/IntakeReviewSection.vue'
import DueDiligenceSection  from './eo-planner/sections/DueDiligenceSection.vue'
import PublicNotificationSection from './eo-planner/sections/PublicNotificationSection.vue'
import TechnicalCirculationSection from './eo-planner/sections/TechnicalCirculationSection.vue'
import CommitteeSection     from './eo-planner/sections/CommitteeSection.vue'
import DecisionReviewSection from './eo-planner/sections/DecisionReviewSection.vue'
import PermitsSection       from './eo-planner/sections/PermitsSection.vue'
import EnforcementSection   from './eo-planner/sections/EnforcementSection.vue'
import AppealsSection       from './eo-planner/sections/AppealsSection.vue'
import BuildingPlanAppraisalSection from './eo-planner/sections/BuildingPlanAppraisalSection.vue'
import ReportsSection       from './eo-planner/sections/ReportsSection.vue'
import PolicyReferenceSection from './eo-planner/sections/PolicyReferenceSection.vue'
import SettingsSection      from './eo-planner/sections/SettingsSection.vue'
import DevelopmentMatrixManager from '@/components/admin/land-use/DevelopmentMatrixManager.vue'

import {
  Briefcase, LayoutDashboard, Library, Inbox, FileSearch, Megaphone, Send,
  Users, Gavel, FileCheck2, ShieldAlert, Scale, Building, BarChart3, BookOpen,
  Settings, Menu, X, Search, CornerDownLeft, RefreshCw, FolderOpen, Clock,
  AlertTriangle, Table2,
} from 'lucide-vue-next'

// `embedded` suppresses this view's own brand block and profile menu when it
// is hosted as the console pane of RoleWorkspaceShell, which supplies both.
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()
const authStore = useAuthStore()

// The planner case file is provided here so the reused Step components and
// this console's own sections share one case — see useEoCase.
useOrProvidePlannerCase()

const { isMobile, isTablet } = useBreakpoint()
const { prefs } = useEoPreferences()
const nav = useEoNav()
const workload = useEoWorkload()
const eoCase = useEoCase()

type Section = BottomNavItem & { key: SectionKey; desc: string }

const SECTIONS: readonly Omit<Section, 'badge'>[] = [
  { key: 'dashboard',    label: 'Dashboard',        short: 'Today',    icon: LayoutDashboard,
    desc: 'The clock, the queues and what needs you today' },
  { key: 'register',     label: 'Applications',     short: 'Register', icon: Library,
    desc: 'The development register — every application, searchable' },
  { key: 'intake',       label: 'Intake review',    short: 'Intake',   icon: Inbox,
    desc: 'Completeness, land rights and the acknowledgement that starts the three-month clock' },
  { key: 'diligence',    label: 'Due diligence',    short: 'Assess',   icon: FileSearch,
    desc: 'Layout, title, policy and the five tests for conditions' },
  { key: 'notification', label: 'Public notice',    short: 'Notice',   icon: Megaphone,
    desc: 'Section 26(3) advert, abutting owners and objections' },
  { key: 'circulation',  label: 'Circulation',      short: 'Circulate', icon: Send,
    desc: 'Referrals to health, survey, engineering, fire and the rest' },
  { key: 'committee',    label: 'Committee',        short: 'Committee', icon: Users,
    desc: 'Sittings, agendas, quorum and the report to members' },
  { key: 'decision',     label: 'Determination',    short: 'Decide',   icon: Gavel,
    desc: 'Approve, approve with conditions, refuse, return or ask' },
  { key: 'permits',      label: 'Permits',          short: 'Permits',  icon: FileCheck2,
    desc: 'Drafting, the permit register and occupation certificates' },
  { key: 'enforcement',  label: 'Enforcement',      short: 'Enforce',  icon: ShieldAlert,
    desc: 'Stop-work and prohibition orders, and compliance' },
  { key: 'appeals',      label: 'Appeals',          short: 'Appeals',  icon: Scale,
    desc: 'Appeals to the Administrative Court under s.38' },
  { key: 'plans',        label: 'Building plans',   short: 'Plans',    icon: Building,
    desc: 'Site, floor, sections and elevations against the by-laws' },
  { key: 'reports',      label: 'Reports',          short: 'Reports',  icon: BarChart3,
    desc: 'Quarterly returns to province and council statistics' },
  { key: 'matrix',       label: 'Development matrix', short: 'Matrix', icon: Table2,
    desc: 'Permitted, special consent and prohibited uses by zone' },
  { key: 'reference',    label: 'Reference',        short: 'Ref',      icon: BookOpen,
    desc: 'The Act, the local plan, zoning policy and guidance' },
  { key: 'settings',     label: 'Settings',         short: 'Settings', icon: Settings,
    desc: 'How this console behaves on this device' },
]

const GROUP_LABEL: Record<string, string> = {
  casework: 'Casework', records: 'Registers', office: 'Office',
}

// Bottom bar order: the four that move a case day to day, then the rest
// behind More. A fifteen-slot bar would give each item 25px.
const MOBILE_ORDER: SectionKey[] = [
  'dashboard', 'decision', 'register', 'intake',
  'diligence', 'notification', 'circulation', 'committee', 'permits',
  'enforcement', 'appeals', 'plans', 'reports', 'matrix', 'reference', 'settings',
]

const sections = computed<Section[]>(() =>
  SECTIONS.map(s => ({ ...s, badge: workload.badges.value[s.key] || undefined })))

const mobileSections = computed<Section[]>(() =>
  MOBILE_ORDER.map(k => sections.value.find(s => s.key === k)!).filter(Boolean))

const activeSection = nav.section
const activeMeta = computed(() =>
  sections.value.find(s => s.key === activeSection.value) ?? sections.value[0])

const SECTION_COMPONENTS: Record<SectionKey, Component> = {
  dashboard: DashboardSection, register: RegisterSection, intake: IntakeReviewSection,
  diligence: DueDiligenceSection, notification: PublicNotificationSection,
  circulation: TechnicalCirculationSection, committee: CommitteeSection,
  decision: DecisionReviewSection, permits: PermitsSection, enforcement: EnforcementSection,
  appeals: AppealsSection, plans: BuildingPlanAppraisalSection, reports: ReportsSection,
  matrix: DevelopmentMatrixManager, reference: PolicyReferenceSection, settings: SettingsSection,
}

// ── The open case follows the URL ─────────────────────────────────────
// One watcher, here, rather than one per section: useEoCase holds the case in
// module state and every section reads it.
watch(nav.caseId, id => { void eoCase.load(id) }, { immediate: true })

// ── Rail collapse ─────────────────────────────────────────────────────
// A tablet starts collapsed — room for the rail, not for fifteen labels. The
// officer's own choice (the toggle, or Settings) wins once made this session.
const userCollapse = ref<boolean | null>(null)
const railCollapsed = computed(() => userCollapse.value ?? (isTablet.value || prefs.value.railCollapsed))
function toggleRail() { userCollapse.value = !railCollapsed.value }

// ── Workload ──────────────────────────────────────────────────────────
onMounted(() => { void workload.refresh() })
// The queues drift as the office works. Re-read on a section change rather
// than on a timer, which would spend a rural data allowance sitting idle.
watch(activeSection, () => { void workload.refreshIfStale() })

const workloadLabel = computed(() => {
  if (workload.loading.value) return 'Reading queues'
  if (workload.error.value) return 'Queues unavailable'
  const n = workload.badges.value.decision ?? 0
  return n ? `${n} awaiting determination` : 'Nothing awaiting you'
})

// ── Section change: focus + scroll ────────────────────────────────────
const mainEl = ref<HTMLElement | null>(null)
watch(activeSection, async () => {
  await nextTick()
  mainEl.value?.scrollTo({ top: 0 })
  mainEl.value?.focus({ preventScroll: true })
})

// ── Jump palette (Ctrl/⌘ K) ───────────────────────────────────────────
// Fifteen sections and a register that runs to hundreds of files: the fastest
// route to "Stand 4412" is typing it, not scrolling a rail.
const paletteOpen = ref(false)
const paletteQuery = ref('')
const paletteIndex = ref(0)
const paletteInput = ref<HTMLInputElement | null>(null)

interface PaletteItem { id: string; title: string; meta: string; icon: Component; run: () => void }

const paletteItems = computed<PaletteItem[]>(() => {
  const q = paletteQuery.value.trim().toLowerCase()
  const secs: PaletteItem[] = SECTIONS
    .filter(s => !q || s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .map(s => ({
      id: `s:${s.key}`, title: s.label, meta: s.desc, icon: s.icon,
      run: () => nav.go(s.key),
    }))
  if (!q) return secs
  const cases: PaletteItem[] = workload.cases.value
    .filter(c => `${c.dev_register_no ?? ''} ${c.tpd_reference ?? ''} ${c.stand_number} ${c.applicant_name} ${c.suburb_ward ?? ''}`
      .toLowerCase().includes(q))
    .slice(0, 8)
    .map(c => ({
      id: `c:${c.id}`,
      title: c.dev_register_no || c.tpd_reference || `Stand ${c.stand_number}`,
      meta: [c.applicant_name, c.stand_number && `Stand ${c.stand_number}`, statusLabel(c.status)]
        .filter(Boolean).join(' · '),
      icon: FolderOpen,
      // Opening from the palette goes to the case's own section only when the
      // officer is on a whole-council screen; from a casework section it keeps
      // them where they are, with the new file open.
      run: () => {
        if (isCaseSection(activeSection.value)) nav.openCase(c.id)
        else nav.go('decision', { case: c.id })
      },
    }))
  return [...cases, ...secs]
})

watch(paletteQuery, () => { paletteIndex.value = 0 })

function openPalette() {
  paletteQuery.value = ''
  paletteIndex.value = 0
  paletteOpen.value = true
}

// Not `autofocus`: UiSheet moves focus to its own first control on open, which
// would swallow the attribute and leave Ctrl K + typing going nowhere.
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
  <div class="eo-root" :class="{ embedded: props.embedded }">
    <a class="eo-skip" href="#eo-main">Skip to content</a>

    <header class="eo-header">
      <button v-if="!isMobile" class="ins-iconbtn eo-railbtn" type="button"
              :aria-expanded="!railCollapsed" aria-controls="eo-section-rail"
              @click="toggleRail">
        <component :is="railCollapsed ? Menu : X" :size="15" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>

      <div v-if="!props.embedded" class="eo-brand">
        <div class="eo-mark"><Briefcase :size="16" aria-hidden="true" /></div>
        <div class="eo-brand-text">
          <span class="eo-title">Executive Officer — Planning</span>
          <span class="eo-sub">Vungu RDC · RTCP Act [Ch. 29:12]</span>
        </div>
      </div>

      <h1 class="eo-section-title">
        <component :is="activeMeta.icon" :size="15" aria-hidden="true" />
        <span class="eo-section-name">{{ activeMeta.label }}</span>
        <span class="eo-section-sub">{{ activeMeta.desc }}</span>
      </h1>

      <button type="button" class="eo-jump" @click="openPalette">
        <Search :size="14" aria-hidden="true" />
        <span class="eo-jump-label">Jump to…</span>
        <kbd class="eo-kbd" aria-hidden="true">Ctrl K</kbd>
      </button>

      <button type="button" class="eo-work" :class="{ 'is-error': !!workload.error.value }"
              :disabled="workload.loading.value" title="Re-read the queues"
              @click="workload.refresh()">
        <component :is="workload.error.value ? AlertTriangle : Clock" :size="14" aria-hidden="true" />
        <span class="eo-work-label" aria-live="polite">{{ workloadLabel }}</span>
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': workload.loading.value }" />
      </button>

      <ProfileDropdown
        v-if="!props.embedded"
        role-label="E.O. Planning"
        avatar-key="eo_planner_avatar"
        @logout="handleLogout"
      />
    </header>

    <!-- The open case, carried across every section that works on one. -->
    <div v-if="eoCase.permit.value || eoCase.loading.value || eoCase.error.value"
         class="eo-casebar" :class="`clock-${eoCase.clock.value.tone}`">
      <template v-if="eoCase.permit.value">
        <FolderOpen :size="15" aria-hidden="true" class="eo-case-ico" />
        <div class="eo-case-id">
          <span class="eo-case-ref ins-mono">{{ eoCase.reference.value }}</span>
          <span class="eo-case-where">
            Stand {{ eoCase.permit.value.stand_number }}
            <template v-if="eoCase.permit.value.suburb_ward">· {{ eoCase.permit.value.suburb_ward }}</template>
            · {{ eoCase.permit.value.applicant_name }}
          </span>
        </div>
        <span class="eo-case-status">{{ statusLabel(eoCase.permit.value.status) }}</span>
        <span class="eo-case-clock" :class="`t-${eoCase.clock.value.tone}`">
          <Clock :size="12" aria-hidden="true" /> {{ eoCase.clock.value.label }}
        </span>
        <button type="button" class="eo-case-close" @click="eoCase.close()">
          <X :size="14" aria-hidden="true" />
          <span class="ent-sr-only">Close the open case</span>
        </button>
      </template>
      <template v-else-if="eoCase.loading.value">
        <span class="eo-case-msg">Opening the case file…</span>
      </template>
      <template v-else>
        <AlertTriangle :size="15" aria-hidden="true" class="eo-case-ico" />
        <span class="eo-case-msg">{{ eoCase.error.value }}</span>
        <button type="button" class="eo-case-close" @click="eoCase.close()">
          <X :size="14" aria-hidden="true" />
          <span class="ent-sr-only">Dismiss</span>
        </button>
      </template>
    </div>

    <div class="eo-body">
      <nav v-if="!isMobile" id="eo-section-rail" class="eo-nav"
           :class="{ collapsed: railCollapsed }"
           aria-label="EO planner console sections">
        <template v-for="(s, i) in sections" :key="s.key">
          <span v-if="!railCollapsed && (i === 0 || SECTION_GROUP[sections[i - 1].key] !== SECTION_GROUP[s.key])"
                class="eo-nav-group">
            {{ GROUP_LABEL[SECTION_GROUP[s.key]] }}
          </span>
          <hr v-else-if="railCollapsed && i > 0 && SECTION_GROUP[sections[i - 1].key] !== SECTION_GROUP[s.key]"
              class="eo-nav-rule" />
          <button type="button"
                  class="eo-nav-item"
                  :class="{ active: activeSection === s.key }"
                  :aria-current="activeSection === s.key ? 'page' : undefined"
                  :title="railCollapsed ? s.label : undefined"
                  @click="nav.go(s.key)">
            <span class="eo-nav-icon">
              <component :is="s.icon" :size="16" aria-hidden="true" />
              <span v-if="railCollapsed && s.badge" class="eo-nav-dot" aria-hidden="true" />
            </span>
            <span v-if="!railCollapsed" class="eo-nav-label">{{ s.label }}</span>
            <span v-if="!railCollapsed && s.badge" class="eo-nav-badge">{{ s.badge > 99 ? '99+' : s.badge }}</span>
            <span class="ent-sr-only">
              <template v-if="railCollapsed">{{ s.label }}</template>
              <template v-if="s.badge">, {{ s.badge }} waiting</template>
            </span>
          </button>
        </template>
      </nav>

      <main id="eo-main" ref="mainEl" class="eo-content"
            :class="{ 'ent-bottomnav-gap': isMobile }" tabindex="-1">
        <!-- KeepAlive so a half-written committee report survives a trip to the
             Act and back. Sections whose data is judged against the clock use
             useStaleRefresh rather than onMounted, which would otherwise fire
             once for the life of the session. -->
        <KeepAlive>
          <component :is="SECTION_COMPONENTS[activeSection]" :key="activeSection" class="eo-section" />
        </KeepAlive>
      </main>
    </div>

    <UiBottomNav
      v-if="isMobile"
      :items="mobileSections"
      :model-value="activeSection"
      label="EO planner console sections"
      @update:model-value="nav.go($event as SectionKey)"
    />

    <UiSheet :open="paletteOpen" title="Jump to" subtitle="Sections and open cases" width="34rem"
             @close="paletteOpen = false" @update:open="paletteOpen = $event">
      <div class="eo-pal">
        <label class="ins-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Search sections and cases</span>
          <input ref="paletteInput" v-model="paletteQuery" type="search"
                 placeholder="Section, register number, stand or applicant"
                 role="combobox" aria-controls="eo-pal-list" aria-expanded="true"
                 :aria-activedescendant="paletteItems[paletteIndex] ? `eo-pal-${paletteIndex}` : undefined"
                 @keydown="paletteKey" />
        </label>
        <ul id="eo-pal-list" class="eo-pal-list" role="listbox">
          <li v-for="(item, i) in paletteItems" :id="`eo-pal-${i}`" :key="item.id"
              role="option" :aria-selected="i === paletteIndex"
              class="eo-pal-item" :class="{ on: i === paletteIndex }"
              @mouseenter="paletteIndex = i" @click="runPalette(item)">
            <component :is="item.icon" :size="15" aria-hidden="true" />
            <span class="eo-pal-text">
              <strong>{{ item.title }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <CornerDownLeft v-if="i === paletteIndex" :size="13" class="eo-pal-enter" aria-hidden="true" />
          </li>
          <li v-if="!paletteItems.length" class="eo-pal-empty">
            Nothing matches “{{ paletteQuery }}”. Cases are searched by register number,
            stand, applicant and ward — and only those still in progress appear here.
          </li>
        </ul>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
.eo-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }
/* Hosted inside RoleWorkspaceShell the viewport height belongs to the shell;
   claiming the full viewport here would push the pane past the chrome. */
.eo-root.embedded { height:100%; }

.eo-skip { position:absolute; top:8px; left:8px; z-index:80;
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:var(--ent-fw-semibold); text-decoration:none; transform:translateY(-220%); }
.eo-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

/* ── Header ──────────────────────────────────────────────────────── */
.eo-header { display:flex; align-items:center; gap:var(--ent-s3);
  min-height:var(--ent-topbar-h, 52px); padding:var(--ent-s2) var(--ent-s4);
  background:var(--ent-surface); border-bottom:1px solid var(--ent-line); flex-shrink:0; }
.eo-railbtn { width:var(--ent-control-h-sm); height:var(--ent-control-h-sm); }

.eo-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.eo-mark { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.9rem; height:1.9rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.eo-brand-text { min-width:0; }
.eo-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold);
  line-height:1.15; white-space:nowrap; }
.eo-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); white-space:nowrap; }

.eo-section-title { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2);
  margin:0 0 0 var(--ent-s2); padding-left:var(--ent-s4); border-left:1px solid var(--ent-line);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.eo-section-name { flex-shrink:0; }
.eo-section-sub { color:var(--ent-text-3); font-weight:var(--ent-fw-normal); font-size:var(--ent-fs-xs);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.eo-section-sub::before { content:'— '; }

.eo-jump { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2) 0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text-3);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r);
  cursor:pointer; transition:border-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.eo-jump:hover { border-color:var(--ent-line-strong); color:var(--ent-text-2); }
.eo-jump:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.eo-kbd { font-family:var(--ent-font-mono); font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  padding:1px 5px; border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); background:var(--ent-surface); }

.eo-work { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium);
  color:var(--ent-text-2); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-pill); cursor:pointer; white-space:nowrap;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.eo-work:hover { background:var(--ent-surface-2); }
.eo-work:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.eo-work.is-error { color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg);
  border-color:var(--ent-tone-negative-line); }

/* ── Case bar ────────────────────────────────────────────────────── */
.eo-casebar { display:flex; align-items:center; gap:var(--ent-s3); flex-shrink:0;
  padding:var(--ent-s2) var(--ent-s4); background:var(--ent-surface-2);
  border-bottom:1px solid var(--ent-line); font-size:var(--ent-fs-sm);
  animation:eo-casebar-in var(--ent-dur-lg) var(--ent-ease); }
@keyframes eo-casebar-in { from { opacity:0; transform:translateY(-4px); } }
/* A breached clock is the one state that colours the whole bar: it changes
   what the officer may lawfully do with the file, not just how long is left. */
.eo-casebar.clock-expired { background:var(--ent-tone-negative-bg);
  border-bottom-color:var(--ent-tone-negative-line); }
.eo-case-ico { color:var(--ent-text-3); flex-shrink:0; }
.eo-case-id { display:flex; align-items:baseline; gap:var(--ent-s2); min-width:0; flex:1; }
.eo-case-ref { font-weight:var(--ent-fw-semibold); color:var(--ent-text); white-space:nowrap; }
.eo-case-where { color:var(--ent-text-2); font-size:var(--ent-fs-xs);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.eo-case-status { flex-shrink:0; padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-surface); border:1px solid var(--ent-line); color:var(--ent-text-2); }
.eo-case-clock { display:inline-flex; align-items:center; gap:4px; flex-shrink:0;
  padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.eo-case-clock.t-caution { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.eo-case-clock.t-urgent, .eo-case-clock.t-expired {
  background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }
.eo-case-msg { flex:1; color:var(--ent-text-2); }
.eo-case-close { display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h-sm); height:var(--ent-control-h-sm); flex-shrink:0;
  background:none; border:1px solid transparent; border-radius:var(--ent-r-sm);
  color:var(--ent-text-3); cursor:pointer; }
.eo-case-close:hover { background:var(--ent-surface); color:var(--ent-text); }
.eo-case-close:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* ── Rail ────────────────────────────────────────────────────────── */
.eo-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.eo-nav { display:flex; flex-direction:column; gap:2px;
  width:var(--ent-rail-w); padding:var(--ent-s3) var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line); overflow-y:auto; flex-shrink:0; }
.eo-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }

.eo-nav-group { display:block; padding:var(--ent-s3) var(--ent-s3) var(--ent-s1);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.06em;
  text-transform:uppercase; color:var(--ent-text-3); }
.eo-nav-group:first-child { padding-top:0; }
.eo-nav-rule { width:60%; margin:var(--ent-s2) auto; border:0; border-top:1px solid var(--ent-line); }

.eo-nav-item { position:relative; display:flex; align-items:center; gap:var(--ent-s3);
  width:100%; min-height:var(--ent-control-h); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  background:none; border:1px solid transparent; border-radius:var(--ent-r);
  color:var(--ent-text-2); text-align:left; cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.eo-nav.collapsed .eo-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.eo-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.eo-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
/* Tinted, not solid: the accent stays under a tenth of the surface. */
.eo-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); font-weight:var(--ent-fw-semibold); }
.eo-nav-icon { position:relative; display:inline-flex; flex-shrink:0; }
.eo-nav-dot { position:absolute; top:-2px; right:-3px; width:7px; height:7px; border-radius:50%;
  background:var(--ent-danger); box-shadow:0 0 0 2px var(--ent-surface); }
.eo-nav-label { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  animation:eo-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes eo-rail-label { from { opacity:0; transform:translateX(-6px); } }
.eo-nav-badge { flex-shrink:0; min-width:1.35rem; padding:0 6px; text-align:center;
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums;
  line-height:1.35rem; border-radius:var(--ent-r-pill);
  color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }
.eo-nav-item.active .eo-nav-badge { color:var(--ent-accent); background:var(--ent-surface); }

.eo-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; outline:none; }

/* Section arrival: a short rise and fade, on the compositor only. A
   <Transition mode="out-in"> would hold the new section back until the old one
   finished leaving, costing every switch a delay. */
.eo-section { animation:eo-section-in var(--ent-dur-lg) var(--ent-ease) backwards; }
@keyframes eo-section-in { from { opacity:0; transform:translateY(6px); } }

/* ── Jump palette ────────────────────────────────────────────────── */
.eo-pal { display:flex; flex-direction:column; gap:var(--ent-s3); }
.eo-pal-list { list-style:none; margin:0; padding:0; max-height:min(55vh, 26rem); overflow-y:auto; }
.eo-pal-item { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r); cursor:pointer; color:var(--ent-text-2); }
.eo-pal-item.on { background:var(--ent-accent-soft); color:var(--ent-accent); }
.eo-pal-text { flex:1; min-width:0; }
.eo-pal-text strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.eo-pal-text small { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.eo-pal-enter { color:var(--ent-accent); flex-shrink:0; }
.eo-pal-empty { padding:var(--ent-s5) var(--ent-s3); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }

@media (max-width: 1279px) { .eo-section-sub { display:none; } }
@media (max-width: 1023px) { .eo-jump-label, .eo-kbd { display:none; } }
@media (max-width: 767px) {
  .eo-section-title { margin-left:0; padding-left:0; border-left:none; font-size:var(--ent-fs-md); }
  .eo-brand-text, .eo-work-label { display:none; }
  .eo-casebar { flex-wrap:wrap; }
  .eo-case-where { font-size:var(--ent-fs-micro); }
}

@media (prefers-reduced-motion: reduce) {
  .eo-section, .eo-nav-label, .eo-casebar { animation:none; }
}
</style>
