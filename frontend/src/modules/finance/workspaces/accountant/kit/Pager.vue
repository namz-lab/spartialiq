<script setup lang="ts">
/** "101–200 of 340" with Previous and Next. */
import { computed } from 'vue'

const props = defineProps<{ total: number; limit: number; offset: number; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:offset', offset: number): void }>()

const first = computed(() => (props.total === 0 ? 0 : props.offset + 1))
const last = computed(() => Math.min(props.offset + props.limit, props.total))
const atStart = computed(() => props.offset <= 0)
const atEnd = computed(() => props.offset + props.limit >= props.total)
/** The ends use aria-disabled and a guard, never `disabled`: a button that was just pressed onto the last page keeps focus. */
const step = (to: number): void => { if (!props.disabled) emit('update:offset', to) }
const prev = (): void => { if (!atStart.value) step(Math.max(0, props.offset - props.limit)) }
const next = (): void => { if (!atEnd.value) step(props.offset + props.limit) }
</script>

<template>
  <nav class="pg no-print" aria-label="Pages">
    <button type="button" class="cw-btn cw-btn--small" :aria-disabled="disabled || atStart ? 'true' : undefined" @click="prev">Previous</button>
    <span class="pg-text">{{ total === 0 ? '0 of 0' : `${first}–${last} of ${total}` }}</span>
    <button type="button" class="cw-btn cw-btn--small" :aria-disabled="disabled || atEnd ? 'true' : undefined" @click="next">Next</button>
  </nav>
</template>

<style scoped>
.pg { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pg-text { font-size: 13.5px; color: var(--cw-ink-2); font-variant-numeric: tabular-nums; }
</style>
