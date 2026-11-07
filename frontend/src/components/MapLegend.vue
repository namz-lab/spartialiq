<script setup lang="ts">
// Collapsible map key / legend. Explains the cartographic colours the map uses
// — the statutory road hierarchy, zoning scale and land-tenure categories
// (whose colours aren't self-evident) plus a few basemap basics.
//
// EVERY colour here resolves from the enterprise GIS symbology registry, the
// same published style the map paints from, so the key cannot drift from the
// map. This component defines no colour of its own; the only cartographic
// literals it holds are LABELS, which are legend copy rather than symbology.
import { ref, computed, onMounted } from 'vue'
import { Map as MapIcon, X } from 'lucide-vue-next'
import {
  chipColorFor,
  classificationColorsFor,
  loadPublishedSymbology,
} from '@/map/vunguBasemapStyle'

const open = ref(false)

// Colours arrive asynchronously from the registry, so everything below is
// computed off this counter rather than evaluated once at setup — otherwise the
// legend would render before any style resolved and show only fallbacks.
const symbologyReady = ref(0)
onMounted(async () => {
  await loadPublishedSymbology()
  symbologyReady.value++
})

/**
 * Statutory road hierarchy. The registry classifies roads by the 25 OSM
 * `fclass` values; the schedule groups those into six named classes. The names
 * are legend copy; the colours come from the registry via a representative
 * fclass per class. "Proposed street / widening" is a planning class with no
 * OSM equivalent, so it appears only once the council digitises it.
 */
const ROAD_CLASS_LABELS: Array<{ label: string; fclass: string }> = [
  { label: 'National road',        fclass: 'motorway' },
  { label: 'Primary distributor',  fclass: 'primary' },
  { label: 'District distributor', fclass: 'secondary' },
  { label: 'Local distributor',    fclass: 'tertiary' },
  { label: 'Access road',          fclass: 'residential' },
]

const roadEntries = computed(() => {
  void symbologyReady.value
  const byFclass = classificationColorsFor('roads')
  return ROAD_CLASS_LABELS
    .map(({ label, fclass }) => ({ label, color: byFclass[fclass] }))
    .filter((e): e is { label: string; color: string } => Boolean(e.color))
})

// Basemap basics — through chipColorFor so they match the map paint exactly.
const basemap = computed<Array<{ label: string; color: string; shape?: 'line' | 'dot' }>>(() => {
  void symbologyReady.value
  return [
    { label: 'Water',         color: chipColorFor('water_areas', 'polygon') },
    { label: 'Railway',       color: chipColorFor('railways', 'line'), shape: 'line' },
    { label: 'Buildings',     color: chipColorFor('buildings', 'polygon') },
    { label: 'Farm cadastre', color: chipColorFor('vungu_farm_cadastre', 'polygon') },
    { label: 'Parcels',       color: chipColorFor('vungu_parcels', 'polygon') },
    { label: 'Cemeteries',    color: chipColorFor('vungu_cemeteries', 'polygon') },
  ]
})

const zoneEntries = computed(() => {
  void symbologyReady.value
  return Object.entries(classificationColorsFor('vungu_proposed_peri_urban_zones'))
})
const tenureEntries = computed(() => {
  void symbologyReady.value
  return Object.entries(classificationColorsFor('vungu_beyond_peri_urban_zones'))
})

// FLSCF/A1/A2/SSCF are terse tenure codes — expand them in the key.
const TENURE_LABELS: Record<string, string> = {
  Communal: 'Communal land',
  FLSCF: 'Former large-scale commercial farm',
  FLSCF_A2: 'A2 resettlement (commercial)',
  FLSCF_SSCF_A1: 'A1 resettlement (villagised)',
  'Resettlement Area': 'Resettlement area',
  SSCF: 'Small-scale commercial farm',
}
</script>

<template>
  <div class="legend" :class="{ open }">
    <button v-if="!open" class="legend-fab" @click="open = true" title="Show map key">
      <MapIcon :size="15" /><span>Legend</span>
    </button>

    <div v-else class="legend-panel">
      <header class="legend-head">
        <span class="legend-title"><MapIcon :size="14" /> Map key</span>
        <button class="legend-close" @click="open = false" title="Hide"><X :size="14" /></button>
      </header>

      <div class="legend-body">
        <section class="legend-section">
          <h4 class="legend-h">Roads (masterplan standard)</h4>
          <div v-for="r in roadEntries" :key="r.label" class="legend-row">
            <span class="legend-swatch is-line" :style="{ background: r.color }"></span>
            <span class="legend-label">{{ r.label }}</span>
          </div>
        </section>

        <section class="legend-section">
          <h4 class="legend-h">Basemap</h4>
          <div v-for="b in basemap" :key="b.label" class="legend-row">
            <span class="legend-swatch"
              :class="b.shape === 'line' ? 'is-line' : ''"
              :style="{ background: b.color }"></span>
            <span class="legend-label">{{ b.label }}</span>
          </div>
        </section>

        <section class="legend-section">
          <h4 class="legend-h">Proposed peri-urban zones</h4>
          <div v-for="[name, color] in zoneEntries" :key="name" class="legend-row">
            <span class="legend-swatch" :style="{ background: color }"></span>
            <span class="legend-label">{{ name }}</span>
          </div>
        </section>

        <section class="legend-section">
          <h4 class="legend-h">Land tenure (beyond peri-urban)</h4>
          <div v-for="[name, color] in tenureEntries" :key="name" class="legend-row">
            <span class="legend-swatch" :style="{ background: color }"></span>
            <span class="legend-label">{{ TENURE_LABELS[name] || name }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

.legend-fab {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.7rem; border: none; border-radius: 9999px;
  background: #fff; color: #202124; cursor: pointer;
  font-size: 0.75rem; font-weight: 600;
  box-shadow: 0 1px 6px rgba(32,33,36,0.18);
}
.legend-fab:hover { background: #f8fafc; }

.legend-panel {
  width: 16rem; max-height: 60vh; display: flex; flex-direction: column;
  background: #fff; border-radius: 0.75rem;
  box-shadow: 0 2px 12px rgba(32,33,36,0.28);
  overflow: hidden;
}
.legend-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.75rem; border-bottom: 1px solid #eef0f2; flex-shrink: 0;
}
.legend-title { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 700; color: #202124; }
.legend-close { display: flex; border: none; background: none; color: #5f6368; cursor: pointer; padding: 0.15rem; border-radius: 50%; }
.legend-close:hover { background: #f1f3f4; color: #202124; }

.legend-body { overflow-y: auto; padding: 0.5rem 0.75rem 0.75rem; }
.legend-section + .legend-section { margin-top: 0.7rem; }
.legend-h {
  margin: 0 0 0.35rem; font-size: 0.6875rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em; color: #5f6368;
}
.legend-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.12rem 0; }
.legend-swatch {
  flex-shrink: 0; width: 0.9rem; height: 0.9rem; border-radius: 3px;
  border: 1px solid rgba(0,0,0,0.15);
}
.legend-swatch.is-line { height: 0.28rem; border-radius: 2px; }
.legend-label { font-size: 0.75rem; color: #3c4043; line-height: 1.25; }
</style>
