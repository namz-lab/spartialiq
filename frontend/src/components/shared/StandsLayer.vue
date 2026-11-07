<template>
  <!--
    Headless component — renders nothing in the DOM. Its job is to attach
    a 'stands' source + layers to the host MapLibre instance and emit
    `select` when the citizen clicks a stand.

    Usage:
      <StandsLayer
        :map="mapInstance"
        :statuses="['available']"
        @select="onStandClicked"
      />
  -->
  <span aria-hidden="true" class="sr-only" data-stands-layer></span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch, type PropType } from 'vue'
import type maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { standsService, type StandFeature, type StandStatus } from '../../services/standsService'

const props = defineProps({
  map: {
    type: Object as PropType<MapLibreMap | null>,
    default: null,
  },
  statuses: {
    type: Array as PropType<StandStatus[]>,
    default: () => ['available'] as StandStatus[],
  },
  ward: { type: String, default: '' },
})

const emit = defineEmits<{
  (e: 'select', feature: StandFeature): void
  (e: 'error',  err: unknown): void
  (e: 'loaded', count: number): void
}>()

// Not `vungu-stands`: that id belongs to the basemap's `stands` tile layer
// (vunguBasemap names every source `vungu-<layer>`), and whichever map code
// registered first made the other's source/layers fail on the same page.
const SOURCE_ID  = 'register-stands'
const FILL_ID    = 'register-stands-fill'
const LINE_ID    = 'register-stands-line'
const HALO_ID    = 'register-stands-halo'
const LABEL_ID   = 'register-stands-label'

async function refresh(map: MapLibreMap) {
  try {
    const data = await standsService.list({
      status: props.statuses,
      ward: props.ward || undefined,
    })
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(data as GeoJSON.FeatureCollection)
    } else {
      attach(map, data as GeoJSON.FeatureCollection)
    }
    emit('loaded', data.features.length)
  } catch (err) {
    emit('error', err)
  }
}

function attach(map: MapLibreMap, data: GeoJSON.FeatureCollection) {
  if (map.getLayer(FILL_ID)) return
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data,
    promoteId: 'id',
  })

  // Status-driven colours. Sober ink palette — emerald accent for
  // available, neutral grey for reserved, charcoal for allocated.
  const fillColor: maplibregl.DataDrivenPropertyValueSpecification<string> = [
    'match',
    ['get', 'status'],
    'available', '#1e6b4a',
    'reserved',  '#b54708',
    'allocated', '#5b6473',
    'withdrawn', '#c0c6d1',
    /* default */ '#8e96a4',
  ]

  map.addLayer({
    id: HALO_ID,
    type: 'circle',
    source: SOURCE_ID,
    minzoom: 9,
    maxzoom: 13,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        9, 3, 13, 8,
      ],
      'circle-color': fillColor,
      'circle-opacity': 0.85,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#0b1220',
    },
  })

  map.addLayer({
    id: FILL_ID,
    type: 'fill',
    source: SOURCE_ID,
    minzoom: 13,
    paint: {
      'fill-color': fillColor,
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 0.55,
        0.30,
      ],
    },
  })

  map.addLayer({
    id: LINE_ID,
    type: 'line',
    source: SOURCE_ID,
    minzoom: 13,
    paint: {
      'line-color': '#0b1220',
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 2,
        1,
      ],
    },
  })

  // Stand number + status label — appears at zoom 14+ so the polygon is
  // large enough to contain the text without overlap.
  map.addLayer({
    id: LABEL_ID,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 14,
    layout: {
      'text-field': [
        'concat',
        ['get', 'standNumber'],
        '\n',
        ['get', 'status'],
      ],
      'text-size': 10,
      'text-anchor': 'center',
      'text-max-width': 7,
      'text-allow-overlap': false,
      'text-optional': true,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#111827',
      'text-halo-color': 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.2,
    },
  })

  // Click → emit the feature so the host shows a properties panel.
  const onClick = (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    const f = e.features?.[0]
    if (f) emit('select', f as unknown as StandFeature)
  }
  map.on('click', FILL_ID, onClick)
  map.on('click', HALO_ID, onClick)

  // Hover affordance.
  let hoverId: string | number | null = null
  const setHover = (id: string | number | null) => {
    if (hoverId !== null) {
      map.setFeatureState({ source: SOURCE_ID, id: hoverId }, { hover: false })
    }
    hoverId = id
    if (hoverId !== null) {
      map.setFeatureState({ source: SOURCE_ID, id: hoverId }, { hover: true })
    }
  }
  map.on('mousemove', FILL_ID, (e) => {
    const f = e.features?.[0]
    if (f && f.id != null) setHover(f.id as string | number)
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', FILL_ID, () => {
    setHover(null)
    map.getCanvas().style.cursor = ''
  })
  map.on('mouseenter', HALO_ID, () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', HALO_ID, () => { map.getCanvas().style.cursor = '' })
}

function detach(map: MapLibreMap) {
  for (const id of [LABEL_ID, LINE_ID, FILL_ID, HALO_ID]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}

watch(
  () => props.map,
  (map) => {
    if (!map) return
    if (map.loaded()) {
      refresh(map)
    } else {
      map.once('load', () => refresh(map))
    }
  },
  { immediate: true },
)

watch(
  () => [props.statuses?.join(','), props.ward],
  () => { if (props.map) refresh(props.map) },
)

onBeforeUnmount(() => {
  if (props.map && props.map.getLayer(FILL_ID)) detach(props.map)
})

defineExpose({ refresh: () => props.map && refresh(props.map) })
</script>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
