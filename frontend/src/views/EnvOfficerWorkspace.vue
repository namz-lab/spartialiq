<script setup lang="ts">
// Environmental Health Officer workspace — the environmental map console and
// the EHO case console, in one shell.
//
// The route previously served only EnvironmentalOfficerView (the map), leaving
// views/environment-officer/sections/ unreachable (audit F17).
//
// A link that names a console section (?section=…) opens on the console: it
// was sent to be read there, and landing on the map would hide the case it
// points at. A bare link, and every pane switch after load, stays the shell's
// own state — the pane is not otherwise part of this workspace's URL.
import { useRoute } from 'vue-router'
import { Leaf } from 'lucide-vue-next'
import RoleWorkspaceShell from '@/components/shared/RoleWorkspaceShell.vue'
import EnvironmentalOfficerView from '@/views/EnvironmentalOfficerView.vue'
import EnvironmentOfficerWorkspaceView from '@/views/EnvironmentOfficerWorkspaceView.vue'

const route = useRoute()
const initialPane = route.query.section ? 'console' : 'map'
</script>

<template>
  <RoleWorkspaceShell
    title="Environmental Health Officer"
    subtitle="Vungu RDC · Public Health Act [Ch. 15:09]"
    :icon="Leaf"
    role-label="Env. Officer"
    avatar-key="env_officer_avatar"
    map-label="Environmental map"
    console-label="Case console"
    :initial-pane="initialPane"
  >
    <template #map><EnvironmentalOfficerView embedded /></template>
    <template #console><EnvironmentOfficerWorkspaceView embedded /></template>
  </RoleWorkspaceShell>
</template>
