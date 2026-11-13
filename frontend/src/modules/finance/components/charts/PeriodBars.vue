<script setup lang="ts">
/**
 * Period bars: what moved in each period, drawn as inline SVG.
 *
 * WHY THERE IS NO CHARTING LIBRARY
 * Design rule A6. package.json has no chart dependency and gains none: DESIGN.md owns the palette
 * and a chart library arrives with its own, along with a few hundred kilobytes that a council
 * officer on rural bandwidth pays for. Thirty lines of arithmetic and an <svg> are the whole of it.
 *
 * WHAT A BAR IS AND WHAT IT IS NOT
 *   - A recorded figure of nil is a 2 px stub sitting on the baseline. A period in which nothing
 *     was spent is a fact, so it keeps its place in the axis and reads as nil.
 *   - A figure that was NOT RECORDED is a dashed vertical mark and no bar at all. It is never
 *     drawn as nil, and ChartFrame counts these and says so in a sentence (house rule 3).
 *   - A negative figure — net of a reversal, which carries the signed opposite of the row it
 *     corrects — hangs below the zero line, which is placed by the data rather than pinned to the
 *     bottom of the plot.
 *
 * ACCESSIBILITY
 * The <svg> is role="img" with a name that says what it is of, in which currency. It is not the
 * accessible representation of the data: ChartFrame renders a real <table> from the same rows, and
 * that is what a screen reader reads. Each series is told apart by its mark as well as its colour —
 * solid, hatched — and the legend beneath carries the same marks (WCAG 2.1 AA, colour is never the
 * only signal).
 *
 * The one place a decimal string becomes a JavaScript number is `toChartValue`, which exists to
 * produce a coordinate and says so in its own doc comment. No figure the reader sees comes from it.
 */
import { computed } from 'vue'
import { formatMoney, toChartValue } from '../../composables/useMoney'
import type { Currency } from '../../models/types'
import type { ChartRow, ChartSeries } from './ChartFrame.vue'

const props = defineProps<{
  rows: ChartRow[]
  series: ChartSeries[]
  currency: Currency
  /** The chart's accessible name. States what is plotted and in which currency. */
  accessibleName: string
}>()

/** A viewBox large enough that a 12-period year is not cramped; the element scales to its column. */
const W = 720
const H = 190
const PAD = { top: 20, right: 10, bottom: 28, left: 10 }
const plotW = W - PAD.left - PAD.right
const plotH = H - PAD.top - PAD.bottom

/** A pattern id has to be unique in the document, or two charts share one fill. */
let seq = 0
// eslint-disable-next-line no-plusplus
const hatchId = `fcx-hatch-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`

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
const bandW = computed(() => slotW.value * 0.64)
const barW = computed(() => Math.max(2, bandW.value / Math.max(1, props.series.length)))

interface Mark {
  rowKey: string
  seriesKey: string
  role: ChartSeries['role']
  x: number
  y: number
  height: number
  /** A recorded nil: drawn as a stub on the baseline so the period still reads. */
  nil: boolean
}

const marks = computed<Mark[]>(() => {
  const out: Mark[] = []
  props.rows.forEach((row, i) => {
    props.series.forEach((s, j) => {
      const raw = value(row, s.key)
      if (raw === null) return
      const n = toChartValue(raw)
      const x = PAD.left + i * slotW.value + (slotW.value - bandW.value) / 2 + j * barW.value
      const top = Math.min(zeroY.value, yOf(n))
      const height = Math.abs(yOf(n) - zeroY.value)
      out.push({
        rowKey: row.key,
        seriesKey: s.key,
        role: s.role,
        x,
        y: n === 0 ? zeroY.value - 2 : top,
        height: n === 0 ? 2 : Math.max(2, height),
        nil: n === 0,
      })
    })
  })
  return out
})

/** Periods where a measure has no recorded figure. Marked, never filled in. */
const gaps = computed(() => {
  const out: Array<{ key: string; x: number }> = []
  props.rows.forEach((row, i) => {
    const missing = props.series.some((s) => value(row, s.key) === null)
    if (missing) out.push({ key: row.key, x: PAD.left + i * slotW.value + slotW.value / 2 })
  })
  return out
})

