<script setup lang="ts">
// Building Inspector console — every statutory duty of a local-authority
// building inspector under the Model Building By-Laws (1977) and the RTCP Act
// [Ch. 29:12], grouped the way the job is actually done:
//
//   Field work   Today · Bookings · Inspections · Pre-construction · Case file
//   Compliance   Plan examination · Enforcement · Occupation certificates
//   Office       Tasks · Reports · Reference · Settings
//
// RESPONSIVE STRUCTURE
//   ≥1024px  grouped, labelled left rail
//   768–1023 rail collapsed to icons by default
//   ≤767px   no rail; bottom navigation carries Today, Inspect, Bookings and
//            Enforce, with the rest behind More
//
// NAVIGATION
// The active section IS the URL (?section=) — it is derived from the route, not
// mirrored beside it, so the two can never disagree. Switching section pushes a
// history entry, so Back walks back through the sections an inspector visited
// instead of throwing them out of the workspace. The rules live in
// src/inspector/consoleRoute.ts, where they are tested; the host view owns the
// pane and the open case.
//
// Sections are kept alive: switching from Inspections to Reference and back
// does not throw away a half-marked checklist or the register search.
//
// PREFERENCES
// Two of this view's defaults — which section a bare link lands on, and whether
// the rail starts collapsed — are the inspector's to set, from the Settings
// section. They are defaults only: a link that names a section still opens it,
// and collapsing the rail by hand still wins for the session.

import { ref, computed, watch, nextTick, markRaw, type Component } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useOrProvideInspectionCase } from '@/composables/useInspectionCase'
import { useBreakpoint } from '@/composables/useBreakpoint'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'
import InspectionCaseHeader from '@/components/inspector/InspectionCaseHeader.vue'
import InspectorOutbox from '@/components/inspector/InspectorOutbox.vue'
import { readLocation, mergeQuery, navigationMode, type SectionKey } from '@/inspector/consoleRoute'
import { useInspectorPreferences } from '@/composables/useInspectorPreferences'
import { useInspectorWorkload } from '@/composables/useInspectorWorkload'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import './inspector/inspector.css'

import DashboardSection        from './inspector/sections/DashboardSection.vue'
import BookingsSection         from './inspector/sections/BookingsSection.vue'
import StageInspectionsSection from './inspector/sections/StageInspectionsSection.vue'
import PreConstructionSection  from './inspector/sections/PreConstructionSection.vue'
import CaseFileSection         from './inspector/sections/CaseFileSection.vue'
import PlanExaminationSection  from './inspector/sections/PlanExaminationSection.vue'
import EnforcementSection      from './inspector/sections/EnforcementSection.vue'
import ComplaintsSection       from './inspector/sections/ComplaintsSection.vue'
import CertificatesSection     from './inspector/sections/CertificatesSection.vue'
import ReferralsSection        from './inspector/sections/ReferralsSection.vue'
import ReportsSection          from './inspector/sections/ReportsSection.vue'
import ReferenceSection        from './inspector/sections/ReferenceSection.vue'
import SettingsSection         from './inspector/sections/SettingsSection.vue'

import {
  HardHat, LayoutDashboard, ClipboardCheck, Building, CalendarClock, FolderOpen,
  ShieldAlert, BadgeCheck, BarChart3, BookOpen, Menu, PanelLeftClose, Send, Ruler, Settings,
  Megaphone,
} from 'lucide-vue-next'

// `embedded` suppresses this view's own brand block and profile menu when it
// is hosted as the console pane of RoleWorkspaceShell, which supplies both.
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const ic = useOrProvideInspectionCase()

const { isMobile, isTablet } = useBreakpoint()
const { prefs } = useInspectorPreferences()

type Group = 'Field work' | 'Compliance' | 'Office'

interface Section extends BottomNavItem {
  key: SectionKey
  desc: string
  group: Group
  component: Component
  /** Shows the shared case band above the section. */
  caseBound: boolean
}

