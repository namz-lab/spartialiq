<script setup lang="ts">
// Town Planning Officer workspace — full console covering every statutory
// duty of a Planner in a Zimbabwean local authority under the RTCP Act
// [Ch. 29:12]. Each section is a self-contained component under
// src/views/planner/sections/.
//
// RESPONSIVE STRUCTURE (Phase 5 / Phase 6)
//   ≥1024px  labelled left rail, collapsible to icons — the planner is at a
//            workstation and wants every section one click away
//   768–1023 the rail collapses to icons by default: a tablet has the height
//            for a rail but not the width to spend 240px on labels
//   ≤767px   no rail. A bottom navigation bar carries the four most-used
//            sections; a More sheet carries the rest.
//
// The three presentations share one `sections` array, one active-section ref
// (owned by the shell, via usePlannerShell) and one `goSection` handler.
// Nothing about the statutory workflow branches on viewport.
//
// WHAT CHANGED AND WHY
// The rail used to shrink to 11rem below 900px — 176px of a 375px screen,
// leaving 199px of workspace — and the header hid the section title at the
// same breakpoint, deleting the only thing telling an officer which section
// was open. On mobile the title is now the most prominent element in the
// header, because with the rail gone it is the sole wayfinding.
import { computed, ref } from 'vue'
import { useOrProvidePlannerCase } from '@/composables/usePlannerCase'
import { usePlannerShell, type SectionKey } from '@/composables/usePlannerShell'
import { useBreakpoint } from '@/composables/useBreakpoint'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'
import DashboardSection         from './planner/sections/DashboardSection.vue'
import StatutoryWorkflowSection from './planner/sections/StatutoryWorkflowSection.vue'
import PermitRegisterSection    from './planner/sections/PermitRegisterSection.vue'
import PropertySection          from './planner/sections/PropertySection.vue'
import PermitQueueSection       from './planner/sections/PermitQueueSection.vue'
import InspectionsSection       from './planner/sections/InspectionsSection.vue'
import CommitteeSection         from './planner/sections/CommitteeSection.vue'
import EnforcementSection       from './planner/sections/EnforcementSection.vue'
import BuildingPlansSection     from './planner/sections/BuildingPlansSection.vue'
import ReportsSection           from './planner/sections/ReportsSection.vue'
import ReferenceSection         from './planner/sections/ReferenceSection.vue'
import AppealsSection           from './planner/sections/AppealsSection.vue'
import ForwardPlanningSection   from './planner/sections/ForwardPlanningSection.vue'
import LayoutsSection           from './planner/sections/LayoutsSection.vue'
import DevelopmentMatrixManager from '@/components/admin/land-use/DevelopmentMatrixManager.vue'
import {
  LayoutDashboard, Gavel, FileText, Landmark, Send, Megaphone, ClipboardCheck,
  Users, ShieldAlert, Building, BarChart3, BookOpen, Menu, X, Scale, Compass, Grid3x3, Table2,
} from 'lucide-vue-next'

// `showNav` lets the host hide this view's internal section rail. When
// embedded in <PlannerShell>, the shell provides a single persistent left
// nav, so we suppress the duplicate rail here.
const props = withDefaults(defineProps<{ showNav?: boolean }>(), { showNav: true })

// Workspace-wide planner case context. Every section that consumes
// usePlannerCase() (PermitRegister, Statutory shell descendants, etc.)
// shares this single instance (or inherits from the shell if already provided).
useOrProvidePlannerCase()

const shell = usePlannerShell()
const activeSection = shell.activeConsoleSection           // readonly computed from the shell
function goSection(key: SectionKey) { shell.showConsole(key) }

const { isMobile, isTablet } = useBreakpoint()

