<script setup lang="ts">
// Annexure 2 Development Register — searchable + filterable list of all
// permit applications. Click a row (or Open) to load the statutory workflow
// with that permit. Migrated onto the enterprise kit: UiDataTable +
// UiStatusBadge + UiButton + --ent-* tokens.

import { ref, computed, onMounted } from 'vue'
import {
  dmApi, type PermitApplication, type PermitStatus, type DevType,
} from '@/services/developmentManagementService'
import { statusLabel, type CanonicalStatus, caseRef, devTypeLabel, wardLabel } from '@/composables/useApplicationPipeline'
import { toCsv, downloadCsv, type ReportColumn } from '@/composables/useReportBuilder'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useBreakpoint } from '@/composables/useBreakpoint'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { Search, RefreshCw, Download, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const emit = defineEmits<{ 'open-permit': [] }>()
const fb = useUiFeedback()
const planner = usePlannerCase()

const permits = ref<PermitApplication[]>([])
const loading = ref(false)
const exporting = ref(false)

// Server-side paging. The register used to fetch one page of 200 and show it
// as the whole register, so every application older than the 200 most recent
// was unreachable except by search.
const PAGE_SIZE = 50
const page = ref(0)
const total = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const rangeLabel = computed(() => {
  if (!total.value) return '0 records'
  const from = page.value * PAGE_SIZE + 1
  const to = Math.min(total.value, from + permits.value.length - 1)
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.value.toLocaleString()}`
})
const search = ref('')
const statusFilter = ref<PermitStatus|''>('')
const typeFilter = ref<DevType|''>('')

// Phase 16. On desktop the search box and the two selects share one toolbar
// row. At 375px three controls in a row give each about 110px, which is not
// enough for "All statuses" to be readable, let alone tappable. Below 768px
// the search keeps the row and the selects move into a sheet behind a
// Filters button.
//
// The filters still apply the moment they change, exactly as they do on
// desktop — the sheet is a container, not a staging area. A draft-and-Apply
// model would be a behaviour change dressed as a layout change, and with two
// selects it would cost the officer a tap rather than saving one.
const { isMobile } = useBreakpoint()
const filtersOpen = ref(false)

/** Drives the badge on the Filters button, so an officer can see that a
 *  filter is narrowing the register without opening the sheet to check. */
const activeFilterCount = computed(() =>
  (statusFilter.value ? 1 : 0) + (typeFilter.value ? 1 : 0))

function clearFilters() {
  statusFilter.value = ''
  typeFilter.value = ''
  refresh()
}

const filters = () => ({
  status: statusFilter.value || undefined,
  development_type: typeFilter.value || undefined,
  search: search.value.trim() || undefined,
})

/** New criteria start from the first page; paging keeps them. */
function refresh() {
  page.value = 0
  return load()
}
function goPage(n: number) {
  if (n < 0 || n >= pageCount.value || n === page.value) return
  page.value = n
  void load()
}

let seq = 0
async function load() {
  const mine = ++seq
  loading.value = true
  try {
    const res = await dmApi.listPermits({ ...filters(), limit: PAGE_SIZE, offset: page.value * PAGE_SIZE })
    if (mine !== seq) return // a newer search or page superseded this one
    permits.value = res.data
    total.value = Number(res.total) || 0
  } catch (e: unknown) {
    if (mine === seq) fb.showToast(fb.parseApiError(e, 'Could not load permits'), 'error')
  } finally {
    if (mine === seq) loading.value = false
  }
}
onMounted(refresh)

const STATUSES: CanonicalStatus[] = [
  'pending_payment', 'registered', 'acknowledged', 'circulation', 'objection_period',
  'under_review', 'awaiting_eo_decision', 'deferred',
  'approved', 'approved_with_conditions', 'refused', 'withdrawn', 'appealed',
]
const DEV_TYPES: DevType[] = [
  'new_building','alteration','extension','change_of_use',
  'subdivision','consolidation','rezoning','other',
]

// UiDataTable columns. Cell rendering is overridden per column via #cell-<key>.
const columns = [
  // Not sortable: the server orders the register newest-received first and a
  // column sort would reorder only the 50 rows of this page.
  { key:'dev_register_no',  label:'Reference',    width:'11rem', mono:true },
  { key:'applicant_name',   label:'Applicant' },
  { key:'stand_number',     label:'Stand / ward' },
  { key:'development_type', label:'Type',         width:'8.5rem' },
  { key:'status',           label:'Status',       width:'9.5rem' },
  { key:'received_at',      label:'Received',     width:'7rem' },
  { key:'fee_paid',         label:'Fee',          width:'5rem' },
]

const filtered = computed(() => permits.value)

async function openPermit(p: PermitApplication) {
  try {
    await planner.loadFromPermit(p.id)
    fb.showToast(`Opened ${caseRef(p)}`, 'success')
    emit('open-permit')
  } catch (e: unknown) {
    fb.openMessageBox({ kind:'error', title:'Could not load permit',
      message: fb.parseApiError(e, 'The permit could not be retrieved.') })
  }
}

const CSV_COLS: ReportColumn[] = [
  { key: 'reg', label: 'Register no', get: p => p.dev_register_no || '' },
  { key: 'tpd', label: 'TPD reference', get: p => p.tpd_reference || '' },
  { key: 'status', label: 'Status', get: p => statusLabel(p.status) },
  { key: 'type', label: 'Development type', get: p => devTypeLabel(p.development_type) },
  { key: 'applicant', label: 'Applicant', get: p => p.applicant_name || '' },
  { key: 'stand', label: 'Stand', get: p => p.stand_number || '' },
  { key: 'ward', label: 'Ward', get: p => p.suburb_ward || '' },
  { key: 'received', label: 'Received', get: p => p.received_at?.slice(0, 10) || '' },
  { key: 'fee', label: 'Fee paid', get: p => p.fee_paid ? 'Yes' : 'No' },
  { key: 'id', label: 'Permit ID', get: p => p.id },
]

/** Exports every record matching the filters, not just the page on screen. */
async function exportCsv() {
  exporting.value = true
  try {
    const rows = await dmApi.listAllPermits(filters())
    if (!rows.length) { fb.showToast('Nothing to export', 'warn'); return }
    downloadCsv(toCsv(rows, CSV_COLS), `development-register-${new Date().toISOString().slice(0, 10)}.csv`)
    fb.showToast(`Exported ${rows.length.toLocaleString()} records`, 'success')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not export the register'), 'error')
  } finally {
    exporting.value = false
  }
}

function fmtDate(iso: string|null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}
</script>

<template>
  <div class="pr">
    <header class="pr-head">
      <div class="pr-titles">
        <h2>Development Register</h2>
        <span class="pr-count" aria-live="polite">{{ loading && !total ? 'Loading…' : rangeLabel }}</span>
      </div>
      <UiButton size="sm" @click="exportCsv" :disabled="!total" :loading="exporting">
        <template #icon><Download :size="13" /></template>
        Export CSV
      </UiButton>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <div class="pr-filters">
      <div class="pr-search">
        <Search :size="14" aria-hidden="true" />
        <label class="ent-sr-only" for="pr-search">Search the register</label>
        <input id="pr-search" name="pr-search" v-model="search"
               type="search" placeholder="Register no, stand, applicant, ward — Enter"
               @keyup.enter="refresh" @search="refresh" />
      </div>

      <!-- Mobile: the selects live in a sheet, behind one button. -->
      <button
        v-if="isMobile"
        type="button"
        class="pr-filterbtn"
        :class="{ 'has-filters': activeFilterCount > 0 }"
        :aria-expanded="filtersOpen"
        aria-haspopup="dialog"
        @click="filtersOpen = true"
      >
        <SlidersHorizontal :size="14" aria-hidden="true" />
        Filters
        <span v-if="activeFilterCount" class="pr-filterbtn-count">{{ activeFilterCount }}</span>
      </button>

      <!-- Tablet and up: the selects sit in the toolbar. -->
      <template v-else>
        <label class="ent-sr-only" for="pr-status-filter">Filter by status</label>
        <select id="pr-status-filter" class="pr-select" name="pr-status-filter"
                v-model="statusFilter" @change="refresh">
          <option value="">All statuses</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</option>
        </select>
        <label class="ent-sr-only" for="pr-type-filter">Filter by development type</label>
        <select id="pr-type-filter" class="pr-select" name="pr-type-filter"
                v-model="typeFilter" @change="refresh">
          <option value="">All types</option>
          <option v-for="t in DEV_TYPES" :key="t" :value="t">{{ devTypeLabel(t) }}</option>
        </select>
      </template>
    </div>

    <!--
      Filter sheet. The controls inside are the same v-models the desktop
      toolbar binds, so there is one filter state and one refresh path.
    -->
    <UiSheet
      v-model:open="filtersOpen"
      variant="sheet"
      title="Filter the register"
      :subtitle="`${total.toLocaleString()} record${total === 1 ? '' : 's'} match`"
    >
      <div class="pr-sheet-fields">
        <div class="pr-sheet-field">
          <label class="pr-sheet-label" for="pr-status-filter-m">Status</label>
          <select id="pr-status-filter-m" class="pr-sheet-select"
                  v-model="statusFilter" @change="refresh">
            <option value="">All statuses</option>
            <option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</option>
          </select>
        </div>
        <div class="pr-sheet-field">
          <label class="pr-sheet-label" for="pr-type-filter-m">Development type</label>
          <select id="pr-type-filter-m" class="pr-sheet-select"
                  v-model="typeFilter" @change="refresh">
            <option value="">All types</option>
            <option v-for="t in DEV_TYPES" :key="t" :value="t">{{ devTypeLabel(t) }}</option>
          </select>
        </div>
      </div>

      <template #footer>
        <UiButton variant="secondary" :disabled="!activeFilterCount" @click="clearFilters">
          Clear filters
        </UiButton>
        <UiButton variant="primary" @click="filtersOpen = false">
          Show {{ total.toLocaleString() }} record{{ total === 1 ? '' : 's' }}
        </UiButton>
      </template>
    </UiSheet>

    <!--
      Mobile card roles are declared rather than inferred, so all eight
      register columns still reach the officer's phone: the register number
      identifies the card, the applicant names it, the status sits top-right
      where it is scanned, and the remaining four become meta rows. Nothing is
      dropped, so there is no "open the record to see the rest".
    -->
    <UiDataTable
      class="pr-table"
      :columns="columns"
      :rows="filtered"
      row-key="id"
      :loading="loading"
      clickable
      empty-message="No permits match the current filters."
      mobile-primary="dev_register_no"
      mobile-secondary="applicant_name"
      mobile-status="status"
      :mobile-meta="['stand_number', 'development_type', 'received_at', 'fee_paid']"
      @row-click="openPermit"
    >
      <template #cell-dev_register_no="{ row }"><span :class="{ 'pr-unreg': caseRef(row) === 'Unregistered' }">{{ caseRef(row) }}</span></template>
      <template #cell-stand_number="{ row }">{{ row.stand_number || '—' }} · {{ wardLabel(row.suburb_ward) }}</template>
      <template #cell-development_type="{ row }">{{ devTypeLabel(row.development_type) }}</template>
      <template #cell-status="{ row }"><UiStatusBadge :status="row.status" /></template>
      <template #cell-received_at="{ row }">{{ fmtDate(row.received_at) }}</template>
      <template #cell-fee_paid="{ row }">
        <span class="pr-fee" :class="{ paid: row.fee_paid }">{{ row.fee_paid ? 'PAID' : 'UNPAID' }}</span>
      </template>
    </UiDataTable>

    <nav v-if="total > PAGE_SIZE" class="pr-pager" aria-label="Register pages">
      <UiButton size="sm" variant="ghost" :disabled="page === 0 || loading" @click="goPage(page - 1)">
        <template #icon><ChevronLeft :size="14" /></template>
        Newer
      </UiButton>
      <span class="pr-pager-at">Page {{ page + 1 }} of {{ pageCount }}</span>
      <UiButton size="sm" variant="ghost" :disabled="page >= pageCount - 1 || loading" @click="goPage(page + 1)">
        Older
        <ChevronRight :size="14" aria-hidden="true" />
      </UiButton>
    </nav>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Migrated onto the enterprise token SSOT (src/styles/enterprise.css). */
.pr { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3);
  height: 100%; min-height: 0; }

.pr-head { display: flex; align-items: center; gap: var(--ent-s2); }
.pr-titles { flex: 1; display: flex; align-items: baseline; gap: var(--ent-s2); }
.pr-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold);
  color: var(--ent-text); letter-spacing: -0.01em; }
.pr-count { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

.pr-filters { display: flex; gap: var(--ent-s2); align-items: center; }
.pr-search { display: inline-flex; align-items: center; gap: var(--ent-s2);
  height: var(--ent-control-h); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  padding: 0 var(--ent-s3); background: var(--ent-surface); flex: 1; max-width: 24rem; color: var(--ent-text-3); }
.pr-search input { border: none; outline: none; flex: 1; background: transparent;
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.pr-select { height: var(--ent-control-h); padding: 0 var(--ent-s3);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r); background: var(--ent-surface);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text); cursor: pointer; }
.pr-search:focus-within, .pr-select:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }

.pr-fee { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); color: var(--ent-danger); letter-spacing: 0.03em; }
.pr-fee.paid { color: var(--ent-success); }
.pr-unreg { color: var(--ent-text-3); font-family: var(--ent-font); font-weight: var(--ent-fw-normal); font-style: italic; }

/* Let the table consume the remaining console height and scroll internally. */
.pr-table { flex: 1; min-height: 0; }

.pr-pager { display: flex; align-items: center; justify-content: flex-end; gap: var(--ent-s2); padding-bottom: var(--ent-s2); }
.pr-pager-at { font-size: var(--ent-fs-xs); color: var(--ent-text-3); font-variant-numeric: tabular-nums; }

/* ── Mobile filter button ───────────────────────────────────────────────── */
.pr-filterbtn {
  display: inline-flex; align-items: center; gap: var(--ent-s2); flex-shrink: 0;
  height: var(--ent-control-h); padding: 0 var(--ent-s4);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface); color: var(--ent-text);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm);
  font-weight: var(--ent-fw-semibold); cursor: pointer;
}
.pr-filterbtn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
/* Active filters change the border and add a count, not just a tint: an
   officer must be able to tell the register is narrowed without comparing
   two shades of grey in daylight. */
.pr-filterbtn.has-filters {
  border-color: var(--ent-accent); color: var(--ent-accent);
  background: var(--ent-accent-soft);
}
.pr-filterbtn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--ent-r-pill);
  background: var(--ent-accent); color: var(--ent-text-on-accent);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
}

/* ── Filter sheet ───────────────────────────────────────────────────────── */
.pr-sheet-fields { display: flex; flex-direction: column; gap: var(--ent-s5); }
.pr-sheet-field { display: flex; flex-direction: column; gap: var(--ent-s2); }
.pr-sheet-label {
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-2);
}
/* Full width and at the touch height: a select is the one control a thumb
   must hit precisely, because missing it opens nothing. */
.pr-sheet-select {
  width: 100%; min-height: var(--ent-touch-primary);
  padding: 0 var(--ent-control-px);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface); color: var(--ent-text);
  font-family: var(--ent-font);
}
.pr-sheet-select:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

/* ── Mobile: ≤767 ───────────────────────────────────────────────────────── */
@media (max-width: 767px) {
  .pr { padding: var(--ent-s3) var(--ent-s3) 0; }
  .pr-head { flex-wrap: wrap; }
  .pr-titles { flex: 1 0 100%; }
  .pr-search { max-width: none; }
}
</style>
