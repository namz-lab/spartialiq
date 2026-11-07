<script setup lang="ts">
// Enterprise UI kit — Panel. The single container primitive: a hairline
// surface with an optional header (icon / title / subtitle / actions), body,
// and footer. Replaces every ad-hoc `.card` / `.ds-card`. Consumes --ent-*.
// `flush` removes body padding so a DataTable can sit edge-to-edge.
defineProps<{
  title?: string
  subtitle?: string
  flush?: boolean
}>()
</script>

<template>
  <section class="ui-panel">
    <header v-if="title || $slots.actions || $slots.icon" class="ui-panel-head">
      <span v-if="$slots.icon" class="ui-panel-icon"><slot name="icon" /></span>
      <div v-if="title" class="ui-panel-titles">
        <h3 class="ui-panel-title">{{ title }}</h3>
        <span v-if="subtitle" class="ui-panel-sub">{{ subtitle }}</span>
      </div>
      <div v-if="$slots.actions" class="ui-panel-actions"><slot name="actions" /></div>
    </header>
    <div class="ui-panel-body" :class="{ flush }"><slot /></div>
    <footer v-if="$slots.footer" class="ui-panel-foot"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.ui-panel {
  display: flex; flex-direction: column; min-width: 0;
  background: var(--ent-surface);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md);
}
.ui-panel-head {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s3) var(--ent-s4);
  border-bottom: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
  border-radius: var(--ent-r-md) var(--ent-r-md) 0 0;
}
.ui-panel-icon { display: inline-flex; color: var(--ent-text-2); flex-shrink: 0; }
.ui-panel-titles { min-width: 0; }
.ui-panel-title {
  margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text); line-height: var(--ent-lh-tight);
}
.ui-panel-sub { display: block; font-size: var(--ent-fs-xs); color: var(--ent-text-3); margin-top: 1px; }
.ui-panel-actions { margin-left: auto; display: inline-flex; align-items: center; gap: var(--ent-s2); }
.ui-panel-body { padding: var(--ent-s4); min-width: 0; }
.ui-panel-body.flush { padding: 0; }
.ui-panel-foot {
  padding: var(--ent-s3) var(--ent-s4);
  border-top: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
  border-radius: 0 0 var(--ent-r-md) var(--ent-r-md);
}
</style>
