<script setup lang="ts">
/**
 * Ask for a written reason before an act that is kept on the record (cancel, remove).
 *
 * Built on CwDialog: named by its heading, described by the message, focus starts in the reason and
 * stays inside, Esc and the backdrop are ignored while busy, and focus goes back to the opener.
 */
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import CwDialog from './CwDialog.vue'

const props = withDefaults(defineProps<{
  title: string; message?: string; label?: string; minLength?: number; maxLength?: number; submitLabel?: string
  danger?: boolean; busy?: boolean; error?: string | null
  /** Optional: the control that opened the dialog, for the focus return (Safari does not focus a clicked button). */
  opener?: HTMLElement | null
}>(), { opener: null, maxLength: undefined, label: 'Reason', minLength: 5, submitLabel: 'Confirm', message: '', danger: false, busy: false, error: null })
const emit = defineEmits<{ (e: 'submit', reason: string): void; (e: 'close'): void }>()

const text = ref('')
const ok = computed(() => text.value.trim().length >= props.minLength)
function submit(): void { if (ok.value && !props.busy) emit('submit', text.value.trim()) }
function close(): void { if (!props.busy) emit('close') }
</script>

<template>
  <CwDialog :title="title" :busy="busy" :opener="opener" form @close="close" @submit="submit">
    <template #header>
      <button type="button" class="cw-icon-btn" aria-label="Close" :aria-disabled="busy || undefined" @click="close"><X :size="20" aria-hidden="true" /></button>
    </template>
    <template v-if="message" #describe><p style="color: var(--cw-ink-2)">{{ message }}</p></template>
    <label class="cw-field">
      <span class="cw-label">{{ label }}</span>
      <textarea v-model="text" class="cw-textarea" :minlength="minLength" :maxlength="maxLength" required data-autofocus />
      <span class="cw-hint">At least {{ minLength }} characters. Kept on the record with your name.</span>
    </label>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
    <template #footer>
      <button type="button" class="cw-btn" :aria-disabled="busy || undefined" @click="close">Back</button>
      <!-- Disabled only while the reason is too short (nothing pressed yet); while busy it stays focusable. -->
      <button type="submit" class="cw-btn" :class="danger ? 'cw-btn--danger' : 'cw-btn--primary'" :disabled="!ok" :aria-disabled="busy || undefined">{{ busy ? 'Working…' : submitLabel }}</button>
    </template>
  </CwDialog>
</template>