// Order matters twice: it is the rail order within a group, and the first four
// fill the phone's bottom bar. Site work first — that is where the phone is.
const sections: readonly Section[] = [
  { key: 'dashboard',       label: 'Today',                   short: 'Today',    icon: LayoutDashboard, group: 'Field work',
    desc: 'Your inspection queue',                              component: markRaw(DashboardSection),        caseBound: false },
  { key: 'stages',          label: 'Inspections',             short: 'Inspect',  icon: Building,        group: 'Field work',
    desc: 'Stage checklist, evidence and result',               component: markRaw(StageInspectionsSection), caseBound: true },
  { key: 'bookings',        label: 'Bookings',                short: 'Bookings', icon: CalendarClock,   group: 'Field work',
    desc: 'Owner requests for stage inspections',               component: markRaw(BookingsSection),         caseBound: false },
  { key: 'enforcement',     label: 'Enforcement',             short: 'Enforce',  icon: ShieldAlert,     group: 'Compliance',
    desc: 'Orders, compliance visits, escalation',              component: markRaw(EnforcementSection),      caseBound: false },
  // Not case-bound, and that is the point: a report arrives before there is a
  // case, often before there is a stand number. It is the only way work that
  // did not start with an application gets onto the register at all.
  { key: 'complaints',      label: 'Public reports',          short: 'Public',   icon: Megaphone,       group: 'Compliance',
    desc: 'Unauthorised or dangerous building work',            component: markRaw(ComplaintsSection),       caseBound: false },
  { key: 'preconstruction', label: 'Pre-construction',        short: 'Pre-con',  icon: ClipboardCheck,  group: 'Field work',
    desc: 'Plan, permit validity, pegs, building lines',        component: markRaw(PreConstructionSection),  caseBound: true },
  { key: 'casefile',        label: 'Case file',               short: 'File',     icon: FolderOpen,      group: 'Field work',
    desc: 'The full building file for the open permit',         component: markRaw(CaseFileSection),         caseBound: true },
  { key: 'plans',           label: 'Plan examination',        short: 'Plans',    icon: Ruler,           group: 'Compliance',
    desc: 'Annexure 11 building plan appraisal',                component: markRaw(PlanExaminationSection),  caseBound: false },
  { key: 'certificates',    label: 'Occupation certificates', short: 'Certs',    icon: BadgeCheck,      group: 'Compliance',
    desc: 'Annexure 13 issue and register',                     component: markRaw(CertificatesSection),     caseBound: true },
  { key: 'referrals',       label: 'Tasks and referrals',     short: 'Tasks',    icon: Send,            group: 'Office',
    desc: 'Inbound circulation, outbound field referrals',      component: markRaw(ReferralsSection),        caseBound: true },
  { key: 'reports',         label: 'Reports',                 short: 'Reports',  icon: BarChart3,       group: 'Office',
    desc: 'Periodic returns to Council',                        component: markRaw(ReportsSection),          caseBound: false },
  { key: 'reference',       label: 'Reference',               short: 'Ref',      icon: BookOpen,        group: 'Office',
    desc: 'By-Laws, Annexures, minimum standards',              component: markRaw(ReferenceSection),        caseBound: false },
  { key: 'settings',        label: 'Settings',                short: 'Settings', icon: Settings,        group: 'Office',
    desc: 'Appointment, field work and this device',            component: markRaw(SettingsSection),         caseBound: false },
]
const GROUPS: readonly Group[] = ['Field work', 'Compliance', 'Office']
const byGroup = computed(() => GROUPS.map(g => ({ group: g, items: sections.filter(s => s.group === g) })))

const location = computed(() => readLocation({
  query: route.query,
  params: route.params,
  isMobile: isMobile.value,
  defaultSection: prefs.value.landingSection,
}))

/**
 * Everything the URL rules need besides the location itself. Kept in one place
 * because read and write must be given the SAME context: hand readLocation a
 * landing preference and mergeQuery none, and the console starts writing
 * ?section= links that contradict where a bare link lands.
 */
const routeContext = computed(() => ({
  isMobile: isMobile.value,
  inspectionId: location.value.inspectionId,
  defaultSection: prefs.value.landingSection,
}))

/** One source of truth: what the URL says is what renders. */
const activeSection = computed<SectionKey>(() => location.value.section)

/**
 * The route a rail item points at. Each section is a real destination with a
 * real URL, so an inspector can middle-click Reports into a second tab, or copy
 * the link to a colleague, the way every other link on the web behaves.
 */
