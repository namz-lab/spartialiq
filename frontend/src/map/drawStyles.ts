// src/map/drawStyles.ts
// MapboxDraw layer styles shared by every editor that draws on a MapLibre map
// (the stands editor and the GMS map workspace).
export const DRAW_STYLES: any[] = [
  { id: 'draw-polygon-fill-active',   type: 'fill',   filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']], paint: { 'fill-color': '#4f46e5', 'fill-opacity': 0.2 } },
  { id: 'draw-polygon-fill-inactive', type: 'fill',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'fill-color': '#4f46e5', 'fill-opacity': 0.15 } },
  { id: 'draw-polygon-stroke-active', type: 'line',   filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2.5, 'line-dasharray': [3, 1.5] } },
  { id: 'draw-polygon-stroke-inactive', type: 'line', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2 } },
  { id: 'draw-line-active',   type: 'line',   filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],  layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2, 'line-dasharray': [3, 1.5] } },
  { id: 'draw-line-inactive', type: 'line',   filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'false']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2 } },
  { id: 'draw-vertex-stroke', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']], paint: { 'circle-radius': 7, 'circle-color': '#fff' } },
  { id: 'draw-vertex',        type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']], paint: { 'circle-radius': 5, 'circle-color': '#4f46e5' } },
  { id: 'draw-midpoint',      type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']], paint: { 'circle-radius': 3.5, 'circle-color': '#818cf8' } },
  // A finished point feature (draw_point creates one per click).
  { id: 'draw-point',         type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']], paint: { 'circle-radius': 6, 'circle-color': '#4f46e5', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
]
