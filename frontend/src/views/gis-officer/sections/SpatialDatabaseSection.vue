<script setup lang="ts">
// Spatial Database — the GIS Officer's registry of every Council-owned
// GIS data layer. CRUD + last-updated tracking. Stale entries surface
// on the Dashboard. Public-tier layers populate the Public GIS Portal.

import { ref, computed, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  useGISOfficerWorkspace, LAYER_CATEGORY_LABELS, GIS_COORD_SYSTEMS,
  type DataLayerRecord, type LayerCategory,
} from '@/composables/useGISOfficerWorkspace'
import { isPositiveNumber, isPersonName, sanitizeInteger } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { getTileLayerCatalog, type TileLayerMeta } from '@/services/vectorTiles'
import { gisOfficerService } from '@/services/gisOfficerService'
import {
  Database, Plus, Search, Trash2, Pencil, Save, X, RefreshCw, AlertTriangle,
} from 'lucide-vue-next'

const gis = useGISOfficerWorkspace()
const fb = useUiFeedback()

const mapEl = ref<HTMLDivElement | null>(null)
const map = shallowRef<maplibregl.Map | null>(null)
const catalog = ref<TileLayerMeta[]>([])
const catalogError = ref('')
const catalogLoading = ref(false)

async function loadCatalog() {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const layers = await getTileLayerCatalog()
    catalog.value = layers
    if (!layers.length) {
      catalogError.value = 'Tile catalog returned no layers. Check that the backend tile service is running.'
    }
  } catch (e: any) {
    catalog.value = []
    catalogError.value = e?.message || 'Could not load the published tile catalog.'
  } finally {
    catalogLoading.value = false
  }
}

function initMap() {
  if (!mapEl.value || map.value) return
  const m = new maplibregl.Map({
    container: mapEl.value,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f2efe9' } }], glyphs: '/fonts/{fontstack}/{range}.pbf' } as any,
    center: gisOfficerService.vunguCenter(),
    zoom: 11,
    attributionControl: false,
  })
  m.addControl(new maplibregl.NavigationControl(), 'top-right')
  m.addControl(new maplibregl.AttributionControl({ compact: true }))
  m.on('load', () => { addVunguBasemap(m); map.value = m })
  m.on('error', (e: any) => {
    const msg = e?.error?.message ?? ''
    if (msg && !/fetch|network|ajax|load|glyph|tile|font|ERR_|unimplemented type/i.test(msg)) {
      catalogError.value = catalogError.value || 'Map failed to load a layer.'
    }
  })
}

onMounted(() => { loadCatalog(); initMap() })
onBeforeUnmount(() => { map.value?.remove(); map.value = null })

const search = ref('')
const categoryFilter = ref<'all' | LayerCategory>('all')

const filtered = computed(() => {
  let arr = gis.layers.value
  if (categoryFilter.value !== 'all') arr = arr.filter(l => l.category === categoryFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) arr = arr.filter(l =>
    l.layer_name.toLowerCase().includes(q) ||
    l.description.toLowerCase().includes(q) ||
    l.source.toLowerCase().includes(q))
  return arr
})

const editing = ref<string | null>(null)
const draft = ref<Omit<DataLayerRecord, 'id' | 'last_updated_at'>>({
  layer_name:'', category:'other', description:'', feature_count:0,
  updated_by:'', source:'', coordinate_system:'Lo31',
  is_public:false, metadata_url:'', notes:'',
})

function startNew() {
  editing.value = 'NEW'
  draft.value = {
    layer_name:'', category:'other', description:'', feature_count:0,
    updated_by:'', source:'', coordinate_system:'Lo31',
    is_public:false, metadata_url:'', notes:'',
  }
}

function startEdit(l: DataLayerRecord) {
  editing.value = l.id
  draft.value = {
    layer_name: l.layer_name, category: l.category, description: l.description,
    feature_count: l.feature_count, updated_by: l.updated_by, source: l.source,
    coordinate_system: l.coordinate_system, is_public: l.is_public,
    metadata_url: l.metadata_url, notes: l.notes,
  }
}

