<script setup lang="ts">
// A confirmation the administrator has to read.
//
// WHY NOT window.confirm
// Four of this console's actions are irreversible or affect somebody else's
// working day — suspending an officer mid-shift, removing an account,
// revoking every session, resetting a password. A native confirm cannot say
// WHAT will happen, cannot be styled to distinguish a destructive action from
// a routine one, and cannot carry the consequence in the sentence the admin
// actually reads.
//
// WHY THE SCRIM DOES NOT DISMISS
// A destructive confirmation that closes on a stray click has taught the
// operator that clicking outside is safe, which is exactly the habit that
// makes the next one dangerous. Escape and Cancel both still work: there is a
// way out, it just is not the click they were already making.

import UiSheet from '@/components/ui/UiSheet.vue'
import { AlertTriangle } from 'lucide-vue-next'

withDefaults(defineProps<{
  open: boolean
  title: string
  /** What will happen, in one sentence, naming the person or record. */
  message: string
  /** Anything that cannot be undone, or that someone else will notice. */
  consequence?: string
  confirmLabel?: string
  /** Destructive styling. Reserve it for actions that lose data or access. */
  destructive?: boolean
  busy?: boolean
}>(), { confirmLabel: 'Confirm', destructive: false, busy: false })

defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <UiSheet :open="open" :title="title" variant="dialog" width="26rem"
           :scrim-close="false" @close="$emit('cancel')">
    <div class="ac-body">
      <p class="ac-message">{{ message }}</p>
      <p v-if="consequence" class="ac-consequence" :class="{ destructive }">
        <AlertTriangle :size="15" aria-hidden="true" />
        <span>{{ consequence }}</span>
      </p>
    </div>
    <div class="ac-actions">
      <button type="button" class="ac-btn" :disabled="busy" @click="$emit('cancel')">Cancel</button>
      <button type="button" class="ac-btn" :class="destructive ? 'ac-danger' : 'ac-primary'"
              :disabled="busy" @click="$emit('confirm')">
        {{ busy ? 'Working…' : confirmLabel }}
      </button>
    </div>
  </UiSheet>
</template>

<style scoped>
.ac-body { display:flex; flex-direction:column; gap:var(--ent-s3); }
.ac-message { margin:0; font-size:var(--ent-fs-base); line-height:var(--ent-lh); color:var(--ent-text); }
.ac-consequence { display:flex; align-items:flex-start; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s3); font-size:var(--ent-fs-sm); line-height:var(--ent-lh);
  color:var(--ent-tone-warning-fg); background:var(--ent-tone-warning-bg);
  border:1px solid var(--ent-tone-warning-line); border-radius:var(--ent-r); }
.ac-consequence.destructive { color:var(--ent-tone-negative-fg);
  background:var(--ent-tone-negative-bg); border-color:var(--ent-tone-negative-line); }
.ac-consequence > svg { flex-shrink:0; margin-top:1px; }

.ac-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); margin-top:var(--ent-s5); }
.ac-btn { min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.ac-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.ac-btn:disabled { opacity:0.55; cursor:not-allowed; }
.ac-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ac-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.ac-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.ac-danger { color:#fff; background:var(--ent-danger); border-color:var(--ent-danger); }
.ac-danger:hover:not(:disabled) { filter:brightness(0.93); }
</style>
