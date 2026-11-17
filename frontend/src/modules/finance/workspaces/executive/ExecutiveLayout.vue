<script setup lang="ts">
/** Executive Finance: the portal shell with the chief executive's navigation. */
import { computed } from 'vue'
import { House, LayoutDashboard, TrendingUp, Coins, Wallet, FolderKanban, MapPinned, Building2, FileText, Mail, Scale, Hourglass, Landmark, Receipt, ShieldCheck } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { executiveDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { name: 'exe-dashboard', label: 'Dashboard', icon: House },
  { name: 'exe-gis', label: 'Property Map', icon: MapPinned },
  { name: 'exe-overview', label: 'Executive Overview', icon: LayoutDashboard },
  { name: 'exe-performance', label: 'Financial Performance', icon: TrendingUp },
  { name: 'exe-position', label: 'Financial Position', icon: Scale },
  { name: 'exe-cash', label: 'Cash and Bank', icon: Landmark },
  { name: 'exe-ageing', label: 'Debtors by Age', icon: Hourglass },
  { name: 'exe-revenue', label: 'Revenue Overview', icon: Coins },
  { name: 'exe-expenditure', label: 'Expenditure Overview', icon: Wallet },
  { name: 'exe-projects', label: 'Projects & Capital', icon: FolderKanban },
  { name: 'exe-service', label: 'Service Delivery', icon: MapPinned },
  { name: 'exe-departments', label: 'Department Performance', icon: Building2 },
  { name: 'exe-payments', label: 'Payments and Vouchers', icon: Receipt },
  { name: 'exe-reports', label: 'Reports & Briefs', icon: FileText },
  { name: 'exe-trail', label: 'Audit Trail', icon: ShieldCheck },
])
const menu = [{ name: 'exe-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="executiveDash" :nav="nav" :menu="menu" home-route="exe-dashboard" home-title="CEO Dashboard"
    :home-crumbs="['Council', 'Chief Executive Officer']" messages-route="exe-messages" nav-label="Executive Finance" workspace="accounting" />
</template>
