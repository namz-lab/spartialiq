<script setup lang="ts">
// Permit drafting — wraps the existing Step4PermitDrafting which
// handles condition selection with the 5-test gating
// (necessity / relevance / enforceability / precision / reasonableness)
// + Annexure 7 condition notes.
import Step4PermitDrafting from '@/views/planner/Step4PermitDrafting.vue'
</script>

<template>
  <Step4PermitDrafting />
</template>
