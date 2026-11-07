// src/map/tools/camera.ts
// ─────────────────────────────────────────────────────────────────────────
// Camera-movement helpers that honor prefers-reduced-motion.
//
// PRODUCT.md (accessibility): map drill-down `flyTo` / `fitBounds` must
// collapse to an instant jump under `prefers-reduced-motion: reduce`. The GIS
// toolkit (search, attribute table, data import) moves the camera, so it routes
// through these wrappers instead of calling map.flyTo / map.fitBounds directly.
// ─────────────────────────────────────────────────────────────────────────

function reduceMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** map.flyTo, but jumps (no animation) under reduced-motion. */
export function flyTo(map: any, opts: any): void {
  if (!map?.flyTo) return
  map.flyTo(reduceMotion() ? { ...opts, animate: false, essential: true } : opts)
}

/** map.fitBounds, but jumps (no animation) under reduced-motion. */
export function fitBounds(map: any, bounds: any, opts: any = {}): void {
  if (!map?.fitBounds) return
  map.fitBounds(bounds, reduceMotion() ? { ...opts, animate: false } : opts)
}
