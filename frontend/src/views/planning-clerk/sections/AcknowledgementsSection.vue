<script setup lang="ts">
// Acknowledgement letters.
//
// Two statutory clocks start here and this is the only screen that shows both.
// The letter must go out within five WORKING days of receipt; the same letter
// starts the three-month determination period, after which an undetermined
// application is deemed refused and the applicant may appeal on that ground
// alone. A clerk who misses the first has a procedural problem; a council that
// misses the second has lost the decision.
//
// One live letter per file: the unique index in migration 125 refuses a second
// one, and the server says so in words rather than as a constraint name.
//
// The due dates are proposed here and stored by the server. They are EDITABLE
// on the form, because plusWorkingDays skips weekends but not public holidays
// — Zimbabwe's move, and a hardcoded list that silently went stale would
// produce a deadline wrong in the council's favour. See console.ts.

import { computed, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import {
  asLabel, deadlineTone, formatDate,
  plusWorkingDays, plusMonths, toDateTimeInput,
} from '@/planning-clerk/console'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { updateEntry, errorMessage, num } from '@/services/planningClerk'
import UiButton from '@/components/ui/UiButton.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import { AlertTriangle, Send, CheckCircle2, Clock } from 'lucide-vue-next'

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
    value: (r) => (r.tpd_reference as string) || (r.application_register_no as string) || '—',
  },
  { key: 'recipient', label: 'To' },
  { key: 'received_at', label: 'Received', nowrap: true, value: (r) => formatDate(r.received_at as string) },
  {
    key: 'due_by',
    label: '5-day letter',
    nowrap: true,
    value: (r) => (r.sent_at
      ? `Sent ${formatDate(r.sent_at as string)}`
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
    key: 'determination_due_by',
    label: '3-month clock',
    nowrap: true,
    value: (r) => (r.determination_due_by
      ? deadlineTone(r.determination_due_by as string).label
      : '—'),
    tone: (r) => {
      if (!r.determination_due_by) return null
      const t = deadlineTone(r.determination_due_by as string).tone
      return t === 'overdue' ? 'negative' : t === 'today' || t === 'soon' ? 'warning' : 'neutral'
    },
    secondary: true,
  },
  { key: 'sent_method', label: 'Sent by', value: (r) => asLabel(r.sent_method as string), secondary: true },
  { key: 'drafted_by_name', label: 'Drafted by', secondary: true },
])

/**
 * The form seeds both clocks from the receipt date the clerk enters.
 *
 * Seeded once when the form opens, not recomputed as the receipt date is
 * edited: a clerk who has deliberately moved a due date for a public holiday
 * should not have it silently reset when they correct a typo in another box.
 * The hints say where the numbers came from.
 */
const fields = computed<ClerkField[]>(() => {
  const now = new Date().toISOString()
  return [
    {
      name: 'letter_no', label: 'Letter number', type: 'text', required: true,
      placeholder: 'e.g. VRDC/PL/ACK/2026/0142',
      hint: 'Cannot be changed once written — it is the letter’s identity.',
    },
    { name: 'recipient', label: 'Addressed to', type: 'text', required: true, full: true },
    {
      name: 'application_register_no', label: 'Development Register number', type: 'text',
      hint: 'As entered in the Development Register, if it differs from the TPD reference.',
    },
    {
      name: 'received_at', label: 'Application received', type: 'datetime', required: true,
      initial: () => toDateTimeInput(now),
      hint: 'The clerk’s date stamp on the TPD form. Acknowledgement is due two weeks after this (s.26(2)(a)).',
    },
    {
      name: 'due_by', label: 'Acknowledgement due', type: 'datetime', required: true,
      initial: () => toDateTimeInput(plusWorkingDays(now, 5)),
      hint: 'The Act allows two weeks from receipt (s.26(2)(a)); the council’s own target is five working days, weekends excluded. Move it if a public holiday falls inside.',
    },
    {
      name: 'determination_due_by', label: 'Determination due', type: 'datetime',
      initial: () => toDateTimeInput(plusMonths(now, 3)),
      hint: 'Three months from the date this acknowledgement is issued, not from receipt (s.26(7)); four for a subdivision (s.40(6)). Move it if the letter goes out on a later day. After this an undetermined application is deemed refused.',
    },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true },
  ]
})

