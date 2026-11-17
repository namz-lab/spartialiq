<script setup lang="ts">
/** Committee Decisions: the portal shell with the committee's agenda navigation. */
import { computed } from 'vue'
import { House, Gavel, History, Wallet, ArrowLeftRight, HardHat, Globe2, Percent, Landmark, ChartColumn, FolderOpen, Mail } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { useFinanceStore } from '../../stores/finance'
import { committeeDash, pendingTotal } from './agenda'
import '../shared/dash.css'

const store = useFinanceStore()
const can = (code: string) => store.can(code)
const nav = computed<PortalNavItem[]>(() => [
  { group: 'Agenda', name: 'com-dashboard', label: 'Dashboard', icon: House },
  { group: 'Agenda', name: 'com-agenda', label: 'Awaiting Decision', icon: Gavel, badge: pendingTotal(committeeDash.state.data) || undefined },
  { group: 'Agenda', name: 'com-decided', label: 'Decided', icon: History },
  ...(can('finance.budget.approve') ? [{ group: 'Registers', name: 'com-budget', label: 'Budget', icon: Wallet }] : []),
  ...(can('finance.revision.approve') ? [{ group: 'Registers', name: 'com-revisions', label: 'Revisions', icon: ArrowLeftRight }] : []),
  ...(can('finance.project.approve') ? [{ group: 'Registers', name: 'com-projects', label: 'Projects', icon: HardHat }] : []),
  ...(can('finance.publication.approve') ? [{ group: 'Registers', name: 'com-publication', label: 'Publications', icon: Globe2 }] : []),
  ...(can('finance.rates.tariff.approve') ? [{ group: 'Registers', name: 'com-tariffs', label: 'Rates Tariffs', icon: Percent }] : []),
  { group: 'Context', name: 'com-position', label: 'Financial Position', icon: Landmark },
  { group: 'Context', name: 'com-reports', label: 'Reports', icon: ChartColumn },
  { group: 'Context', name: 'com-documents', label: 'Documents', icon: FolderOpen },
])
const menu = [{ name: 'com-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="committeeDash" :nav="nav" :menu="menu" home-route="com-dashboard" home-title="Committee Decisions"
    :home-crumbs="['Finance Department', 'Finance Committee']" messages-route="com-messages" nav-label="Committee Decisions" :yearly="false" workspace="committee" />
</template>
