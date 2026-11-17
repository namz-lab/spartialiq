<script setup lang="ts">
/**
 * The finance director's dashboard. It leads with the council's position for the selected year
 * (cash at bank, debtors, creditors, budget execution and rates collection, each per currency, from
 * `../position.ts`), then what is waiting for a decision and what is out of line, then the state
 * of the finance system itself (`GET /finance/dashboards/manager`: accounts, roles, health,
 * activity and the latest configuration changes). Nothing is added across currencies.
 */
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Landmark, Users, Truck, Gauge, ChartColumn, HeartPulse, CircleCheck, CircleAlert, Info, History,
  Zap, ChevronRight, ListChecks, AlertTriangle, UserCog, Pencil, TriangleAlert, Upload, CalendarRange, Send, FileStack,
} from 'lucide-vue-next'
import BarChart from '../../shared/BarChart.vue'
import FinanceGisMap from '../../../components/gis/FinanceGisMap.vue'
import { shortWhen, pctText } from '../../shared/useDashboard'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { useFinanceStore } from '../../../stores/finance'
import { useFinanceNav } from '../../../shell/useFinanceNav'
import { managerDash } from '../dashboard'
import { uptimeText } from '../health'
import { position, loadPosition, dataOf, ordered, execution, executionTone, PART_NEEDS, type PartKey } from '../position'
import { inbox, loadInbox } from '../inbox'
import { waitingTotal } from '../approvals'
import { useWhere } from '../links'

const store = useFinanceStore()
const nav = useFinanceNav()
const where = useWhere()
const { state, load } = managerDash
const d = computed(() => state.data)

async function read(): Promise<void> {
  await loadPosition(store.selectedYearId, store.can)
  await loadInbox(store.selectedYearId, store.can)
}
onMounted(read)
watch(() => store.selectedYearId, read)

const ops = computed(() => dataOf(position.operations))
const exe = computed(() => dataOf(position.executive))
const rev = computed(() => dataOf(position.revenue))
const pay = computed(() => dataOf(position.payables))
const ccy = computed<Currency>(() => ops.value?.year.reporting_currency ?? exe.value?.year.reporting_currency ?? 'USD')
const money = (v: string | null | undefined, c: Currency) => formatMoney(v, c)
/** The tile's sentence when its read is not available. */
const unread = (k: PartKey): string | null => {
  const p = position[k]
  if (p.state === 'denied') return `Not readable with your role (${PART_NEEDS[k]})`
  if (p.state === 'error') return 'Could not be read'
  return null
}

const waiting = computed(() => inbox.items.filter((x) => (x.n ?? 0) > 0).slice(0, 6).map((x) => ({ ...x, link: where(x.where) })))
const waitingN = computed(() => waitingTotal(inbox.items))

