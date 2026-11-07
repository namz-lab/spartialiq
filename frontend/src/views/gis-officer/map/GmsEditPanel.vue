<script setup lang="ts">
// The edit session: which layer, what has been changed, whether it is saved,
// what the topology check says, and submission to QA.
import { ref, computed } from 'vue'
import { Undo2, Redo2, X } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import GmsAttributeForm from './GmsAttributeForm.vue'
import type { useEditSession } from '@/composables/useEditSession'
import type { AccuracyClass, Edit, EditIssue, GmsLayer } from '@/services/gms'

export type Draft =
  | { kind: 'new'; geometry: GeoJSON.Geometry }
  | { kind: 'pending'; index: number }
  | { kind: 'feature'; feature_id: number; version: number; attrs: Record<string, unknown>; accuracy_class: AccuracyClass; source: string }

const props = defineProps<{
  es: ReturnType<typeof useEditSession>
  layers: GmsLayer[]
  draft: Draft | null
  issues: EditIssue[]
  clipboard: Record<string, unknown> | null
  busy: boolean
}>()
const emit = defineEmits<{
  start: [layerId: string]
  'draft-save': [v: { attrs: Record<string, unknown>; accuracy_class: AccuracyClass; source: string }]
  'draft-cancel': []
  focus: [index: number]
  validate: []
  submit: []
  abandon: []
  leave: []
}>()

const chosen = ref('')
const editableLayers = computed(() => props.layers.filter((l) => l.can_edit))
const layer = computed(() => props.layers.find((l) => l.layer_id === props.es.session.value?.layer_id) ?? null)
const es = props.es

function labelOf(e: Edit, i: number) {
  if (e.op === 'create') {
    const a = e.attrs as Record<string, unknown>
    return `New · ${a.name ?? a.stand_no ?? a.trading_name ?? `#${i + 1}`}`
  }
  return `${e.op === 'update' ? 'Change' : 'Delete'} · F-${e.feature_id}`
}

const draftForm = computed(() => {
  const d = props.draft
  if (!d) return null
  if (d.kind === 'new') return { attrs: {}, accuracy: 'D' as AccuracyClass, source: `On-screen digitising, ${new Date().getFullYear()}`, title: 'New feature' }
  if (d.kind === 'feature') return { attrs: d.attrs, accuracy: d.accuracy_class, source: d.source, title: `Feature F-${d.feature_id}` }
  const e = es.edits.value[d.index]
  if (!e || e.op !== 'create') return null
  return { attrs: e.attrs, accuracy: e.accuracy_class, source: e.source, title: labelOf(e, d.index) }
})
const draftIssues = computed(() => {
  const d = props.draft
  return d?.kind === 'pending' ? props.issues.filter((i) => i.index === d.index && i.field) : []
})

