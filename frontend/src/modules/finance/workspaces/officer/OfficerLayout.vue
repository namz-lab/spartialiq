<script setup lang="ts">
/** Finance Operations: the portal shell with the finance officer's navigation. */
import { computed } from 'vue'
import { House, ArrowLeftRight, HandCoins, Wallet, NotebookPen, Landmark, Scale, BookOpen, ChartColumn, Mail } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { officerDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { name: 'ofc-dashboard', label: 'Dashboard', icon: House },
  { name: 'ofc-transactions', label: 'Transactions', icon: ArrowLeftRight },
  { name: 'ofc-payments', label: 'Payments', icon: HandCoins },
  { name: 'ofc-receivables', label: 'Receivables', icon: Wallet },
  { name: 'ofc-journals', label: 'Journals', icon: NotebookPen, badge: officerDash.state.data?.journals.n || undefined },
  { name: 'ofc-banking', label: 'Banking', icon: Landmark },
  { name: 'ofc-reconciliation', label: 'Reconciliation', icon: Scale },
  { name: 'ofc-ledger', label: 'General Ledger', icon: BookOpen },
  { name: 'ofc-reports', label: 'Reports', icon: ChartColumn },
])
const menu = [{ name: 'ofc-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="officerDash" :nav="nav" :menu="menu" home-route="ofc-dashboard" home-title="Finance Officer Dashboard"
    :home-crumbs="['Finance Department', 'Finance Officer']" messages-route="ofc-messages" nav-label="Finance Operations" />
</template>
