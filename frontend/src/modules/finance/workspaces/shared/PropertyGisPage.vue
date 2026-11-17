<script setup lang="ts">
/**
 * The property map page each finance workspace mounts (route meta `gisMode`). One map component,
 * a role's own framing: the lead sentence, the tabs it has (analytics, integration) and the map's
 * defaults come from the mode. `?parcel=` opens a property on arrival.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Map as MapIcon, ChartColumn, PlugZap } from 'lucide-vue-next'
import FinanceGisMap from '../../components/gis/FinanceGisMap.vue'
import GeoAnalytics from '../../components/gis/GeoAnalytics.vue'
import IntegrationMonitor from '../../components/gis/IntegrationMonitor.vue'
import { useFinanceStore } from '../../stores/finance'
import { propertyApi, type PropertyAnalytics, type PropertyLayers } from '../../api/propertyApi'

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const mode = computed(() => String(route.meta.gisMode ?? 'manager'))

const LEADS: Record<string, string> = {
  cashier: 'Find a citizen’s stand by number, account, name or ID, see it on the map, and take payment against its open invoices.',
  manager: 'The council’s properties from the Planning register, coloured by their financial standing. Click a stand for its account; switch to ward colouring to compare areas.',
  accountant: 'Trace revenue to the property that produced it: each stand’s bills, receipts and ledger state, and reconciliation by ward.',
  budget: 'Where council money is invested: located capital projects over the wards and land use, with revenue by ward beside them.',
  revenue: 'Revenue coverage on the ground: unbilled and allocated stands without accounts, arrears by ward, and each property’s account for follow-up.',
  administration: 'Mapping and integration oversight: the Planning–Finance synchronisation, its exceptions and the account–property matching.',
  audit: 'Geographically traceable transactions: every property’s allocation, account, bills, receipts and integration events, exportable as evidence.',
  department: 'Projects and service delivery by location, over the wards and the council’s property register.',
  executive: 'The council-wide revenue map: collection, debt and capital investment by ward.',
  committee: 'Geographic revenue performance and property-related exposure, ward by ward, for the committee.',
  publisher: 'Approved ward-level figures for public transparency. Individual account holders are not shown.',
  officer: 'Property accounts on the map, for verification and follow-up.',
}

type Tab = 'map' | 'analytics' | 'integration'
const tabs = computed(() => {
  const t: { id: Tab; label: string; icon: unknown }[] = [{ id: 'map', label: 'Property map', icon: MapIcon }]
  if (mode.value !== 'cashier') t.push({ id: 'analytics', label: 'Geographic analytics', icon: ChartColumn })
  if (['manager', 'administration', 'revenue', 'audit', 'officer'].includes(mode.value)) t.push({ id: 'integration', label: 'Planning integration', icon: PlugZap })
  return t
})
const tab = ref<Tab>((['map', 'analytics', 'integration'].includes(String(route.query.tab)) ? route.query.tab : 'map') as Tab)
function setTab(t: Tab): void {
  tab.value = t
  void router.replace({ query: { ...route.query, tab: t === 'map' ? undefined : t } })
  if (t === 'analytics') {
    void loadAnalytics()
    if (!layers.value) void propertyApi.layers().then((l) => { layers.value = l }).catch(() => {})
  }
}

const analytics = ref<PropertyAnalytics | null>(null)
const layers = ref<PropertyLayers | null>(null)
const mapRef = ref<InstanceType<typeof FinanceGisMap> | null>(null)
const parcel = computed(() => (typeof route.query.parcel === 'string' ? route.query.parcel : null))
async function loadAnalytics(): Promise<void> {
  if (!analytics.value) analytics.value = await propertyApi.analytics().catch(() => null)
}
if (tab.value === 'analytics') { void loadAnalytics(); void propertyApi.layers().then((l) => { layers.value = l }).catch(() => {}) }
function wardPicked(code: string): void {
  setTab('map')
  setTimeout(() => mapRef.value?.zoomWard(code), 50)
}
void store
</script>

<template>
  <div class="pg">
    <div class="pg-head">
      <p class="pg-lead">{{ LEADS[mode] ?? LEADS.manager }}</p>
      <div class="pg-tabs" role="tablist">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="setTab(t.id)">
          <component :is="t.icon" :size="16" aria-hidden="true" /> {{ t.label }}
        </button>
      </div>
    </div>
    <KeepAlive>
      <FinanceGisMap v-if="tab === 'map'" ref="mapRef" :mode="mode" :initial-parcel="parcel" :initial-query="typeof route.query.q === 'string' ? route.query.q : null" @analytics="(a) => (analytics = a)" />
    </KeepAlive>
    <GeoAnalytics v-if="tab === 'analytics'" :analytics="analytics" :layers="layers" :mode="mode" @ward="wardPicked" />
    <IntegrationMonitor v-if="tab === 'integration'" @changed="analytics = null; mapRef?.refresh()" />
  </div>
</template>

<style scoped>
.pg { display: grid; gap: 12px; }
.pg-head { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.pg-lead { margin: 0; color: var(--cw-ink-2, #515c6b); font-size: 13.5px; max-width: 820px; }
.pg-tabs { display: flex; gap: 4px; background: #fff; border: 1px solid var(--cw-card-line, #e3e8ee); border-radius: 10px; padding: 3px; }
.pg-tabs button { display: inline-flex; gap: 6px; align-items: center; border: 0; background: none; padding: 7px 12px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600; color: var(--cw-ink-2); cursor: pointer; }
.pg-tabs button.on { background: var(--cw-accent, #1f5aa8); color: #fff; }
</style>
