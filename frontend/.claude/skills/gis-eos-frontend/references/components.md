# Frontend reference — components

Load when building or reviewing a reusable component.

## Rules
- One concern per component; ≤ ~300 lines (METRICS.md) or split.
- Props typed via `defineProps<{}>()`; events via `defineEmits<{}>()`. No `any`.
- Every interactive element: keyboard reachable, visible focus (token ring), `aria-*` where needed.
- Icons from `lucide-vue-next`, `:size` set, decorative icons `aria-hidden`.
- Colors/spacing/radii from `--login-*` tokens (DESIGN-SYSTEM.md). No inline hex.

## Reuse map (extend these before creating)
| Need | Existing |
|---|---|
| Pick a parcel on a map | `src/components/ParcelSelectorMap.vue` |
| Modal stand/parcel picker | `src/components/StandPickerModal.vue` |
| Layer toggle chips | `src/components/MapLayerFilters.vue` |
| Payment method choice | `src/components/PaymentMethodPicker.vue` |
| Workflow status pipeline | `src/components/workflow/ApplicationPipeline.vue` |
| Toast / inline feedback | `src/components/UiFeedback.vue` |
| Map toolbar / attribute table / import | `src/components/map/*` |

## States (all required)
loading (skeleton or spinner), empty (explain + primary action), error (token error surface +
retry), success. A component with only the happy path is not done.
