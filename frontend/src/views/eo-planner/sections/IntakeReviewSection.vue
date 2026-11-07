<script setup lang="ts">
// Intake review — completeness under the TPD form, land rights, the fee, and
// the acknowledgement that starts the three-month clock.
//
// The work itself is Step1Intake, shared with the planner's statutory
// workflow. Its own queue is suppressed here: the EO console opens the case
// once, for every section, and a second picker inside one section would let an
// officer work a file the case bar says is not open.
import { useEoCase } from '@/eo-planner/useEoCase'
import Step1Intake from '@/views/planner/Step1Intake.vue'
import CaseRequired from './CaseRequired.vue'

const eoCase = useEoCase()
</script>

<template>
  <CaseRequired v-if="!eoCase.caseId.value" what="The intake checks for an application" />
  <Step1Intake v-else hide-queue />
</template>
