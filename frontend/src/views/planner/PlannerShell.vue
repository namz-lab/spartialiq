<script setup lang="ts">
// Unified planner workspace. Hosts the spatial map and the statutory console
// as kept-alive panes that share ONE case-file context. The map seeds intake
// and the console reads it back, so a stand selected on the map flows straight
// into the Section 26 workflow.
//
// RESPONSIVE STRUCTURE (Phase 5)
// The chrome holds five things: brand, pane switch, the statutory-workspace
// link, the sync chip and the profile menu. On a 375px bar they cannot all be
// spelled out, so below 768px the switch, the statutory link and the sync
// chip reduce to icons, keeping their text as sr-only labels plus a title.
//
// The sync chip is specifically NOT dropped on mobile (Phase 23). A planner
// working a rural ward is the user most likely to be offline, so "Offline —
// saved locally" is more load-bearing on a phone than on a workstation. It
// keeps its colour, its icon and its accessible text; only the visible words
// go, and they return the moment there is room.
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { providePlannerCase } from '@/composables/usePlannerCase'
import {
  providePlannerShell, SECTION_KEYS,
  type PlannerPane, type SectionKey, type PlannerShellApi,
} from '@/composables/usePlannerShell'
import { isApplication360Tab } from '@/views/planner/application360Tabs'
import { featureToStandSeed } from '@/composables/featureToStandSeed'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import VunguPlannerView from '@/views/planner/VunguPlannerView.vue'
import PlannerWorkspaceView from '@/views/PlannerWorkspaceView.vue'
import {
  Map as MapIcon, Gavel, WifiOff, Cloud, CloudUpload, Landmark,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const { isMobile } = useBreakpoint()

// One case context shared by both panes.
const ctx = providePlannerCase()

const activePane = ref<PlannerPane>('map')
const activeConsoleSection = ref<SectionKey>('dashboard')
const consoleMounted = ref(false)

const mapPane = ref<InstanceType<typeof VunguPlannerView> | null>(null)

function showMap() {
  activePane.value = 'map'
  // A map hidden with display:none loses correct canvas dimensions.
  nextTick(() => (mapPane.value as any)?.resizeMap?.())
}
function showConsole(section?: SectionKey) {
  if (section) activeConsoleSection.value = section
  consoleMounted.value = true
  activePane.value = 'console'
}
function registerStandFromMap(feature: unknown) {
  ctx.seedIntake(featureToStandSeed(feature as any))
  showConsole('workflow')
}
async function openCaseForStand(permitId: string, tab?: string) {
  await ctx.loadFromPermit(permitId)
  const nextTab = (tab && isApplication360Tab(tab))
    ? tab
    : (typeof route.query.tab === 'string' && isApplication360Tab(route.query.tab) ? route.query.tab : undefined)
  await router.replace({
    query: {
      ...route.query,
      pane: 'console',
      section: 'workflow',
      case: permitId,
      ...(nextTab ? { tab: nextTab } : {}),
    },
  })
  // After the URL is settled, so the URL-sync watcher sees nothing to change
  // and cannot drop ?case= by racing this replace.
  showConsole('workflow')
  const centroid = ctx.current.value?.property.centroid
  if (centroid) nextTick(() => (mapPane.value as any)?.flyTo?.(centroid))
}
function flyTo(centroid: [number, number]) {
  showMap()
  nextTick(() => (mapPane.value as any)?.flyTo?.(centroid))
}

const api: PlannerShellApi = {
  activePane: computed(() => activePane.value),
  activeConsoleSection: computed(() => activeConsoleSection.value),
  showMap, showConsole, registerStandFromMap, openCaseForStand, flyTo,
}
providePlannerShell(api)

// Deep links: /planner (map), /planner?pane=console, /planner?case=<id>&tab=overview
onMounted(() => {
  const section = route.query.section
  if (typeof section === 'string' && (SECTION_KEYS as readonly string[]).includes(section)) {
    activeConsoleSection.value = section as SectionKey
  }
  const caseId = route.query.case
  if (typeof caseId === 'string' && caseId) {
    // Console first, synchronously: otherwise the URL-sync watcher sees the
    // section change while the pane is still 'map' and pushes a bare
    // /planner, dropping ?case= and ?tab= (a refreshed or shared case link
    // landed on Overview, and Back went to the map).
    showConsole('workflow')
    const tab = typeof route.query.tab === 'string' ? route.query.tab : undefined
    void openCaseForStand(caseId, tab)
    return
  }
  if (route.query.pane === 'console') showConsole()
  else showMap()
})

// Keep the URL in step with what is on screen. Switching section used to leave
// ?section=dashboard in the address bar, so a refresh, a bookmark or the Back
// button always landed the officer on My Work. A section change is a history
// entry (Back returns to the previous section); the case id stays only while
// the workflow is showing it.
watch([activePane, activeConsoleSection], ([pane, section]) => {
  const q = route.query
  const want = pane === 'console' ? { pane: 'console', section } : {}
  if (q.pane === want.pane && (pane !== 'console' || q.section === section)) return
  const keepCase = pane === 'console' && section === 'workflow'
  const { case: c, tab, pane: _p, section: _s, ...rest } = q
  void router.push({ query: { ...rest, ...want, ...(keepCase && c ? { case: c, ...(tab ? { tab } : {}) } : {}) } })
})
watch(() => [route.query.pane, route.query.section] as const, ([pane, section]) => {
  if (typeof section === 'string' && (SECTION_KEYS as readonly string[]).includes(section)
      && section !== activeConsoleSection.value) {
    activeConsoleSection.value = section as SectionKey
  }
  if (pane === 'console' && activePane.value !== 'console') showConsole()
  else if (pane !== 'console' && activePane.value === 'console') showMap()
})

// Online/sync chip.
const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
function onOnline() { online.value = true }
function onOffline() { online.value = false }
onMounted(() => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})
onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})
const syncState = computed<'offline' | 'syncing' | 'saved'>(() => {
  if (!online.value) return 'offline'
  if (ctx.syncPending.value) return 'syncing'
  return 'saved'
})
const syncLabel = computed(() =>
  syncState.value === 'offline' ? 'Offline — saved locally'
  : syncState.value === 'syncing' ? 'Syncing…' : 'Saved')

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="ps-root">
    <header class="ps-chrome">
      <div class="ps-brand">
        <div class="ps-logo"><Landmark :size="17" aria-hidden="true" /></div>
        <div class="ps-brand-text">
          <span class="ps-title">Town Planning Officer</span>
          <span class="ps-sub">Vungu RDC · RTCP Act [Ch. 29:12]</span>
        </div>
      </div>

      <div class="ps-switch" role="tablist" aria-label="Planner view">
        <button type="button" role="tab" :aria-selected="activePane === 'map'"
                :class="{ active: activePane === 'map' }" @click="showMap">
          <MapIcon :size="14" aria-hidden="true" />
          <span :class="isMobile ? 'ent-sr-only' : 'ps-switch-label'">Map</span>
        </button>
        <button type="button" role="tab" :aria-selected="activePane === 'console'"
                :class="{ active: activePane === 'console' }" @click="showConsole()">
          <Gavel :size="14" aria-hidden="true" />
          <span :class="isMobile ? 'ent-sr-only' : 'ps-switch-label'">Work</span>
        </button>
      </div>

      <!--
        role="status" so a change from Saved to Offline is announced rather
        than only recoloured; aria-live="polite" so it waits for a pause
        instead of interrupting the officer mid-field.
      -->
      <div class="ps-sync" :class="syncState" :title="syncLabel"
           role="status" aria-live="polite">
        <component :is="syncState === 'offline' ? WifiOff : syncState === 'syncing' ? CloudUpload : Cloud"
                   :size="13" aria-hidden="true" />
        <span :class="isMobile ? 'ent-sr-only' : 'ps-sync-label'">{{ syncLabel }}</span>
      </div>

      <ProfileDropdown role-label="Town Planning Officer" avatar-key="planner_avatar" @logout="handleLogout" />
    </header>

    <div class="ps-body">
      <VunguPlannerView ref="mapPane" v-show="activePane === 'map'" />
      <PlannerWorkspaceView v-if="consoleMounted" v-show="activePane === 'console'" />
    </div>
  </div>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css + src/styles/responsive.css. */
