<script setup lang="ts">
// Hosts the 5-step Section 26 statutory workflow shell. The shell
// already manages its own header (clock banner, step nav, drawer toggle)
// via providePlannerCase + StatutoryShell, so this section just embeds it.
import StatutoryShell from '../StatutoryShell.vue'
</script>

<template>
  <div class="sw-section">
    <StatutoryShell />
  </div>
</template>

<style scoped>
.sw-section { height:100%; display:flex; flex-direction:column; min-height:0; }
.sw-section > :deep(.sw-root) { flex:1; min-height:0; }
</style>
