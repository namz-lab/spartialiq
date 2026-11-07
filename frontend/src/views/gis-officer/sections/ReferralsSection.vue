<script setup lang="ts">
// GIS Officer — technical-circulation referrals raised by the planner.
import SpecialistReferralsInbox from '@/components/workflow/SpecialistReferralsInbox.vue'
</script>

<template>
  <SpecialistReferralsInbox
    :department-needles="['gis']"
    heading="GIS referrals"
    empty-next-step="No GIS referrals in technical circulation. Files appear here when the planner circulates a case to this desk."
  />
</template>
