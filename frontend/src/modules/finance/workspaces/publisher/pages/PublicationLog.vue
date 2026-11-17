<script setup lang="ts">
/**
 * Every release request in every year, with each step on the record: requested, approved,
 * published, withdrawn or refused, who did it and when. Read from `GET /finance/publications`,
 * every page of it (`publicationApi.all`), so an old release is never silently missing.
 *
 * Filters are the server's (dataset, state, year) and live in the address. Where one person both
 * approved and published a release the row says so; whether that was allowed is the council's
 * setting, and the server applied it at the time.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { History, AlertTriangle } from 'lucide-vue-next'
import { publicationApi, sameApproverAndPublisher, type PublicationRecord } from '../../../api/publicationApi'
import type { PublicationDataset, PublicationState } from '../../../models/types'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { DATASET, STATE } from '../dashboard'

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const q = (k: string) => (typeof route.query[k] === 'string' ? String(route.query[k]) : '')
const dataset = computed(() => q('dataset'))
const state = computed(() => q('state'))
const year = computed(() => q('year'))

const rows = ref<PublicationRecord[]>([])
const truncated = ref(false)
const error = ref<string | null>(null)
const loading = ref(false)
async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const r = await publicationApi.all({
      dataset: (dataset.value || undefined) as PublicationDataset | undefined,
      state: (state.value || undefined) as PublicationState | undefined,
      financial_year_id: year.value || undefined,
    })
    rows.value = r.rows
    truncated.value = r.truncated
  } catch (err) { error.value = messageOf(err, 'The publication log could not be read.'); rows.value = [] } finally { loading.value = false }
}
watch([dataset, state, year], load, { immediate: true })
function set(k: string, v: string): void { void router.replace({ query: { ...route.query, [k]: v || undefined } }) }

const sorted = computed(() => [...rows.value].sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at))))
function steps(p: PublicationRecord): { what: string; when: string | null; who?: string | null }[] {
  return [
    { what: 'Requested', when: p.created_at ?? null },
    { what: 'Approved', when: p.approved_at, who: p.approved_by_name },
    { what: 'Published', when: p.published_at, who: p.published_by_name },
    { what: p.state === 'rejected' ? 'Refused' : 'Withdrawn', when: p.withdrawn_at ?? (p.state === 'rejected' ? p.reviewed_at : null), who: p.withdrawn_by_name ?? p.reviewed_by_name },
  ].filter((s) => s.when)
}
const tone = (s: string) => (s === 'published' ? 'cw-pill--pos' : s === 'approved' ? 'cw-pill--info' : s === 'pending' ? 'cw-pill--warn' : 'cw-pill--mute')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><History :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Publication Log</h2><p>Every release request in every year, and each step taken on it.</p></div>
  </section>

  <div class="cw-card cw-card-body pl-filters" role="group" aria-label="Filter the log">
    <label class="cw-field"><span class="cw-label">Dataset</span>
      <select class="cw-input" :value="dataset" @change="set('dataset', ($event.target as HTMLSelectElement).value)">
        <option value="">Every dataset</option><option v-for="(l, k) in DATASET" :key="k" :value="k">{{ l }}</option></select></label>
    <label class="cw-field"><span class="cw-label">State</span>
      <select class="cw-input" :value="state" @change="set('state', ($event.target as HTMLSelectElement).value)">
        <option value="">Every state</option><option v-for="(l, k) in STATE" :key="k" :value="k">{{ l }}</option></select></label>
    <label class="cw-field"><span class="cw-label">Financial year</span>
      <select class="cw-input" :value="year" @change="set('year', ($event.target as HTMLSelectElement).value)">
        <option value="">Every year</option><option v-for="y in store.years" :key="y.id" :value="y.id">{{ y.label }}</option></select></label>
  </div>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>
  <p v-if="truncated" class="cw-banner-msg cw-banner-msg--warn" role="status">The log is longer than this screen reads. Narrow it by year or dataset.</p>
  <section class="cw-card">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!sorted.length && !error" class="cw-empty">{{ dataset || state || year ? 'No release matches.' : 'No release has been requested.' }}</p>
      <table v-else-if="sorted.length" class="cw-table dx-compact">
        <caption class="sr-only">Release requests, most recently changed first</caption>
        <thead><tr><th scope="col">Dataset</th><th scope="col">Year</th><th scope="col">Period</th><th scope="col">State</th><th scope="col">History</th><th scope="col">Note</th></tr></thead>
        <tbody>
          <tr v-for="p in sorted" :key="p.id">
            <td><strong>{{ DATASET[p.dataset] ?? p.dataset }}</strong> v{{ p.version }}</td>
            <td>{{ (p.financial_year_label ?? '').split(' (')[0] || '—' }}</td>
            <td>{{ p.reporting_period_label ?? '—' }}</td>
            <td><span class="cw-pill" :class="tone(p.state)">{{ STATE[p.state] ?? p.state }}</span></td>
            <td class="dx-wrap"><div v-for="s in steps(p)" :key="s.what">{{ s.what }} {{ formatDateTime(s.when) }}<span v-if="s.who" class="cw-hint"> · {{ s.who }}</span></div>
              <div v-if="sameApproverAndPublisher(p)" class="cw-hint pl-same">Approved and published by the same person.</div></td>
            <td class="dx-wrap">{{ p.withdraw_reason ?? p.decision_note ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.pl-filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px 16px; padding-top: 16px; }
.pl-same { color: var(--cw-ink-2); font-style: italic; }
</style>
