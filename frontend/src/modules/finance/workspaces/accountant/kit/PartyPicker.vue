<script setup lang="ts">
/** Choose a party (supplier, debtor, ratepayer…) by name or reference. */
import ComboPicker, { type PickOption } from './ComboPicker.vue'
import type { LedgerParty, PartyType } from '../../../models/ledgerTypes'

const props = defineProps<{
  modelValue: string
  parties: LedgerParty[]
  types?: PartyType[]
  label: string
  placeholder?: string
  disabled?: boolean
  /** S4: id(s) of the hint or error that describes the field, and whether the value is invalid. */
  describedby?: string
  invalid?: boolean
}>()
defineEmits<{ (e: 'update:modelValue', id: string): void }>()

const MAX = 50
const TYPE_NAME: Record<PartyType, string> = {
  ratepayer: 'ratepayer', debtor: 'debtor', supplier: 'supplier', employee: 'employee', other: 'other',
}

function search(q: string): PickOption[] {
  const pool = props.types?.length ? props.parties.filter(p => props.types!.includes(p.party_type)) : props.parties
  const needle = q.trim().toLowerCase()
  const byName = (a: LedgerParty, b: LedgerParty) => a.name.localeCompare(b.name)
  let hits: LedgerParty[]
  if (!needle) hits = [...pool].sort(byName)
  else {
    const starts = (p: LedgerParty) => p.name.toLowerCase().startsWith(needle) || (p.reference ?? '').toLowerCase().startsWith(needle)
    const first = pool.filter(starts).sort(byName)
    const seen = new Set(first.map(p => p.id))
    const rest = pool.filter(p => !seen.has(p.id) && (p.name.toLowerCase().includes(needle) || (p.reference ?? '').toLowerCase().includes(needle))).sort(byName)
    hits = [...first, ...rest]
  }
  return hits.slice(0, MAX).map(p => ({ id: p.id, text: p.name, sub: [p.reference, TYPE_NAME[p.party_type]].filter(Boolean).join(' · ') }))
}
function textFor(id: string): string {
  return props.parties.find(p => p.id === id)?.name ?? ''
}
</script>

<template>
  <ComboPicker
    :model-value="modelValue" :label="label" :search="search" :text-for="textFor"
    :placeholder="placeholder ?? 'Name or reference'" :disabled="disabled" :describedby="describedby" :invalid="invalid"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
