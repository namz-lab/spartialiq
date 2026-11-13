<script setup lang="ts">
/** Finance Management: the portal shell with the finance administrator's navigation. */
import { computed } from 'vue'
import {
  House, Users, KeyRound, Workflow, BookOpen, CalendarRange, PlugZap, ShieldCheck, Activity, Settings, Mail,
} from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { managerDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { name: 'mgr-dashboard', label: 'Dashboard', icon: House },
  { name: 'mgr-users', label: 'Users & Roles', icon: Users },
  { name: 'mgr-permissions', label: 'Permissions', icon: KeyRound },
  { name: 'mgr-workflow', label: 'Workflow Setup', icon: Workflow },
  { name: 'mgr-chart', label: 'Chart of Accounts', icon: BookOpen },
  { name: 'mgr-periods', label: 'Financial Periods', icon: CalendarRange },
  { name: 'mgr-integration', label: 'System Integration', icon: PlugZap },
  { name: 'mgr-audit', label: 'Audit Logs', icon: ShieldCheck },
  { name: 'mgr-health', label: 'System Health', icon: Activity, badge: managerDash.state.data?.alerts.length || undefined },
  { name: 'mgr-settings', label: 'Settings', icon: Settings },
])
const menu = [{ name: 'mgr-messages', label: 'Messages', icon: Mail }, { name: 'mgr-settings', label: 'Settings', icon: Settings }]
</script>

<template>
  <PortalLayout :dash="managerDash" :nav="nav" :menu="menu" home-route="mgr-dashboard" home-title="Finance Admin Dashboard"
    :home-crumbs="['Finance Department', 'Finance Admin']" messages-route="mgr-messages" nav-label="Finance Management" :yearly="false" />
</template>
