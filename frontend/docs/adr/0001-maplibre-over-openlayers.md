# ADR 0001 — MapLibre GL over OpenLayers/Leaflet for the primary map

Status: Accepted · Owner: `gis-eos-architect`

## Context
The platform renders 24 PostGIS vector-tile layers with per-layer styling and admin drill-down.

## Decision
Use MapLibre GL (`maplibre-gl` 4.7) as the primary map engine, styled via
`src/map/vunguBasemapStyle.ts`. Leaflet remains only where already embedded.

## Consequences
- Vector tiles + GPU styling; style is single-source (`styleLayerFor`/`chipColorFor`).
- Agents extend the MapLibre pipeline; **do not** propose swapping to OpenLayers without a new
  ADR superseding this one.
