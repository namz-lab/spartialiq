<script setup lang="ts">
// GIS Officer Portal — full 10-section console covering every duty in
// the GIS/ICT unit of the Planning Department: spatial database
// maintenance, application mapping, abutting-owner extraction, zoning
// maps, environmental constraints, enforcement mapping, forward
// planning maps, the public GIS portal, and data quality assurance.

import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { provideGISOfficerWorkspace } from '@/composables/useGISOfficerWorkspace'
import { useBreakpoint } from '@/composables/useBreakpoint'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiBottomNav, { type BottomNavItem } from '@/components/ui/UiBottomNav.vue'

import DashboardSection                from './gis-officer/sections/DashboardSection.vue'
import SpatialDatabaseSection          from './gis-officer/sections/SpatialDatabaseSection.vue'
import ApplicationMappingSection       from './gis-officer/sections/ApplicationMappingSection.vue'
import AbuttingOwnersSection           from './gis-officer/sections/AbuttingOwnersSection.vue'
import ZoningMapsSection               from './gis-officer/sections/ZoningMapsSection.vue'
import EnvironmentalConstraintsSection from './gis-officer/sections/EnvironmentalConstraintsSection.vue'
import EnforcementMappingSection       from './gis-officer/sections/EnforcementMappingSection.vue'
import ForwardPlanningMapsSection      from './gis-officer/sections/ForwardPlanningMapsSection.vue'
import PublicGISPortalSection          from './gis-officer/sections/PublicGISPortalSection.vue'
import DataQualitySection              from './gis-officer/sections/DataQualitySection.vue'
import StandsEditorSection             from './gis-officer/sections/StandsEditorSection.vue'
import ReferralsSection                from './gis-officer/sections/ReferralsSection.vue'
import RoadsWorksSection               from './gis-officer/sections/RoadsWorksSection.vue'
import WashAssetsSection               from './gis-officer/sections/WashAssetsSection.vue'
import LivestockSection                from './gis-officer/sections/LivestockSection.vue'
import MasterThemesSection             from './gis-officer/sections/MasterThemesSection.vue'
import OpsImportSection                from './gis-officer/sections/OpsImportSection.vue'
// The GIS Branch's register sections (GMS, migration 132): the parcel register and profile, the survey import, and the integration console
// (the ERP outbox, the SurveyPro importer). Each has its own address (/gis/parcels, /gis/data/import, /gis/integration) that opens it here.
import ParcelRegisterSection           from './gis-officer/sections/ParcelRegisterSection.vue'
import SurveyImportSection             from './gis-officer/sections/SurveyImportSection.vue'
import IntegrationSection              from './gis-officer/sections/IntegrationSection.vue'
import { GMS_CAN } from '@/services/gms'
import DevelopmentMatrixManager from '@/components/admin/land-use/DevelopmentMatrixManager.vue'
// The symbology console is shared verbatim with the IT Admin route
// (/admin/gis-symbology). Reused rather than duplicated so both roles always see
// the same governance — a second copy is how symbology drift started.
import GisSymbologyRegistryView        from './admin/GisSymbologyRegistryView.vue'

