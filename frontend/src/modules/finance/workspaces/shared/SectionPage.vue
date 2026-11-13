<script setup lang="ts">
/**
 * A workspace page built on a screen the finance console already has. Route meta decides which:
 *
 *   cwEmbed   the screen (a key of SECTIONS below)
 *   cwProps   how it opens (a tab, a part of the ledger)
 *   cwIcon    the page-head icon;  cwTitle / cwLead  the page head
 *   cwNeeds   a permission the screen needs; without it the page says so (cwDenied, or a default)
 *   cwStates  a row of workflow states written to the address (`cwStateParam`, default `status`),
 *             which the screen reads as its filter
 *
 * Reusing the console screens keeps one implementation of every control (preparer ≠ approver,
 * period locks, publication approval) instead of a second copy per workspace.
 */
import { computed, defineAsyncComponent, onBeforeMount, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, LayoutGrid } from 'lucide-vue-next'
import { useFinanceStore } from '../../stores/finance'
import { usePortalRefresh } from './useDashboard'
import '@/views/inspector/inspector.css'
import '../../pages/finance.css'

const S = (load: () => Promise<{ default: Component }>) => defineAsyncComponent(load)
const SECTIONS: Record<string, Component> = {
  overview: S(() => import('../../pages/sections/FinanceOverviewSection.vue')),
  budget: S(() => import('../../pages/sections/BudgetSection.vue')),
  revisions: S(() => import('../../pages/sections/RevisionsSection.vue')),
  reports: S(() => import('../../pages/sections/ReportsSection.vue')),
  projects: S(() => import('../../pages/sections/ProjectsSection.vue')),
  ledger: S(() => import('../../pages/sections/LedgerSection.vue')),
  statements: S(() => import('../../pages/sections/StatementsSection.vue')),
  rates: S(() => import('../../pages/sections/RatesSection.vue')),
  audit: S(() => import('../../pages/sections/FinanceAuditSection.vue')),
  documents: S(() => import('../../pages/sections/DocumentsSection.vue')),
  publication: S(() => import('../../pages/sections/PublicationSection.vue')),
  transactions: S(() => import('../../pages/sections/TransactionsSection.vue')),
  imports: S(() => import('../../pages/sections/ImportsSection.vue')),
  years: S(() => import('../../pages/sections/FinancialYearsSection.vue')),
  classifications: S(() => import('../../pages/sections/ClassificationsSection.vue')),
  settings: S(() => import('../../pages/sections/FinanceSettingsSection.vue')),
  permissions: S(() => import('../../pages/sections/PermissionsSection.vue')),
  access: S(() => import('../../pages/sections/AccessSection.vue')),
  map: S(() => import('../../pages/sections/MapSection.vue')),
}

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const refresh = usePortalRefresh()

const component = computed(() => SECTIONS[String(route.meta.cwEmbed)])
const icon = computed(() => (route.meta.cwIcon as Component | undefined) ?? LayoutGrid)
const needs = computed(() => route.meta.cwNeeds as string | undefined)
const allowed = computed(() => !needs.value || store.can(needs.value))
const states = computed(() => (route.meta.cwStates as { value: string; label: string }[] | undefined) ?? [])
const param = computed(() => String(route.meta.cwStateParam ?? 'status'))
const current = computed(() => (typeof route.query[param.value] === 'string' ? String(route.query[param.value]) : ''))

onBeforeMount(() => {
  const first = route.meta.cwStateDefault as string | undefined
  if (first && !current.value) void router.replace({ query: { ...route.query, [param.value]: first } })
})
function show(value: string): void { void router.replace({ query: { ...route.query, [param.value]: value } }) }
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="icon" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ route.meta.cwTitle }}</h2>
      <p>{{ route.meta.cwLead }}</p>
    </div>
  </section>

  <div v-if="states.length && allowed" class="cw-seg sp-states" role="group" aria-label="Workflow state">
    <button v-for="s in states" :key="s.value" type="button" :aria-pressed="current === s.value" @click="show(s.value)">{{ s.label }}</button>
  </div>

  <div v-if="!allowed" class="cw-banner-msg cw-banner-msg--warn" role="status">
    <AlertTriangle :size="18" aria-hidden="true" />
    <span v-if="route.meta.cwDenied">{{ route.meta.cwDenied }}</span>
    <span v-else>Your role does not include this page (it needs <code>{{ needs }}</code>). Ask the finance administrator if your duties have changed.</span>
  </div>
  <div v-else-if="component" class="sp-embed">
    <component :is="component" :key="route.name ?? ''" v-bind="(route.meta.cwProps as Record<string, unknown> | undefined) ?? {}" @changed="refresh" />
  </div>
</template>

<style scoped>
.sp-embed { position: relative; overflow-x: auto; min-width: 0; padding: 18px; background: var(--cw-surface); border-radius: var(--cw-r); box-shadow: var(--cw-shadow); border: 1px solid #e3e8ee; }
.sp-states { max-width: 820px; }
</style>