.ps-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text); font-family:var(--ent-font); }
.ps-chrome { display:flex; align-items:center; gap:var(--ent-s3);
  padding:0 calc(var(--ent-s4) + var(--ent-safe-right)) 0 calc(var(--ent-s4) + var(--ent-safe-left));
  min-height:var(--ent-topbar-h); background:var(--ent-surface);
  border-bottom:1px solid var(--ent-line); box-shadow:var(--ent-e1); flex-shrink:0; }
.ps-brand { display:flex; align-items:center; gap:var(--ent-s2); min-width:0; }
.ps-logo { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.85rem; height:1.85rem; border-radius:var(--ent-r); background:var(--ent-accent); color:var(--ent-text-on-accent); }
.ps-brand-text { min-width:0; }
.ps-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold);
  line-height:1.1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ps-sub   { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.ps-switch { display:inline-flex; gap:2px; margin-left:var(--ent-s4); padding:2px; flex-shrink:0;
  background:var(--ent-surface-sunken); border:1px solid var(--ent-line); border-radius:var(--ent-r); }
.ps-switch button { display:inline-flex; align-items:center; justify-content:center; gap:var(--ent-s1);
  min-height:var(--ent-control-h-sm); padding:var(--ent-s1) var(--ent-s3);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); border:none;
  background:transparent; color:var(--ent-text-2); border-radius:var(--ent-r-sm); cursor:pointer;
  font-family:var(--ent-font); }
