<script setup lang="ts">
/**
 * An Accounting page built on a screen the finance console already has: rates, the cash-ups,
 * banking, setup and the audit trail. The page head comes from route meta (`cwTitle`, `cwLead`);
 * `cwSection` picks the screen and how it opens.
 *
 * This page stays local to the workspace rather than using shared/SectionPage.vue because it
 * carries what that page does not: the cash desk the banking screen reads, and the bank-accounts
 * table above it. Reusing the console screens keeps one implementation of each control (preparer ≠
 * poster, the blind count, the period locks) instead of a second copy that could drift.
 */
import { computed, defineAsyncComponent, onMounted, type Component } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import {
  ReceiptText, ShieldCheck, ClipboardCheck, Landmark, Settings, AlertTriangle,
} from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import { useAccountant } from '../useAccountant'
import '@/views/inspector/inspector.css'
import '../../../pages/finance.css'

const Rates = defineAsyncComponent(() => import('../../../pages/sections/RatesSection.vue'))
const Audit = defineAsyncComponent(() => import('../../../pages/sections/FinanceAuditSection.vue'))
const Sessions = defineAsyncComponent(() => import('../../../components/cash/CashSessions.vue'))
const Banking = defineAsyncComponent(() => import('../../../components/cash/CashBanking.vue'))
const Setup = defineAsyncComponent(() => import('../../../components/cash/CashSetup.vue'))

type Key = 'revenue' | 'audit' | 'cashups' | 'bank' | 'settings'
const SECTIONS: Record<Key, { component: Component; icon: Component; desk?: boolean; needs?: string }> = {
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

  <section v-if="key === 'bank'" class="cw-card" aria-labelledby="bk-h">
    <div class="cw-card-head"><h3 id="bk-h">Bank accounts in the ledger</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <table v-if="state.dashboard?.banks.length" class="cw-table">
        <caption class="sr-only">Bank accounts in the ledger</caption>
        <thead><tr><th>Account</th><th>Currency</th><th class="r">Ledger balance</th><th>Last entry</th><th>Reconciliation</th></tr></thead>
        <tbody>
          <tr v-for="b in state.dashboard.banks" :key="b.id + b.currency">
            <th scope="row">{{ b.code }} — {{ b.name }}</th><td>{{ b.currency }}</td><td class="amt">{{ formatMoney(b.balance, b.currency) }}</td>
            <td>{{ formatDate(b.last_entry) }}</td><td>
              <template v-if="b.reconciled_to !== undefined">{{ b.reconciled_to ? `Reconciled to ${formatDate(b.reconciled_to)}` : 'Never reconciled' }}</template><template v-if="(b.unreconciled_entries ?? 0) > 0"><template v-if="b.reconciled_to !== undefined"> · </template>{{ b.unreconciled_entries }} {{ b.unreconciled_entries === 1 ? 'entry' : 'entries' }} not reconciled</template> 
              <RouterLink :to="{ name: 'acc-bank' }" class="cw-link">Reconcile</RouterLink>
            </td>
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
    <component :is="section.component" v-bind="{ ...(section.desk ? { desk: state.desk } : {}) }" @changed="changed" />
  </div>
</template>

<style scoped>
.acc-embed { position: relative; overflow-x: auto; background: var(--cw-surface); border-radius: var(--cw-r); box-shadow: var(--cw-shadow); border: 1px solid #e3e8ee; padding: 18px; min-width: 0; }
</style>
