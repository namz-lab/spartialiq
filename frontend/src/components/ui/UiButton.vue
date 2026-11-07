<script setup lang="ts">
// Enterprise UI kit — Button. One control, four roles. Consumes --ent-* tokens.
// Icon goes in the #icon slot (leading); label is the default slot.
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  type?: 'button' | 'submit' | 'reset'
  block?: boolean
  loading?: boolean
  disabled?: boolean
}>(), { variant: 'secondary', size: 'md', type: 'button' })
</script>

<template>
  <button
    :type="type"
    class="ui-btn"
    :class="[`v-${variant}`, `s-${size}`, { block, 'is-loading': loading }]"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="ui-btn-spin" aria-hidden="true" />
    <slot v-else name="icon" />
    <span class="ui-btn-label"><slot /></span>
  </button>
</template>

<style scoped>
.ui-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--ent-s2);
  height: var(--ent-control-h); padding: 0 var(--ent-control-px);
  font-family: var(--ent-font); font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold);
  line-height: 1; white-space: nowrap; cursor: pointer;
  border: 1px solid transparent; border-radius: var(--ent-r);
  transition: background-color var(--ent-dur) var(--ent-ease),
              border-color var(--ent-dur) var(--ent-ease),
              color var(--ent-dur) var(--ent-ease);
}
.ui-btn.s-sm { height: var(--ent-control-h-sm); padding: 0 var(--ent-s3); font-size: var(--ent-fs-sm); }
.ui-btn.block { width: 100%; }
.ui-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ui-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.ui-btn.v-primary { background: var(--ent-accent); color: var(--ent-text-on-accent); border-color: var(--ent-accent); }
.ui-btn.v-primary:hover:not(:disabled) { background: var(--ent-accent-hover); border-color: var(--ent-accent-hover); }
.ui-btn.v-primary:active:not(:disabled) { background: var(--ent-accent-active); }

.ui-btn.v-secondary { background: var(--ent-surface); color: var(--ent-text); border-color: var(--ent-line-strong); }
.ui-btn.v-secondary:hover:not(:disabled) { background: var(--ent-surface-2); border-color: var(--ent-text-3); }

.ui-btn.v-ghost { background: transparent; color: var(--ent-text-2); }
.ui-btn.v-ghost:hover:not(:disabled) { background: var(--ent-surface-2); color: var(--ent-text); }

.ui-btn.v-danger { background: var(--ent-surface); color: var(--ent-danger); border-color: var(--ent-tone-negative-line); }
.ui-btn.v-danger:hover:not(:disabled) { background: var(--ent-danger-soft); }

.ui-btn-label:empty { display: none; }

.ui-btn-spin {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: ui-btn-spin 0.7s linear infinite;
}
@keyframes ui-btn-spin { to { transform: rotate(360deg); } }
</style>
