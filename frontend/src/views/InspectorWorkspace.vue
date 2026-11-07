<script setup lang="ts">
// Building Inspector workspace — the site map and the inspection console, in
// one shell, sharing one inspection case.
//
// NAVIGATION
// This view owns the parts of the URL that say *what is open*: the pane
// (?pane=) and the case (/:inspectionId in the path, or ?permit= when a permit
// was opened without one). The console owns ?section=. The rules themselves
// live in src/inspector/consoleRoute.ts, where they are tested.
//
// State is derived from the route rather than held beside it, so Back, Forward,
// a reload and a pasted link all resolve to the same screen — including which
// half of the workspace was open.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { HardHat } from 'lucide-vue-next'
import RoleWorkspaceShell from '@/components/shared/RoleWorkspaceShell.vue'
import BuildingInspectorView from '@/views/BuildingInspectorView.vue'
import InspectorWorkspaceView from '@/views/InspectorWorkspaceView.vue'
import { provideInspectionCase } from '@/composables/useInspectionCase'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { dmApi } from '@/services/developmentManagementService'
import { readLocation, mergeQuery, caseKey, type Pane } from '@/inspector/consoleRoute'
import { useInspectorPreferences } from '@/composables/useInspectorPreferences'

// Deep link: /inspector-workspace/:inspectionId (a stage_inspection UUID).
defineProps<{ inspectionId?: string }>()

const route = useRoute()
const router = useRouter()
const ic = provideInspectionCase()
const { isMobile } = useBreakpoint()
const { prefs } = useInspectorPreferences()

const restoreError = ref<string | null>(null)

const location = computed(() => readLocation({
  query: route.query,
  params: route.params,
  isMobile: isMobile.value,
  // The landing preference is read here too, not just in the console: this view
  // and the console must resolve the same URL to the same section, or a bare
  // link would open one section and write links for another.
  defaultSection: prefs.value.landingSection,
}))

const routeContext = computed(() => ({
  isMobile: isMobile.value,
  inspectionId: location.value.inspectionId,
  defaultSection: prefs.value.landingSection,
}))

/**
 * Open whatever case the URL names, whenever it names a different one.
 *
 * This runs on mount AND on every route change, so stepping Back to an
 * inspection opened earlier actually reopens it. It used to run only on mount,
 * which meant Back moved the address bar while the console kept showing the
 * previous case — the URL and the screen disagreeing about which building is
 * under inspection.
 *
 * The case is restored from SERVER state, never from a local cache: the URL is
 * the identity, so a reload or a shared link must resolve the same case.
 */
async function openFromUrl(inspectionId: string | null, permitId: string | null) {
  restoreError.value = null

  if (inspectionId) {
    try {
      const inspection = await dmApi.getStageInspection(inspectionId)
      // getStageInspection answers null for "not found" and for a failed read
      // alike, so those get the general message. The specific one is reserved
      // for a record that really exists but names no permit — a data fault
      // worth reporting differently, because retrying will not fix it.
      if (!inspection) {
        restoreError.value = 'That inspection could not be opened. It may have been removed, '
          + 'or you may not have access to it.'
        return
      }
      if (!inspection.permit_app_id) {
        restoreError.value = 'That inspection could not be opened — it has no permit application.'
        return
      }
      if (ic.current.value?.permitId === inspection.permit_app_id) return
      await ic.loadPermit(inspection.permit_app_id)
    } catch {
      restoreError.value = 'That inspection could not be opened. It may have been removed, '
        + 'or you may not have access to it.'
    }
    return
  }

  if (permitId && ic.current.value?.permitId !== permitId) {
    try {
      await ic.loadPermit(permitId)
    } catch {
      restoreError.value = 'That permit could not be opened. It may have been removed, '
        + 'or you may not have access to it.'
    }
  }
}

// Keyed on the case identity alone. Watching a tuple here re-ran this on every
// breakpoint change, because `location` is recomputed when the pane inference
// changes — which meant a window resize re-fetched the inspection, and on a
// malformed URL produced a burst of 400s.
watch(
  () => caseKey(location.value),
  () => { void openFromUrl(location.value.inspectionId, location.value.permitId) },
  { immediate: true },
)

/**
 * Record the open case on the URL so a reload keeps it. A case is context, not
 * a destination, so this replaces rather than pushes: Back should return to the
 * previous section, not step through every permit that was glanced at.
 */
watch(() => ic.current.value?.permitId ?? null, (permitId) => {
  if (location.value.inspectionId) return          // the path already names it
  if (permitId === location.value.permitId) return
  void router.replace({
    query: mergeQuery(route.query, { ...location.value, permitId }, routeContext.value),
  }).catch(() => undefined)
})

/** Switching panes is a move the inspector made, so Back undoes it. */
function setPane(pane: Pane) {
  if (pane === location.value.pane) return
  void router.push({
    query: mergeQuery(route.query, { ...location.value, pane }, routeContext.value),
  }).catch(() => undefined)
}
</script>

<template>
  <RoleWorkspaceShell
    title="Building Inspector"
    subtitle="Vungu RDC · Model Building By-Laws (1977)"
    :icon="HardHat"
    role-label="Building Inspector"
    avatar-key="building_inspector_avatar"
    map-label="Site map"
    console-label="Console"
    :pane="location.pane"
    @update:pane="setPane"
  >
    <template #map><BuildingInspectorView embedded @open-console="setPane('console')" /></template>
    <template #console>
      <!-- One child, stacked internally. The shell's pane is a flex ROW that
           gives every child flex:1, so a sibling banner here would sit BESIDE
           the console taking half the width, stretched to full height. -->
      <div class="iw-console">
        <p v-if="restoreError" class="iw-restore-error" role="alert">{{ restoreError }}</p>
        <InspectorWorkspaceView embedded />
      </div>
    </template>
  </RoleWorkspaceShell>
</template>

<style scoped>
.iw-console { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
.iw-console > :last-child { flex:1; min-height:0; }

.iw-restore-error {
  /* A message, not a wall. */
  flex: none;
  align-self: flex-start;
  max-width: 68ch;
  margin: var(--ent-s4);
  padding: var(--ent-s3) var(--ent-s4);
  border: 1px solid var(--ent-tone-negative-line);
  border-radius: var(--ent-r-md);
  background: var(--ent-danger-soft);
  color: var(--ent-text);
  font-size: var(--ent-fs-sm);
}
</style>
