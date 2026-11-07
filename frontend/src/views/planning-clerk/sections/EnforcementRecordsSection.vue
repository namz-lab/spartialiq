<script setup lang="ts">
// Enforcement records — the public-inspection enforcement register.
//
// The clerk keeps this register; the planner issues the orders. It is
// read-only here for the same reason the Development Register is: an order's
// status is changed by serving it or by an inspection finding compliance, and
// a screen that let the register be edited directly would let it disagree
// with the record it is a view of.
//
// WHAT CHANGED, BESIDES THE STYLING
// The ten hardcoded order-type hexes are gone. They were a second colour
// system — violet, orange, cyan, two different reds — saying nothing except
// that ten decisions had been made separately, and they were applied as
// inline `background: hex + '22'`, which is an eight-digit alpha hex that
// does not respond to a theme at all. What a reader needs from this column is
// what KIND of order it is, which the label already says, and how serious it
// is, which is what the tone now carries.
//
// The owner's contact number has come out of the visible table and the
// export. This is a register open to public inspection; the owner's name and
// the stand are the register, a private telephone number is not.

import { computed, onActivated, onMounted, ref } from 'vue'
import { planningClerkService } from '@/services/planningClerkService'
import type { EnforcementOrder } from '@/services/developmentManagementService'
import { formatDate } from '@/planning-clerk/console'
import type { Tone } from '@/planning-clerk/registerSpec'
import UiButton from '@/components/ui/UiButton.vue'
import {
  ShieldAlert, Download, Search, RefreshCw, AlertTriangle, Inbox, ShieldCheck,
} from 'lucide-vue-next'

const orders = ref<EnforcementOrder[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const search = ref('')
const typeFilter = ref<'all' | EnforcementOrder['order_type']>('all')
const statusFilter = ref<'all' | EnforcementOrder['status']>('all')

const TYPE_LABEL: Record<EnforcementOrder['order_type'], string> = {
  stop_work: 'Stop-work', demolition: 'Demolition',
  rectification: 'Rectification', removal: 'Removal',
  cessation: 'Cessation', enforcement_notice: 'Enforcement notice',
  stop_notice: 'Stop notice', breach_of_condition: 'Breach of condition',
  retrospective_consent: 'Retrospective consent', reinstatement: 'Reinstatement',
}

const STATUS_LABEL: Record<EnforcementOrder['status'], string> = {
  draft: 'Draft', issued: 'Issued', served: 'Served',
  complied: 'Complied', non_complied: 'Non-complied',
  withdrawn: 'Withdrawn', appealed: 'Appealed',
  active: 'Active', extended: 'Extended', cancelled: 'Cancelled',
}

/**
 * How severe the order is, not which order it is.
 *
 * An order that stops work or demolishes a structure is the council's
 * heaviest instrument and reads as negative. Everything that asks for
 * something to be put right is a warning. A retrospective consent is the one
 * that resolves a breach rather than creating one.
 */
const TYPE_TONE: Record<EnforcementOrder['order_type'], Tone> = {
  stop_work: 'negative', demolition: 'negative', cessation: 'negative',
  enforcement_notice: 'negative', stop_notice: 'negative',
  rectification: 'warning', removal: 'warning',
  breach_of_condition: 'warning', reinstatement: 'warning',
  retrospective_consent: 'info',
}

/** Where the order stands: settled in the council's favour, against, or live. */
const STATUS_TONE: Record<EnforcementOrder['status'], Tone> = {
  draft: 'neutral', withdrawn: 'neutral', cancelled: 'neutral',
  issued: 'info', served: 'info',
  active: 'warning', extended: 'warning', appealed: 'warning',
  complied: 'positive',
  non_complied: 'negative',
}

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    orders.value = await planningClerkService.enforcementOrders()
  } catch {
    loadError.value = 'Could not read the enforcement register. Check the connection and try again.'
    orders.value = []
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
onActivated(() => { void refresh() })

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return orders.value.filter((o) => {
    if (typeFilter.value !== 'all' && o.order_type !== typeFilter.value) return false
    if (statusFilter.value !== 'all' && o.status !== statusFilter.value) return false
    if (!term) return true
    return [o.order_reference, o.stand_number, o.owner_name, o.suburb_ward,
      o.breach_description, o.required_action]
      .some((v) => (v || '').toLowerCase().includes(term))
  })
})