.ps-switch button.active { background:var(--ent-surface); color:var(--ent-accent); box-shadow:var(--ent-e1); }
.ps-switch button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ps-switch-label { white-space:nowrap; }


.ps-sync { display:inline-flex; align-items:center; justify-content:center; gap:var(--ent-s1);
  margin-left:auto; flex-shrink:0;
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  padding:var(--ent-s1) var(--ent-s3); border-radius:var(--ent-r-pill);
  background:var(--ent-success-soft); color:var(--ent-success); }
.ps-sync.syncing { background:var(--ent-accent-soft); color:var(--ent-accent); }
.ps-sync.offline { background:var(--ent-danger-soft); color:var(--ent-danger); }
.ps-sync-label { white-space:nowrap; }

.ps-body { flex:1; min-height:0; position:relative; display:flex; }
.ps-body > * { flex:1; min-width:0; }

/* ── Tablet: 768–1023 ─────────────────────────────────────────────────────
   The statutory subtitle is the first thing to go: the switch, the statutory
   link and the sync chip are all controls, and the subtitle is not. */
@media (max-width: 1023px) {
  .ps-sub { display:none; }
  .ps-switch { margin-left:var(--ent-s3); }
}

/* ── Mobile: ≤767 ─────────────────────────────────────────────────────────
   Five chrome items on a 375px bar: the three text-bearing controls become
   square icon buttons. Their labels move to sr-only spans in the template and
   survive as title attributes, so neither a screen-reader user nor a
   long-press loses the wording. The sync chip keeps its colour and icon, so
   "offline" is still visible at a glance — it is the state a field planner
   most needs to see. */
@media (max-width: 767px) {
  .ps-chrome { gap:var(--ent-s2); }
  .ps-switch button { min-width:var(--ent-touch-min); min-height:var(--ent-touch-min); padding:var(--ent-s1) var(--ent-s2); }
  .ps-sync { min-width:var(--ent-touch-min); min-height:var(--ent-touch-min); padding:var(--ent-s1) var(--ent-s2); }
  /* The account chip was crushed to 13px by a crowded bar: the brand gives
     way instead (the logo stays), the chip keeps its touch size. */
  .ps-brand-text { display:none; }
  .ps-chrome :deep(.ph-user-chip) { flex-shrink:0; margin-left:auto; }
  .ps-chrome :deep(.ph-chip-identity) { min-width:var(--ent-touch-min); min-height:var(--ent-touch-min); }
}
</style>
