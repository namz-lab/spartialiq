/**
 * pmtilesProtocol.ts
 *
 * Frontend glue so MapLibre GL JS can load PMTiles archives served from
 * /api/tiles/pmtiles/:archive (registered once at app start).
 *
 * Usage:
 *   import { registerPmtilesProtocol } from '@/services/pmtilesProtocol'
 *   registerPmtilesProtocol()
 *   new maplibregl.Map({
 *     style: {
 *       sources: { base: { type: 'vector', url: 'pmtiles:///api/tiles/pmtiles/zimbabwe.pmtiles' } },
 *       ...
 *     }
 *   })
 */
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'

let registered = false
let protocol: Protocol | null = null

export function registerPmtilesProtocol(): Protocol {
  if (!protocol) protocol = new Protocol()
  if (!registered) {
    maplibregl.addProtocol('pmtiles', protocol.tile)
    registered = true
  }
  return protocol
}

/** Convenience source URL builder. */
export function pmtilesUrl(archive: string): string {
  return `pmtiles:///api/tiles/pmtiles/${archive}`
}
