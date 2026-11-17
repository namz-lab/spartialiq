<script setup lang="ts">
/**
 * The Cash Office: the shared portal shell with the cashier's navigation. Loads the desk and the
 * queue once and refreshes the queue every minute; each page reloads what it changes through
 * `useCashier()`. Ctrl+N starts a new payment from anywhere.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  House, CreditCard, FileText, Users, Search, Layers, ChartColumn, Mail, CircleHelp, AlertTriangle, RefreshCw,
  Landmark, MonitorCheck, ClipboardCheck, MapPinned } from 'lucide-vue-next'
import PortalShell, { type PortalNavItem } from '../shared/PortalShell.vue'
import { greeting, usePortalInbox } from '../shared/usePortal'
import { financeRoleLabel } from '../../shell/roleLabels'
import { useFinanceStore } from '../../stores/finance'
import { resetCashier, useCashier } from './useCashier'

const router = useRouter()
const store = useFinanceStore()
const { state, loadDesk, loadQueue } = useCashier()
const { inbox } = usePortalInbox()

/**
 * The navigation follows the person's duties, so a cash supervisor (who takes no money) sees the
 * drawers and the cash-ups, and a cashier sees the till. The server still decides every request.
 */
const can = (code: string): boolean => store.can(code)
const tills = computed(() => can('finance.cash.session.operate') || can('finance.cash.receipt.record'))
const supervises = computed(() => can('finance.cash.session.supervise') || can('finance.cash.assignment.manage'))
const verifies = computed(() => can('finance.cash.session.verify'))
const banks = computed(() => can('finance.cash.deposit.prepare'))
const oversight = computed(() => supervises.value || verifies.value)

const nav = computed<PortalNavItem[]>(() => [
  ...(tills.value ? [
    { name: 'cashier-dashboard', label: 'Cashier Dashboard', icon: House },
    { name: 'cashier-gis', label: 'Find Property', icon: MapPinned },
    { name: 'cashier-pay', label: 'Take Payment', icon: CreditCard },
  ] : []),
  { name: 'cashier-receipts', label: 'Receipts', icon: FileText },
  { name: 'cashier-customers', label: 'Customer Accounts', icon: Users },
  { name: 'cashier-bills', label: 'Bill Enquiries', icon: Search },
  ...(tills.value ? [{ name: 'cashier-cashup', label: 'Daily Cash Up', icon: Layers }] : []),
  ...(banks.value ? [{ name: 'cashier-banking', label: 'Banking', icon: Landmark }] : []),
  ...(tills.value ? [{ name: 'cashier-reports', label: 'Reports', icon: ChartColumn }] : []),
  ...(supervises.value ? [{ name: 'cashier-drawers', label: 'Drawers', icon: MonitorCheck, group: 'Supervision' }] : []),
  ...(verifies.value ? [{
    name: 'cashier-verify', label: 'Cash-ups to Verify', icon: ClipboardCheck, group: 'Supervision',
    badge: state.desk?.awaiting_verification || undefined,
  }] : []),
  // Under their own heading once a Supervision group is shown, so they do not read as part of it.
  { name: 'cashier-messages', label: 'Messages', icon: Mail, badge: inbox.unread, group: oversight.value ? 'Office' : undefined },
  { name: 'cashier-help', label: 'Help & Support', icon: CircleHelp, group: oversight.value ? 'Office' : undefined },
])
const menu = computed(() => [
  ...(tills.value ? [{ name: 'cashier-cashup', label: 'My till', icon: Layers }] : []),
  ...(supervises.value ? [{ name: 'cashier-drawers', label: 'Drawers', icon: MonitorCheck }] : []),
  { name: 'cashier-messages', label: 'Messages', icon: Mail },
  { name: 'cashier-help', label: 'Help & Support', icon: CircleHelp },
])
const homeRoute = computed(() => (tills.value ? 'cashier-dashboard' : supervises.value ? 'cashier-drawers' : verifies.value ? 'cashier-verify' : 'cashier-dashboard'))
const homeTitle = computed(() => `${greeting()}, ${financeRoleLabel(store.identity?.role) || 'Cashier'}`)

function onKey(e: KeyboardEvent): void {
  if (tills.value && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
    e.preventDefault()
    void router.push({ name: 'cashier-pay' })
  }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

function boot(): void { void loadDesk(); void loadQueue() }
</script>

<template>
  <PortalShell
    :nav="nav" :menu="menu" :home-route="homeRoute" :home-title="homeTitle"
    home-subtitle="Vungu Rural District Council • Finance Department" title-prefix="Cashier"
    brand-sub="Local Authority Finance System" messages-route="cashier-messages" nav-label="Cash Office" workspace="cashier"
    @boot="boot" @tick="loadQueue" @logout="resetCashier"
  >
    <template #notices>
      <div v-if="state.deskError" class="cw-banner-msg cw-banner-msg--neg" role="alert">
        <AlertTriangle :size="18" aria-hidden="true" />
        <span>{{ state.deskError }}</span>
        <button type="button" class="cw-btn cw-btn--small" @click="loadDesk()"><RefreshCw :size="14" aria-hidden="true" /> Retry</button>
      </div>
    </template>
  </PortalShell>
</template>
