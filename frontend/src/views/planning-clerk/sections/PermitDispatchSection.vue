<script setup lang="ts">
// Permit dispatch — handing over the sealed instrument, and proving it.
//
// The date recorded here is the one that decides whether a later appeal is in
// time, because the appeal window runs from SERVICE and not from the Council
// resolution. A permit posted with no tracking number is a permit the council
// cannot prove it served, so the database refuses that combination
// (clerk_dispatch_posted_is_tracked) rather than leaving it to the form.
//
// The screen has two halves on purpose. The queue on the left is every
// approved permit that has no dispatch entry — the work. The register below
// is what has already gone out — the evidence. A clerk who only ever saw the
// register would have no way to know which permits are still sitting in the
// drawer.

import { computed, onMounted, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import { asLabel, formatDate, formatWhen, toDateTimeInput } from '@/planning-clerk/console'
import { useClerkNav } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { listRegister, errorMessage, num } from '@/services/planningClerk'
import { planningClerkService } from '@/services/planningClerkService'
import type { PermitApplication } from '@/services/developmentManagementService'
import UiButton from '@/components/ui/UiButton.vue'
import {
  Send, AlertTriangle, CheckCircle2, FolderOpen, RefreshCw, Inbox,
} from 'lucide-vue-next'

const nav = useClerkNav()
const overview = useClerkOverview()

const METHODS = [
  { value: 'collected', label: 'Collected at the counter' },
  { value: 'registered_post', label: 'Registered post' },
  { value: 'courier', label: 'Courier' },
  { value: 'email', label: 'Email' },
] as const

const columns = computed<ClerkColumn[]>(() => [
  {
    key: 'tpd_reference', label: 'File', mono: true,
    value: (r) => (r.tpd_reference as string) || '—',
  },
  { key: 'recipient', label: 'Handed to' },
  { key: 'dispatched_at', label: 'Dispatched', nowrap: true, value: (r) => formatWhen(r.dispatched_at as string) },
  {
    key: 'delivery_method', label: 'How',
    value: (r) => asLabel(r.delivery_method as string),
  },
  {
    key: 'proof_of_delivery_ref', label: 'Proof', mono: true,
    // Post and courier without a tracking number cannot happen (the database
    // refuses it), but a collection with no signature reference is a gap the
    // clerk can still close by writing the receipt-book page number in.
    tone: (r) => (r.proof_of_delivery_ref ? 'positive' : 'warning'),
    value: (r) => (r.proof_of_delivery_ref as string) || 'None recorded',
  },
  { key: 'applicant_name', label: 'Applicant', secondary: true },
  { key: 'dispatched_by_name', label: 'By', secondary: true },
])

const fields = computed<ClerkField[]>(() => [
  { name: 'recipient', label: 'Handed to', type: 'text', required: true, full: true,
    placeholder: 'The person who took it, and in what capacity' },
  { name: 'delivery_method', label: 'How', type: 'select', required: true,
    options: METHODS, initial: 'collected' },
  { name: 'dispatched_at', label: 'Dispatched at', type: 'datetime',
    initial: () => toDateTimeInput(new Date().toISOString()),
    hint: 'The applicant’s time to appeal runs from this date.' },
  { name: 'proof_of_delivery_ref', label: 'Proof of delivery', type: 'text',
    hint: 'Tracking number for post or courier — required. For a collection, the receipt-book page.' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
])

// ── The queue: approved permits with nothing dispatched against them ────

const queue = ref<PermitApplication[]>([])
const dispatchedIds = ref<Set<string>>(new Set())
const queueLoading = ref(false)
const queueError = ref<string | null>(null)

async function loadQueue() {
  queueLoading.value = true
  queueError.value = null
  try {
    // Two reads rather than a join, because the approved-permit list comes
    // from the development-management API and the dispatch register from the
    // clerk's. Matching them here is a set intersection over a few hundred
    // ids; pushing it into SQL would mean a clerk endpoint that reaches into
    // the planner's tables to answer a question about the clerk's own book.
    const [approved, sent] = await Promise.all([
      planningClerkService.dispatchQueue(),
      listRegister('dispatches', { limit: 500 }),
    ])
    dispatchedIds.value = new Set(
      sent.rows.map((d) => d.permit_application_id).filter(Boolean) as string[])
    queue.value = approved.filter((p) => !dispatchedIds.value.has(p.id))
  } catch (err) {
    queueError.value = errorMessage(err, 'Could not read the approved permits.')
    queue.value = []
  } finally {
    queueLoading.value = false
  }
}

onMounted(loadQueue)

function openAndDispatch(permit: PermitApplication) {
  // Opening the file rather than dispatching straight from the row: the form
  // writes against whichever file is open, and a clerk should see which one
  // that is in the bar before they fill anything in.
  nav.openFile(permit.id)
}

const approvedTotal = computed(() => num(overview.data.value?.permits.approved))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Decisions &amp; enforcement</span>
        <h2 class="ins-title">Permit dispatch</h2>
        <p class="ins-lede">
          Handing over the sealed instrument, and the proof that it happened.
          The appeal window runs from service, so the date and the delivery
          reference recorded here are what the council is held to.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="queueLoading" @click="loadQueue">
          <template #icon><RefreshCw :size="14" :class="{ 'ins-spin': queueLoading }" /></template>
          Refresh queue
        </UiButton>
      </div>
    </header>

    <!-- The work, before the evidence. -->
    <section class="ins-card">
      <header class="ins-card-head">
        <h3>
          <Send :size="15" aria-hidden="true" />
          Waiting to be issued
          <span class="ins-count">{{ queue.length }}</span>
        </h3>
        <span class="clk-disp-of">of {{ approvedTotal }} approved</span>
      </header>

      <div class="ins-card-body">
        <p v-if="queueError" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ queueError }}</span>
        </p>

        <div v-else-if="queueLoading && !queue.length" class="clk-disp-load" aria-busy="true">
          <span v-for="n in 3" :key="n" class="ins-skel" />
          <span class="ent-sr-only">Reading the approved permits</span>
        </div>

        <ul v-else-if="queue.length" class="ins-rows">
          <li v-for="p in queue" :key="p.id" class="ins-row"
              :class="{ open: nav.permit.value === p.id }">
            <div class="ins-row-main">
              <span class="ins-row-title ins-mono">
                {{ p.tpd_reference || p.dev_register_no || 'Unreferenced' }}
              </span>
              <span class="ins-row-meta">
                {{ p.applicant_name }} · Stand {{ p.stand_number || '—' }}
                · {{ p.suburb_ward || '—' }}
                · {{ asLabel(p.status) }}
                <template v-if="p.decision_at"> · decided {{ formatDate(p.decision_at) }}</template>
              </span>
            </div>
            <UiButton v-if="nav.permit.value !== p.id" size="sm" variant="secondary"
                      @click="openAndDispatch(p)">
              <template #icon><FolderOpen :size="13" /></template>
              Open file
            </UiButton>
            <span v-else class="clk-disp-here">
              <CheckCircle2 :size="14" aria-hidden="true" />
              Open — use “Record dispatch” below
            </span>
          </li>
        </ul>

        <div v-else class="clk-disp-empty">
          <Inbox :size="22" aria-hidden="true" />
          <p>
            Every approved permit has been dispatched. Nothing is sitting in
            the drawer.
          </p>
        </div>
      </div>
    </section>

    <ClerkRegister
      register="dispatches"
      title="Dispatch register"
      add-label="Record dispatch"
      search-hint="Recipient or proof-of-delivery reference"
      requires-file
      :columns="columns"
      :fields="fields"
    />
  </div>
</template>

<style scoped>
.clk-disp-of { font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  font-variant-numeric:tabular-nums; }

.clk-disp-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-disp-load .ins-skel:nth-child(even) { width:80%; }

.ins-row.open { background:var(--ent-accent-soft); }
.clk-disp-here { display:inline-flex; align-items:center; gap:var(--ent-s2);
  flex-shrink:0; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); }

.clk-disp-empty { display:flex; flex-direction:column; align-items:center;
  gap:var(--ent-s3); padding:var(--ent-s6) var(--ent-s4); text-align:center;
  color:var(--ent-text-3); }
.clk-disp-empty p { margin:0; font-size:var(--ent-fs-sm); max-width:36ch;
  line-height:var(--ent-lh); }
</style>