const weeks = computed(() => (d.value?.activity ?? []).map((w) => new Date(`${w.week}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })))
const ALERT_ROUTE: Record<string, string> = { audit: 'mgr-audit', years: 'mgr-periods', imports: 'mgr-integration' }
const publication = computed(() => {
  const r = nav.resolve('publication')
  return r.kind === 'route' ? { name: r.name } : null
})
const QUICK = computed(() => [
  { label: 'Commit an import', icon: Upload, to: { name: 'mgr-integration', query: { status: 'validated' } } },
  { label: 'Open or close a period', icon: CalendarRange, to: { name: 'mgr-periods' } },
  { label: 'Statements', icon: FileStack, to: { name: 'mgr-statements' } },
  ...(publication.value ? [{ label: 'Request publication', icon: Send, to: publication.value }] : []),
])
const activityIcon = (event: string) => (event === 'FIN_PERMISSION' || event === 'USER_MGMT' ? UserCog : Pencil)
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load()">Retry</button></p>

  <section class="mg-gis" aria-labelledby="mg-gis-h">
    <div class="mg-gis-head">
      <h3 id="mg-gis-h" class="mg-h">Council property map</h3>
      <RouterLink :to="{ name: 'mgr-gis' }" class="mg-gis-link">Open full map and analytics <ChevronRight :size="15" aria-hidden="true" /></RouterLink>
    </div>
    <FinanceGisMap mode="manager" compact height="780px" />
  </section>

  <h3 class="mg-h">Position{{ ops?.year.label ? ` · ${ops.year.label}` : '' }}</h3>
  <div class="cw-tiles dx-tiles" :aria-busy="position.loading">
    <RouterLink :to="{ name: 'mgr-position' }" class="cw-tile cw-tile--blue" data-tile="cash">
      <span class="cw-tile-icon"><Landmark :size="32" aria-hidden="true" /></span>
      <div><p class="cw-tile-label">Cash at Bank</p>
        <template v-if="ops?.banks.length">
          <p v-for="(b, i) in ordered(ops.banks, ccy)" :key="b.currency" :class="i ? 'cw-tile-value-2 num' : 'cw-tile-value num'">{{ money(b.balance, b.currency) }}</p>
        </template>
        <p v-else-if="ops" class="cw-tile-sub">No bank account has entries</p>
        <p v-else-if="unread('operations')" class="cw-tile-sub">{{ unread('operations') }}</p></div>
    </RouterLink>
    <RouterLink :to="{ name: 'mgr-position' }" class="cw-tile cw-tile--green" data-tile="debtors">
      <span class="cw-tile-icon"><Users :size="32" aria-hidden="true" /></span>
      <div><p class="cw-tile-label">Owed to the Council</p>
        <template v-if="ops?.debtors.length">
          <p v-for="(x, i) in ordered(ops.debtors, ccy)" :key="x.currency" :class="i ? 'cw-tile-value-2 num' : 'cw-tile-value num'">{{ money(x.amount, x.currency) }}</p>
        </template>
        <p v-else-if="ops" class="cw-tile-sub">No debtor owes anything</p>
        <p v-else-if="unread('operations')" class="cw-tile-sub">{{ unread('operations') }}</p></div>
    </RouterLink>
    <RouterLink :to="{ name: 'mgr-position' }" class="cw-tile cw-tile--amber" data-tile="creditors">
      <span class="cw-tile-icon"><Truck :size="32" aria-hidden="true" /></span>
      <div><p class="cw-tile-label">Owed by the Council</p>
        <template v-if="pay?.owed.length">
          <p v-for="(x, i) in ordered(pay.owed, ccy)" :key="x.currency" :class="i ? 'cw-tile-value-2 num' : 'cw-tile-value num'">{{ money(x.outstanding, x.currency) }}</p>
        </template>
        <p v-else-if="pay" class="cw-tile-sub">No supplier is owed anything</p>
        <p v-else-if="unread('payables')" class="cw-tile-sub">{{ unread('payables') }}</p></div>
    </RouterLink>
    <RouterLink :to="{ name: 'mgr-position' }" class="cw-tile cw-tile--violet" data-tile="execution">
      <span class="cw-tile-icon"><Gauge :size="32" aria-hidden="true" /></span>
      <div><p class="cw-tile-label">Spending Budget Used</p>
        <template v-if="exe && execution(exe, 'expenditure').length">
          <p v-for="(t, i) in ordered(execution(exe, 'expenditure'), ccy)" :key="t.currency" :class="i ? 'cw-tile-value-2 num' : 'cw-tile-value num'">{{ pctText(t.execution) }} <small>{{ t.currency }}</small></p>
        </template>
        <p v-else-if="exe" class="cw-tile-sub">No approved spending budget</p>
        <p v-else-if="unread('executive')" class="cw-tile-sub">{{ unread('executive') }}</p></div>
    </RouterLink>
  </div>

  <div class="dx-row dx-row--wide-left">
    <section class="cw-card" aria-labelledby="mg-pend">
      <div class="cw-card-head"><h3 id="mg-pend"><ListChecks :size="24" class="cw-head-icon" aria-hidden="true" /> Waiting for a Decision</h3><span class="cw-spacer" />
        <RouterLink :to="{ name: 'mgr-approvals' }" class="cw-link">All approvals ({{ waitingN }})</RouterLink></div>
      <div class="cw-card-body">
        <div v-if="inbox.loading && !inbox.items.length" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!waiting.length" class="cw-empty">Nothing is waiting for a decision.</p>
        <ul v-else class="dx-list">
          <li v-for="p in waiting" :key="p.key">
            <RouterLink v-if="p.link.ok" :to="p.link.to" class="dx-item"><span class="dx-grow">{{ p.label }} <span class="cw-hint">· {{ p.decides }}</span></span><span class="dx-count">{{ p.n }}</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
            <div v-else class="dx-item"><span class="dx-grow">{{ p.label }} <span class="cw-hint">· {{ p.decides }}</span></span><span class="dx-count">{{ p.n }}</span></div>
          </li>
        </ul>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="mg-coll">
      <div class="cw-card-head"><h3 id="mg-coll"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> Collection and Execution</h3></div>
      <div class="cw-card-body">
        <ul class="dx-kpis">
          <template v-if="rev">
            <li v-for="r in ordered(rev.collection_rate, ccy)" :key="'c' + r.currency"><span>Rates collected of billed, {{ r.currency }}</span><strong>{{ pctText(r.rate) }}</strong></li>
            <li v-if="!rev.collection_rate.length"><span>Rates collection</span><strong class="cw-hint">Nothing billed this year</strong></li>
          </template>
          <li v-else-if="unread('revenue')"><span>Rates collection</span><strong class="cw-hint">{{ unread('revenue') }}</strong></li>
          <template v-if="exe">
            <li v-for="t in ordered(execution(exe, 'revenue'), ccy)" :key="'r' + t.currency"><span>Revenue budget realised, {{ t.currency }}</span>
              <strong><span class="dx-pct" :class="executionTone(t.execution, 'revenue')">{{ pctText(t.execution) }}</span></strong></li>
          </template>
          <template v-if="pay">
            <li v-for="o in ordered(pay.owed, ccy).filter((x) => Number(x.overdue) > 0)" :key="'o' + o.currency"><span>Creditors overdue, {{ o.currency }}</span><strong class="dx-neg num">{{ money(o.overdue, o.currency) }}</strong></li>
          </template>
        </ul>
        <p class="dx-note"><RouterLink :to="{ name: 'mgr-position' }" class="cw-link">Financial Position</RouterLink> has the balance sheet and each bank account.</p>
      </div>
    </section>
  </div>

  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>
  <template v-else-if="d">
    <div class="dx-row dx-row--2">
      <section class="cw-card" aria-labelledby="mg-alerts">
        <div class="cw-card-head"><h3 id="mg-alerts"><TriangleAlert :size="24" class="cw-head-icon" aria-hidden="true" /> Alerts</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'mgr-exceptions' }" class="cw-link">Exceptions</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="!d.alerts?.length" class="cw-empty">No alerts.</p>
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

      <section class="cw-card" aria-labelledby="mg-quick">
        <div class="cw-card-head"><h3 id="mg-quick"><Zap :size="24" class="cw-head-icon" aria-hidden="true" /> Quick Actions</h3></div>
        <div class="cw-card-body">
          <div class="dx-quick">
            <RouterLink v-for="q in QUICK" :key="q.label" :to="q.to" class="cw-action dx-qa">
              <component :is="q.icon" :size="26" :stroke-width="1.6" aria-hidden="true" /><span>{{ q.label }}</span>
            </RouterLink>
          </div>
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="mg-act">
        <div class="cw-card-head"><h3 id="mg-act"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> Finance Activity (Last 5 Weeks)</h3></div>
        <div class="cw-card-body">
          <BarChart :labels="weeks" :series="[{ name: 'Finance actions', colour: '#1f5aa8', values: d.activity.map((w) => w.actions) }]"
            label="Finance actions per week for the last five weeks" />
          <p class="dx-note">Week starting. Successful finance requests from the audit trail; {{ d.activity.at(-1)?.people ?? 0 }} people active this week.
            {{ d.users.active }} of {{ d.users.total }} finance accounts signed in within 30 days; {{ d.roles }} roles hold finance permissions.</p>
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
            <li><CircleCheck :size="20" class="dx-ok" aria-hidden="true" /><span>Application uptime</span><strong>{{ uptimeText(d.health.uptime_seconds) }}</strong></li>
          </ul>
        </div>
      </section>
    </div>

    <section class="cw-card" aria-labelledby="mg-recent">
      <div class="cw-card-head"><h3 id="mg-recent"><History :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Configuration Changes</h3><span class="cw-spacer" />
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
  </template>
</template>

<style scoped>
.mg-h { margin: 0 0 -4px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cw-ink-2); }
.cw-tile-value small { font-size: 12px; font-weight: 600; color: var(--cw-ink-2); }
.mg-gis { margin-bottom: 18px; }
.mg-gis-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mg-gis-link { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; color: var(--cw-accent); text-decoration: none; }
.mg-gis-link:hover { text-decoration: underline; }
</style>
