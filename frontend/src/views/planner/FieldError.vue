<script setup lang="ts">
// Case workspace — field validation primitive. One line, one icon, one message:
// the single error treatment used by every form control in the workspace.
//
// Deliberately not an alert box — a failed check is a property of the field,
// not an interruption. `role="alert"` announces it when it appears; the
// optional `id` lets the calling control point `aria-describedby` at it, so the
// message is read out with the field rather than stranded beside it.
//
// Presentation only. The validation RULES stay in the step components
// (Step1Intake.validate()) — this renders whatever message they produce.
import { AlertCircle } from 'lucide-vue-next'

defineProps<{ message?: string | null; id?: string }>()
</script>

<template>
  <p v-if="message" :id="id" class="field-err" role="alert">
    <AlertCircle :size="12" aria-hidden="true" />
    <span>{{ message }}</span>
  </p>
</template>

<style scoped>
.field-err {
  display: flex; align-items: flex-start; gap: 5px;
  margin: 3px 0 0;
  font-family: var(--ent-font);
  font-size: var(--ent-fs-micro);
  line-height: var(--ent-lh);
  color: var(--ent-danger);
}
.field-err > svg { flex: none; margin-top: 1px; }
</style>
