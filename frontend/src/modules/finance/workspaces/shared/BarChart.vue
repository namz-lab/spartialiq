<script setup lang="ts">
/**
 * Grouped vertical bars, one group per label. Heights are drawn from the server's figures; the
 * chart computes nothing that is shown as a figure. Each bar carries a <title> with its value, and
 * the chart has an accessible name; the same figures are in a table or list on every dashboard.
 */
import { computed } from 'vue'
import { niceMax, tickLabel } from './useDashboard'

const props = withDefaults(defineProps<{
  labels: string[]
  series: { name: string; colour: string; values: number[] }[]
  label: string
  height?: number
  /** Shown in each bar's tooltip, e.g. a currency. */
  unit?: string
  /** One colour per label, for a single series coloured by category. */
  barColours?: string[]
}>(), { height: 150, unit: '', barColours: undefined })

const H = computed(() => props.height)
const max = computed(() => niceMax(props.series.flatMap((s) => s.values)))
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => (max.value / 4) * i))
const barW = computed(() => Math.max(10, Math.min(30, 64 / props.series.length)))
const group = computed(() => Math.max(barW.value * props.series.length + 26, 56))
const width = computed(() => 62 + props.labels.length * group.value)
const y = (v: number) => H.value + 6 - (v / max.value) * H.value
</script>

<template>
  <div class="dx-chart-wrap">
    <div v-if="!barColours" class="dx-legend">
      <span v-for="s in series" :key="s.name"><i :style="{ background: s.colour }" />{{ s.name }}</span>
    </div>
    <svg class="dx-chart" :viewBox="`0 0 ${width} ${H + 30}`" role="img" :aria-label="label">
      <g v-for="t in ticks" :key="t">
        <line x1="50" :x2="width - 4" :y1="y(t)" :y2="y(t)" stroke="#e8edf4" />
        <text x="44" :y="y(t) + 4" text-anchor="end" font-size="11" fill="#515c6b">{{ tickLabel(t) }}</text>
      </g>
      <g v-for="(l, i) in labels" :key="l + i" :transform="`translate(${58 + i * group} 0)`">
        <rect v-for="(s, k) in series" :key="s.name" :x="k * (barW + 3)" :y="y(s.values[i] ?? 0)" :width="barW"
          :height="Math.max(0, H + 6 - y(s.values[i] ?? 0))" rx="2" :fill="barColours?.[i] ?? s.colour">
          <title>{{ l }} {{ s.name }}: {{ (s.values[i] ?? 0).toLocaleString('en-GB') }} {{ unit }}</title>
        </rect>
        <text :x="(series.length * (barW + 3)) / 2" :y="H + 24" text-anchor="middle" font-size="11.5" fill="#1a2430">{{ l }}</text>
      </g>
    </svg>
  </div>
</template>
