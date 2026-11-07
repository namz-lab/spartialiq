<script setup lang="ts">
// Identify: what was clicked, its linked records and its history. Parcels
// show their ERP band (never an amount) and link to the full profile.
import { ref, watch, computed } from 'vue'
import { X, History } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  gmsApi, BAND_LABEL, ACCURACY_LABEL,
  type ParcelProfile, type FeatureDetail, type StatusBand,
} from '@/services/gms'

export type IdentifyTarget = { kind: 'parcel'; id: string } | { kind: 'feature'; id: number }

const props = defineProps<{
  target: IdentifyTarget
  /** The layer the user is editing now, if any. */
  editLayerId: string | null
  canRestore: boolean
}>()
const emit = defineEmits<{
  close: []
  reshape: [f: FeatureDetail]
  'edit-attrs': [f: FeatureDetail]
  delete: [f: FeatureDetail]
  copy: [attrs: Record<string, unknown>]
  refresh: []
}>()

const parcel = ref<ParcelProfile | null>(null)
const feature = ref<FeatureDetail | null>(null)
const loading = ref(false)
const error = ref('')
const showHistory = ref(false)

const BAND_TONE: Record<StatusBand, 'positive' | 'warning' | 'neutral'> = {
  current: 'positive', in_arrears: 'warning', no_account: 'neutral', closed: 'neutral', unknown: 'neutral',
}

async function load() {
  loading.value = true
  error.value = ''
  parcel.value = null
  feature.value = null
  try {
    if (props.target.kind === 'parcel') parcel.value = await gmsApi.parcel(props.target.id)
    else feature.value = await gmsApi.feature(props.target.id)
  } catch (e: any) {
    error.value = e?.response?.status === 404 ? 'Not found, or not visible to your role.' : 'Could not be loaded.'
  } finally {
    loading.value = false
  }
}
watch(() => props.target, load, { immediate: true, deep: true })

const editable = computed(() => !!feature.value && feature.value.status === 'published' && props.editLayerId === feature.value.layer_id)
const label = (name: string) => feature.value?.layer.attributes.find((f) => f.name === name)?.label ?? name
const when = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

async function restore(version: number) {
  const reason = window.prompt(`Restore version ${version}? Say why; it is kept in the history and the audit trail.`)
  if (!reason?.trim() || !feature.value) return
  try {
    await gmsApi.restore(feature.value.feature_id, version, reason.trim())
    await load()
    emit('refresh')
  } catch {
    error.value = 'The version could not be restored.'
  }
}
</script>

