<script setup lang="ts">
/** From and To dates, each bounded by `min` and `max`. */
defineProps<{ from: string; to: string; min?: string; max?: string }>()
const emit = defineEmits<{ (e: 'update:from', v: string): void; (e: 'update:to', v: string): void }>()
let serial = 0
const uid = `dr${++serial}-${Math.random().toString(36).slice(2, 7)}`
</script>

<template>
  <div class="dr">
    <div class="cw-field">
      <label class="cw-label" :for="`${uid}-from`">From</label>
      <input :id="`${uid}-from`" class="cw-input" type="date" :value="from" :min="min" :max="to || max"
        @input="emit('update:from', ($event.target as HTMLInputElement).value)" />
    </div>
    <div class="cw-field">
      <label class="cw-label" :for="`${uid}-to`">To</label>
      <input :id="`${uid}-to`" class="cw-input" type="date" :value="to" :min="from || min" :max="max"
        @input="emit('update:to', ($event.target as HTMLInputElement).value)" />
    </div>
  </div>
</template>

<style scoped>
.dr { display: flex; gap: 12px; flex-wrap: wrap; }
.dr .cw-field { min-width: 150px; flex: 1; }
</style>
