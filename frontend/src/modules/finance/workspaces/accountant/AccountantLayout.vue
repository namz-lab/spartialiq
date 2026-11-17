<script setup lang="ts">
/** Accounting: the shared portal shell with the accountant's navigation. */
import { computed, watch } from 'vue'
import {
  House, ClipboardCheck, Landmark, NotebookPen, HandCoins, Wallet, BookOpen, ChartColumn, Layers,
  Calculator, Building2, Truck, ReceiptText, Percent, CalendarCheck, ShieldCheck, Settings, Mail, DatabaseBackup, PiggyBank, BookText, FileText, Users, MapPinned } from 'lucide-vue-next'
import PortalShell, { type PortalNavItem } from '../shared/PortalShell.vue'
import { useFinanceStore } from '../../stores/finance'
import { resetAccountant, useAccountant } from './useAccountant'
import './kit/print.css'

const store = useFinanceStore()
const { state, loadDashboard } = useAccountant()

const nav = computed<PortalNavItem[]>(() => [
  { group: 'Desk', name: 'acc-dashboard', label: 'Dashboard', icon: House },
  { name: 'acc-gis', label: 'Property Map', icon: MapPinned, group: 'Desk' },
  { group: 'The books', name: 'acc-journals', label: 'Journals', icon: NotebookPen },
  { group: 'The books', name: 'acc-salaries', label: 'Salaries Journal', icon: Users },
  { group: 'The books', name: 'acc-ledger', label: 'General Ledger', icon: BookOpen },
  { group: 'The books', name: 'acc-trial', label: 'Trial Balance', icon: ChartColumn },
  { group: 'Cash & bank', name: 'acc-cashbook', label: 'Cashbook', icon: BookText },
  { group: 'Cash & bank', name: 'acc-bank', label: 'Bank Reconciliation', icon: Landmark },
  { group: 'Cash & bank', name: 'acc-cashups', label: 'Cash-Up Approvals', icon: ClipboardCheck, badge: state.dashboard?.cashups.length || undefined },
  { group: 'Cash & bank', name: 'acc-banking', label: 'Banking & Deposits', icon: PiggyBank },
  { group: 'Debtors', name: 'acc-receivable', label: 'Debtors', icon: Wallet },
  { group: 'Debtors', name: 'acc-revenue', label: 'Revenue & Billing', icon: ReceiptText },
  { group: 'Creditors', name: 'acc-payable', label: 'Accounts Payable', icon: HandCoins },
  { group: 'Creditors', name: 'acc-parties', label: 'Parties', icon: Truck },
  { group: 'Assets', name: 'acc-assets', label: 'Asset Register', icon: Building2 },
  { group: 'Period end', name: 'acc-close', label: 'Period Close', icon: CalendarCheck },
  { group: 'Period end', name: 'acc-reports', label: 'Financial Statements', icon: Layers },
  { group: 'Period end', name: 'acc-ledger-reports', label: 'Ledger Reports', icon: FileText },
  { group: 'Period end', name: 'acc-tax', label: 'Tax Control', icon: Percent },
  { group: 'Control', name: 'acc-votebook', label: 'Vote Book', icon: Calculator },
  { group: 'Control', name: 'acc-audit', label: 'Audit Trail', icon: ShieldCheck },
  { group: 'Control', name: 'acc-migration', label: 'Data Migration', icon: DatabaseBackup },
  { group: 'Control', name: 'acc-settings', label: 'Settings', icon: Settings },
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
    messages-route="acc-messages" nav-label="Accounting" show-year workspace="accountant"
    @boot="boot" @tick="tick" @logout="resetAccountant"
  />
</template>
