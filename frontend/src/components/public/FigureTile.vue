<script setup lang="ts">
/**
 * One live figure from the district register.
 *
 * The number counts up the first time the tile is seen, and only ever counts
 * to a figure the server actually returned. Three states, and the difference
 * between them matters:
 *
 *   loading  — a skeleton. We do not know yet.
 *   null     — an em dash. The server answered and had no figure for this
 *              one, usually because the table is absent in this environment.
 *   number   — the figure, counted up.
 *
 * A zero would be a fourth state and a lie: "0 km of road" is a statement
 * about the district, "—" is a statement about the data, and only one of
 * those is true when a table is missing.
 */
import { computed, toRef, ref } from 'vue'
import { useCountUp } from '@/composables/reveal'
import { formatFigure } from '@/services/districtOverview'

const props = defineProps<{
  label: string
  value?: number | null
  /** Appended to the counted number: 'ha', 'km'. */
  unit?: string
  /** One line under the label saying where the figure comes from. */
  source?: string
  loading?: boolean
}>()

const host = ref<HTMLElement | null>(null)
const shown = useCountUp(toRef(props, 'value'), { element: host })

const known = computed(() => props.value != null && Number.isFinite(props.value))

/** Mid-count the tile shows a partial number; at rest it shows the real one. */
const display = computed(() => {
  if (!known.value) return '—'
  return formatFigure(shown.value ?? props.value)
})

/**
 * The counting digits change 60 times a second, which a screen reader would
 * otherwise announce. The accessible name is the settled figure, stated once.
 */
const accessibleValue = computed(() =>
  known.value
    ? `${formatFigure(props.value)}${props.unit ? ` ${props.unit}` : ''} ${props.label}`
    : `${props.label}: figure unavailable`,
)
</script>

<template>
  <div ref="host" class="figure-tile" :class="{ 'is-pending': loading && !known }">
    <p class="figure-tile-value" aria-hidden="true">
      <span v-if="loading && !known" class="figure-skeleton"></span>
      <template v-else>
        {{ display }}<small v-if="unit && known" class="figure-tile-unit">{{ unit }}</small>
      </template>
    </p>
    <p class="figure-tile-label">{{ label }}</p>
    <p v-if="source" class="figure-tile-source">{{ source }}</p>
    <span class="sr-only">{{ accessibleValue }}</span>
  </div>
</template>
