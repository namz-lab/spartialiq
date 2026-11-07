<script setup lang="ts">
// Plan examination — Annexure 11 building plan appraisal.
//
// The backend reserves the appraisal decision for the building inspector
// (PATCH /building-plans/:id/appraisal), so this is the inspector's desk for it.
// It reuses the one appraisal surface rather than a copy, bound to the shared
// inspection case so the plan open here is the permit open everywhere else.
import BuildingPlansSection from '@/views/planner/sections/BuildingPlansSection.vue'
import { useInspectionCase } from '@/composables/useInspectionCase'
import type { PermitApplication } from '@/services/developmentManagementService'

const ic = useInspectionCase()

function select(p: PermitApplication) {
  if (ic.current.value?.permitId !== p.id) void ic.loadPermit(p.id)
}
</script>

<template>
  <BuildingPlansSection :permit-id="ic.current.value?.permitId ?? null" @select="select" />
</template>
