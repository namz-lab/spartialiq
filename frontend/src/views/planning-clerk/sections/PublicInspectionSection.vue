<script setup lang="ts">
// Public inspection of the Development Register.
//
// The register is open to public inspection, and the council records who
// inspected what. The same counter also takes requests for certified copies
// and for planning searches — the question a conveyancer asks before a
// transfer, which is most of this register's traffic and most of its revenue.
//
// The file link is OPTIONAL because most planning searches are against a
// stand with no application on file at all. `subject_description` carries
// what was asked about when there is nothing to link to.
//
// COPIES ARE A CHARGED SERVICE
// `clerk_inspection_copies_receipted` refuses a row that records copies
// issued with no receipt attached. That is how a counter loses money, and it
// is a database rule rather than a form rule so that it holds whatever writes
// to the register.

import { computed, onMounted, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import { asLabel, formatMoney, formatWhen, toDateTimeInput } from '@/planning-clerk/console'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { listRegister, num, type FeeReceipt } from '@/services/planningClerk'
import { Eye, Receipt as ReceiptIcon } from 'lucide-vue-next'

const overview = useClerkOverview()

const CAPACITIES = [
  { value: 'member_of_public', label: 'Member of the public' },
  { value: 'owner', label: 'Owner' },
  { value: 'agent', label: 'Agent' },
  { value: 'conveyancer', label: 'Conveyancer' },
  { value: 'surveyor', label: 'Surveyor' },
  { value: 'developer', label: 'Developer' },
  { value: 'other_authority', label: 'Another authority' },
  { value: 'media', label: 'Media' },
] as const

const KINDS = [
  { value: 'inspection', label: 'Inspected the register' },
  { value: 'planning_search', label: 'Planning search' },
  { value: 'certified_copy', label: 'Certified copy' },
  { value: 'plan_copy', label: 'Copy of plans' },
] as const

/**
 * Recent counter receipts, offered as the attachment for a copy request.
 *
 * Loaded once and kept: the clerk takes the payment and records the
 * inspection in the same minute, so the receipt they need is almost always
 * one of the last few written.
 */
const receipts = ref<FeeReceipt[]>([])
onMounted(async () => {
  try {
    const page = await listRegister('receipts', { limit: 40 })
    receipts.value = page.rows
  } catch {
    // The register still works without it; the clerk types nothing extra,
    // they just have no picker. Not worth an error banner on this screen.
    receipts.value = []
  }
})

const receiptOptions = computed(() => receipts.value.map((r) => ({
  value: r.id,
  label: `${r.receipt_no} · ${formatMoney(r.amount, r.currency)} · ${r.payer_name}`,
})))

const columns = computed<ClerkColumn[]>(() => [
  { key: 'inspected_at', label: 'When', nowrap: true, value: (r) => formatWhen(r.inspected_at as string) },
  { key: 'requester_name', label: 'Who' },
  {
    key: 'requester_capacity', label: 'Capacity',
    value: (r) => asLabel(r.requester_capacity as string), secondary: true,
  },
  {
    key: 'request_kind', label: 'Asked for',
    value: (r) => asLabel(r.request_kind as string),
    tone: (r) => (r.request_kind === 'inspection' ? 'neutral' : 'info'),
  },
  { key: 'subject_description', label: 'About' },
  {
    key: 'tpd_reference', label: 'File', mono: true,
    value: (r) => (r.tpd_reference as string) || 'No file',
    secondary: true,
  },
  {
    key: 'copies_issued', label: 'Copies',
    value: (r) => (num(r.copies_issued as number) ? String(r.copies_issued) : '—'),
    secondary: true,
  },
  { key: 'attended_by_name', label: 'Attended by', secondary: true },
])

const fields = computed<ClerkField[]>(() => [
  { name: 'requester_name', label: 'Name', type: 'text', required: true },
  { name: 'requester_capacity', label: 'In what capacity', type: 'select', required: true,
    options: CAPACITIES, initial: 'member_of_public' },
  { name: 'requester_contact', label: 'Contact', type: 'text',
    hint: 'Phone or email, if they gave one. Not required to inspect.' },
  { name: 'request_kind', label: 'What they asked for', type: 'select', required: true,
    options: KINDS, initial: 'inspection' },
  { name: 'inspected_at', label: 'When', type: 'datetime',
    initial: () => toDateTimeInput(new Date().toISOString()) },
  { name: 'copies_issued', label: 'Copies issued', type: 'number', step: '1',
    hint: 'Leave at zero for an inspection. Copies need a receipt attached below.' },
  {
    name: 'fee_receipt_id', label: 'Fee receipt', type: 'select',
    options: receiptOptions.value,
    hint: 'Required if any copies were issued — receipt the payment first, in Fees.',
  },
  { name: 'subject_description', label: 'What it was about', type: 'text', required: true, full: true,
    placeholder: 'Stand 4412 Mkoba 19 — zoning and any live application' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
])

const today = computed(() => num(overview.data.value?.inspections.today))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Front counter</span>
        <h2 class="ins-title">Public inspection</h2>
        <p class="ins-lede">
          The Development Register is open to public inspection, and this is
          the record of who inspected what. Certified copies and planning
          searches are logged here too — most of them are conveyancers asking
          before a transfer.
        </p>
      </div>
    </header>

    <p class="ins-banner t-info" role="status">
      <Eye :size="15" aria-hidden="true" />
      <span>
        <strong>{{ today }} inspection{{ today === 1 ? '' : 's' }} logged today.</strong>
        A search against a stand with no application on file is normal — describe
        what was asked about and leave the file unopened.
      </span>
    </p>

    <p v-if="!receipts.length" class="ins-banner t-warning">
      <ReceiptIcon :size="15" aria-hidden="true" />
      <span>
        No recent counter receipts to attach. Copies cannot be recorded as
        issued without one — take the payment in Fees first.
      </span>
    </p>

    <ClerkRegister
      register="inspections"
      title="Inspection register"
      add-label="Log an inspection"
      search-hint="Name, contact or what it was about"
      :columns="columns"
      :fields="fields"
    />
  </div>
</template>
