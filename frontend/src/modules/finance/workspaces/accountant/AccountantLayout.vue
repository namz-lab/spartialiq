<script setup lang="ts">
/** Accounting: the shared portal shell with the accountant's navigation. */
import { computed, watch } from 'vue'
import {
  House, ClipboardCheck, Landmark, NotebookPen, HandCoins, Wallet, BookOpen, ChartColumn, Layers,
  Calculator, Building2, Truck, ReceiptText, Percent, CalendarCheck, ShieldCheck, Settings, Mail, DatabaseBackup, PiggyBank,
} from 'lucide-vue-next'
import PortalShell, { type PortalNavItem } from '../shared/PortalShell.vue'
import { useFinanceStore } from '../../stores/finance'
import { resetAccountant, useAccountant } from './useAccountant'

const store = useFinanceStore()
const { state, loadDashboard } = useAccountant()

const nav = computed<PortalNavItem[]>(() => [
  { name: 'acc-dashboard', label: 'Accountant Dashboard', icon: House },
  { name: 'acc-cashups', label: 'Cash-Up Approvals', icon: ClipboardCheck, badge: state.dashboard?.cashups.length || undefined },
  { name: 'acc-bank', label: 'Bank Reconciliation', icon: Landmark },
  { name: 'acc-banking', label: 'Banking & Deposits', icon: PiggyBank },
  { name: 'acc-journals', label: 'Journal Entries', icon: NotebookPen },
  { name: 'acc-payable', label: 'Accounts Payable', icon: HandCoins },
  { name: 'acc-receivable', label: 'Accounts Receivable', icon: Wallet },
  { name: 'acc-ledger', label: 'General Ledger', icon: BookOpen },
  { name: 'acc-trial', label: 'Trial Balance', icon: ChartColumn },
  { name: 'acc-reports', label: 'Financial Reports', icon: Layers },
  { name: 'acc-budget', label: 'Budget Management', icon: Calculator },
  { name: 'acc-assets', label: 'Asset Register', icon: Building2 },
  { name: 'acc-suppliers', label: 'Supplier Management', icon: Truck },
  { name: 'acc-revenue', label: 'Revenue & Billing', icon: ReceiptText },
  { name: 'acc-tax', label: 'Tax & Statutory', icon: Percent },
  { name: 'acc-migration', label: 'Data Migration', icon: DatabaseBackup },
  { name: 'acc-close', label: 'Close Period', icon: CalendarCheck },
  { name: 'acc-audit', label: 'Audit Trail', icon: ShieldCheck },
  { name: 'acc-settings', label: 'Settings', icon: Settings },
])
const menu = [
  { name: 'acc-messages', label: 'Messages', icon: Mail },
  { name: 'acc-settings', label: 'Settings', icon: Settings },
]

/**
 * The dashboard is year to date, so it opens on the year that contains today: the server picks it
 * when no year is named, and the banner's picker is moved to it. Choosing another year afterwards
 * redraws every figure for that year.
 */
async function boot(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const chosen = store.selectedYear
  if (chosen && chosen.start_date <= today && today <= chosen.end_date) {
    await loadDashboard(chosen.id)
    return
  }
  await loadDashboard(null)
  const id = state.dashboard?.year.id
  if (id && id !== store.selectedYearId && store.years.some((y) => y.id === id)) store.selectYear(id)
}
const tick = (): void => { void loadDashboard(store.selectedYearId) }
// The year picker in the banner drives every figure on the dashboard.
watch(() => store.selectedYearId, (id) => { if (store.identity) void loadDashboard(id) })
</script>

<template>
  <PortalShell
    :nav="nav" :menu="menu" home-route="acc-dashboard" home-title="Accountant Dashboard"
    :home-crumbs="['Finance Department', 'Accountant']" brand-sub="Local Authority Finance Management System"
    messages-route="acc-messages" nav-label="Accounting" show-year
    @boot="boot" @tick="tick" @logout="resetAccountant"
  />
</template>