const counts = computed(() => ({
  total: orders.value.length,
  // "Live" is the count a clerk is asked for, and it is more than `active`:
  // an order that has been served and not yet complied with is live work
  // whatever the column says.
  live: orders.value.filter((o) =>
    ['active', 'issued', 'served', 'extended', 'non_complied'].includes(o.status)).length,
  breached: orders.value.filter((o) => o.status === 'non_complied').length,
}))

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv() {
  // No owner_contact. See the header.
  const head = ['order_reference', 'order_type', 'status', 'stand_number', 'suburb_ward',
    'owner_name', 'issued_at', 'compliance_period_days',
    'breach_description', 'required_action']
  const lines = filtered.value.map((o) => [
    o.order_reference, TYPE_LABEL[o.order_type], STATUS_LABEL[o.status],
    o.stand_number, o.suburb_ward, o.owner_name,
    o.issued_at, o.compliance_period,
    o.breach_description, o.required_action,
  ].map(esc).join(','))
  const blob = new Blob([[head.join(','), ...lines].join('\r\n')],
    { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `enforcement-register-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Decisions &amp; enforcement</span>
        <h2 class="ins-title">Enforcement records</h2>
        <p class="ins-lede">
          The public-inspection register of orders the planner has issued.
          Read-only here — an order's status changes when it is served or when
          an inspection finds compliance.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="loading" @click="refresh">
          <template #icon><RefreshCw :size="14" :class="{ 'ins-spin': loading }" /></template>
          Refresh
        </UiButton>
        <UiButton size="sm" variant="secondary" :disabled="!filtered.length" @click="exportCsv">
          <template #icon><Download :size="14" /></template>
          CSV
        </UiButton>
      </div>
    </header>

    <p v-if="counts.breached" class="ins-banner t-negative" role="status">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>
        <strong>{{ counts.breached }} order{{ counts.breached === 1 ? '' : 's' }}
          recorded as not complied with.</strong>
        Those are the files the planner escalates.
      </span>
    </p>
    <p v-else class="ins-banner t-info" role="status">
      <ShieldAlert :size="15" aria-hidden="true" />
      <span>
        {{ counts.live }} live order{{ counts.live === 1 ? '' : 's' }}
        of {{ counts.total }} on the register.
      </span>
    </p>

    <p class="ins-banner t-info">
      <ShieldCheck :size="15" aria-hidden="true" />
      <span>
        Owners’ contact numbers are on the file, not in this register or its
        export — this is the list open to public inspection.
      </span>
    </p>

    <p v-if="loadError" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ loadError }}</span>
    </p>

    <div class="clk-enf-controls">
      <label class="ins-search clk-enf-find">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search the enforcement register</span>
        <input v-model="search" type="search"
               placeholder="Order reference, stand, owner or breach" />
      </label>
      <select v-model="typeFilter" class="ins-input clk-enf-select"
              aria-label="Filter by order type">
        <option value="all">All order types</option>
        <option v-for="(label, key) in TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="statusFilter" class="ins-input clk-enf-select"
              aria-label="Filter by status">
        <option value="all">All statuses</option>
        <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>

    <div v-if="loading && !orders.length" class="clk-enf-load" aria-busy="true">
      <span v-for="n in 5" :key="n" class="ins-skel" />
      <span class="ent-sr-only">Reading the enforcement register</span>
    </div>

    <section v-else-if="filtered.length" class="ins-card">
      <div class="clk-enf-scroll">
        <table class="clk-enf-table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Type</th>
              <th scope="col">Stand</th>
              <th class="sec" scope="col">Owner</th>
              <th class="sec" scope="col">Issued</th>
              <th class="sec" scope="col">Period</th>
              <th scope="col">Status</th>
              <th class="sec" scope="col">Breach &amp; required action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in filtered" :key="o.id">
              <td class="ins-mono">{{ o.order_reference }}</td>
              <td>
                <span class="clk-enf-chip" :class="`t-${TYPE_TONE[o.order_type]}`">
                  {{ TYPE_LABEL[o.order_type] }}
                </span>
              </td>
              <td>
                <span class="ins-mono">{{ o.stand_number }}</span>
                <span class="clk-enf-sub">{{ o.suburb_ward || '—' }}</span>
              </td>
              <td class="sec">{{ o.owner_name }}</td>
              <td class="sec">{{ formatDate(o.issued_at) }}</td>
              <td class="sec ins-mono clk-enf-days">{{ o.compliance_period }}d</td>
              <td>
                <span class="clk-enf-chip" :class="`t-${STATUS_TONE[o.status]}`">
                  {{ STATUS_LABEL[o.status] }}
                </span>
              </td>
              <td class="sec clk-enf-breach">
                <span>{{ o.breach_description }}</span>
                <span class="clk-enf-sub">→ {{ o.required_action }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-else class="clk-enf-empty">
      <Inbox :size="22" aria-hidden="true" />
      <p v-if="search || typeFilter !== 'all' || statusFilter !== 'all'">
        No enforcement order matches those filters.
      </p>
      <p v-else>
        The enforcement register is empty. Orders appear here as the planner
        issues them.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Tokens only. The ten inline `hex + '22'` badge colours are gone — an
   eight-digit alpha hex cannot follow a theme, and the order type's severity
   is what the reader actually needs from that column. */

.clk-enf-controls { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.clk-enf-find { flex:1; min-width:16rem; }
.clk-enf-select { width:auto; min-width:11rem; }

.clk-enf-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-enf-load .ins-skel:nth-child(even) { width:78%; }

.clk-enf-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.clk-enf-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.clk-enf-table th, .clk-enf-table td {
  padding:var(--ent-s2) var(--ent-s3); text-align:left; vertical-align:top;
  border-bottom:1px solid var(--ent-line); }
.clk-enf-table th {
  position:sticky; top:0; z-index:var(--ent-z-sticky);
  background:var(--ent-surface-2); color:var(--ent-text-3);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.05em; text-transform:uppercase; white-space:nowrap;
  border-bottom:1px solid var(--ent-line-strong); }
.clk-enf-table td { color:var(--ent-text); line-height:var(--ent-lh); }
.clk-enf-table tbody tr:hover td { background:var(--ent-surface-2); }

.clk-enf-chip { display:inline-block; padding:1px var(--ent-s2);
  border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); white-space:nowrap;
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg);
  border:1px solid var(--ent-tone-neutral-line); }
.clk-enf-chip.t-info { background:var(--ent-tone-info-bg); color:var(--ent-tone-info-fg); border-color:var(--ent-tone-info-line); }
.clk-enf-chip.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); border-color:var(--ent-tone-positive-line); }
.clk-enf-chip.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); border-color:var(--ent-tone-warning-line); }
.clk-enf-chip.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); border-color:var(--ent-tone-negative-line); }

.clk-enf-sub { display:block; margin-top:2px; font-size:var(--ent-fs-micro);
  color:var(--ent-text-3); }
.clk-enf-days { text-align:right; font-variant-numeric:tabular-nums; }
.clk-enf-breach { max-width:28rem; }

.clk-enf-empty { display:flex; flex-direction:column; align-items:center;
  gap:var(--ent-s3); padding:var(--ent-s7) var(--ent-s4); text-align:center;
  color:var(--ent-text-3); }
.clk-enf-empty p { margin:0; font-size:var(--ent-fs-sm); max-width:40ch;
  line-height:var(--ent-lh); }

@media (max-width: 1023px) {
  .clk-enf-table th.sec, .clk-enf-table td.sec { display:none; }
  .clk-enf-select { flex:1; min-width:0; }
}
</style>