function sectionTo(key: SectionKey) {
  return { query: mergeQuery(route.query, { ...location.value, section: key }, routeContext.value) }
}

function go(key: SectionKey) {
  const next = { ...location.value, section: key }
  const mode = navigationMode(location.value, next)
  if (mode === 'none') return
  const to = { query: mergeQuery(route.query, next, routeContext.value) }
  void (mode === 'push' ? router.push(to) : router.replace(to)).catch(() => undefined)
}

/**
 * Send the reader to the top of the new section and move focus into it, so a
 * keyboard or screen-reader user lands in the content they just chose rather
 * than continuing from wherever they were in the rail.
 */
watch(activeSection, async () => {
  await nextTick()
  const main = document.getElementById('iw-main')
  main?.scrollTo({ top: 0 })
  main?.focus({ preventScroll: true })
})

// A tablet starts collapsed — room for the rail, not for the labels. The
// inspector can override, and that choice then wins for the session.
const sidebarCollapsed = ref(false)
const userSetCollapse = ref(false)
const railCollapsed = computed(() =>
  userSetCollapse.value ? sidebarCollapsed.value : (prefs.value.railCollapsed || isTablet.value),
)
function toggleRail() {
  const next = !railCollapsed.value
  userSetCollapse.value = true
  sidebarCollapsed.value = next
}

const activeMeta = computed(() => sections.find(s => s.key === activeSection.value)!)

/**
 * Outstanding work per section, so the rail answers "where is my day" without
 * the inspector opening four sections to find out. Re-read on return to the
 * app, like the sections themselves — a badge that is four hours stale is worse
 * than no badge, because it is believed.
 */
const { workload, refreshWorkload } = useInspectorWorkload()
useStaleRefresh(refreshWorkload)

/** Items for the phone's bottom bar, carrying the same counts as the rail. */
const bottomNavItems = computed(() =>
  sections.map(s => ({ ...s, badge: workload.value[s.key]?.count })))

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="iw-root" :class="{ embedded: props.embedded }">
    <a class="iw-skip" href="#iw-main">Skip to content</a>
    <header class="iw-header">
      <button v-if="!isMobile" class="iw-icon-btn" type="button"
              :aria-expanded="!railCollapsed" aria-controls="iw-section-rail"
              @click="toggleRail">
        <component :is="railCollapsed ? Menu : PanelLeftClose" :size="16" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>

      <div v-if="!props.embedded" class="iw-brand">
        <div class="iw-icon"><HardHat :size="16" aria-hidden="true" /></div>
        <div class="iw-brand-text">
          <span class="iw-title">Building Inspector</span>
          <span class="iw-sub">Vungu RDC · Model Building By-Laws (1977)</span>
        </div>
      </div>

      <!-- On mobile this is the sole wayfinding: the rail is gone, so the
           section name is promoted rather than hidden. -->
      <div class="iw-section-title">
        <component :is="activeMeta.icon" :size="15" aria-hidden="true" />
        <span class="iw-section-name">{{ activeMeta.label }}</span>
        <span class="iw-section-sub">{{ activeMeta.desc }}</span>
      </div>

      <InspectorOutbox />

      <!-- Settings is a rail section like any other, but the rail is where an
           inspector looks for WORK, not for their own configuration — and on a
           phone there is no rail at all, only a More sheet. A real link (not a
           button) so it can be opened in a second tab like every other section. -->
      <RouterLink class="iw-icon-btn" :to="sectionTo('settings')"
                  :class="{ active: activeSection === 'settings' }"
                  :aria-current="activeSection === 'settings' ? 'page' : undefined"
                  title="Settings">
        <Settings :size="16" aria-hidden="true" />
        <span class="ent-sr-only">Settings</span>
      </RouterLink>

      <ProfileDropdown
        v-if="!props.embedded"
        role-label="Building Inspector"
        avatar-key="building_inspector_avatar"
        @logout="handleLogout"
      />
    </header>

    <div class="iw-body">
      <nav v-if="!isMobile" id="iw-section-rail" class="iw-nav"
           :class="{ collapsed: railCollapsed }"
           aria-label="Building inspector console sections">
        <div v-for="g in byGroup" :key="g.group" class="iw-group">
          <span v-if="!railCollapsed" class="iw-group-label">{{ g.group }}</span>
          <span v-else class="iw-group-rule" aria-hidden="true" />
          <RouterLink v-for="s in g.items" :key="s.key"
                      class="iw-nav-item"
                      :class="{ active: activeSection === s.key }"
                      :to="sectionTo(s.key)"
                      :aria-current="activeSection === s.key ? 'page' : undefined"
                      :title="railCollapsed ? s.label : undefined">
            <component :is="s.icon" :size="16" aria-hidden="true" />
            <span v-if="!railCollapsed" class="iw-nav-label">{{ s.label }}</span>
            <span v-else class="ent-sr-only">{{ s.label }}</span>
            <!-- The count is part of the link's accessible name, not a bare
                 number floating beside it: "Enforcement, 3 needing attention". -->
            <span v-if="workload[s.key]" class="iw-badge" :class="`t-${workload[s.key]!.tone}`">
              <span aria-hidden="true">{{ workload[s.key]!.count }}</span>
              <span class="ent-sr-only">, {{ workload[s.key]!.count }} needing attention</span>
            </span>
          </RouterLink>
        </div>
      </nav>

      <main id="iw-main" class="iw-content" :class="{ 'ent-bottomnav-gap': isMobile }" tabindex="-1">
        <!-- One case-context band above every case-bound section: the inspector
             never loses track of which case they are acting on. With no case
             open it is omitted — each section already says what to open, and two
             stacked empty states read as an error. -->
        <InspectionCaseHeader v-if="activeMeta.caseBound && ic.current.value" />

        <Transition name="iw-swap" mode="out-in">
          <KeepAlive :max="6">
            <component :is="activeMeta.component" :key="activeSection"
                       @open-section="(k: SectionKey) => go(k)" />
          </KeepAlive>
        </Transition>
      </main>
    </div>

    <UiBottomNav
      v-if="isMobile"
      :items="bottomNavItems"
      :model-value="activeSection"
      label="Building inspector console sections"
      @update:model-value="go($event as SectionKey)"
    />
  </div>
