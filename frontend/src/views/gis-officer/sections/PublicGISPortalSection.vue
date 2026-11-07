<script setup lang="ts">
// Public GIS Portal — operator preview of the public-facing portion of
// the spatial database. Lists every layer flagged is_public on the
// registry, plus a deep-link to the citizen-side map.

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useGISOfficerWorkspace, LAYER_CATEGORY_LABELS } from '@/composables/useGISOfficerWorkspace'
import {
  Eye, ExternalLink, Globe,
} from 'lucide-vue-next'

const router = useRouter()
const gis = useGISOfficerWorkspace()

const publicLayers = computed(() => gis.layers.value.filter(l => l.is_public))
const internalLayers = computed(() => gis.layers.value.filter(l => !l.is_public))

function fmtDate(iso: string|null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}
</script>

<template>
  <div class="pp">
    <header class="pp-head">
      <Eye :size="14" />
      <h2>Public GIS portal</h2>
      <span class="pp-sub">What citizens see · access tier audit</span>
      <button class="pp-btn primary" @click="router.push('/citizen')">
        <ExternalLink :size="11" /> Open citizen view
      </button>
    </header>

    <section class="pp-card">
      <header><Globe :size="13" /><strong>Published layers</strong>
        <span class="pp-sub-r">{{ publicLayers.length }} of {{ gis.layers.value.length }} layers public</span></header>
      <div v-if="!publicLayers.length" class="pp-empty">
        No layers are published to the public portal yet. Toggle "Publish to public GIS portal" on individual layers in the Spatial Database section.
      </div>
      <table v-else class="pp-table">
        <thead><tr><th>Layer</th><th>Category</th><th>CRS</th><th>Source</th><th>Last updated</th></tr></thead>
        <tbody>
          <tr v-for="l in publicLayers" :key="l.id">
            <td><strong>{{ l.layer_name }}</strong>
              <span class="pp-desc">{{ l.description }}</span>
            </td>
            <td>{{ LAYER_CATEGORY_LABELS[l.category] }}</td>
            <td class="pp-crs">{{ l.coordinate_system }}</td>
            <td class="pp-src">{{ l.source }}</td>
            <td class="pp-date">{{ fmtDate(l.last_updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="pp-card">
      <header><strong>Internal-only layers</strong>
        <span class="pp-sub-r">{{ internalLayers.length }} layers withheld from public</span></header>
      <ul class="pp-internal">
        <li v-for="l in internalLayers" :key="l.id">
          <span class="pp-name">{{ l.layer_name }}</span>
          <span class="pp-cat">{{ LAYER_CATEGORY_LABELS[l.category] }}</span>
          <span class="pp-reason">internal</span>
        </li>
        <li v-if="!internalLayers.length" class="pp-empty-inner">All layers are public.</li>
      </ul>
    </section>

    <section class="pp-card">
      <header><strong>Public access — checklist</strong></header>
      <ul class="pp-check">
        <li>Layers tagged <code>is_public: true</code> appear on the citizen Map &amp; Discover tab.</li>
        <li>Sensitive layers (cadastral, sewer, electricity routes) are withheld by default.</li>
        <li>The citizen view does not surface applicant identities — only stand &amp; status.</li>
        <li>Coordinate-system mismatch with the citizen basemap is auto-handled by MapLibre.</li>
        <li>Watch the Data Quality section for stale layers before promoting them to public.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.pp { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:0.85rem; height:100%; overflow-y:auto; }
.pp-head { display:flex; align-items:center; gap:0.4rem; }
.pp-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.pp-sub { color:#94a3b8; font-size:0.7rem; }
.pp-sub-r { color:#94a3b8; font-size:0.65rem; font-weight:400; margin-left:auto; }
.pp-btn { margin-left:auto; display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.4rem 0.7rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; color:#475569; font-size:0.65rem; font-weight:600; cursor:pointer; }
.pp-btn.primary { background:#0e7490; color:#fff; border-color:#0e7490; }
.pp-btn.primary:hover { background:#155e75; }

.pp-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }
.pp-card > header { display:flex; align-items:center; gap:0.4rem;
  padding:0.55rem 0.85rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;
  font-size:0.75rem; color:#0f172a; }
.pp-empty, .pp-empty-inner { padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.72rem; }
.pp-empty-inner { padding:0.65rem; }

.pp-table { width:100%; border-collapse:collapse; font-size:0.7rem; }
.pp-table th, .pp-table td { padding:0.5rem 0.85rem; text-align:left; border-bottom:1px solid #f1f5f9;
  vertical-align:top; }
.pp-table th { font-size:0.58rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;
  background:#fafbfc; }
.pp-table strong { display:block; color:#0f172a; }
.pp-desc { display:block; font-size:0.6rem; color:#94a3b8; margin-top:0.1rem; }
.pp-crs  { font-family: ui-monospace, monospace; color:#0e7490; font-weight:600; }
.pp-src  { color:#64748b; font-size:0.65rem; }
.pp-date { color:#94a3b8; font-size:0.62rem; }

.pp-internal { list-style:none; margin:0; padding:0.4rem; display:flex; flex-direction:column; gap:0.25rem; }
.pp-internal li { display:grid; grid-template-columns:1fr 1fr 6rem; gap:0.5rem;
  padding:0.4rem 0.65rem; border:1px solid #e2e8f0; border-radius:0.3rem; font-size:0.68rem; }
.pp-name { color:#0f172a; font-weight:600; }
.pp-cat  { color:#475569; }
.pp-reason { padding:0.15rem 0.45rem; border-radius:0.25rem; background:#f1f5f9; color:#64748b;
  font-size:0.55rem; font-weight:700; text-transform:uppercase; text-align:center; }

.pp-check { list-style:disc; padding:0.5rem 0.5rem 0.65rem 2rem; margin:0; color:#475569; font-size:0.7rem; line-height:1.7; }
.pp-check code { font-family: ui-monospace, monospace; background:#e0f2fe; color:#0c4a6e;
  padding:0 0.25rem; border-radius:0.2rem; font-size:0.62rem; }
</style>
