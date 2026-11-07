<script setup lang="ts">
// Attribute table for a selection (rectangle or attribute query): one layer
// at a time, sortable, filterable, exportable. CSV export leaves personal
// fields out; exports that need them go through the audited export screen.
import { ref, computed, watch } from 'vue'
import { X, Download } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import type { GmsLayer } from '@/services/gms'

export interface SelectedRow {
  layer_id: string
  id: string
  props: Record<string, unknown>
  geometry: GeoJSON.Geometry | null
}

const props = defineProps<{ rows: SelectedRow[]; layers: GmsLayer[]; editLayerId: string | null }>()
const emit = defineEmits<{
  close: []
  zoom: [row: SelectedRow]
  query: [q: { layer_id: string; field: string; op: 'eq' | 'contains'; value: string }]
  merge: [rows: SelectedRow[]]
}>()

const layerIds = computed(() => [...new Set(props.rows.map((r) => r.layer_id))])
const active = ref('')
watch(layerIds, (ids) => { if (!ids.includes(active.value)) active.value = ids[0] ?? '' }, { immediate: true })
const layerOf = (id: string) => props.layers.find((l) => l.layer_id === id)
const titleOf = (id: string) => (id === 'parcels' ? 'Parcels' : layerOf(id)?.title ?? id)

const columns = computed(() => {
  if (active.value === 'parcels') return ['parcel_id', 'stand_no', 'township_code', 'accuracy_class', 'status', 'allocation_status']
  const l = layerOf(active.value)
  return ['feature_id', ...(l?.attributes.map((a) => a.name) ?? []), 'accuracy_class', 'source']
})
const personal = computed(() => new Set(layerOf(active.value)?.attributes.filter((a) => a.personal).map((a) => a.name) ?? []))

const filter = ref('')
const sortKey = ref('')
const sortDir = ref<1 | -1>(1)
const shown = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const rows = props.rows.filter((r) => r.layer_id === active.value
    && (!f || columns.value.some((c) => String(r.props[c] ?? '').toLowerCase().includes(f))))
  if (!sortKey.value) return rows
  const k = sortKey.value
  return [...rows].sort((a, b) => {
    const x = a.props[k]
    const y = b.props[k]
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true })
    return cmp * sortDir.value
  })
})
function sortBy(c: string) {
  if (sortKey.value === c) sortDir.value = sortDir.value === 1 ? -1 : 1
  else { sortKey.value = c; sortDir.value = 1 }
}

