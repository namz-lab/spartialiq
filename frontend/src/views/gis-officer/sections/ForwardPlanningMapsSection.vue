<script setup lang="ts">
// Forward Planning Maps — base maps for the Forward Planning section
// (Master Plan, Local Plans, Subject Plans, layout briefs). Surfaces
// active layout projects from the Surveyor's register and a checklist
// of map deliverables expected for each plan-making cycle.

import { computed } from 'vue'
import { useOrProvideCadastralCase } from '@/composables/useCadastralCase'
import {
  Building, MapPin, FileText, Layers,
} from 'lucide-vue-next'

const cad = useOrProvideCadastralCase()

const activeLayouts = computed(() =>
  cad.layouts.value.filter(l => l.status !== 'completed'))

const completed = computed(() =>
  cad.layouts.value.filter(l => l.status === 'completed'))

interface ForwardPlanMap { id: string; label: string; purpose: string; icon: any }
const STANDARD_MAPS: ForwardPlanMap[] = [
  { id:'master-base',   label:'Master Plan base map',
    purpose:'Cadastre + roads + services for the planning area',
    icon: MapPin },
  { id:'master-thematic', label:'Thematic overlays',
    purpose:'Density, infrastructure coverage, sensitive areas',
    icon: Layers },
  { id:'local-plan-base', label:'Local Plan base maps',
    purpose:'Per-ward base for the next 5-year cycle',
    icon: MapPin },
  { id:'subject-plan',  label:'Subject Plan extracts',
    purpose:'Single-issue maps (e.g. CBD revitalisation, river corridor)',
    icon: FileText },
  { id:'dev-brief',     label:'Development brief maps',
    purpose:'Council-owned sites prepared for disposal',
    icon: Building },
  { id:'master-perf',   label:'Performance report maps',
    purpose:'Where development happened vs where the Plan directed',
    icon: FileText },
]
</script>

<template>
  <div class="fp">
    <header class="fp-head">
      <Building :size="14" />
      <h2>Forward planning maps</h2>
      <span class="fp-sub">Base maps · thematic overlays · plan-making support</span>
    </header>

    <section class="fp-card">
      <header><strong>Active layout projects</strong>
        <span class="fp-sub-r">{{ activeLayouts.length }} in progress · {{ completed.length }} completed</span></header>
      <div v-if="!activeLayouts.length" class="fp-empty">No active layouts. Speak to the Surveyor to register one.</div>
      <table v-else class="fp-table">
        <thead><tr><th>Layout</th><th>Parent property</th><th>Ward</th><th>Stands</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="l in activeLayouts" :key="l.id">
            <td><strong>{{ l.layout_name }}</strong></td>
            <td>{{ l.parent_property }}</td>
            <td>{{ l.ward || '—' }}</td>
            <td>{{ l.stands_planned }}</td>
            <td><span class="fp-status" :class="l.status">{{ l.status.replace(/_/g, ' ') }}</span></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="fp-card">
      <header><strong>Standard map deliverables</strong>
        <span class="fp-sub-r">Per Master / Local / Subject Plan cycle</span></header>
      <ul class="fp-deliverables">
        <li v-for="m in STANDARD_MAPS" :key="m.id">
          <component :is="m.icon" :size="13" />
          <div>
            <strong>{{ m.label }}</strong>
            <span>{{ m.purpose }}</span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.fp { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:0.85rem; height:100%; overflow-y:auto; }
.fp-head { display:flex; align-items:center; gap:0.4rem; }
.fp-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.fp-sub { color:#94a3b8; font-size:0.7rem; margin-left:auto; }
.fp-sub-r { color:#94a3b8; font-size:0.65rem; font-weight:400; margin-left:auto; }

.fp-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }
.fp-card > header { display:flex; align-items:center; gap:0.4rem;
  padding:0.55rem 0.85rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;
  font-size:0.75rem; color:#0f172a; }
.fp-empty { padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.72rem; }

.fp-table { width:100%; border-collapse:collapse; font-size:0.7rem; }
.fp-table th, .fp-table td { padding:0.5rem 0.85rem; text-align:left; border-bottom:1px solid #f1f5f9; }
.fp-table th { font-size:0.58rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;
  background:#fafbfc; }
.fp-status { padding:0.15rem 0.45rem; border-radius:0.25rem; font-size:0.55rem;
  font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
  background:#e0e7ff; color:#3730a3; }
.fp-status.completed { background:#dcfce7; color:#166534; }
.fp-status.pre_survey, .fp-status.designed { background:#fef3c7; color:#92400e; }

.fp-deliverables { list-style:none; margin:0; padding:0.5rem; display:flex; flex-direction:column; gap:0.35rem; }
.fp-deliverables li { display:flex; align-items:flex-start; gap:0.55rem;
  padding:0.55rem 0.75rem; border:1px solid #e2e8f0; border-radius:0.35rem; }
.fp-deliverables svg { color:#0e7490; margin-top:0.15rem; }
.fp-deliverables strong { display:block; font-size:0.72rem; color:#0f172a; }
.fp-deliverables span   { display:block; font-size:0.62rem; color:#64748b; margin-top:0.1rem; }
</style>
