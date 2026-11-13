<script setup lang="ts">
/** Internal Audit: the portal shell with the internal auditor's navigation. */
import { computed } from 'vue'
import { House, ClipboardList, UserCheck, Search, TriangleAlert, ListChecks, FolderOpen, ChartColumn, ShieldCheck, Mail } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { auditDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { name: 'aud-dashboard', label: 'Dashboard', icon: House },
  { name: 'aud-plans', label: 'Audit Plans', icon: ClipboardList },
  { name: 'aud-assignments', label: 'Audit Assignments', icon: UserCheck },
  { name: 'aud-findings', label: 'Findings', icon: Search, badge: auditDash.state.data?.findings.open || undefined },
  { name: 'aud-risks', label: 'Risk Register', icon: TriangleAlert },
  { name: 'aud-compliance', label: 'Compliance', icon: ListChecks, badge: auditDash.state.data?.findings.overdue || undefined },
  { name: 'aud-evidence', label: 'Evidence', icon: FolderOpen },
  { name: 'aud-reports', label: 'Reports', icon: ChartColumn },
  { name: 'aud-trail', label: 'Audit Trail', icon: ShieldCheck },
])
const menu = [{ name: 'aud-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="auditDash" :nav="nav" :menu="menu" home-route="aud-dashboard" home-title="Internal Auditor Dashboard"
    :home-crumbs="['Finance Department', 'Internal Auditor']" messages-route="aud-messages" nav-label="Internal Audit" />
</template>
