<script setup lang="ts">
// Case workspace — Fact. One label/value pair: the atom of every record view in
// the workspace (applicant particulars, property, proposal, notice dates).
// `mono` switches the value to the machine-identifier face reserved for
// register numbers, stand numbers and coordinates.
//
// Absent backend fields render an em dash rather than collapsing, so a missing
// value stays visibly missing. Presentation only — consumes --ent-*.
withDefaults(defineProps<{
  label: string
  value?: string | number | null
  mono?: boolean
}>(), { mono: false })
</script>

<template>
  <div class="cft">
    <span class="cft-k">{{ label }}</span>
    <span class="cft-v" :class="{ mono }">
      <slot>{{ value === null || value === undefined || value === '' ? '—' : value }}</slot>
    </span>
  </div>
</template>

<style scoped>
.cft { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cft-k {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--ent-text-3); line-height: var(--ent-lh-tight);
}
.cft-v {
  display: inline-flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap;
  font-size: var(--ent-fs-sm); color: var(--ent-text);
  line-height: var(--ent-lh); overflow-wrap: anywhere;
}
.cft-v.mono { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; }
</style>
