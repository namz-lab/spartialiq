/**
 * The district figures the public landing page publishes.
 *
 * These used to be typed into the template — "19 Wards", "609,588 ha",
 * "1,521 km Roads" — which meant the home page of a spatial data portal was
 * the one screen in the building that could not tell you what the spatial
 * data actually said. They now come from PostGIS via
 * `GET /api/public/district-overview`, so a ward added to `public.wards`
 * changes the number on the home page and nothing else has to be edited.
 *
 * Every figure is independently nullable. The backend computes each one in
 * its own statement so a table missing in a given environment yields null for
 * that tile alone; a null renders as an em dash, never as a zero. A council
 * with "0 roads" on its front page is worse than a council with no figure.
 */
import { ref, computed, readonly } from 'vue'
import api from './api'

/** Keys the backend answers with. Order here is the order they are shown. */
export const FIGURE_KEYS = [
  'wards', 'hectares', 'roadKm', 'buildings',
  'parcels', 'farms', 'planningZones', 'waterBodies', 'settlements',
] as const

export type FigureKey = (typeof FIGURE_KEYS)[number]

export interface DistrictOverview {
  district: { name: string; province: string; pcode: string }
  /** ISO timestamp the figures were computed (the backend caches for 6h). */
  asOf: string
  figures: Partial<Record<FigureKey, number | null>>
}

function isOverview(value: unknown): value is DistrictOverview {
  const v = value as DistrictOverview | null
  return !!v && typeof v === 'object' && !!v.figures && typeof v.figures === 'object'
}

// ── Shared module state ────────────────────────────────────────────────
// Home, About and the map preview all want these numbers and the query
// behind them is a five-second PostGIS scan the server caches for six
// hours. Holding the result here means one request per browser session
// however many components ask, and a component mounted a second time
// (a back-navigation) renders from memory instead of flashing skeletons.

const overview = ref<DistrictOverview | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await api.get('/public/district-overview')
    if (!isOverview(res.data)) throw new Error('malformed')
    overview.value = res.data
  } catch (err) {
    // The figures are decoration around a working page, so a failure here
    // must not read as a broken site. The message says what is missing and
    // offers the retry; the rest of the landing page is unaffected.
    const status = (err as { response?: { status?: number } })?.response?.status
    error.value =
      status === 503
        ? 'District figures are still being calculated. Try again in a moment.'
        : 'Live district figures are unavailable right now.'
  } finally {
    loading.value = false
    inFlight = null
  }
}

/**
 * Fetch once per session. Repeat calls while a request is in flight join it
 * rather than starting a second one — three components mounting together is
 * the normal case, not an edge case.
 */
export function useDistrictOverview() {
  function refresh(force = false) {
    if (inFlight) return inFlight
    if (overview.value && !force) return Promise.resolve()
    inFlight = load()
    return inFlight
  }

  return {
    overview: readonly(overview),
    figures: computed(() => overview.value?.figures ?? {}),
    asOf: computed(() => (overview.value?.asOf ? new Date(overview.value.asOf) : null)),
    loading: readonly(loading),
    error: readonly(error),
    /** True once there is something real to show. */
    ready: computed(() => overview.value != null),
    refresh,
  }
}

// ── Presentation ───────────────────────────────────────────────────────

/** Thousands-separated, or an em dash when the figure is absent. */
export function formatFigure(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-GB')
}

/**
 * Big figures compressed for a tile: 133,840 → "133.8K", 588,851 → "588.9K".
 * Used only where the full number does not fit; the accessible name keeps
 * the exact value.
 */
export function compactFigure(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return value.toLocaleString('en-GB')
}

/** "today" / "3 days ago" — how fresh the reading is, in plain words. */
export function freshness(asOf: Date | null): string {
  if (!asOf || Number.isNaN(asOf.getTime())) return ''
  const days = Math.floor((Date.now() - asOf.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return asOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
