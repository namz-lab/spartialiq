<script setup lang="ts">
/** Department Finance: the portal shell with a head of department's navigation. */
import { computed } from 'vue'
import { House, Wallet, Layers, Receipt, FileSignature, FolderKanban, Gauge, ChartColumn, FolderOpen, Mail } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { departmentDash } from './dashboard'
import '../shared/dash.css'

const returned = computed(() => departmentDash.state.data?.tasks.find((t) => t.query?.status === 'returned')?.n)
const nav = computed<PortalNavItem[]>(() => [
  { name: 'dep-dashboard', label: 'Dashboard', icon: House },
  { name: 'dep-budget', label: 'Department Budget', icon: Wallet, badge: returned.value || undefined },
  { name: 'dep-commitments', label: 'Commitments (PR/PO)', icon: Layers },
  { name: 'dep-expenditure', label: 'Expenditure', icon: Receipt },
  { name: 'dep-requisitions', label: 'Requisitions', icon: FileSignature },
  { name: 'dep-projects', label: 'Projects', icon: FolderKanban },
  { name: 'dep-performance', label: 'Performance (KPIs)', icon: Gauge },
  { name: 'dep-reports', label: 'Reports', icon: ChartColumn },
  { name: 'dep-documents', label: 'Documents', icon: FolderOpen },
])
const menu = [{ name: 'dep-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="departmentDash" :nav="nav" :menu="menu" home-route="dep-dashboard" home-title="Department Head Dashboard"
    :home-crumbs="['Council', 'Department Head']" messages-route="dep-messages" nav-label="Department Finance" />
</template>
