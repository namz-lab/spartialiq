<script setup lang="ts">
// Enterprise UI kit — EmptyState. One sentence that explains what would appear
// here and, optionally, one action to create it. No illustrations (per the
// product's "show, don't summarise" principle). Consumes --ent-*.
defineProps<{
  message: string
  sub?: string
}>()
</script>

<template>
  <div class="ui-empty">
    <span v-if="$slots.icon" class="ui-empty-icon"><slot name="icon" /></span>
    <p class="ui-empty-msg">{{ message }}</p>
    <p v-if="sub" class="ui-empty-sub">{{ sub }}</p>
    <div v-if="$slots.action" class="ui-empty-action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--ent-s2); text-align: center;
  padding: var(--ent-s7) var(--ent-s4);
  color: var(--ent-text-3);
}
.ui-empty-icon { display: inline-flex; color: var(--ent-text-3); margin-bottom: var(--ent-s1); opacity: 0.8; }
.ui-empty-msg { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); max-width: 44ch; line-height: var(--ent-lh); }
.ui-empty-sub { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); max-width: 44ch; }
.ui-empty-action { margin-top: var(--ent-s2); }
</style>