// Order matters: the first four become the bottom navigation's primary slots
// on mobile. Daily tools stay on the bar; Property, referrals, inspections
// and the rest sit behind More.
const sections: readonly (BottomNavItem & { key: SectionKey; desc: string })[] = [
  { key:'dashboard',      label:'My Work',              short:'Work',     icon: LayoutDashboard,
    desc:'What to do today' },
  { key:'workflow',       label:'Statutory Workflow',   short:'Workflow', icon: Gavel,
    desc:'Section 26 intake → permit issue' },
  { key:'register',       label:'Permit Register',      short:'Register', icon: FileText,
    desc:'All applications & permits' },
  { key:'enforcement',    label:'Enforcement',          short:'Enforce',  icon: ShieldAlert,
    desc:'Contraventions, orders, compliance' },
  { key:'property',       label:'Property',             short:'Property', icon: Landmark,
    desc:'Stand search and applications on the parcel' },
  { key:'referrals',      label:'Referrals',            short:'Referrals',icon: Send,
    desc:'Technical circulation queue' },
  { key:'participation',  label:'Public participation', short:'Public',   icon: Megaphone,
    desc:'Objection-period cases' },
  { key:'inspections',    label:'Inspections',          short:'Inspect',  icon: ClipboardCheck,
    desc:'Stage inspections on approved permits' },
  { key:'committee',      label:'Committee',            short:'Committee',icon: Users,
    desc:'Meetings and agenda' },
  { key:'appeals',        label:'Appeals',              short:'Appeals',  icon: Scale,
    desc:'Case records for the Administrative Court' },
  { key:'plans',          label:'Building Plans',       short:'Plans',    icon: Building,
    desc:'Plans queue & appraisal' },
  { key:'forward',        label:'Forward planning',     short:'Forward',  icon: Compass,
    desc:'Planning area study, master and local plans' },
  { key:'layouts',        label:'Layouts',              short:'Layouts',  icon: Grid3x3,
    desc:'Layout plans, land budgets, stand schedules' },
  { key:'matrix',         label:'Development matrix',   short:'Matrix',   icon: Table2,
    desc:'Permitted, special consent and prohibited uses by zone' },
  { key:'reports',        label:'Reports & Returns',    short:'Reports',  icon: BarChart3,
    desc:'Monthly, quarterly and annual returns' },
  { key:'reference',      label:'Reference',            short:'Ref',      icon: BookOpen,
    desc:'Legislation, land use, fees, wards' },
]

// The desktop rail groups the sections by the kind of work, so sixteen flat
// items read as five short lists. The mobile bottom nav keeps the flat order.
const RAIL_GROUPS: { title: string; keys: SectionKey[] }[] = [
  { title: 'Casework', keys: ['dashboard', 'workflow', 'referrals', 'participation', 'committee'] },
  { title: 'Registers', keys: ['register', 'property', 'plans', 'inspections'] },
  { title: 'Control', keys: ['enforcement', 'appeals'] },
  { title: 'Plan-making', keys: ['forward', 'layouts', 'matrix'] },
  { title: 'Office', keys: ['reports', 'reference'] },
]
const railGroups = computed(() => RAIL_GROUPS.map(g => ({
  title: g.title,
  items: g.keys.map(k => sections.find(s => s.key === k)!).filter(Boolean),
})))

// A tablet starts collapsed: it has room for the rail, not for the labels.
// The planner can still expand it, and that choice then wins for the session.
const sidebarCollapsed = ref(false)
const userSetCollapse = ref(false)
const railCollapsed = computed(() =>
  userSetCollapse.value ? sidebarCollapsed.value : isTablet.value,
)
function toggleRail() {
  const next = !railCollapsed.value
  userSetCollapse.value = true
  sidebarCollapsed.value = next
}

const activeMeta = computed(() => sections.find(s => s.key === activeSection.value)!)

/** The bottom bar is this view's navigation only when it owns the navigation:
 *  embedded with `showNav: false`, the host is already providing it. */
const showBottomNav = computed(() => props.showNav && isMobile.value)
</script>

