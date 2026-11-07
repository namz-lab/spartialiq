<script setup lang="ts">
// GIS Officer Dashboard — pending map requests, layers that are stale,
// data-quality score, and quick-action shortcuts.

import { ref, computed, onMounted } from 'vue'
import { useGISOfficerWorkspace } from '@/composables/useGISOfficerWorkspace'
import { gisOfficerService } from '@/services/gisOfficerService'
import {
  Globe, Database, MapPin, Users, ShieldAlert, Eye, BarChart3,
  AlertTriangle, Clock, Trees, Send,
} from 'lucide-vue-next'

const emit = defineEmits<{
  'open-section': [key: 'spatial_db'|'app_mapping'|'referrals'|'abutting_owners'|'zoning'|'environmental'|'enforcement'|'forward_planning'|'public_portal'|'data_quality']
}>()
const gis = useGISOfficerWorkspace()

const dmCounts = ref<{ permits: number; enforcement: number }>({ permits: 0, enforcement: 0 })
const loading = ref(true)

async function refresh() {
  loading.value = true
  try {
    dmCounts.value = await gisOfficerService.aggregateCounts()
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const pending = computed(() => gis.pendingRequests.value.slice(0, 6))
const stale   = computed(() => gis.staleLayers.value.slice(0, 6))
const openQuality = computed(() =>
  gis.qualityLog.value.filter(q => !q.resolved_at).slice(0, 5))

function fmtDate(iso: string|null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
</script>

<template>
  <div class="gisd">
    <header class="gisd-head">
      <Globe :size="14" />
      <h2>GIS workload</h2>
      <span class="gisd-sub" v-if="loading">Refreshing…</span>
    </header>

    <p class="gisd-summary">
      {{ gis.layers.value.length }} layers on the register
      · {{ gis.staleLayers.value.length }} stale
      · {{ dmCounts.permits }} permit pins
      · {{ dmCounts.enforcement }} enforcement pins
      · quality score {{ gis.dataQualityScore.value }}.
    </p>

    <div class="gisd-grid">
      <section class="gisd-card">
        <header><Clock :size="13" /><strong>Pending map requests</strong>
          <span class="gisd-sub-r">{{ gis.pendingRequests.value.length }} open</span></header>
        <div v-if="!pending.length" class="gisd-empty">
          No outstanding map requests. New ones appear when a planner or EO asks for an extract.
        </div>
        <ul v-else class="gisd-list">
          <li v-for="r in pending" :key="r.id">
            <span class="gisd-rtype">{{ r.request_type.replace(/_/g, ' ') }}</span>
            <span class="gisd-rby">{{ r.requested_by }}</span>
            <span class="gisd-rstand">Stand {{ r.stand_number || '—' }}</span>
            <span class="gisd-rdate">requested {{ fmtDate(r.requested_at) }}</span>
            <span class="gisd-rstatus" :class="r.status">{{ r.status.replace(/_/g, ' ') }}</span>
          </li>
        </ul>
      </section>

      <section class="gisd-card">
        <header><AlertTriangle :size="13" /><strong>Stale layers</strong>
          <span class="gisd-sub-r">no update in 180+ days</span></header>
        <div v-if="!stale.length" class="gisd-empty">All registered layers have been updated within 180 days.</div>
        <ul v-else class="gisd-list">
          <li v-for="l in stale" :key="l.id">
            <span class="gisd-lname">{{ l.layer_name }}</span>
            <span class="gisd-lcat">{{ l.category.replace(/_/g, ' ') }}</span>
            <span class="gisd-llast">{{ daysSince(l.last_updated_at) }} d ago</span>
          </li>
        </ul>
      </section>

      <section class="gisd-card">
        <header><BarChart3 :size="13" /><strong>Open quality findings</strong></header>
        <div v-if="!openQuality.length" class="gisd-empty">No open quality findings. Run a check from Data quality when a layer looks stale.</div>
        <ul v-else class="gisd-list">
          <li v-for="q in openQuality" :key="q.id">
            <span class="gisd-qres" :class="q.result">{{ q.result }}</span>
            <span class="gisd-qtype">{{ q.check_type.replace(/_/g, ' ') }}</span>
            <span class="gisd-qfind">{{ q.finding }}</span>
            <span class="gisd-qdate">{{ fmtDate(q.checked_at) }}</span>
          </li>
        </ul>
      </section>

      <section class="gisd-card">
        <header><strong>Common actions</strong></header>
        <div class="gisd-quick">
          <button class="gisd-qbtn" @click="emit('open-section','app_mapping')">
            <MapPin :size="13" />
            <div><strong>Map a permit</strong>
              <span>Locate by stand · status overlay</span></div>
          </button>
          <button class="gisd-qbtn" @click="emit('open-section','referrals')">
            <Send :size="13" />
            <div><strong>Answer a GIS referral</strong>
              <span>Close the planner's technical-circulation request</span></div>
          </button>
          <button class="gisd-qbtn" @click="emit('open-section','abutting_owners')">
            <Users :size="13" />
            <div><strong>List abutting owners</strong>
              <span>For Sec 26(3) public notification</span></div>
          </button>
          <button class="gisd-qbtn" @click="emit('open-section','zoning')">
            <Globe :size="13" />
            <div><strong>Zoning map</strong>
              <span>Overlay · zone editor · public extract</span></div>
          </button>
          <button class="gisd-qbtn" @click="emit('open-section','environmental')">
            <Trees :size="13" />
            <div><strong>Environmental check</strong>
              <span>Wetlands · watercourses · sensitive areas</span></div>
          </button>
          <button class="gisd-qbtn" @click="emit('open-section','public_portal')">
            <Eye :size="13" />
            <div><strong>Public GIS portal</strong>
              <span>Preview citizen view · access logs</span></div>
          </button>
          <button class="gisd-qbtn" @click="emit('open-section','data_quality')">
            <BarChart3 :size="13" />
            <div><strong>Run quality check</strong>
              <span>Metadata · staleness · CRS · backup</span></div>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.gisd { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:1rem; }
.gisd-head { display:flex; align-items:center; gap:0.4rem; }
.gisd-head h2 { margin:0; font-size:1rem; font-weight:700; }
.gisd-sub { color:#5a5a5a; font-size:0.7rem; margin-left:auto; }
.gisd-sub-r { color:#5a5a5a; font-size:0.65rem; font-weight:400; margin-left:auto; }

.gisd-summary { margin:0; font-size:0.82rem; color:var(--ent-text-2, #475569); line-height:1.45; }

.gisd-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:0.75rem; }
.gisd-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }
.gisd-card > header { display:flex; align-items:center; gap:0.4rem;
  padding:0.55rem 0.85rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;
  font-size:0.78rem; color:#0f172a; }
.gisd-empty { padding:1.5rem; color:#5a5a5a; font-size:0.78rem; text-align:center; }

.gisd-list { list-style:none; margin:0; padding:0; }
.gisd-list li { padding:0.5rem 0.85rem; border-top:1px solid #f1f5f9; font-size:0.68rem;
  display:flex; gap:0.45rem; align-items:center; flex-wrap:wrap; }
.gisd-rtype { color:#0e7490; font-weight:600; text-transform:capitalize; }
.gisd-rby   { color:#475569; }
.gisd-rstand{ color:#475569; font-size:0.62rem; }
.gisd-rdate { color:#5a5a5a; font-size:0.6rem; }
.gisd-rstatus { margin-left:auto; padding:0.15rem 0.4rem; border-radius:0.25rem; font-size:0.55rem;
  font-weight:700; text-transform:uppercase; letter-spacing:0.04em; background:#e0f2fe; color:#075985; }
.gisd-rstatus.pending     { background:#fef3c7; color:#92400e; }
.gisd-rstatus.in_progress { background:#dbeafe; color:#1e40af; }
.gisd-rstatus.completed   { background:#dcfce7; color:#166534; }

.gisd-lname { font-weight:600; color:#0f172a; flex:1; }
.gisd-lcat  { color:#475569; font-size:0.62rem; text-transform:capitalize; }
.gisd-llast { color:#b45309; font-size:0.62rem; font-weight:600; }

.gisd-qres { padding:0.15rem 0.4rem; border-radius:0.25rem; font-size:0.55rem;
  font-weight:700; text-transform:uppercase; background:#f1f5f9; color:#64748b; }
.gisd-qres.fail { background:#fee2e2; color:#991b1b; }
.gisd-qres.warn { background:#fef3c7; color:#92400e; }
.gisd-qres.pass { background:#dcfce7; color:#166534; }
.gisd-qtype { color:#475569; text-transform:capitalize; }
.gisd-qfind { flex:1; color:#0f172a; }
.gisd-qdate { color:#5a5a5a; font-size:0.6rem; }

.gisd-quick { padding:0.5rem; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.4rem; }
.gisd-qbtn { display:flex; align-items:flex-start; gap:0.6rem;
  padding:0.55rem 0.7rem; background:#fff; border:1px solid #e2e8f0;
  border-radius:0.4rem; text-align:left; cursor:pointer; color:#0f172a; font-size:0.72rem; }
.gisd-qbtn:hover { background:var(--ent-accent-soft, #e8f0fe); border-color:var(--ent-accent-line, #c5d8f7); }
.gisd-qbtn strong { display:block; font-size:0.74rem; font-weight:600; }
.gisd-qbtn span   { display:block; font-size:0.62rem; color:#64748b; margin-top:0.1rem; }
</style>