// ── Mark a letter as sent ───────────────────────────────────────────────
// A letter is not sent until it has gone out AND the clerk can say how, which
// is why this is a short form rather than a one-click toggle. "We sent it" with
// no method recorded is what the council cannot prove at an appeal, and the
// database refuses it (clerk_ack_sent_has_method).

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
    await updateEntry('acknowledgements', sendTarget.value.id as string, {
      sent_at: new Date(sendAt.value).toISOString(),
      sent_method: sendMethod.value,
    })
    sendTarget.value = null
    overview.invalidate()
    await reloadRegister?.()
  } catch (err) {
    sendError.value = errorMessage(err, 'The letter was not marked as sent.')
  } finally {
    sending.value = false
  }
}

const overdue = computed(() => num(overview.data.value?.acknowledgements.overdue))
const outstanding = computed(() => num(overview.data.value?.acknowledgements.outstanding))
const determinationSoon = computed(() =>
  num(overview.data.value?.acknowledgements.determination_soon))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Statutory clocks</span>
        <h2 class="ins-title">Acknowledgement letters</h2>
        <p class="ins-lede">
          Two weeks from receipt to acknowledge (the council aims for five working days), and the date
          of the letter starts the three-month determination period. One live letter per file.
        </p>
      </div>
    </header>

    <!-- Overdue first and stated as a count, because it is the only number on
         this screen that means somebody has to do something today. -->
    <p v-if="overdue" class="ins-banner t-negative" role="status">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>
        <strong>{{ overdue }} acknowledgement{{ overdue === 1 ? '' : 's' }} past the five-day date.</strong>
        The letter is late from the day after it was due, not from the day it is noticed.
      </span>
    </p>
    <p v-else-if="outstanding" class="ins-banner t-info" role="status">
      <Clock :size="15" aria-hidden="true" />
      <span>
        {{ outstanding }} letter{{ outstanding === 1 ? '' : 's' }} still to go out,
        all of them inside the five-day window.
      </span>
    </p>
    <p v-else class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" />
      <span>Every acknowledgement on the register has been sent.</span>
    </p>

    <p v-if="determinationSoon" class="ins-banner t-warning" role="status">
      <Clock :size="15" aria-hidden="true" />
      <span>
        <strong>{{ determinationSoon }} application{{ determinationSoon === 1 ? '' : 's' }}
          within a fortnight of the three-month date.</strong>
        An application not determined by then is deemed refused, and the
        applicant may appeal on that ground alone.
      </span>
    </p>

    <ClerkRegister
      register="acknowledgements"
      title="Acknowledgements"
      add-label="Draft acknowledgement"
      search-hint="Letter number, register number or recipient"
      requires-file
      :columns="columns"
      :fields="fields"
    >
      <template #row-actions="{ row, reload }">
        <UiButton v-if="!row.sent_at && !row.voided_at" size="sm" variant="secondary"
                  @click="askSend(row, reload)">
          <template #icon><Send :size="13" /></template>
          Mark sent
        </UiButton>
      </template>
    </ClerkRegister>

    <UiSheet :open="!!sendTarget" title="Mark the letter as sent"
             subtitle="How it went out is part of the record"
             width="30rem" @close="sendTarget = null" @update:open="sendTarget = null">
      <form class="clk-send" @submit.prevent="confirmSend">
        <p class="ins-banner t-info">
          <Send :size="15" aria-hidden="true" />
          <span>
            Letter <strong class="ins-mono">{{ sendTarget?.letter_no }}</strong>
            to {{ sendTarget?.recipient }}.
          </span>
        </p>

        <p v-if="sendError" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ sendError }}</span>
        </p>

        <div class="ins-form">
          <div class="ins-field">
            <label class="ins-label" for="clk-ack-when">Sent at</label>
            <input id="clk-ack-when" v-model="sendAt" type="datetime-local" class="ins-input" required />
          </div>
          <div class="ins-field">
            <label class="ins-label" for="clk-ack-how">Sent by</label>
            <select id="clk-ack-how" v-model="sendMethod" class="ins-input" required>
              <option v-for="m in SENT_METHODS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
            <p class="ins-hint">
              Registered post is what the council can prove. Keep the slip.
            </p>
          </div>
        </div>

        <div class="clk-send-foot">
          <UiButton variant="ghost" type="button" @click="sendTarget = null">Cancel</UiButton>
          <UiButton variant="primary" type="submit" :loading="sending">Record as sent</UiButton>
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
