<script setup lang="ts">
// Attribute form driven by the layer schema: domains become selects,
// required fields are marked, and every feature carries its accuracy class
// and source (business rule 2).
import { reactive, watch } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import { ACCURACY_LABEL, type AccuracyClass, type LayerField } from '@/services/gms'

const props = defineProps<{
  fields: LayerField[]
  attrs: Record<string, unknown>
  accuracy: AccuracyClass
  source: string
  /** Attributes copied from another feature, offered for pasting. */
  clipboard?: Record<string, unknown> | null
  submitLabel?: string
  issues?: { field?: string; problem?: string }[]
}>()
const emit = defineEmits<{
  save: [v: { attrs: Record<string, unknown>; accuracy_class: AccuracyClass; source: string }]
  cancel: []
}>()

const form = reactive({ attrs: {} as Record<string, unknown>, accuracy: 'D' as AccuracyClass, source: '' })
watch(() => [props.attrs, props.accuracy, props.source], () => {
  form.attrs = { ...props.attrs }
  form.accuracy = props.accuracy
  form.source = props.source
}, { immediate: true })

function paste() {
  const known = new Set(props.fields.map((f) => f.name))
  for (const [k, v] of Object.entries(props.clipboard || {})) if (known.has(k)) form.attrs[k] = v
}

function save() {
  const attrs: Record<string, unknown> = {}
  for (const f of props.fields) {
    const v = form.attrs[f.name]
    if (v === '' || v === undefined || v === null) continue
    attrs[f.name] = f.type === 'number' ? Number(v) : v
  }
  emit('save', { attrs, accuracy_class: form.accuracy, source: form.source.trim() })
}
const problem = (name: string) => props.issues?.find((i) => i.field === name)?.problem
const PROBLEM: Record<string, string> = {
  required: 'Required', not_in_domain: 'Not an allowed value', not_a_number: 'Must be a number',
  not_a_date: 'Must be a date', unknown_attribute: 'Not a field of this layer',
}
</script>

<template>
  <form class="af" @submit.prevent="save">
    <label v-for="f in fields" :key="f.name" class="af-f">
      <span>{{ f.label }}<b v-if="f.required" aria-hidden="true"> *</b><em v-if="f.personal"> · personal data</em></span>
      <select v-if="f.domain" v-model="form.attrs[f.name]" :required="f.required" :aria-invalid="!!problem(f.name)">
        <option value="" disabled>Choose…</option>
        <option v-for="d in f.domain" :key="String(d)" :value="d">{{ d }}</option>
      </select>
      <input v-else-if="f.type === 'number'" v-model="form.attrs[f.name]" type="number" step="any" :required="f.required" :aria-invalid="!!problem(f.name)" />
      <input v-else-if="f.type === 'date'" v-model="form.attrs[f.name]" type="date" :required="f.required" :aria-invalid="!!problem(f.name)" />
      <input v-else v-model="form.attrs[f.name]" type="text" :required="f.required" :aria-invalid="!!problem(f.name)" />
      <small v-if="problem(f.name)" class="af-err">{{ PROBLEM[problem(f.name)!] ?? problem(f.name) }}</small>
    </label>
    <label class="af-f">
      <span>Accuracy class <b aria-hidden="true">*</b></span>
      <select v-model="form.accuracy" required>
        <option v-for="(label, c) in ACCURACY_LABEL" :key="c" :value="c">{{ label }}</option>
      </select>
    </label>
    <label class="af-f">
      <span>Source <b aria-hidden="true">*</b></span>
      <input v-model="form.source" type="text" required placeholder="e.g. digitised over 2025 orthophoto" />
    </label>
    <div class="af-actions">
      <UiButton type="submit" size="sm" variant="primary">{{ submitLabel || 'Save' }}</UiButton>
      <UiButton v-if="clipboard" size="sm" variant="ghost" @click="paste">Paste attributes</UiButton>
      <UiButton size="sm" variant="ghost" @click="emit('cancel')">Cancel</UiButton>
    </div>
  </form>
</template>

<style scoped>
.af { display:flex; flex-direction:column; gap:var(--ent-s2); }
.af-f { display:flex; flex-direction:column; gap:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-2); font-weight:var(--ent-fw-medium); }
.af-f b { color:var(--ent-danger); }
.af-f em { font-style:normal; color:var(--ent-warning); font-weight:var(--ent-fw-normal); }
.af-f input, .af-f select { height:var(--ent-control-h-sm); padding:0 var(--ent-s2); font:inherit; font-size:var(--ent-fs-sm);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); }
.af-f [aria-invalid="true"] { border-color:var(--ent-danger); }
.af-err { color:var(--ent-danger); font-weight:var(--ent-fw-normal); }
.af-actions { display:flex; flex-wrap:wrap; gap:var(--ent-s2); margin-top:var(--ent-s1); }
</style>