import {
  Globe, LayoutDashboard, Database, MapPin, Users,
  Map as MapIcon, Trees, ShieldAlert, Building, Eye, BarChart3, Menu, X, SquarePen,
  Palette, Send, Route, Droplets, Layers, Upload, Beef, Landmark, FileUp, Plug, Table2,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

provideGISOfficerWorkspace()

type SectionKey =
  | 'dashboard' | 'spatial_db' | 'stands_editor' | 'app_mapping' | 'referrals' | 'abutting_owners'
  | 'zoning' | 'matrix' | 'environmental' | 'enforcement' | 'forward_planning'
  | 'roads' | 'wash' | 'livestock' | 'master_themes' | 'ops_import'
  | 'public_portal' | 'data_quality' | 'symbology'
  | 'register' | 'survey_import' | 'integration'

// Order matters below 768px: the first four fill the bottom bar. The GIS
// officer's daily loop is checking the queue, editing stands, keeping the
// spatial database current and mapping incoming applications; the remaining
// seven are periodic and sit behind More. `short` exists because labels like
// "Environmental constraints" are unreadable in a 70px bar slot.
const sections: readonly (BottomNavItem & { key: SectionKey; desc: string })[] = [
  { key:'dashboard',         label:'Dashboard',                 short:'Home',    icon: LayoutDashboard,
    desc:'Pending map requests · stale layers · quality score' },
  { key:'stands_editor',     label:'Stands editor',             short:'Stands',  icon: SquarePen,
    desc:'Draw · edit · manage stand polygons on the map' },
  { key:'spatial_db',        label:'Spatial database',          short:'Data',    icon: Database,
    desc:'13 GIS layers · metadata · sources' },
  { key:'app_mapping',       label:'Application mapping',       short:'Mapping', icon: MapPin,
    desc:'All permit locations · status overlay' },
  { key:'referrals',         label:'GIS referrals',             short:'Referrals', icon: Send,
    desc:"Technical circulation · record this desk's finding" },
  { key:'abutting_owners',   label:'Abutting owners',           short:'Owners',  icon: Users,
    desc:'Identify abutting properties for s.26(3) notice' },
  { key:'zoning',            label:'Zoning maps',               short:'Zoning',  icon: MapIcon,
    desc:'Zoning overlay · zone editor' },
  { key:'matrix',            label:'Development matrix',        short:'Matrix',  icon: Table2,
    desc:'What each zone permits · read-only' },
  { key:'environmental',     label:'Environmental constraints', short:'Environ', icon: Trees,
    desc:'Wetlands · watercourses · sensitive areas' },
  { key:'roads',             label:'Roads & Works',             short:'Roads',   icon: Route,
    desc:'Council road asset register · import-ready' },
  { key:'wash',              label:'WASH assets',               short:'WASH',    icon: Droplets,
    desc:'DSSWC boreholes · schemes · sanitation' },
  { key:'livestock',         label:'Livestock GIS',             short:'Stock',   icon: Beef,
    desc:'Dip tanks · stock pens · watering points' },
  { key:'master_themes',     label:'Master Plan themes',        short:'Themes',  icon: Layers,
    desc:'Honest catalogue · live vs unavailable' },
  { key:'ops_import',        label:'Import assets',             short:'Import',  icon: Upload,
    desc:'GeoJSON into Roads / WASH / livestock / assets' },
  { key:'enforcement',       label:'Enforcement mapping',       short:'Enforce', icon: ShieldAlert,
    desc:'Section 32 / 34 order locations' },
  { key:'forward_planning',  label:'Forward planning maps',     short:'Forward', icon: Building,
    desc:'Layout projects · master plan support' },
  { key:'public_portal',     label:'Public GIS portal',         short:'Public',  icon: Eye,
    desc:'Public-facing map · access logs' },
  { key:'data_quality',      label:'Data quality',              short:'Quality', icon: BarChart3,
    desc:'Metadata · staleness · backup · CRS audit' },
  { key:'symbology',         label:'Symbology registry',        short:'Symbols', icon: Palette,
    desc:'Published style versions · QGIS ↔ web fidelity · rollback' },
  { key:'register',          label:'Parcel register',           short:'Register', icon: Landmark,
    desc:'Every parcel: search, profile, where it came from' },
  { key:'survey_import',     label:'Survey import',             short:'Survey',  icon: FileUp,
    desc:'A plan from the Surveyor-General or a surveyor, into the register: preview, then adopt' },
  { key:'integration',       label:'Integration',               short:'Links',   icon: Plug,
    desc:'The ERP outbox · the SurveyPro importer, its schedule and runs' },
]

// The register sections are the GIS Branch's: a role sees one only if the API would let it use it (the same lists as the router and the backend).
const GMS_SECTION_ROLES: Partial<Record<SectionKey, readonly string[]>> = {
  register: GMS_CAN.view, survey_import: GMS_CAN.importSurvey, integration: GMS_CAN.integrationView,
}
const GMS_PATH: Partial<Record<SectionKey, string>> = { register: '/gis/parcels', survey_import: '/gis/data/import', integration: '/gis/integration' }
const visibleSections = computed(() => sections.filter((s) => {
  const roles = GMS_SECTION_ROLES[s.key]
  return !roles || [...roles, 'admin', 'planner'].includes(authStore.user?.role as string)
}))

const activeSection = ref<SectionKey>('dashboard')
const parcelId = computed(() => (typeof route.params.parcelId === 'string' ? route.params.parcelId : undefined))
// An address that names a section (/gis/integration) opens it; moving between addresses moves between sections
watch(() => route.meta.gisSection, (key) => {
  if (key) activeSection.value = ({ register: 'register', survey_import: 'survey_import', integration: 'integration' } as Record<string, SectionKey>)[key as string] ?? activeSection.value
}, { immediate: true })
function openSection(key: SectionKey) {
  activeSection.value = key
  const to = GMS_PATH[key]
  if (to) { if (route.path !== to && !route.path.startsWith(to + '/')) router.push(to) }
  else if (route.path.startsWith('/gis/')) router.push('/gis-officer-portal')
}

const { isMobile, isTablet } = useBreakpoint()

// A tablet starts collapsed — room for the rail, not for eleven labels. The
// officer can override, and that choice then wins for the session.
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

const activeMeta = computed(() => sections.find(s => s.key === activeSection.value) ?? sections[0])

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="gis-root">
    <a class="gis-skip" href="#gis-main">Skip to content</a>
    <header class="gis-header">
      <button v-if="!isMobile" class="gis-icon-btn" type="button"
              :aria-expanded="!railCollapsed" aria-controls="gis-section-rail"
              @click="toggleRail">
        <component :is="railCollapsed ? Menu : X" :size="14" aria-hidden="true" />
        <span class="ent-sr-only">{{ railCollapsed ? 'Expand' : 'Collapse' }} section menu</span>
      </button>
      <div class="gis-brand">
        <div class="gis-icon"><Globe :size="16" aria-hidden="true" /></div>
        <div class="gis-brand-text">
          <span class="gis-title">GIS Officer Portal</span>
          <span class="gis-sub">Vungu RDC · Spatial intelligence · Lo31 / WGS84</span>
        </div>
      </div>
      <!-- On mobile this is the sole wayfinding: the rail is gone, so the
           section name is promoted rather than hidden. -->
      <h1 class="gis-section-title">
        <component :is="activeMeta.icon" :size="13" aria-hidden="true" />
        <span class="gis-section-name">{{ activeMeta.label }}</span>
        <span class="gis-section-sub">{{ activeMeta.desc }}</span>
      </h1>
      <ProfileDropdown
        role-label="GIS Officer"
        avatar-key="gis_officer_avatar"
        @logout="handleLogout"
      />
    </header>

    <div class="gis-body">
      <nav v-if="!isMobile" id="gis-section-rail" class="gis-nav"
           :class="{ collapsed: railCollapsed }"
           aria-label="GIS officer console sections">
        <button v-for="s in visibleSections" :key="s.key"
                type="button"
                class="gis-nav-item"
                :class="{ active: activeSection === s.key }"
                :aria-current="activeSection === s.key ? 'page' : undefined"
                :title="railCollapsed ? s.label : undefined"
                @click="openSection(s.key)">
          <component :is="s.icon" :size="14" aria-hidden="true" />
          <span v-if="!railCollapsed" class="gis-nav-label">{{ s.label }}</span>
          <span v-else class="ent-sr-only">{{ s.label }}</span>
        </button>
      </nav>

      <main id="gis-main" class="gis-content" :class="{ 'ent-bottomnav-gap': isMobile }" tabindex="-1">
        <DashboardSection                v-if="activeSection === 'dashboard'"
                                          @open-section="(k: SectionKey) => openSection(k)" />
        <StandsEditorSection             v-else-if="activeSection === 'stands_editor'" />
        <SpatialDatabaseSection          v-else-if="activeSection === 'spatial_db'" />
        <ApplicationMappingSection       v-else-if="activeSection === 'app_mapping'" />
        <ReferralsSection                v-else-if="activeSection === 'referrals'" />
        <AbuttingOwnersSection           v-else-if="activeSection === 'abutting_owners'" />
        <ZoningMapsSection               v-else-if="activeSection === 'zoning'" />
        <DevelopmentMatrixManager        v-else-if="activeSection === 'matrix'" />
        <EnvironmentalConstraintsSection v-else-if="activeSection === 'environmental'" />
        <RoadsWorksSection               v-else-if="activeSection === 'roads'" />
        <WashAssetsSection               v-else-if="activeSection === 'wash'" />
        <LivestockSection                v-else-if="activeSection === 'livestock'" />
        <MasterThemesSection             v-else-if="activeSection === 'master_themes'" />
        <OpsImportSection                v-else-if="activeSection === 'ops_import'" />
        <EnforcementMappingSection       v-else-if="activeSection === 'enforcement'" />
        <ForwardPlanningMapsSection      v-else-if="activeSection === 'forward_planning'" />
        <PublicGISPortalSection          v-else-if="activeSection === 'public_portal'" />
        <DataQualitySection              v-else-if="activeSection === 'data_quality'" />
        <ParcelRegisterSection           v-else-if="activeSection === 'register'" :parcel-id="parcelId" />
        <SurveyImportSection             v-else-if="activeSection === 'survey_import'" />
        <IntegrationSection              v-else-if="activeSection === 'integration'" />
        <!-- Same console the IT Admin sees at /admin/gis-symbology — one
             component, so the two roles can never see different governance. -->
        <GisSymbologyRegistryView        v-else-if="activeSection === 'symbology'" />
      </main>
    </div>

    <UiBottomNav
      v-if="isMobile"
      :items="[...visibleSections]"
      :model-value="activeSection"
      label="GIS officer console sections"
      @update:model-value="openSection($event as SectionKey)"
    />
  </div>
</template>

<style scoped>
/* Migrated onto the enterprise token SSOT (src/styles/enterprise.css) and the
   four-step breakpoint system (src/styles/responsive.css). The cyan and slate
   hexes this file hardcoded are gone: role identity belongs in the brand mark
   and the title, not in a second palette. */

.gis-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }

