<script setup lang="ts">
// Refusal letters.
//
// Seven CALENDAR days from the Council resolution, not working days — this is
// the one clock in the console that counts weekends, and getting it the same
// way round as the five-day acknowledgement is the point of having both
// helpers named differently in console.ts.
//
// Reasons are mandatory in the database, not merely on the form. A refusal
// without reasons is void, and the applicant cannot frame an appeal against
// one, so `reasons TEXT NOT NULL CHECK (length(trim(reasons)) > 0)` in
// migration 125 is the rule and this form is only its front.
//
// The appeal window runs from SERVICE of the letter, which is why "mark sent"
// records the method and the date rather than being a tick.

import { computed, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import {
  asLabel, deadlineTone, formatDate, plusCalendarDays, toDateTimeInput,
} from '@/planning-clerk/console'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { updateEntry, errorMessage, num } from '@/services/planningClerk'
import UiButton from '@/components/ui/UiButton.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import { AlertTriangle, Send, CheckCircle2, Scale } from 'lucide-vue-next'

const overview = useClerkOverview()

const SENT_METHODS = [
  { value: 'registered_post', label: 'Registered post' },
  { value: 'ordinary_post', label: 'Ordinary post' },
  { value: 'hand', label: 'Handed over' },
  { value: 'courier', label: 'Courier' },
  { value: 'email', label: 'Email' },
] as const

const columns = computed<ClerkColumn[]>(() => [
  { key: 'letter_no', label: 'Letter', mono: true },
  {
    key: 'tpd_reference', label: 'File', mono: true,
    value: (r) => (r.tpd_reference as string) || '—',
  },
  { key: 'recipient', label: 'To' },
  {
    key: 'council_resolution_date', label: 'Resolved', nowrap: true,
    value: (r) => formatDate(r.council_resolution_date as string),
  },
  {
    key: 'due_by',
    label: '7-day letter',
    nowrap: true,
    value: (r) => (r.sent_at
      ? `Served ${formatDate(r.sent_at as string)}`
      : deadlineTone(r.due_by as string).label),
    tone: (r) => {
      const t = deadlineTone(r.due_by as string, r.sent_at as string | null).tone
      return t === 'done' ? 'positive'
        : t === 'overdue' ? 'negative'
        : t === 'today' || t === 'soon' ? 'warning'
        : 'neutral'
    },
  },
  {
    key: 'reasons',
    label: 'Reasons',
    // Truncated in the cell, in full in the title: a refusal's reasons run to
    // paragraphs, and a table row that carried all of them would be unusable.
    value: (r) => {
      const text = String(r.reasons ?? '')
      return text.length > 90 ? `${text.slice(0, 90)}…` : text || '—'
    },
    secondary: true,
  },
  { key: 'sent_method', label: 'Served by', value: (r) => asLabel(r.sent_method as string), secondary: true },
  { key: 'drafted_by_name', label: 'Drafted by', secondary: true },
])

const fields = computed<ClerkField[]>(() => {
  const now = new Date().toISOString()
  return [
    {
      name: 'letter_no', label: 'Letter number', type: 'text', required: true,
      placeholder: 'e.g. VRDC/PL/REF/2026/0031',
      hint: 'Cannot be changed once written.',
    },
    { name: 'recipient', label: 'Addressed to', type: 'text', required: true, full: true },
    {
      name: 'council_resolution_date', label: 'Council resolved to refuse', type: 'datetime',
      required: true, initial: () => toDateTimeInput(now),
      hint: 'The date of the resolution, from the minutes. The seven days run from here.',
    },
    {
      name: 'due_by', label: 'Letter due', type: 'datetime', required: true,
      initial: () => toDateTimeInput(plusCalendarDays(now, 7)),
      hint: 'Seven calendar days — weekends count, unlike the acknowledgement rule.',
    },
    {
      name: 'reasons', label: 'Reasons for refusal', type: 'textarea', required: true, full: true,
      placeholder: 'Each ground, numbered, as it will appear in the letter',
      hint: 'Mandatory. A refusal without reasons is void and cannot be appealed against.',
    },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true },
  ]
})

// ── Serve the letter ────────────────────────────────────────────────────

const sendTarget = ref<Record<string, unknown> | null>(null)
const sendMethod = ref<string>('registered_post')
const sendAt = ref('')
const sending = ref(false)
const sendError = ref<string | null>(null)
let reloadRegister: (() => Promise<void>) | null = null

