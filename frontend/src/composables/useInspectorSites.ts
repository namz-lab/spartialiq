/**
 * Inspection sites for the site map, resolved by the server
 * (GET /api/inspector/sites): permit position, Stands Register boundary or
 * stand-sized cadastre parcel, each with an explicit precision.
 *
 * Not a Pinia workflow board. Failures surface as `error` — they must not look
 * like an empty district.
 */

import { computed, ref, shallowRef } from 'vue'
import {
  inspectorGis,
  type EnforcementPointProps,
  type InspectorSiteLayers,
  type SitePointProps,
} from '@/services/inspectorGis'
import type { InspectorSite } from '@/inspector/architecture'
import { isPositioned } from '@/inspector/siteGeo'

export interface InspectorMapSite extends InspectorSite, Omit<SitePointProps,
  'permitId' | 'ref' | 'title' | 'stand' | 'ward' | 'applicant' | 'developmentType' | 'permitStatus' | 'hasOccupationCertificate'> {
  /** [lng, lat] when the site is positioned (boundary or point precision). */
  center: [number, number] | null
}

export interface EnforcementSite extends EnforcementPointProps {
  center: [number, number] | null
}

const EMPTY_LAYERS: InspectorSiteLayers = {
  points: { type: 'FeatureCollection', features: [] },
  boundaries: { type: 'FeatureCollection', features: [] },
  enforcement: { type: 'FeatureCollection', features: [] },
  unlocated: 0,
}

export function toMapSite(f: InspectorSiteLayers['points']['features'][number]): InspectorMapSite {
  const p = f.properties
  const center = f.geometry && isPositioned(p.precision) ? f.geometry.coordinates : null
  return {
    ...p,
    center,
    lng: center ? center[0] : null,
    lat: center ? center[1] : null,
  }
}

export function useInspectorSites() {
  const layers = shallowRef<InspectorSiteLayers>(EMPTY_LAYERS)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const scope = ref<'inspectable' | 'all'>('inspectable')

  const sites = computed<InspectorMapSite[]>(() => layers.value.points.features.map(toMapSite))
  const enforcement = computed<EnforcementSite[]>(() => layers.value.enforcement.features.map(f => ({
    ...f.properties,
    center: f.geometry ? f.geometry.coordinates : null,
  })))

  const inspectable = computed(() => sites.value.filter(s => !s.hasOccupationCertificate && (
    s.permitStatus === 'approved' || s.permitStatus === 'approved_with_conditions'
  )))
  const occupied = computed(() => sites.value.filter(s => s.hasOccupationCertificate))
  const unpositioned = computed(() => sites.value.filter(s => !s.center))

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      layers.value = await inspectorGis.sites(scope.value)
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { message?: string } } })?.response?.data
      error.value = data?.message || (e instanceof Error ? e.message : 'Inspection sites could not be loaded.')
    } finally {
      loading.value = false
    }
  }

  return { layers, sites, enforcement, inspectable, occupied, unpositioned, loading, error, scope, refresh }
}