function cancelEdit() { editing.value = null }

function saveDraft() {
  if (draft.value.layer_name.trim().length < 2) {
    fb.showToast('Layer name must be at least 2 characters.', 'warning')
    return
  }
  if (draft.value.updated_by.trim() && !isPersonName(draft.value.updated_by)) {
    fb.showToast('Updated-by must be a person’s name, or left blank.', 'warning')
    return
  }
  const count = sanitizeInteger(String(draft.value.feature_count ?? ''))
  if (count === '' || !isPositiveNumber(count, { integer: true, min: 0 })) {
    fb.showToast('Feature count must be a whole number of 0 or more.', 'warning')
    return
  }
  draft.value.feature_count = Number(count)
  const now = new Date().toISOString()
  if (editing.value === 'NEW') {
    gis.upsertLayer({ ...draft.value, last_updated_at: now })
    fb.showToast('Layer added to registry.', 'success')
  } else if (editing.value) {
    gis.upsertLayer({ id: editing.value, ...draft.value, last_updated_at: now })
    fb.showToast('Layer updated.', 'success')
  }
  editing.value = null
}

async function removeOne(l: DataLayerRecord) {
  const ok = await fb.confirmAction(
    'Remove layer',
    `Remove "${l.layer_name}" from the spatial database registry? Any quality findings for this layer will also be removed.`,
    { confirmLabel:'Remove', danger:true },
  )
  if (!ok) return
  gis.removeLayer(l.id)
  fb.showToast('Layer removed.', 'info')
}

