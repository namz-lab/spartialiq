<script setup lang="ts">
/**
 * The finance administrator's dashboard (`GET /finance/dashboards/manager`): finance accounts and
 * roles, everything waiting for someone's approval, what needs fixing, a five-week view of finance
 * activity, the system's health and the latest configuration changes from the audit trail.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Users, Layers, Hourglass, TriangleAlert, ChartColumn, HeartPulse, CircleCheck, CircleAlert, Info, History,
  Zap, UserPlus, KeyRound, Workflow, Settings, ChevronRight, ListChecks, AlertTriangle, UserCog, Pencil,
} from 'lucide-vue-next'
import BarChart from '../../shared/BarChart.vue'
import { shortWhen } from '../../shared/useDashboard'
import { useFinanceNav } from '../../../shell/useFinanceNav'
import type { FinanceTarget } from '../../../shell/targets'
import { managerDash } from '../dashboard'
import { uptimeText } from '../health'

const { state, load } = managerDash
const d = computed(() => state.data)
const nav = useFinanceNav()

const ALERT_ROUTE: Record<string, string> = { audit: 'mgr-audit', years: 'mgr-periods', imports: 'mgr-integration' }
const TARGET: Record<string, FinanceTarget> = {
  budget: 'budget', revisions: 'revisions', publication: 'publication', projects: 'projects',
  rates: 'rates', map: 'map', vouchers: 'ledger.vouchers',
}
function linkOf(key: string) {
  const r = nav.resolve(TARGET[key] ?? 'overview')
  return r.kind === 'route' ? { name: r.name } : null
}
const pending = computed(() => (d.value?.pending ?? []).filter((p) => p.n > 0))

const weeks = computed(() => (d.value?.activity ?? []).map((w) => new Date(`${w.week}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })))
const QUICK = [
  { label: 'Add User', icon: UserPlus, to: 'mgr-users' },
  { label: 'Create Role', icon: KeyRound, to: 'mgr-permissions' },
  { label: 'Configure Workflow', icon: Workflow, to: 'mgr-workflow' },
  { label: 'System Settings', icon: Settings, to: 'mgr-settings' },
]
const activityIcon = (event: string) => (event === 'FIN_PERMISSION' || event === 'USER_MGMT' ? UserCog : Pencil)
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load()">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'mgr-users' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Users :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Active Users</p><p class="cw-tile-value num">{{ d.users.active }}</p>
          <p class="cw-tile-sub">of {{ d.users.total }} finance accounts, signed in within 30 days</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'mgr-permissions' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><Layers :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Roles</p><p class="cw-tile-value num">{{ d.roles }}</p><p class="cw-tile-sub">with finance permissions</p></div>
      </RouterLink>
      <a href="#mgr-pending" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><Hourglass :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Pending Approvals</p><p class="cw-tile-value num">{{ d.pending_total }}</p><p class="cw-tile-sub">across finance</p></div>
      </a>
      <RouterLink :to="{ name: 'mgr-health' }" class="cw-tile cw-tile--red">
        <span class="cw-tile-icon"><TriangleAlert :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">System Alerts</p><p class="cw-tile-value num">{{ d.alerts.length }}</p><p class="cw-tile-sub">to look at</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="mg-act">
        <div class="cw-card-head"><h3 id="mg-act"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> User Activity (Last 5 Weeks)</h3></div>
        <div class="cw-card-body">
          <BarChart :labels="weeks" :series="[{ name: 'Finance actions', colour: '#1f5aa8', values: d.activity.map((w) => w.actions) }]"
            label="Finance actions per week for the last five weeks" />
          <p class="dx-note">Week starting. Successful finance requests from the audit trail; {{ d.activity.at(-1)?.people ?? 0 }} people active this week.</p>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="mg-health">
        <div class="cw-card-head"><h3 id="mg-health"><HeartPulse :size="24" class="cw-head-icon" aria-hidden="true" /> System Health</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'mgr-health' }" class="cw-link">Details</RouterLink></div>
        <div class="cw-card-body">
          <ul class="dx-health">
            <li><CircleCheck :size="20" class="dx-ok" aria-hidden="true" /><span>Database</span><strong class="dx-ok">Online · {{ d.health.database.ms }} ms</strong></li>
            <li><CircleCheck :size="20" :class="d.health.imports.open_batches ? 'dx-warn' : 'dx-ok'" aria-hidden="true" /><span>Integrations</span>
              <strong :class="d.health.imports.open_batches ? 'dx-warn' : 'dx-ok'">{{ d.health.imports.open_batches ? `${d.health.imports.open_batches} import open` : 'No import waiting' }}</strong></li>
            <li><CircleCheck :size="20" class="dx-ok" aria-hidden="true" /><span>Audit trail</span><strong>Last entry {{ shortWhen(d.health.audit_trail.last_event) }}</strong></li>
            <li><Info :size="20" class="dx-info" aria-hidden="true" /><span>Backups</span><strong>Not monitored here</strong></li>
            <li><CircleCheck :size="20" class="dx-ok" aria-hidden="true" /><span>Application uptime</span><strong>{{ uptimeText(d.health.uptime_seconds) }}</strong></li>
          </ul>
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="mg-recent">
        <div class="cw-card-head"><h3 id="mg-recent"><History :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Administration Activity</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'mgr-audit' }" class="cw-link">Audit Logs</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="!d.recent.length" class="cw-empty">No configuration changes recorded.</p>
          <ul v-else class="dx-list">
            <li v-for="(r, i) in d.recent" :key="i"><div class="dx-item">
              <component :is="activityIcon(r.event)" :size="19" class="dx-accent" aria-hidden="true" />
              <span class="dx-grow">{{ r.text }} <span class="cw-hint">· {{ r.who }}</span></span><span class="dx-when">{{ shortWhen(r.at) }}</span>
            </div></li>
          </ul>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="mg-quick">
        <div class="cw-card-head"><h3 id="mg-quick"><Zap :size="24" class="cw-head-icon" aria-hidden="true" /> Quick Actions</h3></div>
        <div class="cw-card-body">
          <div class="dx-quick">
            <RouterLink v-for="q in QUICK" :key="q.label" :to="{ name: q.to }" class="cw-action dx-qa">
              <component :is="q.icon" :size="26" :stroke-width="1.6" aria-hidden="true" /><span>{{ q.label }}</span>
            </RouterLink>
          </div>
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--2">
      <section id="mg-pending" class="cw-card" aria-labelledby="mg-pend">
        <div class="cw-card-head"><h3 id="mg-pend"><ListChecks :size="24" class="cw-head-icon" aria-hidden="true" /> Waiting for Approval</h3></div>
        <div class="cw-card-body">
          <p v-if="!pending.length" class="cw-empty">Nothing is waiting for an approval.</p>
          <ul v-else class="dx-list">
            <li v-for="p in pending" :key="p.key">
              <RouterLink v-if="linkOf(p.key)" :to="linkOf(p.key)!" class="dx-item"><span class="dx-grow">{{ p.label }}</span><span class="dx-count">{{ p.n }}</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
              <div v-else class="dx-item"><span class="dx-grow">{{ p.label }}</span><span class="dx-count">{{ p.n }}</span></div>
            </li>
          </ul>
          <p class="dx-note">Approving is the approver's job in their own workspace; this list shows where work is waiting.</p>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="mg-alerts">
        <div class="cw-card-head"><h3 id="mg-alerts"><TriangleAlert :size="24" class="cw-head-icon" aria-hidden="true" /> System Alerts</h3></div>
        <div class="cw-card-body">
          <p v-if="!d.alerts.length" class="cw-empty">No alerts.</p>
          <ul v-else class="dx-list">
            <li v-for="(a, i) in d.alerts" :key="i">
              <RouterLink :to="{ name: ALERT_ROUTE[a.key] ?? 'mgr-health' }" class="dx-item">
                <CircleAlert v-if="a.tone === 'neg'" :size="20" class="dx-neg" aria-hidden="true" />
                <TriangleAlert v-else-if="a.tone === 'warn'" :size="20" class="dx-warn" aria-hidden="true" />
                <Info v-else :size="20" class="dx-info" aria-hidden="true" />
                <span class="dx-grow">{{ a.text }}</span><ChevronRight :size="18" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </template>
</template>
