<script setup lang="ts">
// Executive Officer (Planning) workspace — the spatial command centre and the
// fifteen-section case console, in one shell, over one open case.
//
// Both halves already existed. The route used to serve only EOPlannerView (the
// map), so every section under views/eo-planner/sections/ was unreachable
// (audit F17). The map view even carried an "EO Planner Portal" button that
// routed back to itself, because the alias behind that path pointed at the map.
//
// PANE
// Controlled here rather than left to the shell, because the map hands cases
// to the console: "Determine" on the map opens the case in the console's
// Determination section, and the pane has to follow the officer there. A link
// that names a section (?section=…) also opens on the console — it was sent to
// be read there, and landing on the map would hide the case it points at.
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { Briefcase } from 'lucide-vue-next'
import RoleWorkspaceShell from '@/components/shared/RoleWorkspaceShell.vue'
import EOPlannerView from '@/views/EOPlannerView.vue'
import EOPlannerPortalView from '@/views/EOPlannerPortalView.vue'

const route = useRoute()
const pane = ref<'map' | 'console'>(route.query.section || route.query.case ? 'console' : 'map')
</script>

<template>
  <RoleWorkspaceShell
    v-model:pane="pane"
    title="EO Planner"
    subtitle="Vungu RDC · RTCP Act [Ch. 29:12] · 3-month clock"
    :icon="Briefcase"
    role-label="E.O. Planning"
    avatar-key="eo_planner_avatar"
    map-label="Command centre"
    console-label="Case console"
  >
    <template #map><EOPlannerView embedded @open-console="pane = 'console'" /></template>
    <template #console><EOPlannerPortalView embedded /></template>
  </RoleWorkspaceShell>
</template>