function askSend(row: Record<string, unknown>, reload: () => Promise<void>) {
  sendTarget.value = row
  sendMethod.value = 'registered_post'
  sendAt.value = toDateTimeInput(new Date().toISOString())
  sendError.value = null
  reloadRegister = reload
}

async function confirmSend() {
  if (!sendTarget.value) return
  sending.value = true
  sendError.value = null
  try {
    await updateEntry('refusals', sendTarget.value.id as string, {
      sent_at: new Date(sendAt.value).toISOString(),
      sent_method: sendMethod.value,
    })
    sendTarget.value = null
    overview.invalidate()
    await reloadRegister?.()
  } catch (err) {
    sendError.value = errorMessage(err, 'The letter was not marked as served.')
  } finally {
    sending.value = false
  }
}

const overdue = computed(() => num(overview.data.value?.refusals.overdue))
const outstanding = computed(() => num(overview.data.value?.refusals.outstanding))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Statutory clocks</span>
        <h2 class="ins-title">Refusal letters</h2>
        <p class="ins-lede">
          Seven calendar days from the Council resolution to serve the letter,
          with reasons. The applicant’s appeal window runs from service, so the
          date and method recorded here are the ones that decide whether an
          appeal is in time.
        </p>
      </div>
    </header>

    <p v-if="overdue" class="ins-banner t-negative" role="status">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>
        <strong>{{ overdue }} refusal{{ overdue === 1 ? '' : 's' }} past the seven-day date.</strong>
        Late service is itself a ground of appeal.
      </span>
    </p>
    <p v-else-if="outstanding" class="ins-banner t-info" role="status">
      <Scale :size="15" aria-hidden="true" />
      <span>
        {{ outstanding }} refusal letter{{ outstanding === 1 ? '' : 's' }} still to serve,
        all inside the seven-day window.
      </span>
    </p>
    <p v-else class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" />
      <span>Every refusal on the register has been served.</span>
    </p>

    <ClerkRegister
      register="refusals"
      title="Refusals"
      add-label="Draft refusal letter"
      search-hint="Letter number, recipient or a reason"
      requires-file
      :columns="columns"
      :fields="fields"
    >
      <template #row-actions="{ row, reload }">
        <UiButton v-if="!row.sent_at && !row.voided_at" size="sm" variant="secondary"
                  @click="askSend(row, reload)">
          <template #icon><Send :size="13" /></template>
          Mark served
        </UiButton>
      </template>
    </ClerkRegister>

    <UiSheet :open="!!sendTarget" title="Record service of the refusal"
             subtitle="The appeal window runs from this date"
             width="30rem" @close="sendTarget = null" @update:open="sendTarget = null">
      <form class="clk-send" @submit.prevent="confirmSend">
        <p class="ins-banner t-warning">
          <Scale :size="15" aria-hidden="true" />
          <span>
            Letter <strong class="ins-mono">{{ sendTarget?.letter_no }}</strong>
            to {{ sendTarget?.recipient }}. The applicant’s time to appeal starts
            on the date you record here.
          </span>
        </p>

        <p v-if="sendError" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ sendError }}</span>
        </p>

        <div class="ins-form">
          <div class="ins-field">
            <label class="ins-label" for="clk-ref-when">Served at</label>
            <input id="clk-ref-when" v-model="sendAt" type="datetime-local" class="ins-input" required />
          </div>
          <div class="ins-field">
            <label class="ins-label" for="clk-ref-how">Served by</label>
            <select id="clk-ref-how" v-model="sendMethod" class="ins-input" required>
              <option v-for="m in SENT_METHODS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
            <p class="ins-hint">Keep the registered-post slip with the file.</p>
          </div>
        </div>

        <div class="clk-send-foot">
          <UiButton variant="ghost" type="button" @click="sendTarget = null">Cancel</UiButton>
          <UiButton variant="primary" type="submit" :loading="sending">Record service</UiButton>
        </div>
      </form>
    </UiSheet>
  </div>
</template>

<style scoped>
.clk-send { display:flex; flex-direction:column; gap:var(--ent-s4); }
.clk-send-foot { display:flex; justify-content:flex-end; gap:var(--ent-s2);
  padding-top:var(--ent-s3); border-top:1px solid var(--ent-line); }
</style>
