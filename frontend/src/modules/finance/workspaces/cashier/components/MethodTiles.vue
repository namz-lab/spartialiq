<script setup lang="ts">
/** The four ways a customer pays at the counter, as large tiles. */
import { Banknote, CreditCard, Landmark, Smartphone, Check } from 'lucide-vue-next'
import type { CashMethod } from '../../../models/cashTypes'

defineProps<{ modelValue: CashMethod; row?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: CashMethod): void }>()

const METHODS: { value: CashMethod; label: string; icon: unknown }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'POS / Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Landmark },
  { value: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
]
</script>

<template>
  <div class="cw-methods" :class="{ 'cw-methods--row': row }" role="group" aria-label="Payment method">
    <button
      v-for="m in METHODS" :key="m.value" type="button" class="cw-method-tile"
      :aria-pressed="modelValue === m.value" @click="emit('update:modelValue', m.value)"
    >
      <span v-if="modelValue === m.value" class="cw-tick"><Check :size="15" aria-hidden="true" /></span>
      <component :is="m.icon" :size="34" aria-hidden="true" />
      <span>{{ m.label }}</span>
    </button>
  </div>
</template>
