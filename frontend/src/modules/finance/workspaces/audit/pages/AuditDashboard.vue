<script setup lang="ts">
/**
 * The internal auditor's dashboard (`GET /finance/dashboards/audit`): audits under way, open
 * findings, actions past their due date, compliance (of the actions that fell due, the share closed
 * by their date), plan progress, findings by risk, recent audits and what is coming up.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { ClipboardCheck, Search, TriangleAlert, ShieldCheck, ChartPie, ChartColumn, History, CalendarClock, ChevronRight, AlertTriangle, FileSearch, Plus } from 'lucide-vue-next'
import DonutChart from '../../shared/DonutChart.vue'
import BarChart from '../../shared/BarChart.vue'
import { dayMonth, pctText } from '../../shared/useDashboard'
import { useFinanceStore } from '../../../stores/finance'
import { auditDash, PHASE, STATUS } from '../dashboard'

const store = useFinanceStore()
const { state, load } = auditDash
const d = computed(() => state.data)
const segments = computed(() => {
  const p = d.value?.plan
  if (!p) return []
  return [
    { label: 'Completed', value: Number(p.completed_pct ?? 0), shown: `${p.completed} (${pctText(p.completed_pct)})`, colour: '#1e9e4a' },
    { label: 'In Progress', value: Number(p.in_progress_pct ?? 0), shown: `${p.in_progress} (${pctText(p.in_progress_pct)})`, colour: '#1b6fd1' },
    { label: 'Not Started', value: Number(p.not_started_pct ?? 0), shown: `${p.not_started} (${pctText(p.not_started_pct)})`, colour: '#c6cdd6' },
  ]
})
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load(store.selectedYearId)">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'aud-plans' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><ClipboardCheck :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Active Audits</p><p class="cw-tile-value num">{{ d.plan.in_progress }}</p><p class="cw-tile-sub">of {{ d.plan.total }} on the plan</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'aud-findings' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><Search :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Open Findings</p><p class="cw-tile-value num">{{ d.findings.open }}</p><p class="cw-tile-sub">{{ d.findings.high }} high risk</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'aud-compliance' }" class="cw-tile cw-tile--red">
        <span class="cw-tile-icon"><TriangleAlert :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Overdue Actions</p><p class="cw-tile-value num">{{ d.findings.overdue }}</p><p class="cw-tile-sub">past their agreed date</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'aud-compliance' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><ShieldCheck :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Compliance</p><p class="cw-tile-value num">{{ pctText(d.compliance.pct) }}</p>
          <p class="cw-tile-sub">{{ d.compliance.due ? `${d.compliance.on_time} of ${d.compliance.due} actions closed on time` : 'No action has fallen due yet' }}</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--2">
      <section class="cw-card" aria-labelledby="au-plan">
        <div class="cw-card-head"><h3 id="au-plan"><ChartPie :size="24" class="cw-head-icon" aria-hidden="true" /> Audit Plan Progress ({{ d.year.label.split(' (')[0] }})</h3></div>
        <div class="cw-card-body">
          <p v-if="!d.plan.total" class="cw-empty">No audits on the plan for this year. <RouterLink :to="{ name: 'aud-plans' }" class="cw-link"><Plus :size="16" aria-hidden="true" /> Add one</RouterLink></p>
          <DonutChart v-else :segments="segments" :centre="pctText(d.plan.completed_pct)" sub="Completed" :label="`Audit plan ${pctText(d.plan.completed_pct)} completed`" />
        </div>
      </section>
      <section class="cw-card" aria-labelledby="au-risk">
        <div class="cw-card-head"><h3 id="au-risk"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> Open Findings by Risk Level</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'aud-risks' }" class="cw-link">Risk Register</RouterLink></div>
        <div class="cw-card-body">
          <BarChart :labels="['High', 'Medium', 'Low']" :series="[{ name: 'Open findings', colour: '#1f5aa8', values: [d.findings.high, d.findings.medium, d.findings.low] }]"
            :bar-colours="['#e53935', '#f39c12', '#2e9e44']" :label="`Open findings: ${d.findings.high} high, ${d.findings.medium} medium, ${d.findings.low} low`" />
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--2">
      <section class="cw-card" aria-labelledby="au-rec">
        <div class="cw-card-head"><h3 id="au-rec"><History :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Audit Activities</h3></div>
        <div class="cw-card-body">
          <p v-if="!d.recent.length" class="cw-empty">No audit activity yet.</p>
          <ul v-else class="dx-list">
            <li v-for="r in d.recent" :key="r.id"><RouterLink :to="{ name: 'aud-plans' }" class="dx-item">
              <FileSearch :size="19" class="dx-accent" aria-hidden="true" />
              <span class="dx-grow">{{ r.title }} – {{ r.status === 'in_progress' ? PHASE[r.phase] : STATUS[r.status] }}</span><span class="dx-when">{{ dayMonth(r.updated_at) }}</span>
            </RouterLink></li>
          </ul>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="au-up">
        <div class="cw-card-head"><h3 id="au-up"><CalendarClock :size="24" class="cw-head-icon" aria-hidden="true" /> Upcoming</h3></div>
        <div class="cw-card-body">
          <p v-if="!d.upcoming.length" class="cw-empty">Nothing scheduled ahead.</p>
          <ul v-else class="dx-list">
            <li v-for="u in d.upcoming" :key="u.kind + u.id"><RouterLink :to="{ name: u.kind === 'finding' ? 'aud-findings' : 'aud-plans' }" class="dx-item">
              <CalendarClock :size="19" class="dx-info" aria-hidden="true" /><span class="dx-grow">{{ u.text }}</span><span class="dx-when">{{ dayMonth(u.date) }}</span><ChevronRight :size="18" aria-hidden="true" />
            </RouterLink></li>
          </ul>
          <p v-if="d.refusals_7d" class="dx-note">{{ d.refusals_7d }} finance requests were refused for lack of permission in the last 7 days.
            <RouterLink :to="{ name: 'aud-trail' }" class="cw-link">Audit Trail</RouterLink></p>
        </div>
      </section>
    </div>
  </template>
</template>
