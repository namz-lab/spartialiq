<script setup lang="ts">
/**
 * A Budget Management page built on a screen the finance console already has: budget lines,
 * revisions, reports and projects. Reusing them keeps one implementation of each control (a
 * preparer cannot approve their own line, an approved line is changed only by a revision).
 *
 * Budget Approval is the budget-line screen opened on one workflow state (`?status=`), submitted by
 * default; the line screen reads that filter from the address and keeps it in step.
 */
import { computed, defineAsyncComponent, onBeforeMount, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ClipboardList, ClipboardCheck, ArrowLeftRight, ChartColumn, FolderKanban } from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { useBudget } from '../useBudget'
import '@/views/inspector/inspector.css'
import '../../../pages/finance.css'

const Budget = defineAsyncComponent(() => import('../../../pages/sections/BudgetSection.vue'))
const Revisions = defineAsyncComponent(() => import('../../../pages/sections/RevisionsSection.vue'))
const Reports = defineAsyncComponent(() => import('../../../pages/sections/ReportsSection.vue'))
const Projects = defineAsyncComponent(() => import('../../../pages/sections/ProjectsSection.vue'))

type Key = 'planning' | 'approval' | 'virements' | 'reports' | 'projects'
const SECTIONS: Record<Key, { component: Component; icon: Component }> = {
  planning: { component: Budget, icon: ClipboardList },
  approval: { component: Budget, icon: ClipboardCheck },
  virements: { component: Revisions, icon: ArrowLeftRight },
  reports: { component: Reports, icon: ChartColumn },
  projects: { component: Projects, icon: FolderKanban },
}
const STATES = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Pending approval' },
  { value: 'returned', label: 'Returned for revision' }, { value: 'approved', label: 'Approved' },
]

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const { loadDashboard } = useBudget()

const key = computed(() => route.meta.cwSection as Key)
const section = computed(() => SECTIONS[key.value])
const status = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''))

onBeforeMount(() => {
  if (key.value === 'approval' && !status.value) void router.replace({ query: { ...route.query, status: 'submitted' } })
})
function show(value: string): void { void router.replace({ query: { ...route.query, status: value } }) }
const changed = (): void => { void loadDashboard(store.selectedYearId) }
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="section.icon" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ route.meta.cwTitle }}</h2>
      <p>{{ route.meta.cwLead }}</p>
    </div>
  </section>

  <div v-if="key === 'approval'" class="cw-seg bs-states" role="group" aria-label="Workflow state">
    <button v-for="s in STATES" :key="s.value" type="button" :aria-pressed="status === s.value" @click="show(s.value)">{{ s.label }}</button>
  </div>

  <div class="bs-embed">
    <component :is="section.component" :key="key" @changed="changed" />
  </div>
</template>

<style scoped>
.bs-embed { position: relative; overflow-x: auto; min-width: 0; padding: 18px; background: var(--cw-surface); border-radius: var(--cw-r); box-shadow: var(--cw-shadow); border: 1px solid #e3e8ee; }
.bs-states { max-width: 720px; }
</style>
