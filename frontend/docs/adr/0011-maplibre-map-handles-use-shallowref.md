# ADR 0011 — A MapLibre `Map` handle is held in `shallowRef`, never `ref`

Status: Accepted · Owner: `gis-eos-maplibre`
Recorded: 2026-09-13, during Building Inspector GIS work.

## Context

`vue-tsc` began failing with:

```
src/views/surveyor/components/SurveyPlanPreview.vue(177,3):
  error TS2589: Type instantiation is excessively deep and possibly infinite.
```

in a file nobody had edited. A clean checkout of `HEAD` type-checked with zero errors, so
the trigger was program size, not that file.

`ref<maplibregl.Map>()` makes TypeScript compute `UnwrapRef<Map>`, which walks the entire
MapLibre type graph — `StyleSpecification`, every source and layer variant, the full paint
and layout property unions. Each such `ref` is near TypeScript's instantiation budget on
its own. Adding files to the program shifts the shared instantiation cache, and whichever
map-holding file is checked last tips over the limit. Fixing one file simply moved the
error to the next `ref<maplibregl.Map>` in the codebase.

The unwrapping is also wrong on its own terms: a `Map` is an imperative handle, not
reactive state. Deep reactivity over it buys nothing and makes Vue proxy a live WebGL object.

## Decision

Hold every MapLibre `Map` (and comparable third-party handle) in `shallowRef`:

```ts
const map = shallowRef<maplibregl.Map | null>(null)
```

Applied across all nine map-holding components: `InteractiveMap`, the six GIS-officer
sections, `SurveyPlanPreview`, `SurveyPlanMapView`, and the inspector's
`BuildingInspectorView`.

## Consequences

- `npm run type-check` is clean, and stays clean as the program grows — the failure mode
  was order-dependent and would have reappeared on any new file.
- No behaviour change: `.value` assignment, `v-if="map"` and `map.value?.remove()` all work
  identically. Only the map's *internals* stop being reactive, and nothing ever depended
  on that.
- New map code must use `shallowRef`. A plain `ref` around a `Map` is a type-check hazard
  for the whole repository, not just for its own file.
