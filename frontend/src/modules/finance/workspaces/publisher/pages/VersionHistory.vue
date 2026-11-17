<script setup lang="ts">
/**
 * Version history: each dataset's releases for a year and reporting period, newest version first,
 * with the one live on the portal marked. Publishing a newer version supersedes the live one on the
 * server; withdrawing takes a version down and keeps it on the record. Both are done on Report
 * Publishing, where approval is checked; this page only reads (`GET /finance/publications`).
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { GitBranch, AlertTriangle } from 'lucide-vue-next'
import { publicationApi, versionChains, type PublicationRecord } from '../../../api/publicationApi'
import { messageOf } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { DATASET, STATE } from '../dashboard'

const rows = ref<PublicationRecord[]>([])
const truncated = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try { const r = await publicationApi.all(); rows.value = r.rows; truncated.value = r.truncated } catch (err) {
    error.value = messageOf(err, 'The version history could not be read.')
  } finally { loading.value = false }
}
onMounted(load)
const chains = computed(() => versionChains(rows.value))
const tone = (s: string) => (s === 'published' ? 'cw-pill--pos' : s === 'approved' ? 'cw-pill--info' : s === 'pending' ? 'cw-pill--warn' : 'cw-pill--mute')
const when = (p: PublicationRecord) => p.withdrawn_at ?? p.published_at ?? p.approved_at ?? p.reviewed_at ?? p.created_at ?? null
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><GitBranch :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Version History</h2><p>Each dataset's releases by year and period, and which version residents see now.</p></div>
  </section>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>
  <p v-if="truncated" class="cw-banner-msg cw-banner-msg--warn" role="status">There are more releases than this screen reads; the oldest are not shown.</p>
  <div v-if="loading" class="cw-card cw-card-body" style="padding-top: 18px"><span class="cw-skel" /><span class="cw-skel" /></div>
  <p v-else-if="!chains.length && !error" class="cw-empty">No release has been requested.</p>

  <section v-for="c in chains" :key="c.key" class="cw-card" :aria-labelledby="`vh-${c.key}`">
    <div class="cw-card-head">
      <h3 :id="`vh-${c.key}`">{{ DATASET[c.dataset] ?? c.dataset }} · {{ c.year || '—' }}<template v-if="c.period"> · {{ c.period }}</template></h3>
      <span class="cw-spacer" />
      <span class="cw-hint">{{ c.live ? `Version ${c.live.version} is live` : 'Nothing live' }}</span>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <table class="cw-table dx-compact">
        <caption class="sr-only">Versions, newest first</caption>
        <thead><tr><th scope="col">Version</th><th scope="col">State</th><th scope="col">Data as at</th><th scope="col">Last step</th><th scope="col">Note</th></tr></thead>
        <tbody>
          <tr v-for="v in c.versions" :key="v.id">
            <td><strong>v{{ v.version }}</strong><span v-if="c.live?.id === v.id" class="cw-hint"> · live</span></td>
            <td><span class="cw-pill" :class="tone(v.state)">{{ STATE[v.state] ?? v.state }}</span></td>
            <td>{{ v.data_as_at ?? '—' }}</td>
            <td>{{ formatDateTime(when(v)) }}</td>
            <td class="dx-wrap">{{ v.withdraw_reason ?? v.decision_note ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="dx-note">To publish an approved version or withdraw a live one, use
        <RouterLink :to="{ name: 'pub-reports', query: { state: c.live ? 'published' : 'approved' } }" class="cw-link">Report Publishing</RouterLink>.</p>
    </div>
  </section>
</template>