.gis-skip {
  position:absolute; top:8px; left:8px; z-index:80;
  padding:0.45rem 0.75rem; background:var(--ent-surface); color:var(--ent-accent);
  border:1px solid var(--ent-accent); border-radius:var(--ent-r-sm);
  font-weight:600; text-decoration:none; transform:translateY(-220%);
}
.gis-skip:focus-visible { transform:translateY(0); outline:2px solid var(--ent-accent); outline-offset:2px; }

.gis-root :deep(input:focus-visible),
.gis-root :deep(textarea:focus-visible),
.gis-root :deep(select:focus-visible),
.gis-root :deep(button:focus-visible) {
  outline:2px solid var(--ent-accent);
  outline-offset:2px;
}

@media (prefers-reduced-motion: reduce) {
  .gis-root, .gis-root :deep(*) { transition-duration:0ms !important; animation-duration:0ms !important; }
}

.gis-header { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s4); background:var(--ent-surface);
  border-bottom:1px solid var(--ent-line); box-shadow:var(--ent-e1); flex-shrink:0; }
.gis-icon-btn { display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h-sm); height:var(--ent-control-h-sm); flex-shrink:0;
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  background:var(--ent-surface); color:var(--ent-text-2); cursor:pointer; }
.gis-icon-btn:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.gis-icon-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.gis-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.gis-icon { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.85rem; height:1.85rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.gis-brand-text { min-width:0; }
.gis-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold);
  line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gis-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.gis-section-title { flex:1; min-width:0; display:flex; align-items:center; gap:var(--ent-s2);
  margin:0 0 0 var(--ent-s5); padding-left:var(--ent-s4); border-left:1px solid var(--ent-line);
  font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.gis-section-name { flex-shrink:0; }
.gis-section-sub { color:var(--ent-text-3); font-weight:var(--ent-fw-normal);
  font-size:var(--ent-fs-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gis-section-sub::before { content:'— '; }

.gis-body { flex:1; min-height:0; display:flex; overflow:hidden; }

.gis-nav { display:flex; flex-direction:column; gap:2px;
  width:var(--ent-rail-w); padding:var(--ent-s2); background:var(--ent-surface);
  border-right:1px solid var(--ent-line);
  overflow-y:auto; flex-shrink:0; }
.gis-nav.collapsed { width:var(--ent-rail-w-collapsed); align-items:center; }
.gis-nav-item { display:inline-flex; align-items:center; gap:var(--ent-s2);
  width:100%; min-height:var(--ent-control-h); padding:var(--ent-s2) var(--ent-s3);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  background:none; border:1px solid transparent; border-radius:var(--ent-r-sm);
  color:var(--ent-text-2); text-align:left; cursor:pointer; font-family:var(--ent-font); }
.gis-nav.collapsed .gis-nav-item { width:var(--ent-control-h); padding:0; justify-content:center; }
.gis-nav-item:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.gis-nav-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.gis-nav-item.active { background:var(--ent-accent-soft); color:var(--ent-accent);
  border-color:var(--ent-accent-line); font-weight:var(--ent-fw-semibold); }
.gis-nav-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

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
.gis-nav-label { animation:gis-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes gis-rail-label { from { opacity:0; transform:translateX(-6px); } }


.gis-content { flex:1; min-width:0; overflow-y:auto; background:var(--ent-canvas);
  -webkit-overflow-scrolling:touch; }

/* ── Tablet: 768–1023 ─────────────────────────────────────────────────── */
@media (max-width: 1023px) {
  .gis-section-sub { display:none; }
}

/* ── Mobile: ≤767 ─────────────────────────────────────────────────────── */
@media (max-width: 767px) {
  .gis-section-title { margin-left:0; padding-left:0; border-left:none;
    font-size:var(--ent-fs-md); }
  .gis-brand-text { display:none; }
}
</style>
