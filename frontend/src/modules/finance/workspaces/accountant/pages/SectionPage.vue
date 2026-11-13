<script setup lang="ts">
/**
 * An Accounting page built on a screen the finance console already has: the ledger, the
 * statements, the budget, rates, the cash-ups, banking, setup, the audit trail. The page head comes
 * from route meta (`cwTitle`, `cwLead`); `cwSection` picks the screen and how it opens.
 *
 * Reusing them keeps one implementation of each control (preparer ≠ poster, the blind count, the
 * period locks) instead of a second copy that could drift.
 */
import { computed, defineAsyncComponent, onMounted, type Component } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import {
  NotebookPen, BookOpen, CalendarCheck, ChartColumn, Layers, Wallet, Calculator, ReceiptText,
  ShieldCheck, ClipboardCheck, Landmark, Settings, AlertTriangle, Info,
} from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import { useAccountant } from '../useAccountant'
import '@/views/inspector/inspector.css'
import '../../../pages/finance.css'

const Ledger = defineAsyncComponent(() => import('../../../pages/sections/LedgerSection.vue'))
const Statements = defineAsyncComponent(() => import('../../../pages/sections/StatementsSection.vue'))
const Budget = defineAsyncComponent(() => import('../../../pages/sections/BudgetSection.vue'))
const Rates = defineAsyncComponent(() => import('../../../pages/sections/RatesSection.vue'))
const Audit = defineAsyncComponent(() => import('../../../pages/sections/FinanceAuditSection.vue'))
const Sessions = defineAsyncComponent(() => import('../../../components/cash/CashSessions.vue'))
const Banking = defineAsyncComponent(() => import('../../../components/cash/CashBanking.vue'))
const Setup = defineAsyncComponent(() => import('../../../components/cash/CashSetup.vue'))

type Key = 'journals' | 'ledger' | 'close' | 'trial' | 'reports' | 'receivable' | 'budget' | 'revenue' | 'audit' | 'cashups' | 'bank' | 'settings'
const SECTIONS: Record<Key, { component: Component; props?: Record<string, unknown>; icon: Component; desk?: boolean; needs?: string }> = {
  journals: { component: Ledger, props: { only: 'vouchers' }, icon: NotebookPen },
  ledger: { component: Ledger, props: { only: 'chart' }, icon: BookOpen },
  close: { component: Ledger, props: { only: 'periods' }, icon: CalendarCheck },
  trial: { component: Statements, props: { initialTab: 'trial_balance' }, icon: ChartColumn },
  reports: { component: Statements, props: { initialTab: 'position' }, icon: Layers },
  receivable: { component: Statements, props: { initialTab: 'ageing' }, icon: Wallet },
  budget: { component: Budget, icon: Calculator },
  revenue: { component: Rates, icon: ReceiptText },
  audit: { component: Audit, icon: ShieldCheck, needs: 'finance.audit.view' },
  cashups: { component: Sessions, icon: ClipboardCheck },
  bank: { component: Banking, icon: Landmark, desk: true },
  settings: { component: Setup, icon: Settings, desk: true, needs: 'finance.cash.setup.manage' },
}

const route = useRoute()
const store = useFinanceStore()
const { state, loadDesk, loadDashboard } = useAccountant()

const key = computed(() => route.meta.cwSection as Key)
const section = computed(() => SECTIONS[key.value])
const allowed = computed(() => !section.value.needs || store.can(section.value.needs))
const isPayment = computed(() => key.value === 'journals' && route.query.purpose === 'payment')

onMounted(() => { if (section.value.desk && !state.desk) void loadDesk() })

function changed(): void {
  void loadDashboard(store.selectedYearId)
  if (section.value.desk) void loadDesk()
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="section.icon" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ route.meta.cwTitle }}</h2>
      <p>{{ route.meta.cwLead }}</p>
    </div>
  </section>

  <p v-if="isPayment" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />
    A payment is recorded as a journal: debit the expense (or the creditor), credit the bank account. It is posted by somebody other than you.</p>
  <section v-if="key === 'bank'" class="cw-card" aria-labelledby="bk-h">
    <div class="cw-card-head"><h3 id="bk-h">Bank accounts in the ledger</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <table v-if="state.dashboard?.banks.length" class="cw-table">
        <thead><tr><th>Account</th><th>Currency</th><th class="r">Ledger balance</th><th>Last entry</th><th>Reconciliation</th></tr></thead>
        <tbody>
          <tr v-for="b in state.dashboard.banks" :key="b.id + b.currency">
            <td>{{ b.code }} — {{ b.name }}</td><td>{{ b.currency }}</td><td class="amt">{{ formatMoney(b.balance, b.currency) }}</td>
            <td>{{ formatDate(b.last_entry) }}</td><td><RouterLink :to="{ name: 'acc-bank' }" class="cw-link">Reconcile</RouterLink></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="cw-empty">No bank account has entries.</p>
    </div>
  </section>

  <div v-if="!allowed" class="cw-banner-msg cw-banner-msg--warn" role="status">
    <AlertTriangle :size="18" aria-hidden="true" />
    <span v-if="key === 'audit'">The finance audit trail is read by internal audit and the Director of Finance. Your role does not hold <code>finance.audit.view</code>; every act you take is still recorded in it.</span>
    <span v-else>Your role does not include this page. Ask the finance administrator if your duties have changed.</span>
  </div>
  <div v-else-if="section.desk && !state.desk" class="cw-card cw-card-body" style="padding-top: 20px">
    <p v-if="state.deskError" class="cw-banner-msg cw-banner-msg--neg">{{ state.deskError }}</p>
    <template v-else><span class="cw-skel" /><span class="cw-skel" /></template>
  </div>
  <div v-else class="acc-embed">
    <component :is="section.component" v-bind="{ ...(section.props ?? {}), ...(section.desk ? { desk: state.desk } : {}) }" @changed="changed" />
  </div>
</template>

<style scoped>
.acc-embed { position: relative; overflow-x: auto; background: var(--cw-surface); border-radius: var(--cw-r); box-shadow: var(--cw-shadow); border: 1px solid #e3e8ee; padding: 18px; min-width: 0; }
</style>
