<script setup lang="ts">
/**
 * A ring of shares with the headline in the middle and a legend beside it. `value` is a percentage
 * from the server (0–100); `shown` is the text the legend prints for it.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  segments: { label: string; value: number; shown: string; colour: string }[]
  centre: string
  sub: string
  label: string
  size?: number
}>(), { size: 150 })

const R = 58
const C = 2 * Math.PI * R
const arcs = computed(() => {
  let offset = 0
  return props.segments.map((s) => {
    const len = (Math.max(0, Math.min(100, s.value)) / 100) * C
    const arc = { ...s, dash: `${len} ${C - len}`, offset: -offset }
    offset += len
    return arc
  })
})
</script>

<template>
  <div class="dx-donut">
    <svg viewBox="0 0 150 150" :width="size" :height="size" role="img" :aria-label="label">
      <circle cx="75" cy="75" :r="R" fill="none" stroke="#edf1f6" stroke-width="22" />
      <circle v-for="a in arcs" :key="a.label" cx="75" cy="75" :r="R" fill="none" :stroke="a.colour" stroke-width="22"
        :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" transform="rotate(-90 75 75)" />
      <text x="75" y="76" text-anchor="middle" font-size="24" font-weight="800" fill="#1a2430">{{ centre }}</text>
      <text x="75" y="96" text-anchor="middle" font-size="12.5" fill="#515c6b">{{ sub }}</text>
    </svg>
    <dl class="dx-donut-legend">
      <div v-for="s in segments" :key="s.label"><dt><i :style="{ background: s.colour }" />{{ s.label }}</dt><dd>{{ s.shown }}</dd></div>
    </dl>
  </div>
</template>
