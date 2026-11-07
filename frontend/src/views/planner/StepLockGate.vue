<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
defineProps<{ unlocked: boolean; reason?: string }>()
</script>

<template>
  <!-- Single root so parent directives (e.g. v-show) can attach. display:contents
       keeps the wrapper transparent to layout, so children behave as direct
       siblings of the parent. -->
  <div class="step-gate">
    <slot v-if="unlocked" />
    <div v-else class="step-locked">
      <Lock :size="20" />
      <p>{{ reason || 'Complete previous step first.' }}</p>
    </div>
  </div>
</template>

<style scoped>
.step-gate { display: contents; }
.step-locked { display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:2rem 1rem; color:var(--ent-text-3); gap:0.5rem; font-size:0.8125rem; text-align:center; }
</style>
