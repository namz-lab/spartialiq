<script setup lang="ts">
/**
 * A workspace's frame: the portal shell plus its dashboard read.
 *
 * A year-based dashboard opens on the year that contains today (the server picks it when none is
 * named) and moves the banner's year picker there; choosing another year afterwards redraws every
 * figure. A dashboard that is not per year (`yearly` false) is simply read.
 */
import { provide, watch } from 'vue'
import PortalShell, { type PortalMenuItem, type PortalNavItem } from './PortalShell.vue'
import { useFinanceStore } from '../../stores/finance'
import type { WorkspaceKey } from '../../shell/workspaces'
import type { Dashboard } from './useDashboard'

const props = withDefaults(defineProps<{
  dash: Dashboard<unknown>
  nav: PortalNavItem[]
  menu?: PortalMenuItem[]
  homeRoute: string
  homeTitle: string
  homeCrumbs: string[]
  messagesRoute: string
  navLabel: string
  yearly?: boolean
  /** Names this workspace on the switcher between the workspaces the person holds. */
  workspace?: WorkspaceKey | null
}>(), { menu: () => [], yearly: true, workspace: null })

const store = useFinanceStore()

async function boot(): Promise<void> {
  if (!props.yearly) { await props.dash.load(); return }
  const today = new Date().toISOString().slice(0, 10)
  const chosen = store.selectedYear
  if (chosen && chosen.start_date <= today && today <= chosen.end_date) {
    await props.dash.load(chosen.id)
    return
  }
  await props.dash.load(null)
  const id = props.dash.yearOf()
  if (id && id !== store.selectedYearId && store.years.some((y) => y.id === id)) store.selectYear(id)
}
const refresh = (): void => { void props.dash.load(props.yearly ? store.selectedYearId : null) }
provide('portalRefresh', refresh)
watch(() => store.selectedYearId, (id) => { if (props.yearly && store.identity && id !== props.dash.yearOf()) void props.dash.load(id) })
</script>

<template>
  <PortalShell
    :nav="nav" :menu="menu" :home-route="homeRoute" :home-title="homeTitle" :home-crumbs="homeCrumbs"
    brand-sub="Local Authority Finance Management System" :messages-route="messagesRoute" :nav-label="navLabel"
    :show-year="yearly" :workspace="workspace" @boot="boot" @tick="refresh" @logout="dash.reset()"
  />
</template>
