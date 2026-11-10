# PATTERNS — reusable-pattern registry (GIS-EOS)

`gis-eos-platform` owns this file. When a completed feature yields something reusable, append
**one line** here so the next feature reuses instead of reinventing (ladder rung 2 / rung 3).
Consult this before writing new code. Keep it a registry, not documentation — link to the code.

Format: `- <kind>: <name> — <one-line purpose> — <path>`

## Seed entries (existing reusable code worth knowing)
- component: `MapLayerFilters` — floating layer chip panel — `src/components/MapLayerFilters.vue`
- component: `ParcelSelectorMap` — pick a parcel on the map — `src/components/ParcelSelectorMap.vue`
- component: `StandPickerModal` — modal stand/parcel picker — `src/components/StandPickerModal.vue`
- component: `PaymentMethodPicker` — payment method chooser — `src/components/PaymentMethodPicker.vue`
- component: `ApplicationPipeline` — workflow status pipeline — `src/components/workflow/ApplicationPipeline.vue`
- map: `addVunguBasemap` — full 24-layer basemap + drill-down — `src/map/vunguBasemap.ts`
- map: `styleLayerFor` / `chipColorFor` — single-source layer styling — `src/map/vunguBasemapStyle.ts`
- store: `spatial` — tile layer load/toggle + OGC fallback — `src/stores/spatial.ts`
- service: `vectorTiles` — tile catalog/feature/url helpers — `src/services/vectorTiles.ts`
- composable: `useCitizenCase` — citizen case state — `src/composables/useCitizenCase.ts`
- ui: statutory step gating — `src/views/planner/StepLockGate.vue`

## New entries
<!-- append below; delete an entry if its code is removed -->
