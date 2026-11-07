<script setup lang="ts">
// Reports — the quarterly return to province, already built for the planner
// workspace: applications received, determined and refused, enforcement orders
// issued, broken down by status, development type and ward, exported as the
// province PDF template or as CSV.
//
// One return, one implementation. The EO signs it; the planner compiles it.
import PlannerReports from '@/views/planner/sections/ReportsSection.vue'
</script>

<template>
  <PlannerReports />
</template>
