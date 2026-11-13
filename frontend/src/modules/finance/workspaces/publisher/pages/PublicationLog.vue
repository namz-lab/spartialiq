<script setup lang="ts">
/**
 * Every release request in every year, with each step on the record: requested, approved,
 * published, withdrawn or refused, who did it and when. Read from `GET /finance/publications`.
 */
import { computed, onMounted, ref } from 'vue'
import { History } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import type { Publication } from '../../../models/types'
import { messageOf } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { DATASET, STATE } from '../dashboard'

const rows = ref<Publication[]>([])
const error = ref<string | null>(null)
const loading = ref(false)
onMounted(async () => {
  loading.value = true
  try { rows.value = await financeApi.publications() } catch (err) { error.value = messageOf(err, 'The publication log could not be read.') } finally { loading.value = false }
})
const sorted = computed(() => [...rows.value].sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at))))
function steps(p: Publication): { what: string; when: string | null; who?: string | null }[] {
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
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
  <section class="cw-card">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!sorted.length" class="cw-empty">No release has been requested.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th>Dataset</th><th>Year</th><th>Period</th><th>State</th><th>History</th><th>Note</th></tr></thead>
        <tbody>
          <tr v-for="p in sorted" :key="p.id">
            <td><strong>{{ DATASET[p.dataset] ?? p.dataset }}</strong> v{{ p.version }}</td>
            <td>{{ (p.financial_year_label ?? '').split(' (')[0] || '—' }}</td>
            <td>{{ p.reporting_period_label ?? '—' }}</td>
            <td><span class="cw-pill" :class="tone(p.state)">{{ STATE[p.state] ?? p.state }}</span></td>
            <td class="dx-wrap"><div v-for="s in steps(p)" :key="s.what">{{ s.what }} {{ formatDateTime(s.when) }}<span v-if="s.who" class="cw-hint"> · {{ s.who }}</span></div></td>
            <td class="dx-wrap">{{ p.withdraw_reason ?? p.decision_note ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
