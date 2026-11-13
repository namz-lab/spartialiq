<script setup lang="ts">
/**
 * What residents can see on the council's public finance page right now: each live release and the
 * number of public documents, with a link to the page itself. Publishing and withdrawing are done on
 * Report Publishing.
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { MonitorUp, ExternalLink } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import type { Publication } from '../../../models/types'
import { messageOf } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { publisherDash, DATASET } from '../dashboard'

const live = ref<Publication[]>([])
const error = ref<string | null>(null)
const loading = ref(false)
onMounted(async () => {
  loading.value = true
  try { live.value = await financeApi.publications({ state: 'published' }) } catch (err) { error.value = messageOf(err, 'The live releases could not be read.') } finally { loading.value = false }
})
const publicDocs = computed(() => publisherDash.state.data?.documents.public ?? 0)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><MonitorUp :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Website Publishing</h2><p>What residents can see on the council's public finance page right now.</p></div>
    <span class="cw-spacer" />
    <RouterLink :to="{ name: 'council-finances' }" target="_blank" class="cw-btn cw-btn--outline"><ExternalLink :size="18" aria-hidden="true" /> Open the public page</RouterLink>
  </section>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
  <section class="cw-card">
    <div class="cw-card-head"><h3>Live on the portal</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /></div>
      <p v-else-if="!live.length" class="cw-empty">Nothing is live. A release approved by the approver is published from <RouterLink :to="{ name: 'pub-reports', query: { state: 'approved' } }" class="cw-link">Report Publishing</RouterLink>.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th>Dataset</th><th>Year</th><th>Period</th><th>Published</th><th>By</th></tr></thead>
        <tbody><tr v-for="p in live" :key="p.id"><td><strong>{{ DATASET[p.dataset] ?? p.dataset }}</strong> v{{ p.version }}</td>
          <td>{{ (p.financial_year_label ?? '').split(' (')[0] }}</td><td>{{ p.reporting_period_label ?? '—' }}</td>
          <td>{{ formatDateTime(p.published_at) }}</td><td>{{ p.published_by_name ?? '—' }}</td></tr></tbody>
      </table>
      <p class="dx-note">{{ publicDocs }} documents are set to public; they show while the documents dataset is published.
        <RouterLink :to="{ name: 'pub-disclosures' }" class="cw-link">Public Disclosures</RouterLink></p>
    </div>
  </section>
</template>
