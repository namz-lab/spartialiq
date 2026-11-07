<script setup lang="ts">
// Public notices — two registers, both of them proof.
//
// A development application that affects neighbours must be advertised and
// the abutting owners must be told. If either is not done, or is done and
// cannot be proved, an objector who was never served has a live ground of
// appeal against whatever the council decides. These two registers are the
// proof:
//
//   Newspaper certificates   the publisher's certificate that the notice ran
//                            on the date it says. The objection period is
//                            counted from the advertisement date, so that
//                            date is the one the council is held to.
//   Abutting owners          one row per neighbour, with the delivery
//                            receipt reference. Per person, not per file:
//                            "we notified the neighbours" is not an answer to
//                            "was Mrs Moyo notified".
//
// Both used to live in localStorage.

import { computed, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import { asLabel, deadlineTone, formatDate, toDateInput, toDateTimeInput } from '@/planning-clerk/console'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { num } from '@/services/planningClerk'
import { Newspaper, Users, Megaphone } from 'lucide-vue-next'

const overview = useClerkOverview()

type Tab = 'certificates' | 'abutters'
const tab = ref<Tab>('certificates')

// ── Newspaper certificates ──────────────────────────────────────────────

const certColumns = computed<ClerkColumn[]>(() => [
  {
    key: 'tpd_reference', label: 'File', mono: true,
    value: (r) => (r.tpd_reference as string) || '—',
  },
  { key: 'newspaper_name', label: 'Newspaper' },
  { key: 'advert_date', label: 'Published', nowrap: true, value: (r) => formatDate(r.advert_date as string) },
  {
    key: 'second_advert_date', label: 'Second insertion',
    value: (r) => formatDate(r.second_advert_date as string), secondary: true,
  },
  {
    key: 'objection_closes_on',
    label: 'Objections close',
    nowrap: true,
    value: (r) => (r.objection_closes_on
      ? `${formatDate(r.objection_closes_on as string)} · ${deadlineTone(r.objection_closes_on as string).label}`
      : 'Not set'),
    tone: (r) => {
      if (!r.objection_closes_on) return 'neutral'
      const t = deadlineTone(r.objection_closes_on as string).tone
      // An open window is information; a closed one is a fact the planner
      // needs before determining, so it reads as settled rather than late.
      return t === 'overdue' ? 'neutral' : t === 'today' || t === 'soon' ? 'warning' : 'info'
    },
  },
  {
    key: 'certificate_received_at',
    label: 'Certificate held',
    nowrap: true,
    value: (r) => (r.certificate_received_at ? formatDate(r.certificate_received_at as string) : 'Not yet'),
    // The advert running is not the proof — the publisher's certificate is.
    // A file with an advert and no certificate is the gap that matters.
    tone: (r) => (r.certificate_received_at ? 'positive' : 'warning'),
  },
  { key: 'filed_under_ref', label: 'Filed under', mono: true, secondary: true },
  { key: 'filed_by_name', label: 'Filed by', secondary: true },
])

const certFields = computed<ClerkField[]>(() => {
  const today = new Date()
  // Thirty days is the council's usual objection window; it is seeded, not
  // enforced, because the period can differ by application type.
  const close = new Date(today.getTime() + 30 * 86_400_000)
  return [
    { name: 'newspaper_name', label: 'Newspaper', type: 'text', required: true,
      placeholder: 'e.g. The Chronicle' },
    { name: 'advert_date', label: 'Date published', type: 'date', required: true,
      initial: () => toDateInput(today.toISOString()),
      hint: 'The date on the paper. The objection period is counted from here.' },
    { name: 'second_advert_date', label: 'Second insertion', type: 'date',
      hint: 'Only where the council advertises twice.' },
    { name: 'objection_closes_on', label: 'Objections close', type: 'date',
      initial: () => toDateInput(close.toISOString()) },
    { name: 'certificate_received_at', label: 'Certificate received', type: 'date',
      hint: 'Leave blank until the publisher’s certificate is actually in the file.' },
    { name: 'filed_under_ref', label: 'Filed under reference', type: 'text', required: true,
      placeholder: 'Where the certificate physically is' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true },
  ]
})

// ── Abutting owners ─────────────────────────────────────────────────────

const METHODS = [
  { value: 'hand_delivered', label: 'Hand delivered' },
  { value: 'registered_post', label: 'Registered post' },
  { value: 'courier', label: 'Courier' },
  { value: 'email', label: 'Email' },
] as const

const abutterColumns = computed<ClerkColumn[]>(() => [
  {
    key: 'tpd_reference', label: 'File', mono: true,
    value: (r) => (r.tpd_reference as string) || '—',
  },
  { key: 'abutter_name', label: 'Neighbour' },
  { key: 'abutter_stand_number', label: 'Stand', mono: true },
  { key: 'notified_at', label: 'Served', nowrap: true, value: (r) => formatDate(r.notified_at as string) },
  { key: 'method', label: 'How', value: (r) => asLabel(r.method as string) },
  {
    key: 'receipt_ref', label: 'Receipt', mono: true,
    // Post and courier are proved by the tracking number and the database
    // refuses them without one; hand delivery is proved by the signature.
    tone: (r) => (!r.receipt_ref && ['registered_post', 'courier'].includes(r.method as string)
      ? 'negative' : null),
    secondary: true,
  },
  {
    key: 'responded', label: 'Responded',
    value: (r) => (r.responded ? 'Yes' : 'No'),
    tone: (r) => (r.responded ? 'info' : null),
    secondary: true,
  },
  { key: 'abutter_address', label: 'Address', secondary: true },
  { key: 'served_by_name', label: 'Served by', secondary: true },
])

const abutterFields = computed<ClerkField[]>(() => [
  { name: 'abutter_name', label: 'Neighbour’s name', type: 'text', required: true },
  { name: 'abutter_stand_number', label: 'Their stand number', type: 'text' },
  { name: 'abutter_address', label: 'Address served', type: 'text', required: true, full: true },
  { name: 'notified_at', label: 'Served at', type: 'datetime',
    initial: () => toDateTimeInput(new Date().toISOString()) },
  { name: 'method', label: 'How it was served', type: 'select', required: true,
    options: METHODS, initial: 'hand_delivered' },
  { name: 'receipt_ref', label: 'Delivery receipt reference', type: 'text',
    hint: 'Required for registered post or courier — it is the proof of service.' },
  { name: 'responded', label: 'Has responded', type: 'checkbox',
    hint: 'Tick once they have written in. Their objection itself goes in the correspondence log.' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
])

const windowsOpen = computed(() => num(overview.data.value?.certificates.objection_windows_open))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Statutory clocks</span>
        <h2 class="ins-title">Public notices</h2>
        <p class="ins-lede">
          Two registers, and both of them are proof. An objector who was never
          served, or a notice the council cannot show ran on the date it says,
          is a live ground of appeal against whatever is decided.
        </p>
      </div>
      <div class="ins-actions">
        <div class="ins-seg" role="tablist" aria-label="Notice registers">
          <button type="button" role="tab" :aria-selected="tab === 'certificates'"
                  @click="tab = 'certificates'">
            <Newspaper :size="14" aria-hidden="true" />
            Newspaper
          </button>
          <button type="button" role="tab" :aria-selected="tab === 'abutters'"
                  @click="tab = 'abutters'">
            <Users :size="14" aria-hidden="true" />
            Neighbours
          </button>
        </div>
      </div>
    </header>

    <p v-if="windowsOpen" class="ins-banner t-info" role="status">
      <Megaphone :size="15" aria-hidden="true" />
      <span>
        {{ windowsOpen }} objection period{{ windowsOpen === 1 ? ' is' : 's are' }} still open.
        The planner cannot determine those applications until they close.
      </span>
    </p>

    <ClerkRegister
      v-if="tab === 'certificates'"
      register="certificates"
      title="Newspaper certificates"
      lede="The publisher’s certificate is the admissible proof, not the cutting. A row with an advertisement date and no certificate is the gap to chase."
      add-label="File a certificate"
      search-hint="Newspaper or filing reference"
      requires-file
      :columns="certColumns"
      :fields="certFields"
    />

    <ClerkRegister
      v-else
      register="abutters"
      title="Abutting-owner notifications"
      lede="One row per neighbour. “We notified the neighbours” is not an answer to “was Mrs Moyo notified”."
      add-label="Record a notification"
      search-hint="Neighbour, stand, address or receipt reference"
      requires-file
      :columns="abutterColumns"
      :fields="abutterFields"
    />
  </div>
</template>
