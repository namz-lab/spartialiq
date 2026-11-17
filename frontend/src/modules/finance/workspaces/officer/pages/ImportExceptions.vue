<script setup lang="ts">
/**
 * The finance officer's exception review: every import batch in the selected year that still has
 * unresolved exceptions or failed, and, for the one chosen, each rejected row with its field, the
 * rule it broke and the server's message (`GET /finance/imports`, `GET /finance/imports/:id/exceptions`).
 *
 * Resolving an exception (correct, accept or set aside, with a note) stays in Imports, where the
 * batch, its mapping and its control totals are on screen; this page is the list to work through.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { FileWarning, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import type { ImportBatch, ImportException } from '../../../models/types'
import { batchesToReview, exceptionLabel } from '../imports'

const store = useFinanceStore()
const batches = ref<ImportBatch[]>([])
const error = ref<string | null>(null)
const loading = ref(false)
const chosen = ref<ImportBatch | null>(null)
const rows = ref<ImportException[]>([])
const rowsError = ref<string | null>(null)
const rowsLoading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    batches.value = await financeApi.imports({ ...(store.selectedYearId ? { financial_year_id: store.selectedYearId } : {}), limit: 200 })
  } catch (err) {
    error.value = messageOf(err, 'The import batches could not be read.')
  } finally {
    loading.value = false
  }
}
async function show(b: ImportBatch): Promise<void> {
  chosen.value = b
  rows.value = []
  rowsError.value = null
  rowsLoading.value = true
  try { rows.value = await financeApi.importExceptions(b.id, { open_only: true, limit: 500 }) } catch (err) {
    rowsError.value = messageOf(err, 'The exceptions for this batch could not be read.')
  } finally { rowsLoading.value = false }
}
onMounted(load)
watch(() => store.selectedYearId, () => { chosen.value = null; void load() })

const review = computed(() => batchesToReview(batches.value))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><FileWarning :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Import Exceptions</h2>
      <p>Rows an import rejected, batch by batch. Each is resolved in Imports, with a note, before the batch can be committed.</p></div>
    <span class="cw-spacer" />
    <button type="button" class="cw-btn cw-btn--outline" :disabled="loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /> Read again</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>

  <section class="cw-card" aria-labelledby="ie-b">
    <div class="cw-card-head"><h3 id="ie-b">Batches to review</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading && !batches.length" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!review.length" class="cw-empty">No import in this year has an unresolved exception or a failure.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th scope="col">File</th><th scope="col">Data</th><th scope="col">Status</th><th scope="col" class="r">Rows</th><th scope="col" class="r">Rejected</th><th scope="col" class="r">Open exceptions</th><th scope="col">Uploaded</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="b in review" :key="b.id" :aria-current="chosen?.id === b.id ? 'true' : undefined">
            <td class="dx-wrap">{{ b.original_filename }}</td><td>{{ b.dataset }}</td>
            <td><span class="cw-pill" :class="b.status === 'failed' ? 'cw-pill--neg' : 'cw-pill--warn'">{{ b.status }}</span></td>
            <td class="r num">{{ b.rows_total }}</td><td class="r num">{{ b.rows_rejected }}</td><td class="r num">{{ Number(b.open_exceptions ?? 0) }}</td>
            <td>{{ formatDateTime(b.uploaded_at) }}<span v-if="b.uploaded_by_name" class="cw-hint"> · {{ b.uploaded_by_name }}</span></td>
            <td><button type="button" class="cw-btn cw-btn--small" @click="show(b)">Show rows</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="chosen" class="cw-card" aria-labelledby="ie-r">
    <div class="cw-card-head"><h3 id="ie-r">Open exceptions in {{ chosen.original_filename }}</h3><span class="cw-spacer" />
      <RouterLink :to="{ name: 'ofc-imports', query: { status: chosen.status } }" class="cw-link">Resolve in Imports <ChevronRight :size="14" aria-hidden="true" /></RouterLink></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="chosen.error_summary" class="cw-banner-msg cw-banner-msg--warn" style="margin: 0 0 10px">{{ chosen.error_summary }}</p>
      <div v-if="rowsLoading" aria-busy="true"><span class="cw-skel" /></div>
      <p v-else-if="rowsError" class="cw-empty">{{ rowsError }}</p>
      <p v-else-if="!rows.length" class="cw-empty">Every exception in this batch is resolved.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th scope="col" class="r">Row</th><th scope="col">Field</th><th scope="col">Problem</th><th scope="col">Message</th></tr></thead>
        <tbody>
          <tr v-for="x in rows" :key="x.id"><td class="r num">{{ x.row_number }}</td><td>{{ x.field ?? '—' }}</td><td>{{ exceptionLabel(x.error_code) }}</td><td class="dx-wrap">{{ x.message }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
