/**
 * Field navigation for Building Inspector site visits.
 *
 * Opens an external maps app with coordinates only — never case titles,
 * applicant names, or permit references. GPS observations are labelled as
 * such and are never treated as cadastral geometry.
 */

export type GpsObservation = {
  lat: number
  lng: number
  accuracyM: number | null
  timestamp: string
  source: 'gps_observation'
}

export type GpsFailure =
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'timeout' }

export function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function toRad(d: number) {
  return (d * Math.PI) / 180
}

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—'
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

export function hasCoordinates(lat?: number | null, lng?: number | null): boolean {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && !(lat === 0 && lng === 0)
}

/**
 * Generic geo URI plus an HTTPS OpenStreetMap fallback.
 * Coordinates only — no query text that could leak a case.
 */
export function navigationUrls(lat: number, lng: number): { geo: string; https: string } {
  const latS = lat.toFixed(6)
  const lngS = lng.toFixed(6)
  return {
    geo: `geo:${latS},${lngS}?q=${latS},${lngS}`,
    https: `https://www.openstreetmap.org/?mlat=${latS}&mlon=${lngS}#map=18/${latS}/${lngS}`,
  }
}

/**
 * True only for a device whose OS almost certainly registers a geo: handler —
 * that is, a phone or tablet.
 *
 * Deliberately NOT `(pointer: coarse)`: a touch-screen Windows laptop, which a
 * council office is full of, matches that and has no maps application, so the
 * inspector would click Navigate and watch nothing happen. A mobile OS is the
 * signal that actually predicts the handoff; everything else gets a web map,
 * which always works.
 */
export function prefersGeoHandoff(): boolean {
  if (typeof navigator === 'undefined') return false
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  // EITHER signal is enough. Chrome's client hint is authoritative when true,
  // but it is absent on iOS Safari and Firefox, and stays false under device
  // emulation — so a UA that names a mobile OS counts as well. The only way to
  // reach this branch on a real workstation is to spoof a phone UA, which is
  // precisely when phone behaviour is wanted.
  if (data?.mobile === true) return true
  return /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent || '')
}

/**
 * The URL the Navigate affordance should point at on THIS device.
 *
 * Prefer rendering this as a real <a href> — a link is a user gesture no popup
 * blocker interferes with, it works when JavaScript fails, and the browser
 * shows the destination on hover.
 */
export function navigationHref(lat: number, lng: number, geoHandoff = prefersGeoHandoff()): string {
  const { geo, https } = navigationUrls(lat, lng)
  return geoHandoff ? geo : https
}

/**
 * Open an external map at these coordinates. Returns false when the browser
 * refused, so the caller can say so rather than leaving the inspector waiting.
 *
 * A previous version called window.open('geo:…') first and reported success
 * unconditionally. On a desktop browser nothing handles geo:, and window.open
 * does not throw — so the fallback never ran, the inspector saw no map, and was
 * left with a blank dead tab. Which map opens is now decided by the device
 * BEFORE anything is opened.
 */
export function openExternalNavigation(lat: number, lng: number): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false

  if (prefersGeoHandoff()) {
    // Hand the OS the geo: URI through a link click: no popup to block, and no
    // blank tab left behind when no maps app is registered.
    try {
      const a = document.createElement('a')
      a.href = navigationUrls(lat, lng).geo
      document.body.appendChild(a)
      a.click()
      a.remove()
      return true
    } catch {
      // fall through to the web map
    }
  }

  try {
    const opened = window.open(navigationUrls(lat, lng).https, '_blank', 'noopener,noreferrer')
    return opened !== null
  } catch {
    return false
  }
}

export function captureGps(opts: { timeoutMs?: number; maximumAgeMs?: number } = {}): Promise<GpsObservation | GpsFailure> {
  const timeoutMs = opts.timeoutMs ?? 8000
  const maximumAgeMs = opts.maximumAgeMs ?? 30_000
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ kind: 'unsupported' })
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
          source: 'gps_observation',
        })
      },
      (err) => {
        if (err?.code === 1) resolve({ kind: 'denied' })
        else if (err?.code === 3) resolve({ kind: 'timeout' })
        else resolve({ kind: 'unavailable' })
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs },
    )
  })
}

export function isGpsFailure(v: GpsObservation | GpsFailure): v is GpsFailure {
  return 'kind' in v
}

export function gpsFailureMessage(f: GpsFailure): string {
  if (f.kind === 'unsupported') return 'This browser does not support location. Coordinates will not be attached.'
  if (f.kind === 'denied') return 'Location access was denied. Photos will be saved without GPS coordinates.'
  if (f.kind === 'timeout') return 'Location timed out. Photos will be saved without GPS coordinates.'
  return 'Location is currently unavailable. Photos will be saved without GPS coordinates.'
}
