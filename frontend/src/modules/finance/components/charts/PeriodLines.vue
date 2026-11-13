<script setup lang="ts">
/**
 * Period lines: where the year has got to, against what it was allowed, drawn as inline SVG.
 *
 * WHY A STEP AND NOT A SLOPE FOR THE REFERENCE LINE
 * A council approves an annual allocation; it does not phase it across the months. The backend
 * therefore reports, for each period, the allocation IN FORCE AT THAT PERIOD'S CLOSE — a flat
 * figure that steps when a revision is approved (design A4 forbids interpolating a budget into
 * periods). Drawing that as a sloping line between two points would claim a smooth monthly
 * entitlement the Council never set, so a `reference` series is drawn as a step: flat across each
 * period, vertical where it changes.
 *
 * A `line` series is a genuine running total through each period's close, so it is drawn as a
 * polyline with a marker on every close.
 *
 * WHAT A GAP IS
 * A measure with no recorded figure breaks the line. The two ends are not joined across it and
 * nothing is interpolated, because a line drawn through a gap asserts a figure nobody recorded
 * (house rule 3). The gap carries a dashed vertical mark, the legend names it, and ChartFrame says
 * in a sentence how many there are.
 *
 * ACCESSIBILITY AND MONEY
 * As with PeriodBars: role="img" with a name stating what is plotted and in which currency, the
 * real table in ChartFrame as the representation the chart is accountable to, and `toChartValue`
 * as the single sanctioned place a decimal string becomes a coordinate.
 */
import { computed } from 'vue'
import { formatMoney, toChartValue } from '../../composables/useMoney'
import type { Currency } from '../../models/types'
import type { ChartRow, ChartSeries } from './ChartFrame.vue'

const props = defineProps<{
  rows: ChartRow[]
  series: ChartSeries[]
  currency: Currency
  accessibleName: string
}>()

const W = 720
const H = 190
const PAD = { top: 20, right: 10, bottom: 28, left: 10 }
const plotW = W - PAD.left - PAD.right
const plotH = H - PAD.top - PAD.bottom

const value = (row: ChartRow, key: string): string | null => {
  const raw = row.values[key]
  return raw === undefined ? null : raw
}

const plotted = computed<number[]>(() => {
  const out: number[] = []
  for (const row of props.rows) {
    for (const s of props.series) {
      const raw = value(row, s.key)
      if (raw !== null) out.push(toChartValue(raw))
    }
  }
  return out
})

const domainMax = computed(() => Math.max(0, ...plotted.value))
const domainMin = computed(() => Math.min(0, ...plotted.value))
const span = computed(() => (domainMax.value - domainMin.value) || 1)
const yOf = (v: number): number => PAD.top + (plotH * (domainMax.value - v)) / span.value
const zeroY = computed(() => yOf(0))

const slotW = computed(() => (props.rows.length > 0 ? plotW / props.rows.length : plotW))
const slotStart = (i: number): number => PAD.left + i * slotW.value
const slotCentre = (i: number): number => slotStart(i) + slotW.value / 2

interface Path { key: string; role: ChartSeries['role']; d: string }
interface Marker { key: string; role: ChartSeries['role']; x: number; y: number }

/**
 * One path per unbroken run of recorded figures. A run of length one produces no path — only its
 * marker — because a single point is not a line.
 */
const paths = computed<Path[]>(() => {
  const out: Path[] = []
  for (const s of props.series) {
    let run: Array<{ i: number; n: number }> = []
    const flush = (): void => {
      if (run.length > 1) {
        const d = s.role === 'reference'
          ? run.map((p, k) => {
            const open = `${k === 0 ? 'M' : 'L'} ${slotStart(p.i).toFixed(1)} ${yOf(p.n).toFixed(1)}`
            return `${open} L ${(slotStart(p.i) + slotW.value).toFixed(1)} ${yOf(p.n).toFixed(1)}`
          }).join(' ')
          : run.map((p, k) => `${k === 0 ? 'M' : 'L'} ${slotCentre(p.i).toFixed(1)} ${yOf(p.n).toFixed(1)}`).join(' ')
        out.push({ key: `${s.key}-${run[0].i}`, role: s.role, d })
      } else if (run.length === 1 && s.role === 'reference') {
        const p = run[0]
        out.push({
          key: `${s.key}-${p.i}`,
          role: s.role,
          d: `M ${slotStart(p.i).toFixed(1)} ${yOf(p.n).toFixed(1)} L ${(slotStart(p.i) + slotW.value).toFixed(1)} ${yOf(p.n).toFixed(1)}`,
        })
      }
      run = []
    }
    props.rows.forEach((row, i) => {
      const raw = value(row, s.key)
      if (raw === null) { flush(); return }
      run.push({ i, n: toChartValue(raw) })
    })
    flush()
  }
  return out
})