<template>
  <div class="pw-root">
    <header class="pw-header" :class="{ 'no-nav': !props.showNav }">
      <button
        v-if="props.showNav && !isMobile"
        class="pw-icon-btn"
        type="button"
        :aria-expanded="!railCollapsed"
        aria-controls="pw-section-rail"
        @click="toggleRail"
      >
        <component :is="railCollapsed ? Menu : X" :size="14" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>

      <!--
        Wayfinding. On desktop this echoes the rail's highlighted item; on
        mobile it is the only indication of which section is open, so it is
        promoted and the description drops instead.
      -->
      <h1 class="pw-section-title">
        <component :is="activeMeta.icon" :size="13" aria-hidden="true" />
        <span class="pw-section-name">{{ activeMeta.label }}</span>
        <span class="pw-section-sub">{{ activeMeta.desc }}</span>
      </h1>
    </header>

    <div class="pw-body">
      <nav
        v-if="props.showNav && !isMobile"
        id="pw-section-rail"
        class="pw-nav"
        :class="{ collapsed: railCollapsed }"
        aria-label="Planner console sections"
      >
        <template v-for="g in railGroups" :key="g.title">
          <span v-if="!railCollapsed" class="pw-nav-group" aria-hidden="true">{{ g.title }}</span>
          <hr v-else class="pw-nav-sep" aria-hidden="true" />
          <button v-for="s in g.items" :key="s.key"
                  type="button"
                  class="pw-nav-item"
                  :class="{ active: activeSection === s.key }"
                  :aria-current="activeSection === s.key ? 'page' : undefined"
                  :title="railCollapsed ? s.label : undefined"
                  @click="goSection(s.key)">
            <component :is="s.icon" :size="14" aria-hidden="true" />
            <span v-if="!railCollapsed" class="pw-nav-label">{{ s.label }}</span>
            <span v-else class="ent-sr-only">{{ s.label }}</span>
          </button>
        </template>
      </nav>

      <main class="pw-content" :class="{ 'ent-bottomnav-gap': showBottomNav }">
        <DashboardSection         v-if="activeSection === 'dashboard'"
                                   @open-section="goSection"
                                   @open-case="shell.openCaseForStand" />
        <StatutoryWorkflowSection v-else-if="activeSection === 'workflow'" />
        <PermitRegisterSection    v-else-if="activeSection === 'register'"
                                   @open-permit="goSection('workflow')" />
        <PropertySection          v-else-if="activeSection === 'property'" />
        <PermitQueueSection       v-else-if="activeSection === 'referrals'"
                                   title="Referrals"
                                   subtitle="Applications in technical circulation"
                                   empty="No files in technical circulation. Circulate a case from the statutory workflow."
                                   :statuses="['circulation']"
                                   case-tab="referrals" />
        <PermitQueueSection       v-else-if="activeSection === 'participation'"
                                   title="Public participation"
                                   subtitle="Cases in the objection period"
                                   empty="No cases in the objection period. Issue a public notice from the statutory workflow."
                                   :statuses="['objection_period']"
                                   case-tab="objections" />
        <InspectionsSection       v-else-if="activeSection === 'inspections'" />
        <CommitteeSection         v-else-if="activeSection === 'committee'" />
        <AppealsSection           v-else-if="activeSection === 'appeals'" />
        <EnforcementSection       v-else-if="activeSection === 'enforcement'" />
        <BuildingPlansSection     v-else-if="activeSection === 'plans'" />
        <ForwardPlanningSection   v-else-if="activeSection === 'forward'" />
        <LayoutsSection           v-else-if="activeSection === 'layouts'" />
        <DevelopmentMatrixManager v-else-if="activeSection === 'matrix'" />
        <ReportsSection           v-else-if="activeSection === 'reports'" />
        <ReferenceSection         v-else-if="activeSection === 'reference'" />
      </main>
    </div>

    <!-- Same sections, same handler, different affordance. -->
    <UiBottomNav
      v-if="showBottomNav"
      :items="[...sections]"
      :model-value="activeSection"
      label="Planner console sections"
      @update:model-value="goSection($event as SectionKey)"
    />
  </div>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css + src/styles/responsive.css.
   Breakpoints: 768 (mobile→tablet) and 1024 (tablet→desktop) only. */

