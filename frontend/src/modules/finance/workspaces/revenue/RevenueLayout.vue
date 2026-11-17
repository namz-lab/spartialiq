<script setup lang="ts">
/** Revenue and Rates: the portal shell with the revenue officer's navigation. */
import { computed } from 'vue'
import {
  House, FileText, HandCoins, Users, Clock, Percent, Wrench, ChartColumn, Bell, FileStack, ListChecks, ScrollText,
  Landmark, SlidersHorizontal, TrendingUp, BadgeCheck,
} from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { usePortalInbox } from '../shared/usePortal'
import { revenueDash } from './dashboard'
import '../shared/dash.css'

const { inbox } = usePortalInbox()
const nav = computed<PortalNavItem[]>(() => [
  { group: 'Desk', name: 'rev-dashboard', label: 'Dashboard', icon: House },
  { group: 'Billing', name: 'rev-billing', label: 'Billing & Invoicing', icon: FileText },
  { group: 'Billing', name: 'rev-bills', label: 'Bills Register', icon: FileStack },
  { group: 'Billing', name: 'rev-roll', label: 'Valuation Roll', icon: Landmark },
  { group: 'Billing', name: 'rev-rates', label: 'Rates & Levies', icon: Percent },
  { group: 'Billing', name: 'rev-charges', label: 'Service Charges', icon: Wrench },
  { group: 'Ratepayers', name: 'rev-accounts', label: 'Customer Accounts', icon: Users },
  { group: 'Ratepayers', name: 'rev-statement', label: 'Statements', icon: ScrollText },
  { group: 'Ratepayers', name: 'rev-collections', label: 'Collections', icon: HandCoins },
  { group: 'Debt', name: 'rev-arrears', label: 'Arrears Management', icon: Clock },
  { group: 'Debt', name: 'rev-collection', label: 'Collection List', icon: ListChecks },
  { group: 'Debt', name: 'rev-adjust', label: 'Adjustments', icon: SlidersHorizontal },
  { group: 'Debt', name: 'rev-interest', label: 'Interest on Arrears', icon: TrendingUp },
  { group: 'Debt', name: 'rev-clearance', label: 'Clearance Certificates', icon: BadgeCheck },
  { group: 'Reporting', name: 'rev-reports', label: 'Revenue Reports', icon: ChartColumn },
  { group: 'Reporting', name: 'rev-messages', label: 'Notifications', icon: Bell, badge: inbox.unread || undefined },
])
</script>

<template>
  <PortalLayout :dash="revenueDash" :nav="nav" home-route="rev-dashboard" home-title="Revenue Officer Dashboard"
    :home-crumbs="['Finance Department', 'Revenue Officer']" messages-route="rev-messages" nav-label="Revenue and Rates" workspace="revenue" />
</template>