/** A marker on every recorded close, so a one-period series is still visible. */
const markers = computed<Marker[]>(() => {
  const out: Marker[] = []
  for (const s of props.series) {
    if (s.role === 'reference') continue
    props.rows.forEach((row, i) => {
      const raw = value(row, s.key)
      if (raw === null) return
      out.push({ key: `${s.key}-${row.key}`, role: s.role, x: slotCentre(i), y: yOf(toChartValue(raw)) })
    })
  }
  return out
})

const gaps = computed(() => {
  const out: Array<{ key: string; x: number }> = []
  props.rows.forEach((row, i) => {
    if (props.series.some((s) => value(row, s.key) === null)) {
      out.push({ key: row.key, x: slotCentre(i) })
    }
  })
  return out
})

const axisLabels = computed(() => props.rows.map((row, i) => ({
  key: row.key,
  text: props.rows.length > 6 ? row.label.slice(0, 3) : row.label,
  x: slotCentre(i),
})))

const ceilingLabel = computed(() => formatMoney(String(domainMax.value.toFixed(2)), props.currency, { bare: true, whole: true }))
const hasNegative = computed(() => domainMin.value < 0)
const floorLabel = computed(() => formatMoney(String(domainMin.value.toFixed(2)), props.currency, { bare: true, whole: true }))
</script>

<template>
  <div class="fcx-lines">
    <svg
      class="fcx-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="accessibleName"
    >
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="PAD.top" :y2="PAD.top" class="fcx-grid" />
      <text :x="PAD.left" :y="PAD.top - 7" class="fcx-axis-value">{{ ceilingLabel }}</text>

      <line :x1="PAD.left" :x2="W - PAD.right" :y1="zeroY" :y2="zeroY" class="fcx-zero" />
      <text v-if="hasNegative" :x="PAD.left" :y="H - PAD.bottom + 12" class="fcx-axis-value">{{ floorLabel }}</text>

      <line v-for="gap in gaps" :key="`gap-${gap.key}`"
            :x1="gap.x" :x2="gap.x" :y1="PAD.top" :y2="H - PAD.bottom" class="fcx-gap" />

      <path v-for="p in paths" :key="p.key" :d="p.d" :class="['fcx-path', `is-${p.role}`]" />

      <circle v-for="m in markers" :key="m.key" :cx="m.x" :cy="m.y" r="2.5"
              :class="['fcx-marker', `is-${m.role}`]" />

      <text v-for="label in axisLabels" :key="`ax-${label.key}`"
            :x="label.x" :y="H - PAD.bottom + 14" text-anchor="middle" class="fcx-axis-label">
        {{ label.text }}
      </text>
    </svg>

    <ul class="fcx-legend">
      <li v-for="s in series" :key="s.key">
        <span class="fcx-swatch" :class="`is-${s.role}`" aria-hidden="true"></span>
        {{ s.name }}
      </li>
      <li v-if="gaps.length">
        <span class="fcx-swatch is-gap" aria-hidden="true"></span>
        Not recorded
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fcx-lines { display: flex; flex-direction: column; gap: var(--ent-s2); min-width: 0; }
.fcx-svg { display: block; width: 100%; height: auto; }

.fcx-grid { stroke: var(--ent-line); stroke-width: 1; stroke-dasharray: 2 3; }
.fcx-zero { stroke: var(--ent-line-strong); stroke-width: 1; }
.fcx-gap { stroke: var(--ent-text-3); stroke-width: 1; stroke-dasharray: 2 4; opacity: 0.6; }

.fcx-axis-label { font-size: 10px; fill: var(--ent-text-3); font-family: var(--ent-font); }
.fcx-axis-value { font-size: 10px; fill: var(--ent-text-2); font-family: var(--ent-font-mono); }

.fcx-path { fill: none; stroke-linejoin: round; stroke-linecap: butt; }
/* The running total is the measure, so it carries the accent. The allocation it is read against is
   neutral and dashed: a reference, not a second measure competing with it. */
.fcx-path.is-line { stroke: var(--ent-accent); stroke-width: 2; }
.fcx-path.is-reference { stroke: var(--ent-text-3); stroke-width: 1.5; stroke-dasharray: 6 3; }
.fcx-marker.is-line { fill: var(--ent-accent); }

.fcx-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ent-s1) var(--ent-s4);
  font-size: var(--ent-fs-micro);
  color: var(--ent-text-2);
}
.fcx-legend li { display: inline-flex; align-items: center; gap: var(--ent-s2); }
.fcx-swatch { width: 14px; height: 0; flex: none; }
.fcx-swatch.is-line { border-top: 2px solid var(--ent-accent); }
.fcx-swatch.is-reference { border-top: 2px dashed var(--ent-text-3); }
.fcx-swatch.is-gap { height: 12px; width: 0; border-left: 1px dashed var(--ent-text-3); }
</style>
