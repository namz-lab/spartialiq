<script setup lang="ts">
import { Check } from 'lucide-vue-next'

defineProps<{ current: number }>()
const STEPS = ['Find Customer', 'Select & Allocate', 'Confirm Payment', 'Issue Receipt']
</script>

<template>
  <ol class="st" aria-label="Payment steps">
    <li
      v-for="(label, i) in STEPS" :key="label"
      :class="{ 'is-done': i + 1 < current, 'is-current': i + 1 === current }"
      :aria-current="i + 1 === current ? 'step' : undefined"
    >
      <span class="st-dot"><Check v-if="i + 1 < current" :size="18" aria-hidden="true" /><template v-else>{{ i + 1 }}</template></span>
      <span class="st-label">{{ label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.st { display: flex; margin: 0; padding: 0; list-style: none; min-width: min(560px, 100%); }
.st li { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.st li + li::before { content: ''; position: absolute; top: 18px; right: 50%; width: 100%; height: 2px; background: #c9d6e6; z-index: 0; }
.st li.is-done + li::before, .st li.is-current::before { background: #1f5aa8; }
.st-dot { position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #fff; border: 2px solid #c9d6e6; color: #515c6b; font-weight: 700; font-size: 14px; }
.is-done .st-dot, .is-current .st-dot { background: #1f5aa8; border-color: #1f5aa8; color: #fff; }
.st-label { font-size: 15.5px; color: #1a2430; }
.is-current .st-label { color: #1f5aa8; font-weight: 700; }
@media (max-width: 640px) { .st-label { font-size: 12.5px; } }
</style>
