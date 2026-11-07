<script setup lang="ts">
// Enforcement — reuses the existing planner-workspace EnforcementSection
// which manages Section 32 stop-work and Section 34 prohibition orders
// against the dmApi enforcement-orders endpoints.
import PlannerEnforcement from '@/views/planner/sections/EnforcementSection.vue'
</script>

<template>
  <PlannerEnforcement />
</template>
