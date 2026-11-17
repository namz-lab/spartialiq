<script setup lang="ts">
/** S12: the one loading state. A card with skeleton lines, aria-busy, and a status line a screen reader can hear. */
withDefaults(defineProps<{ label: string; lines?: number }>(), { lines: 3 })
</script>

<template>
  <section class="cw-card" aria-busy="true">
    <div class="cw-card-body" style="padding-top: 16px"><span v-for="n in lines" :key="n" class="cw-skel" /></div>
    <span class="sr-only" role="status">Loading {{ label }}…</span>
  </section>
</template>