</template>

<style scoped>
.iw-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }
.iw-root.embedded { height:100%; }

.iw-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:var(--ent-fw-semibold); text-decoration:none; transform:translateY(-220%);
}
.iw-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

.iw-root :deep(input:focus-visible),
.iw-root :deep(textarea:focus-visible),
.iw-root :deep(select:focus-visible),
.iw-root :deep(button:focus-visible) {
  outline:2px solid var(--ent-accent);
  outline-offset:2px;
}

.iw-header { display:flex; align-items:center; gap:var(--ent-s3);
  min-height:var(--ent-topbar-h); padding:var(--ent-s2) var(--ent-s4); background:var(--ent-surface);
  border-bottom:1px solid var(--ent-line); flex-shrink:0; }

.iw-icon-btn { display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h); height:var(--ent-control-h); flex-shrink:0;
  border:1px solid transparent; border-radius:var(--ent-r);
  background:transparent; color:var(--ent-text-2); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.iw-icon-btn:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.iw-icon-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
a.iw-icon-btn { text-decoration:none; }
a.iw-icon-btn.active { background:var(--ent-accent-soft); color:var(--ent-accent); }

.iw-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.iw-icon { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.85rem; height:1.85rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.iw-brand-text { min-width:0; }
.iw-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold);
  line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.iw-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.iw-section-title { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.iw-section-title > svg { color:var(--ent-accent); flex-shrink:0; }
.iw-section-name { flex-shrink:0; }
.iw-section-sub { color:var(--ent-text-3); font-weight:var(--ent-fw-normal);
  font-size:var(--ent-fs-sm); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.iw-section-sub::before { content:'·'; margin-right:var(--ent-s2); }

.iw-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.iw-nav { display:flex; flex-direction:column; gap:var(--ent-s3);
  width:var(--ent-rail-w); padding:var(--ent-s3) var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line);
  overflow-y:auto; flex-shrink:0; }
.iw-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }
/* flex-shrink:0 is load-bearing. The rail is a scrolling flex column, so once
   the sections outgrow a short viewport the default shrink compresses each
   GROUP below its own content — the items keep their min-height, so the
   overflow escapes the group box and the next group's label is drawn on top of
   the previous group's last item. The rail is meant to scroll, not to squash. */