const MESSAGE: Record<string, string> = {
  overlap: 'Overlaps another stand',
  not_snapped: 'Road end is not joined to the road beside it',
  outside_ward: 'Falls outside every ward',
  invalid_geometry: 'Invalid geometry',
  wrong_geometry_type: 'Wrong geometry type for this layer',
  missing_accuracy_class: 'No accuracy class',
  missing_source: 'No source',
  attribute: 'Attribute problem',
  unknown_feature: 'Feature no longer exists',
  feature_edited_twice: 'Feature changed twice in one session',
}
const issueText = (i: EditIssue) => {
  const base = MESSAGE[i.code] ?? i.code
  if (i.code === 'attribute') return `${base}: ${i.field} (${i.problem})`
  if (i.code === 'overlap') return `${base} (${i.overlap_m2?.toFixed(1)} m²${i.with_feature ? `, with F-${i.with_feature}` : ''})`
  return base
}
const saveLine = computed(() => ({
  idle: '', saving: 'Saving…', offline: 'Not reached the server — kept on this device, retrying',
  saved: es.savedAt.value ? `Saved ${es.savedAt.value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Saved',
}[es.saveState.value]))
</script>

<template>
  <section class="ep" aria-label="Editing">
    <template v-if="!es.session.value">
      <p class="ep-note">Edits stay in your session until the Senior GIS Officer approves them in QA.</p>
      <p v-if="!editableLayers.length" class="ep-note">No layer here is yours to edit. Departmental focal points edit only their department's layers.</p>
      <form v-else class="ep-start" @submit.prevent="chosen && emit('start', chosen)">
        <label class="ep-f">
          <span>Layer</span>
          <select v-model="chosen" required>
            <option value="" disabled>Choose a layer…</option>
            <option v-for="l in editableLayers" :key="l.layer_id" :value="l.layer_id">{{ l.title }} ({{ l.custodian_dept }})</option>
          </select>
        </label>
        <UiButton type="submit" size="sm" variant="primary" :disabled="!chosen" :loading="busy">Start editing</UiButton>
      </form>
    </template>

    <template v-else>
      <header class="ep-head">
        <div>
          <h2 class="ep-title">Editing {{ layer?.title }}</h2>
          <p class="ep-save" role="status">{{ saveLine }}</p>
        </div>
        <button type="button" class="ep-x" aria-label="Stop editing (keeps the session)" title="Stop editing — the session is kept" @click="emit('leave')"><X :size="14" /></button>
      </header>
      <p v-if="es.recovered.value" class="ep-warn">Unsaved changes from this device were recovered after an interruption.</p>
      <p v-if="es.session.value.status === 'returned'" class="ep-warn">
        Returned by QA: {{ es.session.value.decision_note }}
      </p>
      <p v-if="es.session.value.status === 'submitted'" class="ep-note">Submitted {{ new Date(es.session.value.submitted_at!).toLocaleString('en-GB') }}. Waiting for QA.</p>

      <div v-if="draftForm" class="ep-draft">
        <h3 class="ep-h3">{{ draftForm.title }}</h3>
        <GmsAttributeForm
          :fields="layer?.attributes ?? []" :attrs="draftForm.attrs" :accuracy="draftForm.accuracy" :source="draftForm.source"
          :clipboard="clipboard" :issues="draftIssues" :submit-label="draft?.kind === 'new' ? 'Add to session' : 'Save'"
          @save="emit('draft-save', $event)" @cancel="emit('draft-cancel')"
        />
      </div>

      <div class="ep-tools">
        <UiButton size="sm" variant="ghost" :disabled="!es.canUndo.value" @click="es.undo()">
          <template #icon><Undo2 :size="12" aria-hidden="true" /></template>Undo
        </UiButton>
        <UiButton size="sm" variant="ghost" :disabled="!es.canRedo.value" @click="es.redo()">
          <template #icon><Redo2 :size="12" aria-hidden="true" /></template>Redo
        </UiButton>
      </div>

      <p v-if="!es.edits.value.length" class="ep-note">
        No changes yet. Use the {{ layer?.geom_type === 'Point' ? 'point' : layer?.geom_type === 'LineString' ? 'line' : 'polygon' }} tool to draw,
        or identify a feature of this layer to change it.
      </p>
      <ol v-else class="ep-list">
        <li v-for="(e, i) in es.edits.value" :key="i" :class="{ bad: issues.some((x) => x.index === i) }">
          <button type="button" class="ep-item" @click="emit('focus', i)">{{ labelOf(e, i) }}</button>
          <button v-if="es.editable.value" type="button" class="ep-x" :aria-label="`Remove edit ${i + 1}`" @click="es.removeEdit(i)"><X :size="12" /></button>
        </li>
      </ol>

      <ul v-if="issues.length" class="ep-issues" role="alert">
        <li v-for="(x, n) in issues" :key="n">
          <button type="button" class="ep-item" @click="x.index != null && emit('focus', x.index)">
            <span v-if="x.index != null">#{{ x.index + 1 }}: </span>{{ issueText(x) }}
          </button>
        </li>
      </ul>

      <div v-if="es.editable.value" class="ep-actions">
        <UiButton size="sm" :disabled="!es.edits.value.length" :loading="busy" @click="emit('validate')">Check</UiButton>
        <UiButton size="sm" variant="primary" :disabled="!es.edits.value.length || es.saveState.value === 'saving'" :loading="busy" @click="emit('submit')">Submit for QA</UiButton>
        <UiButton size="sm" variant="ghost" @click="emit('abandon')">Abandon</UiButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ep { display:flex; flex-direction:column; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.ep-note { margin:0; color:var(--ent-text-2); font-size:var(--ent-fs-xs); }
.ep-warn { margin:0; padding:var(--ent-s2); border-radius:var(--ent-r-sm); background:var(--ent-warning-soft); font-size:var(--ent-fs-xs); }
.ep-start { display:flex; flex-direction:column; gap:var(--ent-s2); }
.ep-f { display:flex; flex-direction:column; gap:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.ep-f select { height:var(--ent-control-h-sm); font:inherit; font-size:var(--ent-fs-sm); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); background:var(--ent-surface); color:var(--ent-text); }
.ep-head { display:flex; justify-content:space-between; gap:var(--ent-s2); }
.ep-title { margin:0; font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); }
.ep-save { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.ep-h3 { margin:0 0 var(--ent-s2); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); }
.ep-draft { padding:var(--ent-s3); border:1px solid var(--ent-accent-line); border-radius:var(--ent-r); background:var(--ent-surface); }
.ep-tools { display:flex; gap:var(--ent-s1); }
.ep-list, .ep-issues { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:2px; }
.ep-list li { display:flex; align-items:center; gap:var(--ent-s1); border-left:3px solid transparent; padding-left:var(--ent-s1); }
.ep-list li.bad { border-left-color:var(--ent-danger); }
.ep-item { flex:1; text-align:left; background:none; border:0; padding:2px 0; font:inherit; font-size:var(--ent-fs-sm); color:var(--ent-text); cursor:pointer; }
.ep-item:hover { color:var(--ent-accent); }
.ep-item:focus-visible, .ep-x:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ep-issues .ep-item { color:var(--ent-danger); font-size:var(--ent-fs-xs); }
.ep-x { display:inline-flex; padding:3px; background:none; border:0; border-radius:var(--ent-r-sm); color:var(--ent-text-3); cursor:pointer; }
.ep-x:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.ep-actions { display:flex; flex-wrap:wrap; gap:var(--ent-s2); }
</style>
