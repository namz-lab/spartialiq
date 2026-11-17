<script setup lang="ts">
/**
 * Record an approval. What it asks for follows what the server keeps for that kind of decision:
 *
 *   note        'required'  the endpoint keeps a decision note (revisions, publications)
 *               'none'      the endpoint keeps no note (budget lines, projects): the dialog says so
 *                           rather than collecting words that would be thrown away
 *   resolution  'required'  the endpoint has a resolution field of its own (tariffs)
 *               'optional'  carried as the first sentence of the note ("Resolution FC/14/2026. …")
 *               'none'
 *   date        a resolution date (tariffs)
 *
 * Built on CwDialog, like ReasonDialog: named by its heading, focus kept inside, Esc ignored while
 * busy, focus returned to the opener.
 */
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import CwDialog from '../../shared/CwDialog.vue'

const props = withDefaults(defineProps<{
  title: string; message?: string; submitLabel?: string
  note?: 'required' | 'none'; resolution?: 'required' | 'optional' | 'none'; date?: boolean
  busy?: boolean; error?: string | null
}>(), { message: '', submitLabel: 'Approve', note: 'required', resolution: 'optional', date: false, busy: false, error: null })
const emit = defineEmits<{ (e: 'submit', v: { note: string; resolution: string; date: string }): void; (e: 'close'): void }>()

const noteText = ref('')
const resText = ref('')
const dateText = ref('')
const NOTE_MIN = 5
const RES_MIN = 3

const ok = computed(() =>
  (props.note !== 'required' || noteText.value.trim().length >= NOTE_MIN)
  && (props.resolution !== 'required' || resText.value.trim().length >= RES_MIN))

function submit(): void {
  if (ok.value && !props.busy) emit('submit', { note: noteText.value.trim(), resolution: resText.value.trim(), date: dateText.value })
}
function close(): void { if (!props.busy) emit('close') }
</script>

<template>
  <CwDialog :title="title" :busy="busy" form @close="close" @submit="submit">
    <template #header>
      <button type="button" class="cw-icon-btn" aria-label="Close" :aria-disabled="busy || undefined" @click="close"><X :size="20" aria-hidden="true" /></button>
    </template>
    <template v-if="message" #describe><p style="color: var(--cw-ink-2)">{{ message }}</p></template>

    <label v-if="resolution !== 'none'" class="cw-field">
      <span class="cw-label">Committee resolution reference<template v-if="resolution === 'optional'"> (if one was minuted)</template></span>
      <input v-model="resText" class="cw-input" :required="resolution === 'required'" :minlength="resolution === 'required' ? RES_MIN : undefined"
        maxlength="120" autocomplete="off" :data-autofocus="resolution === 'required' || note === 'none' ? '' : undefined" />
      <span class="cw-hint">
        <template v-if="resolution === 'required'">At least {{ RES_MIN }} characters, as minuted, for example FC/14/2026.</template>
        <template v-else>Kept as the first sentence of the decision note.</template>
      </span>
    </label>

    <label v-if="date" class="cw-field">
      <span class="cw-label">Resolution date (optional)</span>
      <input v-model="dateText" class="cw-input" type="date" />
    </label>

    <label v-if="note === 'required'" class="cw-field">
      <span class="cw-label">Reason for the decision</span>
      <textarea v-model="noteText" class="cw-textarea" :minlength="NOTE_MIN" maxlength="1800" required
        :data-autofocus="resolution === 'required' ? undefined : ''" />
      <span class="cw-hint">At least {{ NOTE_MIN }} characters. Kept on the record with your name.</span>
    </label>
    <p v-else class="cw-hint">The approval is recorded with your name and the time. This kind of approval does not keep a written note.</p>

    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
    <template #footer>
      <button type="button" class="cw-btn" :aria-disabled="busy || undefined" @click="close">Back</button>
      <button type="submit" class="cw-btn cw-btn--primary" :disabled="!ok" :aria-disabled="busy || undefined">{{ busy ? 'Working…' : submitLabel }}</button>
    </template>
  </CwDialog>
</template>
