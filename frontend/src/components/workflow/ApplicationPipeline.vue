<script setup lang="ts">
// Shared, cross-role view of where a development application sits in the
// municipal workflow. Backend-status driven (see useApplicationPipeline), so
// the planner, clerk, specialists, EO and citizen all see the same truth.
import { computed } from 'vue'
import type { PermitApplication, Consultation } from '@/services/developmentManagementService'
import {
  buildPipeline, statusLabel, normalizeStatus, type PipelineStage,
} from '@/composables/useApplicationPipeline'
import { CheckCircle2, MapPin } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  permit: PermitApplication | null
  consultations?: Consultation[]
  title?: string
}>(), { consultations: () => [], title: 'Application progress' })

// GIS integration: when the application has a stored map location, expose a
// "Locate on map" action. The host (e.g. the planner shell) flies its map there.
const emit = defineEmits<{ locate: [coords: { lng: number; lat: number }] }>()
const coords = computed(() => {
  const p = props.permit
  return p && typeof p.lng === 'number' && typeof p.lat === 'number'
    ? { lng: p.lng, lat: p.lat } : null
})

const stages = computed<PipelineStage[]>(() =>
  buildPipeline(props.permit, { consultations: props.consultations }))
const currentLabel = computed(() => props.permit ? statusLabel(props.permit.status) : null)
const badgeClass = computed(() => {
  if (!props.permit) return ''
  const c = normalizeStatus(props.permit.status)
  if (c === 'refused' || c === 'withdrawn') return 'neg'
  if (c === 'approved' || c === 'approved_with_conditions') return 'pos'
  return 'mid'
})
</script>

<template>
  <section class="ap-card">
    <header class="ap-head">
      <span class="ap-title">{{ title }}</span>
      <span v-if="currentLabel" class="ap-badge" :class="badgeClass">{{ currentLabel }}</span>
      <span v-else class="ap-badge muted">No application open</span>
      <button v-if="coords" class="ap-locate" title="Show this application on the map"
              @click="emit('locate', coords)">
        <MapPin :size="12" /> Locate on map
      </button>
    </header>

    <ol class="ap-track">
      <li v-for="(s, i) in stages" :key="s.key" class="ap-stage" :class="s.status">
        <span class="ap-connector" v-if="i > 0" :class="{ filled: s.status === 'done' || s.status === 'active' }" />
        <span class="ap-node">
          <CheckCircle2 v-if="s.status === 'done'" :size="14" />
          <span v-else class="ap-num">{{ i + 1 }}</span>
        </span>
        <span class="ap-body">
          <span class="ap-label">{{ s.label }}</span>
          <span class="ap-role">{{ s.roleLabel }}</span>
          <span v-if="s.evidence" class="ap-evidence">{{ s.evidence }}</span>
          <span v-else class="ap-desc">{{ s.description }}</span>
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ap-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.6rem; padding:0.85rem 1rem; }
.ap-head { display:flex; align-items:center; gap:0.6rem; margin-bottom:0.75rem; }
.ap-title { font-size:0.8rem; font-weight:700; color:#0f172a; }
.ap-badge { font-size:0.66rem; font-weight:700; padding:0.12rem 0.55rem; border-radius:9999px;
  background:#eff6ff; color:#1d4ed8; }
.ap-badge.pos { background:#f0fdf4; color:#16a34a; }
.ap-badge.neg { background:#fef2f2; color:#b91c1c; }
.ap-badge.mid { background:#eff6ff; color:#1d4ed8; }
.ap-badge.muted { background:#f1f5f9; color:#94a3b8; }
.ap-locate { margin-left:auto; display:inline-flex; align-items:center; gap:0.25rem;
  font-size:0.66rem; font-weight:600; color:#1d4ed8; background:#eff6ff;
  border:1px solid #bfdbfe; border-radius:0.35rem; padding:0.2rem 0.5rem; cursor:pointer; }
.ap-locate:hover { background:#dbeafe; }

/* Horizontal on wide screens; wraps to a stacked list when narrow. */
.ap-track { list-style:none; margin:0; padding:0; display:flex; gap:0; flex-wrap:wrap; }
.ap-stage { position:relative; flex:1 1 8.5rem; min-width:8.5rem; display:flex;
  flex-direction:column; align-items:center; text-align:center; padding:0 0.25rem; }
.ap-connector { position:absolute; top:11px; left:-50%; width:100%; height:2px;
  background:#e2e8f0; z-index:0; }
.ap-connector.filled { background:#1d4ed8; }
.ap-node { position:relative; z-index:1; width:24px; height:24px; border-radius:50%;
  display:inline-flex; align-items:center; justify-content:center;
  font-size:0.66rem; font-weight:700; background:#e2e8f0; color:#64748b; }
.ap-stage.done .ap-node   { background:#16a34a; color:#fff; }
.ap-stage.active .ap-node { background:#1d4ed8; color:#fff; box-shadow:0 0 0 3px #bfdbfe; }
.ap-body { display:flex; flex-direction:column; gap:0.1rem; margin-top:0.35rem; }
.ap-label { font-size:0.72rem; font-weight:700; color:#0f172a; }
.ap-stage.pending .ap-label { color:#94a3b8; }
.ap-role { font-size:0.6rem; color:#64748b; line-height:1.2; }
.ap-evidence { font-size:0.62rem; font-weight:600; color:#1d4ed8; margin-top:0.1rem; }
.ap-desc { font-size:0.6rem; color:#cbd5e1; margin-top:0.1rem; }

@media (max-width: 640px) {
  .ap-track { flex-direction:column; gap:0.5rem; }
  /* flex-basis reset matters: in the column track the desktop `1 1 8.5rem`
     basis becomes a 8.5rem HEIGHT per stage, ballooning the card. */
  .ap-stage { flex:0 0 auto; flex-direction:row; align-items:flex-start; text-align:left; gap:0.5rem; min-width:0; }
  .ap-connector { display:none; }
  .ap-body { margin-top:0; align-items:flex-start; }
}
</style>