<template>
  <aside class="id" aria-label="Identify">
    <header class="id-head">
      <h2 class="id-title">
        <template v-if="parcel">Stand <span class="id-mono">{{ parcel.stand_no }}</span></template>
        <template v-else-if="feature">{{ feature.layer.title }}</template>
        <template v-else>Identify</template>
      </h2>
      <button type="button" class="id-x" aria-label="Close" @click="emit('close')"><X :size="14" /></button>
    </header>

    <p v-if="loading" class="id-note" role="status">Loading…</p>
    <p v-else-if="error" class="id-err" role="alert">{{ error }}</p>

    <template v-else-if="parcel">
      <p class="id-sub"><span class="id-mono">{{ parcel.parcel_id }}</span> · {{ parcel.township_code }}</p>
      <UiStatusBadge :tone="BAND_TONE[parcel.status_band]" :label="`ERP: ${BAND_LABEL[parcel.status_band]}`" />
      <dl class="id-dl">
        <dt>Area</dt><dd class="id-mono">{{ parcel.area_m2.toLocaleString('en-GB') }} m²</dd>
        <dt>Ward</dt><dd>{{ parcel.ward_name || parcel.ward_code || '—' }}</dd>
        <dt>Accuracy</dt><dd>{{ ACCURACY_LABEL[parcel.accuracy_class] }}</dd>
        <dt>Survey CRS</dt><dd class="id-mono">{{ parcel.source_crs }}</dd>
        <dt>Allocation</dt><dd>{{ parcel.allocation_status }}</dd>
        <dt>Accounts</dt><dd>{{ parcel.accounts.length }}</dd>
        <dt>Buildings</dt><dd>{{ parcel.buildings.length }}</dd>
      </dl>
      <p class="id-note">Boundary changes only through an approved Survey Section import.</p>
      <RouterLink class="id-link" :to="`/gis/parcels/${parcel.parcel_id}`">Open parcel profile</RouterLink>
    </template>

    <template v-else-if="feature">
      <p class="id-sub"><span class="id-mono">F-{{ feature.feature_id }}</span> · v{{ feature.version }}<span v-if="feature.status === 'retired'"> · retired</span></p>
      <dl class="id-dl">
        <template v-for="(v, k) in feature.attrs" :key="k">
          <dt>{{ label(String(k)) }}</dt><dd>{{ v }}</dd>
        </template>
        <dt>Accuracy</dt><dd>{{ ACCURACY_LABEL[feature.accuracy_class] }}</dd>
        <dt>Source</dt><dd>{{ feature.source }}</dd>
        <dt>Custodian</dt><dd>{{ feature.custodian_dept }}</dd>
      </dl>

      <div class="id-actions">
        <UiButton size="sm" variant="ghost" @click="emit('copy', feature.attrs)">Copy attributes</UiButton>
        <template v-if="editable">
          <UiButton size="sm" @click="emit('edit-attrs', feature)">Edit attributes</UiButton>
          <UiButton size="sm" @click="emit('reshape', feature)">Move / reshape</UiButton>
          <UiButton size="sm" variant="danger" @click="emit('delete', feature)">Delete</UiButton>
        </template>
      </div>

      <button type="button" class="id-hist-btn" :aria-expanded="showHistory" @click="showHistory = !showHistory">
        <History :size="12" aria-hidden="true" /> History ({{ feature.versions.length }})
      </button>
      <ol v-if="showHistory" class="id-hist" reversed>
        <li v-for="v in feature.versions" :key="v.version">
          <div><strong>v{{ v.version }}</strong> {{ v.action }} · {{ when(v.changed_at) }}</div>
          <div class="id-note">{{ v.changed_by || 'system' }}<span v-if="v.note"> — {{ v.note }}</span></div>
          <UiButton v-if="canRestore && v.version !== feature.version" size="sm" variant="ghost" @click="restore(v.version)">Restore this version</UiButton>
        </li>
      </ol>
    </template>
  </aside>
</template>

<style scoped>
.id { display:flex; flex-direction:column; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.id-head { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s2); }
.id-title { margin:0; font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); }
.id-x { display:inline-flex; padding:4px; background:none; border:0; border-radius:var(--ent-r-sm); color:var(--ent-text-3); cursor:pointer; }
.id-x:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.id-x:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.id-sub { margin:0; color:var(--ent-text-2); }
.id-mono { font-family:var(--ent-font-mono); }
.id-dl { display:grid; grid-template-columns:max-content 1fr; gap:var(--ent-s1) var(--ent-s3); margin:0; }
.id-dl dt { color:var(--ent-text-3); }
.id-dl dd { margin:0; overflow-wrap:anywhere; }
.id-note { margin:0; color:var(--ent-text-3); font-size:var(--ent-fs-xs); }
.id-err { margin:0; color:var(--ent-danger); }
.id-link { color:var(--ent-accent); font-weight:var(--ent-fw-medium); }
.id-actions { display:flex; flex-wrap:wrap; gap:var(--ent-s1); }
.id-hist-btn { display:inline-flex; align-items:center; gap:var(--ent-s1); align-self:flex-start; padding:2px 0;
  background:none; border:0; color:var(--ent-text-2); font:inherit; font-size:var(--ent-fs-xs); cursor:pointer; }
.id-hist-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.id-hist { margin:0; padding-left:1.2rem; display:flex; flex-direction:column; gap:var(--ent-s2); font-size:var(--ent-fs-xs); }
</style>
