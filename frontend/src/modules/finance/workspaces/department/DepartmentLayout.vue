<script setup lang="ts">
/** Department Finance: the portal shell with a head of department's navigation. */
import { computed } from 'vue'
import { House, Wallet, Layers, Receipt, FileSignature, FolderKanban, Gauge, ChartColumn, FolderOpen, Mail, ArrowLeftRight, MessageSquareText, MapPinned } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { departmentDash } from './dashboard'
import '../shared/dash.css'

const task = (pred: (t: { key: string; query?: Record<string, string> }) => boolean) => departmentDash.state.data?.tasks.find(pred)?.n
const returned = computed(() => task((t) => t.query?.status === 'returned'))
const unexplained = computed(() => task((t) => t.key === 'expenditure'))
const nav = computed<PortalNavItem[]>(() => [
  { name: 'dep-dashboard', label: 'Dashboard', icon: House },
  { name: 'dep-gis', label: 'Property Map', icon: MapPinned },
  { name: 'dep-budget', label: 'Department Budget', icon: Wallet, badge: returned.value || undefined },
  { name: 'dep-revisions', label: 'Budget Revisions', icon: ArrowLeftRight },
  { name: 'dep-expenditure', label: 'Budget vs Actual', icon: Receipt },
  { name: 'dep-commitments', label: 'Commitments (PR/PO)', icon: Layers },
  { name: 'dep-variance', label: 'Variance Explanations', icon: MessageSquareText, badge: unexplained.value || undefined },
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
    :home-crumbs="['Council', 'Department Head']" messages-route="dep-messages" nav-label="Department Finance" workspace="department" />
</template>