.pw-root { display:flex; flex-direction:column; height:100%;
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }

.pw-header { display:flex; align-items:center; gap:var(--ent-s2);
  padding:0 var(--ent-s4); min-height:44px; background:var(--ent-surface);
  border-bottom:1px solid var(--ent-line); box-shadow:var(--ent-e1); flex-shrink:0; }

.pw-icon-btn { display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h-sm); height:var(--ent-control-h-sm);
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  background:var(--ent-surface); color:var(--ent-text-2); cursor:pointer; flex-shrink:0; }
.pw-icon-btn:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.pw-icon-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.pw-section-title { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2);
  margin:0 0 0 var(--ent-s5); padding-left:var(--ent-s4); border-left:1px solid var(--ent-line);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.pw-header.no-nav .pw-section-title { margin-left:0; padding-left:0; border-left:none; }
.pw-section-name { flex-shrink:0; }
.pw-section-sub { color:var(--ent-text-3); font-weight:var(--ent-fw-normal);
  font-size:var(--ent-fs-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-section-sub::before { content:'— '; }

.pw-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.pw-nav { display:flex; flex-direction:column; gap:2px;
  width:var(--ent-rail-w); padding:var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line);
  overflow-y:auto; -webkit-overflow-scrolling:touch; flex-shrink:0;
  }
.pw-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }
.pw-nav-group { padding:var(--ent-s3) var(--ent-s3) var(--ent-s1); font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.06em; text-transform:uppercase; color:var(--ent-text-3); }
.pw-nav-group:first-child { padding-top:var(--ent-s1); }
.pw-nav-sep { width:60%; margin:var(--ent-s2) auto; border:0; border-top:1px solid var(--ent-line); }
.pw-nav-sep:first-child { display:none; }

.pw-nav-item { position:relative; display:inline-flex; align-items:center; gap:var(--ent-s2);
  width:100%; min-height:var(--ent-control-h); padding:var(--ent-s2) var(--ent-s3);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  background:none; border:1px solid transparent; border-radius:var(--ent-r-sm);
  color:var(--ent-text-2); text-align:left; cursor:pointer; font-family:var(--ent-font); }
.pw-nav.collapsed .pw-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.pw-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.pw-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* Active state: tinted fill, full hairline border, heavier label. The former
   3px inset left stripe is gone — a coloured side-stripe is decoration
   pretending to be structure, and it broke the collapsed rail, where a
   centred icon sat beside a stripe attached to nothing. */
.pw-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); font-weight:var(--ent-fw-semibold); }

.pw-nav-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

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
.pw-nav-label { animation:pw-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes pw-rail-label { from { opacity:0; transform:translateX(-6px); } }


.pw-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; }

/* ── Tablet: 768–1023 ───────────────────────────────────────────────────
   The rail stays but starts collapsed (decided in script, so the officer can
   override). The section description goes: the header has to share its width
   with the rail toggle and the title. */
@media (max-width: 1023px) {
  .pw-section-sub { display:none; }
}

/* ── Mobile: ≤767 ───────────────────────────────────────────────────────
   No rail. The header carries the section name at full prominence; the
   bottom bar shows where you are and where else you can go. */
@media (max-width: 767px) {
  .pw-section-title { margin-left:0; padding-left:0; border-left:none;
    font-size:var(--ent-fs-md); }
  .pw-section-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
}

@media (prefers-reduced-motion: reduce) {
  .pw-root, .pw-root :deep(*) { transition-duration:0ms !important; animation-duration:0ms !important; }
}
</style>
