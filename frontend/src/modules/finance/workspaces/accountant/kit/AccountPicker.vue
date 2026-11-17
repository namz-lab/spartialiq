<script setup lang="ts">
/** Choose a ledger account by code or name. Codes that start with what is typed come first. */
import ComboPicker, { type PickOption } from './ComboPicker.vue'
import type { LedgerAccount } from '../../../models/ledgerTypes'

const props = defineProps<{
  modelValue: string
  accounts?: LedgerAccount[] // Optional for safety during async boot
  filter?: (a: LedgerAccount) => boolean
  label: string
  placeholder?: string
  disabled?: boolean
  describedby?: string
  invalid?: boolean
}>()
defineEmits<{ (e: 'update:modelValue', id: string): void }>()

const MAX = 50
const textOf = (a: LedgerAccount) => `${a.code} ${a.name}`

function search(q: string): PickOption[] {
  const accountPool = props.accounts ?? []
  const pool = props.filter ? accountPool.filter(props.filter) : accountPool
  const needle = q.trim().toLowerCase()
  const byCode = (a: LedgerAccount, b: LedgerAccount) => a.code.localeCompare(b.code, undefined, { numeric: true })
  
  let hits: LedgerAccount[]
  if (!needle) {
    hits = [...pool].sort(byCode)
  } else {
    const first = pool.filter(a => a.code.toLowerCase().startsWith(needle)).sort(byCode)
    const seen = new Set(first.map(a => a.id))
    const rest = pool.filter(a => !seen.has(a.id) && a.name.toLowerCase().includes(needle)).sort(byCode)
    hits = [...first, ...rest]
  }
  return hits.slice(0, MAX).map(a => ({ id: a.id, text: textOf(a), sub: a.is_group ? 'heading' : undefined }))
}

function textFor(id: string): string {
  const accountPool = props.accounts ?? []
  const a = accountPool.find(x => x.id === id)
  return a ? textOf(a) : ''
}
</script>

<template>
  <ComboPicker
    :model-value="modelValue" :label="label" :search="search" :text-for="textFor"
    :placeholder="placeholder ?? 'Code or name'" :disabled="disabled" :describedby="describedby" :invalid="invalid"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>