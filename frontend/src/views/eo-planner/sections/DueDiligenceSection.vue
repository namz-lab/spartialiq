<script setup lang="ts">
// Due diligence — file checks, compatibility with the plan, the statutory
// tests, title-deed and bondholder referrals, and the DD report.
//
// The work itself is Step2DueDiligence, shared with the planner's statutory
// workflow; it reads the case the console has open.
import { useEoCase } from '@/eo-planner/useEoCase'
import Step2DueDiligence from '@/views/planner/Step2DueDiligence.vue'
import CaseRequired from './CaseRequired.vue'

const eoCase = useEoCase()
</script>

<template>
  <CaseRequired v-if="!eoCase.caseId.value" what="The due-diligence sheet" />
  <Step2DueDiligence v-else />
</template>
