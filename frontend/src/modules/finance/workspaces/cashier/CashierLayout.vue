<script setup lang="ts">
/**
 * The Cash Office: the shared portal shell with the cashier's navigation. Loads the desk and the
 * queue once and refreshes the queue every minute; each page reloads what it changes through
 * `useCashier()`. Ctrl+N starts a new payment from anywhere.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { House, CreditCard, FileText, Users, Search, Layers, ChartColumn, Mail, CircleHelp, AlertTriangle, RefreshCw } from 'lucide-vue-next'
import PortalShell, { type PortalNavItem } from '../shared/PortalShell.vue'
import { greeting, usePortalInbox } from '../shared/usePortal'
import { financeRoleLabel } from '../../shell/roleLabels'
import { useFinanceStore } from '../../stores/finance'
import { resetCashier, useCashier } from './useCashier'

const router = useRouter()
const store = useFinanceStore()
const { state, loadDesk, loadQueue } = useCashier()
const { inbox } = usePortalInbox()

const nav = computed<PortalNavItem[]>(() => [
  { name: 'cashier-dashboard', label: 'Cashier Dashboard', icon: House },
  { name: 'cashier-pay', label: 'Take Payment', icon: CreditCard },
  { name: 'cashier-receipts', label: 'Receipts', icon: FileText },
  { name: 'cashier-customers', label: 'Customer Accounts', icon: Users },
  { name: 'cashier-bills', label: 'Bill Enquiries', icon: Search },
  { name: 'cashier-cashup', label: 'Daily Cash Up', icon: Layers },
  { name: 'cashier-reports', label: 'Reports', icon: ChartColumn },
  { name: 'cashier-messages', label: 'Messages', icon: Mail, badge: inbox.unread },
  { name: 'cashier-help', label: 'Help & Support', icon: CircleHelp },
])
const menu = [
  { name: 'cashier-cashup', label: 'My till', icon: Layers },
  { name: 'cashier-messages', label: 'Messages', icon: Mail },
  { name: 'cashier-help', label: 'Help & Support', icon: CircleHelp },
]
const homeTitle = computed(() => `${greeting()}, ${financeRoleLabel(store.identity?.role) || 'Cashier'}`)

function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
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
    :nav="nav" :menu="menu" home-route="cashier-dashboard" :home-title="homeTitle"
    home-subtitle="Vungu Rural District Council • Finance Department" title-prefix="Cashier"
    brand-sub="Local Authority Finance System" messages-route="cashier-messages" nav-label="Cash Office"
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
