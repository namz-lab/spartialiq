<script setup lang="ts">
/** Finance Operations: the portal shell with the finance officer's navigation, grouped by the day's work. */
import { computed } from 'vue'
import {
  House, ArrowLeftRight, HandCoins, Wallet, NotebookPen, Landmark, BookOpen, ChartColumn, Mail, Upload, FileWarning, FolderOpen, FolderKanban,
} from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { officerDash } from './dashboard'
import '../shared/dash.css'

const task = (key: string) => officerDash.state.data?.tasks.filter((t) => t.key === key).reduce((n, t) => n + t.n, 0) || undefined
const nav = computed<PortalNavItem[]>(() => [
  { name: 'ofc-dashboard', label: 'Dashboard', icon: House },
  { name: 'ofc-imports', label: 'Imports', icon: Upload, group: 'Data' },
  { name: 'ofc-exceptions', label: 'Import Exceptions', icon: FileWarning, group: 'Data',
    badge: officerDash.state.data?.tasks.find((t) => t.text.startsWith('Import exceptions'))?.n || undefined },
  { name: 'ofc-banking', label: 'Banking', icon: Landmark, group: 'Money' },
  { name: 'ofc-payments', label: 'Invoices & Payments', icon: HandCoins, group: 'Money' },
  { name: 'ofc-journals', label: 'Journals', icon: NotebookPen, group: 'Money', badge: task('journals') },
  { name: 'ofc-receivables', label: 'Receivables', icon: Wallet, group: 'Money' },
  { name: 'ofc-transactions', label: 'Transactions', icon: ArrowLeftRight, group: 'Registers' },
  { name: 'ofc-ledger', label: 'General Ledger', icon: BookOpen, group: 'Registers' },
  { name: 'ofc-projects', label: 'Projects', icon: FolderKanban, group: 'Registers' },
  { name: 'ofc-documents', label: 'Documents', icon: FolderOpen, group: 'Registers' },
  { name: 'ofc-reports', label: 'Reports', icon: ChartColumn, group: 'Registers' },
])
const menu = [{ name: 'ofc-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="officerDash" :nav="nav" :menu="menu" home-route="ofc-dashboard" home-title="Finance Operations Dashboard"
    :home-crumbs="['Finance Department', 'Finance Operations']" messages-route="ofc-messages" nav-label="Finance Operations" workspace="officer" />
</template>