function exportCsv() {
  const cols = columns.value.filter((c) => !personal.value.has(c))
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [cols.join(','), ...shown.value.map((r) => cols.map((c) => esc(r.props[c])).join(','))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `${active.value}-selection.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// Select by attribute.
const q = ref({ layer_id: '', field: '', op: 'eq' as 'eq' | 'contains', value: '' })
const qFields = computed(() => layerOf(q.value.layer_id)?.attributes ?? [])

const mergeable = computed(() => {
  const l = layerOf(active.value)
  return !!l && l.layer_id === props.editLayerId && l.geom_type !== 'Point' && shown.value.length === 2
})
</script>

<template>
  <section class="st" aria-label="Selection">
    <header class="st-head">
      <div class="st-tabs" role="tablist" aria-label="Selected layers">
        <button v-for="id in layerIds" :key="id" type="button" role="tab" :aria-selected="active === id"
                :class="{ on: active === id }" @click="active = id">
          {{ titleOf(id) }} <span class="st-n">{{ rows.filter((r) => r.layer_id === id).length }}</span>
        </button>
        <span v-if="!rows.length" class="st-note">Drag a rectangle with the select tool, or query by attribute.</span>
      </div>
      <form class="st-q" @submit.prevent="q.layer_id && q.field && emit('query', { ...q })">
        <select v-model="q.layer_id" aria-label="Query layer">
          <option value="">Select by attribute…</option>
          <option v-for="l in layers" :key="l.layer_id" :value="l.layer_id">{{ l.title }}</option>
        </select>
        <template v-if="q.layer_id">
          <select v-model="q.field" aria-label="Field"><option value="" disabled>Field</option>
            <option v-for="f in qFields" :key="f.name" :value="f.name">{{ f.label }}</option></select>
          <select v-model="q.op" aria-label="Operator"><option value="eq">is</option><option value="contains">contains</option></select>
          <input v-model="q.value" aria-label="Value" placeholder="value" />
          <UiButton type="submit" size="sm">Select</UiButton>
        </template>
      </form>
      <input v-model="filter" class="st-filter" type="search" placeholder="Filter rows" aria-label="Filter rows" />
      <UiButton v-if="mergeable" size="sm" @click="emit('merge', shown)">Merge these two</UiButton>
      <UiButton size="sm" variant="ghost" :disabled="!shown.length" @click="exportCsv">
        <template #icon><Download :size="12" aria-hidden="true" /></template>CSV
      </UiButton>
      <button type="button" class="st-x" aria-label="Close attribute table" @click="emit('close')"><X :size="14" /></button>
    </header>
    <div class="st-scroll">
      <table v-if="shown.length" class="st-table">
        <thead>
          <tr>
            <th v-for="c in columns" :key="c" scope="col" :aria-sort="sortKey === c ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'">
              <button type="button" @click="sortBy(c)">{{ c }}<span v-if="personal.has(c)" title="Personal data"> ●</span></button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" tabindex="0" @click="emit('zoom', r)" @keydown.enter="emit('zoom', r)">
            <td v-for="c in columns" :key="c" :class="{ mono: c.endsWith('_id') || c === 'accuracy_class' }">{{ r.props[c] ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.st { display:flex; flex-direction:column; min-height:0; height:100%; font-size:var(--ent-fs-sm); }
.st-head { display:flex; flex-wrap:wrap; align-items:center; gap:var(--ent-s2); padding:var(--ent-s2) var(--ent-s3); border-bottom:1px solid var(--ent-line); }
.st-tabs { display:flex; gap:var(--ent-s1); flex-wrap:wrap; }
.st-tabs button { padding:2px var(--ent-s2); background:none; border:1px solid var(--ent-line); border-radius:var(--ent-r-pill);
  font:inherit; font-size:var(--ent-fs-xs); color:var(--ent-text-2); cursor:pointer; }
.st-tabs button.on { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); color:var(--ent-accent); }
.st-n { font-family:var(--ent-font-mono); }
.st-note { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.st-q { display:flex; flex-wrap:wrap; gap:var(--ent-s1); align-items:center; }
.st-q select, .st-q input, .st-filter { height:var(--ent-control-h-sm); padding:0 var(--ent-s2); font:inherit; font-size:var(--ent-fs-xs);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); background:var(--ent-surface); color:var(--ent-text); }
.st-filter { margin-left:auto; width:160px; }
.st-x { display:inline-flex; padding:4px; background:none; border:0; border-radius:var(--ent-r-sm); color:var(--ent-text-3); cursor:pointer; }
.st-x:focus-visible, .st-tabs button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.st-scroll { flex:1; min-height:0; overflow:auto; }
.st-table { width:100%; border-collapse:collapse; }
.st-table th { position:sticky; top:0; background:var(--ent-surface-2); text-align:left; font-weight:var(--ent-fw-medium); border-bottom:1px solid var(--ent-line); }
.st-table th button { width:100%; padding:var(--ent-s1) var(--ent-s2); background:none; border:0; font:inherit; font-size:var(--ent-fs-xs); color:var(--ent-text-2); text-align:left; cursor:pointer; white-space:nowrap; }
.st-table td { padding:var(--ent-s1) var(--ent-s2); border-bottom:1px solid var(--ent-line); white-space:nowrap; }
.st-table td.mono { font-family:var(--ent-font-mono); }
.st-table tbody tr { cursor:pointer; }
.st-table tbody tr:hover, .st-table tbody tr:focus-visible { background:var(--ent-accent-soft); outline:none; }
</style>
