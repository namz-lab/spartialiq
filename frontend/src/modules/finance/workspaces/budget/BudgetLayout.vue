<script setup lang="ts">
/**
 * Budget Management: the shared portal frame with the budget officer's navigation, grouped by the
 * budget cycle (prepare, execute, structure, report). The dashboard read is loaded by PortalLayout
 * on boot, on each tick and when a section page changes something.
 */
import { computed } from 'vue'
import {
  House, ClipboardList, ClipboardCheck, ChartLine, ArrowLeftRight, Layers, ChartColumn, Network,
  FolderKanban, Gauge, Settings, Mail, Landmark, MessageSquareText, Map as MapIcon, FolderOpen, FileStack, TableProperties,
} from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { budgetDash } from './useBudget'
import type { Dashboard } from '../shared/useDashboard'

const state = budgetDash.state

const nav = computed<PortalNavItem[]>(() => [
  { group: 'Desk', name: 'bud-dashboard', label: 'Dashboard', icon: House },
  { group: 'Preparation', name: 'bud-planning', label: 'Budget Planning', icon: ClipboardList },
  { group: 'Preparation', name: 'bud-approval', label: 'Approval Status', icon: ClipboardCheck, badge: state.data?.workflow.returned || undefined },
  { group: 'Preparation', name: 'bud-preparation', label: 'Preparation by Vote', icon: TableProperties },
  { group: 'Execution', name: 'bud-monitoring', label: 'Budget Monitoring', icon: ChartLine },
  { group: 'Execution', name: 'bud-revenue', label: 'Revenue Estimates', icon: Landmark },
  { group: 'Execution', name: 'bud-commitments', label: 'Commitments', icon: Layers },
  { group: 'Execution', name: 'bud-variance', label: 'Variance Explanations', icon: MessageSquareText },
  { group: 'Execution', name: 'bud-virements', label: 'Virements & Revisions', icon: ArrowLeftRight, badge: state.data?.revisions_awaiting || undefined },
  { group: 'Structure', name: 'bud-programmes', label: 'Programmes & Votes', icon: Network },
  { group: 'Structure', name: 'bud-projects', label: 'Project Budgets', icon: FolderKanban },
  { group: 'Structure', name: 'bud-map', label: 'Allocation by Ward', icon: MapIcon },
  { group: 'Reporting', name: 'bud-reports', label: 'Budget Reports', icon: ChartColumn },
  { group: 'Reporting', name: 'bud-submission', label: 'Council Submission Pack', icon: FileStack },
  { group: 'Reporting', name: 'bud-kpis', label: 'Performance & KPIs', icon: Gauge },
  { group: 'Reporting', name: 'bud-documents', label: 'Documents', icon: FolderOpen },
  { group: 'Control', name: 'bud-settings', label: 'Budget Settings', icon: Settings },
])
const menu = [
  { name: 'bud-messages', label: 'Messages', icon: Mail },
  { name: 'bud-settings', label: 'Budget Settings', icon: Settings },
]
</script>

<template>
  <PortalLayout
    :dash="(budgetDash as Dashboard<unknown>)" :nav="nav" :menu="menu" home-route="bud-dashboard" home-title="Budget Officer Dashboard"
    :home-crumbs="['Finance Department', 'Budget Officer']" messages-route="bud-messages" nav-label="Budget Management"
    workspace="budget"
  />
</template>
