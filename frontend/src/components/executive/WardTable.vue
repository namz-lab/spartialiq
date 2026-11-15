<script setup lang="ts">
// The wards as tables: a map answers "where", a table answers "how many, and how does this ward compare". Every ward is a row; there is a total; nothing
// is hidden behind a scroll bar; and it can be exported or printed (the council's own officials asked for exactly this: per-area figures with totals,
// readable, and in Excel and PDF).
//
// HONESTY RULES (the same as the map's)
//   - A figure a ward does not have is "not recorded", never zero. A rate or density has no total, and says so.
//   - A count's total is the register's own; "Not in any ward" is what the wards do not account for, so the rows and that line add up to the total.
//   - The ward list is provisional while decision D11 is open, and the table says so.
// With a `unitKey` the table carries that unit's measures only (and the register counts for planning); without one it is the Chief Executive's.
import { computed, onMounted, ref, watch } from 'vue'
import { Info, TriangleAlert } from 'lucide-vue-next'
import ExportMenu from '@/components/shared/ExportMenu.vue'
import { spatialEngineApi, type WardTable, type WardTableMeasure, type WardTableRow } from '@/services/spatialEngine'
import { unitsApi, type UnitKey } from '@/services/units'
import type { Cell, ExportTable } from '@/utils/tableExport'

const props = defineProps<{ unitKey?: UnitKey }>()

