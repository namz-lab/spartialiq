<script setup lang="ts">
// Enterprise UI kit — Kpi. A single metric tile: value + label, optional
// leading icon and trailing affordance. When `clickable` is set it renders as
// a real button (keyboard-reachable) so dashboard tiles that drill into a
// section are accessible. Restrained: a flat bordered tile, an accent-tinted
// numeral only when the tone calls for it. Consumes --ent-*.
withDefaults(defineProps<{
  value: string | number
  label: string
  tone?: 'neutral' | 'info' | 'positive' | 'warning' | 'negative'
  clickable?: boolean
}>(), { tone: 'neutral' })

defineEmits<{ activate: [] }>()
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="ui-kpi"
    :class="[`t-${tone}`, { clickable }]"
    :type="clickable ? 'button' : undefined"
    @click="clickable && $emit('activate')"
  >
    <span v-if="$slots.icon" class="ui-kpi-icon"><slot name="icon" /></span>
    <span class="ui-kpi-body">
      <span class="ui-kpi-val">{{ value }}</span>
      <span class="ui-kpi-lbl">{{ label }}</span>
    </span>
    <span v-if="$slots.trailing" class="ui-kpi-trail"><slot name="trailing" /></span>
  </component>
</template>

<style scoped>
.ui-kpi {
  display: flex; align-items: center; gap: var(--ent-s3);
  padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-surface);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md);
  text-align: left; color: var(--ent-text); width: 100%;
  font-family: var(--ent-font);
}
.ui-kpi.clickable { cursor: pointer; transition: border-color var(--ent-dur) var(--ent-ease), background var(--ent-dur) var(--ent-ease); }
.ui-kpi.clickable:hover { border-color: var(--ent-line-strong); background: var(--ent-surface-2); }
.ui-kpi.clickable:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.ui-kpi-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex-shrink: 0;
  border-radius: var(--ent-r); background: var(--ent-surface-2); color: var(--ent-text-2);
}
.ui-kpi.t-info     .ui-kpi-icon { background: var(--ent-accent-soft);   color: var(--ent-accent); }
.ui-kpi.t-positive .ui-kpi-icon { background: var(--ent-success-soft);  color: var(--ent-success); }
.ui-kpi.t-warning  .ui-kpi-icon { background: var(--ent-warning-soft);  color: var(--ent-warning); }
.ui-kpi.t-negative .ui-kpi-icon { background: var(--ent-danger-soft);   color: var(--ent-danger); }

.ui-kpi-body { display: flex; flex-direction: column; min-width: 0; }
.ui-kpi-val { font-size: var(--ent-fs-num); font-weight: var(--ent-fw-bold); line-height: 1; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.ui-kpi.t-negative .ui-kpi-val { color: var(--ent-danger); }
.ui-kpi-lbl { font-size: var(--ent-fs-xs); color: var(--ent-text-3); margin-top: var(--ent-s1); line-height: var(--ent-lh-tight); }
.ui-kpi-trail { margin-left: auto; color: var(--ent-text-3); display: inline-flex; align-items: center; }
</style>
