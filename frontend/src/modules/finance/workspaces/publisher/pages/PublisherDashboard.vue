<script setup lang="ts">
/**
 * The publisher's dashboard (`GET /finance/dashboards/publisher`): what is live on the portal, what
 * waits for approval, what is approved and ready to publish, what was refused, the latest releases
 * and this month's activity by state.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { FileCheck2, Undo2, CalendarClock, TriangleAlert, FileText, ChartPie, Zap, Upload, FilePlus, Globe2, Layers, AlertTriangle, GitBranch } from 'lucide-vue-next'
import DonutChart from '../../shared/DonutChart.vue'
import { dayMonth } from '../../shared/useDashboard'
import { publisherDash, DATASET, STATE } from '../dashboard'
import { useFinanceStore } from '../../../stores/finance'

const { state, load } = publisherDash
const d = computed(() => state.data)

const monthTotal = computed(() => Object.values(d.value?.this_month ?? {}).reduce((a, b) => a + b, 0))
const share = (n: number) => (monthTotal.value ? Math.round((n * 1000) / monthTotal.value) / 10 : 0)
const segments = computed(() => {
  const m = d.value?.this_month
  if (!m) return []
  return [
    { label: 'Published', n: m.published, colour: '#2e9e44' },
    { label: 'Ready to publish', n: m.approved, colour: '#1b6fd1' },
    { label: 'Pending approval', n: m.pending, colour: '#f39c12' },
    { label: 'Withdrawn or refused', n: m.withdrawn + m.rejected, colour: '#b5bec9' },
  ].map((s) => ({ label: s.label, value: share(s.n), shown: `${s.n} (${share(s.n)}%)`, colour: s.colour }))
})
const tone = (s: string) => (s === 'published' ? 'cw-pill--pos' : s === 'approved' ? 'cw-pill--info' : s === 'pending' ? 'cw-pill--warn' : 'cw-pill--mute')
// Offered only where the role holds the permission the destination needs; the server decides.
const store = useFinanceStore()
const QUICK = computed(() => [
  { label: 'Upload Document', icon: Upload, to: 'pub-council', needs: 'finance.document.upload' },
  { label: 'Request a Release', icon: FilePlus, to: 'pub-reports', query: { state: 'pending' }, needs: 'finance.publication.review' },
  { label: 'Publish Approved', icon: Globe2, to: 'pub-reports', query: { state: 'approved' }, needs: 'finance.publication.publish' },
  { label: 'Public Documents', icon: Layers, to: 'pub-disclosures', needs: 'finance.publication.publish' },
  { label: 'Version History', icon: GitBranch, to: 'pub-versions' },
].filter((q) => !q.needs || store.can(q.needs)))
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load()">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'pub-website' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><FileCheck2 :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Published</p><p class="cw-tile-value num">{{ d.states.published }}</p><p class="cw-tile-sub">datasets live · {{ d.documents.public }} public documents</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'pub-reports', query: { state: 'withdrawn' } }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><Undo2 :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Withdrawn or Refused</p><p class="cw-tile-value num">{{ d.states.withdrawn + d.states.rejected }}</p><p class="cw-tile-sub">kept on the record</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'pub-reports', query: { state: 'approved' } }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><CalendarClock :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Ready to Publish</p><p class="cw-tile-value num">{{ d.states.approved }}</p><p class="cw-tile-sub">approved, not yet live</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'pub-reports', query: { state: 'pending' } }" class="cw-tile cw-tile--red">
        <span class="cw-tile-icon"><TriangleAlert :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Pending Approval</p><p class="cw-tile-value num">{{ d.states.pending }}</p><p class="cw-tile-sub">awaiting the approver</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="pb-rec">
        <div class="cw-card-head"><h3 id="pb-rec"><FileText :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Publications</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'pub-log' }" class="cw-link">Publication Log</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="!d.recent.length" class="cw-empty">Nothing has been released yet.</p>
          <ul v-else class="dx-list">
            <li v-for="p in d.recent" :key="p.id"><RouterLink :to="{ name: 'pub-reports', query: { state: p.state === 'rejected' ? 'withdrawn' : p.state } }" class="dx-item">
              <FileText :size="19" class="dx-neg" aria-hidden="true" />
              <span class="dx-grow">{{ DATASET[p.dataset] ?? p.dataset }} v{{ p.version }}<template v-if="p.reporting_period_label"> – {{ p.reporting_period_label }}</template>
                <span class="cw-hint"> · {{ (p.year_label ?? '').split(' (')[0] }}</span></span>
              <span class="cw-pill" :class="tone(p.state)">{{ STATE[p.state] }}</span>
              <span class="dx-when">{{ dayMonth(p.published_at ?? p.created_at) }}</span>
            </RouterLink></li>
          </ul>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="pb-st">
        <div class="cw-card-head"><h3 id="pb-st"><ChartPie :size="24" class="cw-head-icon" aria-hidden="true" /> Publication Status (This Month)</h3></div>
        <div class="cw-card-body">
          <p v-if="!monthTotal" class="cw-empty">No release changed state this month.</p>
          <DonutChart v-else :segments="segments" :centre="String(monthTotal)" sub="Total" :label="`${monthTotal} releases changed state this month`" />
        </div>
      </section>
    </div>

    <section class="cw-card" aria-labelledby="pb-qp">
      <div class="cw-card-head"><h3 id="pb-qp"><Zap :size="24" class="cw-head-icon" aria-hidden="true" /> Quick Publish</h3></div>
      <div class="cw-card-body">
        <div class="dx-quick">
          <RouterLink v-for="q in QUICK" :key="q.label" :to="{ name: q.to, query: q.query }" class="cw-action dx-qa-wide">
            <component :is="q.icon" :size="24" :stroke-width="1.7" aria-hidden="true" /><span>{{ q.label }}</span>
          </RouterLink>
        </div>
      </div>
    </section>
  </template>
</template>