.iw-group { display:flex; flex-direction:column; gap:2px; width:100%; flex-shrink:0; }
.iw-nav.collapsed .iw-group { align-items:center; }
.iw-group-label { padding:0 var(--ent-s3) var(--ent-s1); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); letter-spacing:0.06em; text-transform:uppercase; color:var(--ent-text-3); }
.iw-group-rule { display:block; width:20px; height:1px; margin:var(--ent-s1) 0; background:var(--ent-line); }
.iw-group:first-child .iw-group-rule { display:none; }

.iw-nav-item { position:relative; display:inline-flex; align-items:center; gap:var(--ent-s3); text-decoration:none;
  width:100%; min-height:var(--ent-control-h); padding:var(--ent-s2) var(--ent-s3);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-medium);
  background:none; border:0; border-radius:var(--ent-r);
  color:var(--ent-text-2); text-align:left; cursor:pointer; font-family:var(--ent-font);
  transition:background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease); }
.iw-nav.collapsed .iw-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.iw-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.iw-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.iw-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent); font-weight:var(--ent-fw-semibold); }
.iw-nav-item.active::before { content:''; position:absolute; left:calc(-1 * var(--ent-s2)); top:8px; bottom:8px;
  width:3px; border-radius:0 3px 3px 0; background:var(--ent-accent); }
.iw-nav.collapsed .iw-nav-item.active::before { display:none; }
.iw-nav-label { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Workload count. Tone carries the urgency so the number does not have to be
   read to be understood — danger is past its date, warn is owed an answer,
   info is simply today's list. */
.iw-badge { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  min-width:18px; height:18px; padding:0 5px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; line-height:1; }
.iw-badge.t-danger { background:var(--ent-danger);  color:var(--ent-text-on-accent); }
.iw-badge.t-warn   { background:var(--ent-warning); color:var(--ent-text-on-accent); }
.iw-badge.t-info   { background:var(--ent-accent-soft); color:var(--ent-accent); }
/* Collapsed to icons there is no room for a number, so it becomes a dot in the
   corner — still says "there is work here", without overlapping the glyph. */
.iw-nav.collapsed .iw-badge { position:absolute; top:3px; right:3px;
  min-width:8px; width:8px; height:8px; padding:0; }
.iw-nav.collapsed .iw-badge > span[aria-hidden] { display:none; }

/* RAIL COLLAPSE — why the width does not animate.
   Animating width made every frame of the collapse relayout the whole
   workspace: the rail, the content pane and everything in it. It also animated
   a box whose contents had already gone, because the labels are mounted and
   unmounted rather than faded. So the width now changes in one step and the
   motion rides on the labels instead, in transform and opacity only, which the
   compositor handles without touching layout.
   Supersedes docs/adr/0009-workspace-rail-collapse-width-transition.md, which
   kept the transition to avoid an unreviewed cross-role change — the six role
   rails are changed together here, which is what that ADR was asking for. */
.iw-nav-label { animation:iw-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes iw-rail-label { from { opacity:0; transform:translateX(-6px); } }


.iw-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; scroll-behavior:smooth; }

.iw-swap-enter-active, .iw-swap-leave-active { transition:opacity var(--ent-dur) var(--ent-ease), transform var(--ent-dur) var(--ent-ease); }
.iw-swap-enter-from { opacity:0; transform:translateY(6px); }
.iw-swap-leave-to { opacity:0; }

@media (prefers-reduced-motion: reduce) {
  .iw-nav, .iw-nav-item { transition:none; }
  .iw-nav-label { animation:none; }
  .iw-swap-enter-active, .iw-swap-leave-active { transition:none; }
  .iw-content { scroll-behavior:auto; }
}

@media (max-width: 1023px) {
  .iw-section-sub { display:none; }
}
@media (max-width: 767px) {
  .iw-header { padding:var(--ent-s2) var(--ent-s3); }
  .iw-section-title { font-size:var(--ent-fs-md); }
  .iw-brand-text { display:none; }
}
</style>