const data = ref<WardTable | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)
// sort: a column of the counts table or of the measures table, or the ward
const sort = ref<{ key: string; dir: 1 | -1 }>({ key: 'ward', dir: 1 })

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = props.unitKey ? await unitsApi.wardTable(props.unitKey) : await spatialEngineApi.wardTable()
  } catch {
    error.value = 'The ward tables could not be read. Try again in a moment.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.unitKey, load)

const n = (v: number) => v.toLocaleString('en-GB')
function fmt(m: WardTableMeasure, v: number | null): string {
  if (v === null) return 'not recorded'
  const dp = m.kind === 'density' ? 2 : 1
  const s = v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  return m.kind === 'share' ? `${s}%` : s
}

// "10" after "9": wards are numbered, so sort the names as numbers where they are
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

function valueFor(r: WardTableRow, key: string): number | string | null {
  if (key === 'ward') return r.name
  if (key.startsWith('m:')) return r.measures[key.slice(2)]?.value ?? null
  return r.counts[key.slice(2)] ?? null
}
const rows = computed(() => {
  const list = [...(data.value?.rows ?? [])]
  const { key, dir } = sort.value
  return list.sort((a, b) => {
    const x = valueFor(a, key), y = valueFor(b, key)
    if (x === null && y === null) return natural(a.name, b.name)
    if (x === null) return 1                      // not recorded sorts last, whichever way
    if (y === null) return -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : natural(String(x), String(y))
    return c === 0 ? natural(a.name, b.name) : c * dir
  })
})
function sortBy(key: string) {
  sort.value = sort.value.key === key ? { key, dir: sort.value.dir === 1 ? -1 : 1 } : { key, dir: key === 'ward' ? 1 : -1 }
}
const ariaSort = (key: string) => (sort.value.key === key ? (sort.value.dir === 1 ? 'ascending' : 'descending') : 'none')

const provisional = computed(() => data.value?.ward_register.basis === 'interim')
const asAt = computed(() => {
  const t = data.value?.run?.computed_at
  return t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'not yet computed'
})
const notes = computed(() => {
  const out: string[] = []
  if (provisional.value) out.push('The ward list is provisional while the ward register is open (decision D11).')
  out.push('A figure shown "not recorded" is not zero: the ward has none recorded. A rate or density has no total.')
  return out
})

/** The one table to export: the counts and the measures side by side, as the council reports them. */
function build(): ExportTable {
  const d = data.value!
  const cols = ['Ward', ...d.counts.map((c) => c.label), ...d.measures.map((m) => `${m.label} (${m.unit})`)]
  const body: Cell[][] = rows.value.map((r) => [
    r.name,
    ...d.counts.map((c) => r.counts[c.key] ?? null),
    ...d.measures.map((m) => r.measures[m.key]?.value ?? null),
  ])
  return {
    title: props.unitKey ? 'Ward table' : "Ward table: Chief Executive's overview",
    asAt: asAt.value,
    source: 'The spatial engine (ward measures) and the council registers (parcels, facilities, polling areas).',
    notes: notes.value,
    columns: cols,
    rows: body,
    totals: d.totals ? { label: 'Total', cells: [...d.counts.map((c) => d.totals![c.key] ?? null), ...d.measures.map(() => 'no total (rate)')] } : undefined,
    extra: d.not_in_a_ward ? [{ label: 'Not in any ward', cells: [...d.counts.map((c) => d.not_in_a_ward![c.key] ?? null), ...d.measures.map(() => '')] }] : [],
  }
}
</script>

<template>
  <section class="wt-root" aria-labelledby="wt-h" data-testid="ward-table">
    <header class="wt-head">
      <h2 id="wt-h" class="wt-title">Ward by ward, as tables</h2>
      <ExportMenu v-if="data && data.rows.length" :build="build" filename="ward-table" print />
    </header>

    <p v-if="loading" class="wt-note">Reading the wards…</p>
    <p v-else-if="error" class="wt-alert" role="alert"><TriangleAlert :size="16" aria-hidden="true" /> {{ error }} <button type="button" class="wt-retry" @click="load">Try again</button></p>
    <p v-else-if="!data || !data.rows.length" class="wt-note" data-testid="wt-empty">
      <Info :size="16" aria-hidden="true" /> No wards are linked to the council yet, so there is nothing to tabulate.
    </p>

    <template v-else>
      <p v-for="t in notes" :key="t" class="wt-foot">{{ t }}</p>

      <div v-if="data.counts.length" class="wt-block">
        <table class="wt-table" data-testid="wt-counts">
          <caption>What the registers hold in each ward</caption>
          <thead>
            <tr>
              <th scope="col" :aria-sort="ariaSort('ward')"><button type="button" class="wt-sort" @click="sortBy('ward')">Ward</button></th>
              <th v-for="c in data.counts" :key="c.key" scope="col" class="num" :aria-sort="ariaSort('c:' + c.key)">
                <button type="button" class="wt-sort" @click="sortBy('c:' + c.key)">{{ c.label }}</button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.ward_code">
              <th scope="row">{{ r.name }}</th>
              <td v-for="c in data.counts" :key="c.key" class="num">{{ n(r.counts[c.key] ?? 0) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="wt-total" data-testid="wt-total">
              <th scope="row">Total</th>
              <td v-for="c in data.counts" :key="c.key" class="num">{{ n(data.totals?.[c.key] ?? 0) }}</td>
            </tr>
            <tr v-if="data.not_in_a_ward" class="wt-outside" data-testid="wt-outside">
              <th scope="row">of which in no ward</th>
              <td v-for="c in data.counts" :key="c.key" class="num">{{ n(data.not_in_a_ward?.[c.key] ?? 0) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div v-if="data.measures.length" class="wt-block">
        <table class="wt-table" data-testid="wt-measures">
          <caption>The ward measures</caption>
          <thead>
            <tr>
              <th scope="col" :aria-sort="ariaSort('ward')"><button type="button" class="wt-sort" @click="sortBy('ward')">Ward</button></th>
              <th v-for="m in data.measures" :key="m.key" scope="col" class="num" :aria-sort="ariaSort('m:' + m.key)">
                <button type="button" class="wt-sort" @click="sortBy('m:' + m.key)">{{ m.label }}</button>
                <small>{{ m.unit }}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.ward_code">
              <th scope="row">{{ r.name }}</th>
              <td v-for="m in data.measures" :key="m.key" class="num" :class="{ none: r.measures[m.key]?.value === null }">{{ fmt(m, r.measures[m.key]?.value ?? null) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.wt-root { margin-top: 1.25rem; background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1rem 1.125rem; }
.wt-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
.wt-title { margin: 0; font-size: 1rem; font-weight: 600; }
.wt-note, .wt-alert { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.625rem 0.875rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); }
.wt-alert { background: var(--ent-danger-soft); color: var(--ent-danger); }
.wt-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }
.wt-foot { margin: 0 0 0.5rem; font-size: 0.8125rem; color: var(--ent-text-3); }
.wt-block { margin-top: 0.75rem; overflow-x: auto; }
.wt-table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; font-variant-numeric: tabular-nums; }
.wt-table caption { text-align: left; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); padding-bottom: 0.375rem; }
.wt-table th, .wt-table td { padding: 0.375rem 0.625rem; border-bottom: 1px solid var(--ent-surface-2); text-align: left; vertical-align: bottom; }
.wt-table thead th { font-weight: 600; color: var(--ent-text); border-bottom: 2px solid var(--ent-line); }
.wt-table thead th small { display: block; font-weight: 400; font-size: 0.75rem; color: var(--ent-text-3); }
.wt-table tbody th { font-weight: 500; }
.num { text-align: right !important; }
.none { color: var(--ent-text-3); font-style: italic; }
.wt-total th, .wt-total td { font-weight: 700; border-top: 2px solid var(--ent-line); border-bottom: 0; }
.wt-outside th, .wt-outside td { font-size: 0.8125rem; color: var(--ent-text-3); }
.wt-sort { padding: 0; border: 0; background: none; font: inherit; font-weight: 600; color: inherit; cursor: pointer; text-align: inherit; }
.wt-sort:hover { text-decoration: underline; }
.wt-sort:focus-visible { outline: 2px solid var(--ent-accent); outline-offset: 2px; }
th[aria-sort="ascending"] .wt-sort::after { content: ' ▲'; font-size: 0.7em; }
th[aria-sort="descending"] .wt-sort::after { content: ' ▼'; font-size: 0.7em; }
@media print {
  .wt-root { border: 0; padding: 0; margin-top: 1rem; break-inside: auto; }
  .wt-table { font-size: 11pt; color: #000; }
  .wt-table th, .wt-table td { border-bottom: 1px solid #999; }
  .wt-block { overflow: visible; }
  .wt-sort::after { content: none !important; }
}
</style>