function fmtDate(iso: string|null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

const CATEGORIES = Object.keys(LAYER_CATEGORY_LABELS) as LayerCategory[]
</script>

<template>
  <div class="sdb">
    <header class="sdb-head">
      <Database :size="14" />
      <h2>Spatial database</h2>
      <span class="sdb-sub">{{ gis.layers.value.length }} layer(s) registered</span>
      <button class="sdb-add ghost" @click="loadCatalog" :disabled="catalogLoading">
        <RefreshCw :size="12" :class="{ spin: catalogLoading }" /> Refresh catalog
      </button>
      <button class="sdb-add" @click="startNew">
        <Plus :size="12" /> New layer
      </button>
    </header>

    <div v-if="catalogError" class="sdb-banner" role="alert">
      <AlertTriangle :size="14" />
      <span>{{ catalogError }}</span>
      <button type="button" @click="loadCatalog">Retry</button>
    </div>

    <section class="sdb-map-card">
      <header>
        <strong>Published tile layers</strong>
        <span>{{ catalogLoading ? 'Loading catalog…' : `${catalog.length} layer(s) from PostGIS` }}</span>
      </header>
      <p class="sdb-map-note">
        Toggles change visibility on the preview map. These layers are served by the tile catalog
        and cannot be deleted from this console. Use New layer below to register Council metadata.
      </p>
      <div class="sdb-map-wrap">
        <div ref="mapEl" class="sdb-map"></div>
        <MapLayerFilters :map="map" />
      </div>
    </section>

    <div class="sdb-filters">
      <div class="sdb-search">
        <Search :size="11" />
        <input v-model="search" placeholder="Search layer / source / description…" />
      </div>
      <select v-model="categoryFilter">
        <option value="all">All categories</option>
        <option v-for="c in CATEGORIES" :key="c" :value="c">{{ LAYER_CATEGORY_LABELS[c] }}</option>
      </select>
    </div>

    <div v-if="editing" class="sdb-form">
      <h3>{{ editing === 'NEW' ? 'New layer' : 'Edit layer' }}</h3>
      <div class="sdb-grid">
        <label><span>Layer name *</span><input v-model="draft.layer_name" /></label>
        <label><span>Category</span>
          <select v-model="draft.category">
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ LAYER_CATEGORY_LABELS[c] }}</option>
          </select>
        </label>
        <label><span>Coordinate system</span>
          <select v-model="draft.coordinate_system">
            <option v-for="cs in GIS_COORD_SYSTEMS" :key="cs.code" :value="cs.code">{{ cs.code }}</option>
          </select>
        </label>
        <label><span>Feature count</span><input type="number" min="0" v-model.number="draft.feature_count" /></label>
        <label><span>Updated by</span><input v-model="draft.updated_by" /></label>
        <label><span>Source</span><input v-model="draft.source" placeholder="e.g. EMA shapefile, in-house surveyor, OSM" /></label>
        <label class="full"><span>Description</span><input v-model="draft.description" /></label>
        <label class="full"><span>Metadata URL</span><input v-model="draft.metadata_url" placeholder="https://…" /></label>
        <label class="check"><input type="checkbox" v-model="draft.is_public" /> <span>Publish to public GIS portal</span></label>
        <label class="full"><span>Notes</span><textarea v-model="draft.notes" rows="2"></textarea></label>
      </div>
      <div class="sdb-form-actions">
        <button class="sdb-btn ghost" @click="cancelEdit"><X :size="11" /> Cancel</button>
        <button class="sdb-btn primary" @click="saveDraft"><Save :size="11" /> Save</button>
      </div>
    </div>

    <table class="sdb-table">
      <thead>
        <tr><th>Layer</th><th>Category</th><th>CRS</th><th>Source</th><th>Updated</th><th>Public</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="l in filtered" :key="l.id">
          <td>
            <strong>{{ l.layer_name }}</strong>
            <span class="sdb-desc">{{ l.description }}</span>
          </td>
          <td class="sdb-cat">{{ LAYER_CATEGORY_LABELS[l.category] }}</td>
          <td class="sdb-crs">{{ l.coordinate_system }}</td>
          <td class="sdb-src">{{ l.source }}</td>
          <td class="sdb-date">{{ fmtDate(l.last_updated_at) }}<br><small>{{ l.updated_by || '—' }}</small></td>
          <td><span class="sdb-pub" :class="{ on: l.is_public }">{{ l.is_public ? 'Public' : 'Internal' }}</span></td>
          <td class="sdb-actions">
            <button class="sdb-btn small ghost" @click="startEdit(l)" title="Edit">
              <Pencil :size="11" />
            </button>
            <button class="sdb-btn small red-ghost" @click="removeOne(l)" title="Remove">
              <Trash2 :size="11" />
            </button>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="7" class="sdb-empty">No layers match the filter.</td>
        </tr>
      </tbody>
    </table>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.sdb { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:0.85rem; height:100%; overflow-y:auto; }
