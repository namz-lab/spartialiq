<script setup lang="ts">
/** Revenue and Rates: the portal shell with the revenue officer's navigation. */
import { computed } from 'vue'
import { House, FileText, HandCoins, Users, Clock, Percent, Wrench, ChartColumn, Bell } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { usePortalInbox } from '../shared/usePortal'
import { revenueDash } from './dashboard'
import '../shared/dash.css'

const { inbox } = usePortalInbox()
const nav = computed<PortalNavItem[]>(() => [
  { name: 'rev-dashboard', label: 'Dashboard', icon: House },
  { name: 'rev-billing', label: 'Billing & Invoicing', icon: FileText },
  { name: 'rev-collections', label: 'Collections', icon: HandCoins },
  { name: 'rev-accounts', label: 'Customer Accounts', icon: Users },
  { name: 'rev-arrears', label: 'Arrears Management', icon: Clock },
  { name: 'rev-rates', label: 'Rates & Levies', icon: Percent },
  { name: 'rev-charges', label: 'Service Charges', icon: Wrench },
  { name: 'rev-reports', label: 'Revenue Reports', icon: ChartColumn },
  { name: 'rev-messages', label: 'Notifications', icon: Bell, badge: inbox.unread || undefined },
])
</script>

<template>
  <PortalLayout :dash="revenueDash" :nav="nav" home-route="rev-dashboard" home-title="Revenue Officer Dashboard"
    :home-crumbs="['Finance Department', 'Revenue Officer']" messages-route="rev-messages" nav-label="Revenue and Rates" />
</template>
