<script setup lang="ts">
/** USD | ZWG. A statement shows one book at a time; this is how the person picks which. */
import type { Currency } from '../../../models/types'
import { useTabKeys } from './useTabKeys'

const props = defineProps<{ modelValue: Currency; label?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', c: Currency): void }>()
const BOOKS: Currency[] = ['USD', 'ZWG']

const onKey = useTabKeys(() => BOOKS, () => props.modelValue, (c) => emit('update:modelValue', c), true)
</script>

<template>
  <div class="cw-seg bs" role="radiogroup" :aria-label="label ?? 'Book'" @keydown="onKey">
    <button
      v-for="c in BOOKS" :key="c" type="button" role="radio" :aria-checked="c === modelValue ? 'true' : 'false'"
      :tabindex="c === modelValue ? 0 : -1" @click="emit('update:modelValue', c)"
    >{{ c }}</button>
  </div>
</template>

<style scoped>
.bs { display: inline-grid; min-width: 150px; }
</style>