.sdb-head { display:flex; align-items:center; gap:0.4rem; }
.sdb-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.sdb-sub { color:#94a3b8; font-size:0.7rem; }
.sdb-add { margin-left:auto; display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.4rem 0.7rem; background:#0e7490; color:#fff; border:none;
  border-radius:0.35rem; font-size:0.7rem; font-weight:600; cursor:pointer; }
.sdb-add:hover { background:#155e75; }
.sdb-add.ghost { margin-left:0.4rem; background:#fff; color:#475569; border:1px solid #e2e8f0; }
.sdb-add.ghost:hover { background:#f8fafc; }
.sdb-add:disabled { opacity:0.6; cursor:not-allowed; }
.spin { animation: sdbspin 0.8s linear infinite; }
@keyframes sdbspin { to { transform: rotate(360deg); } }

.sdb-banner { display:flex; align-items:center; gap:0.5rem; padding:0.55rem 0.75rem;
  background:#fef3c7; color:#92400e; border:1px solid #fde68a; border-radius:0.4rem;
  font-size:0.75rem; }
.sdb-banner button { margin-left:auto; background:#fff; border:1px solid #fde68a;
  border-radius:0.3rem; padding:0.25rem 0.55rem; font-size:0.7rem; cursor:pointer; color:#92400e; }

.sdb-map-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }
.sdb-map-card > header { display:flex; align-items:center; gap:0.5rem;
  padding:0.55rem 0.85rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;
  font-size:0.75rem; }
.sdb-map-card > header span { margin-left:auto; color:#94a3b8; font-size:0.65rem; }
.sdb-map-note { margin:0; padding:0.5rem 0.85rem; font-size:0.68rem; color:#64748b; line-height:1.45; }
.sdb-map-wrap { position:relative; height:18rem; }
.sdb-map { width:100%; height:100%; }

.sdb-filters { display:flex; align-items:center; gap:0.45rem; }
.sdb-search { display:flex; align-items:center; gap:0.3rem; flex:1;
  padding:0.35rem 0.55rem; background:#fff; border:1px solid #e2e8f0; border-radius:0.3rem; }
.sdb-search input { flex:1; border:none; outline:none; font-size:0.72rem; }
.sdb-filters select { padding:0.4rem 0.55rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  font-size:0.72rem; background:#fff; }

.sdb-form { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; padding:0.85rem 1rem; }
.sdb-form h3 { margin:0 0 0.55rem; font-size:0.78rem; color:#0e7490; }
.sdb-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.45rem; }
.sdb-grid label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.62rem; color:#64748b; }
.sdb-grid label.full { grid-column:1 / -1; }
.sdb-grid label.check { display:flex; flex-direction:row; align-items:center; gap:0.4rem; font-size:0.7rem; }
.sdb-grid input, .sdb-grid select, .sdb-grid textarea {
  padding:0.4rem 0.55rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  font-size:0.72rem; color:#0f172a; font-family:inherit; resize:vertical; }
.sdb-form-actions { display:flex; justify-content:flex-end; gap:0.4rem; margin-top:0.6rem; }

.sdb-table { width:100%; border-collapse:collapse; background:#fff;
  border:1px solid #e2e8f0; border-radius:0.4rem; overflow:hidden; font-size:0.7rem; }
.sdb-table th, .sdb-table td { padding:0.5rem 0.75rem; text-align:left; border-bottom:1px solid #f1f5f9;
  vertical-align:top; }
.sdb-table th { font-size:0.58rem; color:#94a3b8; text-transform:uppercase;
  letter-spacing:0.04em; background:#f8fafc; }
.sdb-table strong { display:block; color:#0f172a; }
.sdb-desc { display:block; font-size:0.6rem; color:#94a3b8; margin-top:0.1rem; }
.sdb-cat  { color:#475569; }
.sdb-crs  { font-family: ui-monospace, monospace; color:#0e7490; font-weight:600; }
.sdb-src  { color:#64748b; font-size:0.65rem; }
.sdb-date { color:#94a3b8; font-size:0.62rem; }
.sdb-date small { color:#cbd5e1; }
.sdb-pub { padding:0.15rem 0.4rem; border-radius:0.25rem; font-size:0.55rem; font-weight:700;
  text-transform:uppercase; background:#f1f5f9; color:#64748b; }
.sdb-pub.on { background:#dcfce7; color:#166534; }
.sdb-actions { white-space:nowrap; }
.sdb-empty { text-align:center; color:#94a3b8; padding:1.5rem; }

.sdb-btn { display:inline-flex; align-items:center; gap:0.25rem;
  padding:0.4rem 0.7rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; color:#475569; font-size:0.66rem; font-weight:600; cursor:pointer; }
.sdb-btn.small { padding:0.3rem 0.4rem; }
.sdb-btn.primary { background:#0e7490; color:#fff; border-color:#0e7490; }
.sdb-btn.primary:hover { background:#155e75; }
.sdb-btn.ghost   { background:#fff; }
.sdb-btn.red-ghost { color:#dc2626; border-color:#fecaca; }
.sdb-btn.red-ghost:hover { background:#fee2e2; }
</style>
