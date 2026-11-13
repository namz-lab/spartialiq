<script setup lang="ts">
/** Two or more lines over the same days, area-tinted, for a month's money in and out. */
import { computed } from 'vue'
import { niceMax, tickLabel } from './useDashboard'

const props = withDefaults(defineProps<{
  labels: string[]
  series: { name: string; colour: string; values: number[] }[]
  label: string
  height?: number
  /** Print every n-th x label. */
  every?: number
}>(), { height: 140, every: 5 })

const W = 560
const H = computed(() => props.height)
const max = computed(() => niceMax(props.series.flatMap((s) => s.values)))
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => (max.value / 4) * i))
const x = (i: number) => 50 + (props.labels.length > 1 ? (i * (W - 60)) / (props.labels.length - 1) : 0)
const y = (v: number) => H.value + 6 - (v / max.value) * H.value
const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
const area = (vals: number[]) => `${path(vals)} L${x(vals.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
</script>

<template>
  <div class="dx-chart-wrap">
    <div class="dx-legend">
      <span v-for="s in series" :key="s.name"><i :style="{ background: s.colour }" />{{ s.name }}</span>
    </div>
    <svg class="dx-chart" :viewBox="`0 0 ${W} ${H + 28}`" role="img" :aria-label="label">
      <g v-for="t in ticks" :key="t">
        <line x1="50" :x2="W - 6" :y1="y(t)" :y2="y(t)" stroke="#e8edf4" />
        <text x="44" :y="y(t) + 4" text-anchor="end" font-size="11" fill="#515c6b">{{ tickLabel(t) }}</text>
      </g>
      <g v-for="s in series" :key="s.name">
        <path v-if="s.values.length" :d="area(s.values)" :fill="s.colour" opacity="0.10" />
        <path v-if="s.values.length" :d="path(s.values)" fill="none" :stroke="s.colour" stroke-width="2.4" stroke-linejoin="round" />
      </g>
      <template v-for="(l, i) in labels" :key="l">
        <text v-if="i % every === 0 || i === labels.length - 1" :x="x(i)" :y="H + 24" :text-anchor="i === labels.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'" font-size="11" fill="#1a2430">{{ l }}</text>
      </template>
    </svg>
  </div>
</template>
