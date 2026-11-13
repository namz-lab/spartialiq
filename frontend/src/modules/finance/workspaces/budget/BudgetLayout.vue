<script setup lang="ts">
/** Budget Management: the shared portal shell with the budget officer's navigation. */
import { computed, watch } from 'vue'
import {
  House, ClipboardList, ClipboardCheck, ChartLine, ArrowLeftRight, Layers, ChartColumn, Network,
  FolderKanban, Gauge, Settings, Mail,
} from 'lucide-vue-next'
import PortalShell, { type PortalNavItem } from '../shared/PortalShell.vue'
import { useFinanceStore } from '../../stores/finance'
import { resetBudget, useBudget } from './useBudget'

const store = useFinanceStore()
const { state, loadDashboard } = useBudget()

const nav = computed<PortalNavItem[]>(() => [
  { name: 'bud-dashboard', label: 'Budget Officer Dashboard', icon: House },
  { name: 'bud-planning', label: 'Budget Planning', icon: ClipboardList },
  { name: 'bud-approval', label: 'Budget Approval', icon: ClipboardCheck, badge: state.dashboard?.workflow.returned || undefined },
  { name: 'bud-monitoring', label: 'Budget Monitoring', icon: ChartLine },
  { name: 'bud-virements', label: 'Virements & Adjustments', icon: ArrowLeftRight },
  { name: 'bud-commitments', label: 'Commitments (Encumbrances)', icon: Layers },
  { name: 'bud-reports', label: 'Budget Reports', icon: ChartColumn },
  { name: 'bud-programmes', label: 'Programme / Cost Centres', icon: Network },
  { name: 'bud-projects', label: 'Project Budgets', icon: FolderKanban },
  { name: 'bud-kpis', label: 'Performance & KPIs', icon: Gauge },
  { name: 'bud-settings', label: 'Budget Settings', icon: Settings },
])
const menu = [
  { name: 'bud-messages', label: 'Messages', icon: Mail },
  { name: 'bud-settings', label: 'Budget Settings', icon: Settings },
]

/** Opens on the year that contains today; the banner's picker then drives every figure. */
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
watch(() => store.selectedYearId, (id) => { if (store.identity) void loadDashboard(id) })
</script>

<template>
  <PortalShell
    :nav="nav" :menu="menu" home-route="bud-dashboard" home-title="Budget Officer Dashboard"
    :home-crumbs="['Finance Department', 'Budget Officer']" brand-sub="Local Authority Finance Management System"
    messages-route="bud-messages" nav-label="Budget Management" show-year
    @boot="boot" @tick="tick" @logout="resetBudget"
  />
</template>
