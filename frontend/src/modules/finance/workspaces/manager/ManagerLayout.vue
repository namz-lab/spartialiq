<script setup lang="ts">
/**
 * Finance Management: the portal shell with the finance director's navigation, grouped by the
 * director's work: the position, the decisions waiting, the controls of the system and oversight.
 * The year picker is shown because the position, exceptions and statements are per year.
 */
import { computed } from 'vue'
import {
  House, Users, KeyRound, Workflow, BookOpen, CalendarRange, PlugZap, ShieldCheck, Activity, Mail,
  Scale, Inbox, ShieldAlert, FileStack, ChartColumn, FolderOpen, Shapes, MapPinned } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { managerDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { name: 'mgr-dashboard', label: 'Dashboard', icon: House, group: 'Position' },
  { name: 'mgr-gis', label: 'Property Map', icon: MapPinned, group: 'Position' },
  { name: 'mgr-position', label: 'Financial Position', icon: Scale, group: 'Position' },
  { name: 'mgr-statements', label: 'Statements', icon: FileStack, group: 'Position' },
  { name: 'mgr-reports', label: 'Reports', icon: ChartColumn, group: 'Position' },
  { name: 'mgr-approvals', label: 'Approvals', icon: Inbox, group: 'Decisions', badge: managerDash.state.data?.pending_total || undefined },
  { name: 'mgr-exceptions', label: 'Exceptions', icon: ShieldAlert, group: 'Decisions' },
  { name: 'mgr-periods', label: 'Financial Periods', icon: CalendarRange, group: 'Control' },
  { name: 'mgr-chart', label: 'Chart of Accounts', icon: BookOpen, group: 'Control' },
  { name: 'mgr-settings', label: 'Classifications', icon: Shapes, group: 'Control' },
  { name: 'mgr-workflow', label: 'Workflow Setup', icon: Workflow, group: 'Control' },
  { name: 'mgr-integration', label: 'System Integration', icon: PlugZap, group: 'Control' },
  { name: 'mgr-audit', label: 'Audit Logs', icon: ShieldCheck, group: 'Oversight' },
  { name: 'mgr-documents', label: 'Documents', icon: FolderOpen, group: 'Oversight' },
  { name: 'mgr-users', label: 'Users & Roles', icon: Users, group: 'Oversight' },
  { name: 'mgr-permissions', label: 'Permissions', icon: KeyRound, group: 'Oversight' },
  { name: 'mgr-health', label: 'System Health', icon: Activity, group: 'Oversight', badge: managerDash.state.data?.alerts.length || undefined },
])
const menu = [{ name: 'mgr-messages', label: 'Messages', icon: Mail }, { name: 'mgr-workflow', label: 'Workflow Setup', icon: Workflow }]
</script>

<template>
  <PortalLayout :dash="managerDash" :nav="nav" :menu="menu" home-route="mgr-dashboard" home-title="Finance Management Dashboard"
    :home-crumbs="['Finance Department', 'Finance Management']" messages-route="mgr-messages" nav-label="Finance Management" workspace="manager" />
</template>