const axisLabels = computed(() => props.rows.map((row, i) => ({
  key: row.key,
  // A twelve-period year has about 58 px per slot, so a monthly label is shortened to its month.
  // The table carries every label in full, with the period's dates beside it.
  text: props.rows.length > 6 ? row.label.slice(0, 3) : row.label,
  x: PAD.left + i * slotW.value + slotW.value / 2,
})))

const ceilingLabel = computed(() => formatMoney(String(domainMax.value.toFixed(2)), props.currency, { bare: true, whole: true }))
const floorLabel = computed(() => formatMoney(String(domainMin.value.toFixed(2)), props.currency, { bare: true, whole: true }))
const hasNegative = computed(() => domainMin.value < 0)
</script>

<template>
  <div class="fcx-bars">
    <svg
      class="fcx-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="accessibleName"
    >
      <defs>
        <pattern :id="hatchId" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" class="fcx-hatch-ground" />
          <line x1="0" y1="0" x2="0" y2="5" class="fcx-hatch-line" />
        </pattern>
      </defs>

      <!-- The ceiling, so a bar's height can be read against a stated figure. -->
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="PAD.top" :y2="PAD.top" class="fcx-grid" />
      <text :x="PAD.left" :y="PAD.top - 7" class="fcx-axis-value">{{ ceilingLabel }}</text>

      <!-- Zero sits where the data puts it, not at the foot of the plot. -->
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="zeroY" :y2="zeroY" class="fcx-zero" />
      <text v-if="hasNegative" :x="PAD.left" :y="H - PAD.bottom + 12" class="fcx-axis-value">{{ floorLabel }}</text>

      <line v-for="gap in gaps" :key="`gap-${gap.key}`"
            :x1="gap.x" :x2="gap.x" :y1="PAD.top" :y2="H - PAD.bottom" class="fcx-gap" />

      <rect
        v-for="mark in marks"
        :key="`${mark.rowKey}-${mark.seriesKey}`"
        :x="mark.x"
        :y="mark.y"
        :width="Math.max(1, barW - 1)"
        :height="mark.height"
        :class="['fcx-bar', `is-${mark.role}`, { 'is-nil': mark.nil }]"
        :fill="mark.role === 'bar-secondary' ? `url(#${hatchId})` : undefined"
      />

      <text v-for="label in axisLabels" :key="`ax-${label.key}`"
            :x="label.x" :y="H - PAD.bottom + 14" text-anchor="middle" class="fcx-axis-label">
        {{ label.text }}
      </text>
    </svg>

    <!-- The legend is real text outside the SVG, so it is selectable, translatable and read in
         document order rather than trapped inside an image. -->
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
.fcx-bars { display: flex; flex-direction: column; gap: var(--ent-s2); min-width: 0; }
.fcx-svg { display: block; width: 100%; height: auto; }

.fcx-grid { stroke: var(--ent-line); stroke-width: 1; stroke-dasharray: 2 3; }
.fcx-zero { stroke: var(--ent-line-strong); stroke-width: 1; }
.fcx-gap { stroke: var(--ent-text-3); stroke-width: 1; stroke-dasharray: 2 4; opacity: 0.6; }

.fcx-axis-label { font-size: 10px; fill: var(--ent-text-3); font-family: var(--ent-font); }
.fcx-axis-value { font-size: 10px; fill: var(--ent-text-2); font-family: var(--ent-font-mono); }

/* The accent is the measure itself and nothing else on the surface, which keeps it well under the
   ten per cent DESIGN.md allows. */
.fcx-bar.is-bar { fill: var(--ent-accent); }
.fcx-bar.is-bar-secondary { stroke: var(--ent-accent-line); stroke-width: 1; }
.fcx-bar.is-nil { fill: var(--ent-text-3); }
.fcx-hatch-ground { fill: var(--ent-accent-soft); }
.fcx-hatch-line { stroke: var(--ent-accent-line); stroke-width: 2; }

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
.fcx-swatch {
  width: 14px;
  height: 10px;
  border-radius: 1px;
  flex: none;
}
.fcx-swatch.is-bar { background: var(--ent-accent); }
.fcx-swatch.is-bar-secondary {
  background: var(--ent-accent-soft);
  border: 1px solid var(--ent-accent-line);
  background-image: repeating-linear-gradient(45deg, var(--ent-accent-line) 0 2px, transparent 2px 5px);
}
.fcx-swatch.is-gap {
  height: 12px;
  width: 0;
  border-left: 1px dashed var(--ent-text-3);
  border-radius: 0;
}
</style>
