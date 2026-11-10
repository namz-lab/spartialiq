# Client Portal Stitch Redesign Design

## Goal

Restyle the citizen-facing portal and connected online application/payment flow to match the exported Stitch project "Citizen Planning & Service Portal" while preserving existing Vue behavior, routing, API calls, and localStorage fallbacks.

## Visual Direction

Use the Stitch design system from `stitch-export/stitch_citizen_planning_service_portal/citizen_service_framework/DESIGN.md`: Public Sans, Oxford Blue primary, Forest Green secondary, pale blue surfaces, white content cards, restrained borders, and low-shadow "flat-plus" elevation.

## Scope

Apply the redesign to:

- `src/views/ViewerPortalView.vue`
- `src/views/OnlineApplicationsView.vue`
- `src/views/OnlineApplicationFormView.vue`
- `src/views/PaymentGatewayView.vue`
- `src/views/PaymentReceiptView.vue`
- shared global style tokens in `src/styles/main.css`

## Approach

Keep templates and scripts mostly intact. Add shared global CSS variables and font loading, then adjust each view's scoped CSS so current class names render in the Stitch visual language. This avoids replacing working Vue interactions with static exported HTML.

## Behavior

Existing interactions remain unchanged: portal navigation, service modals, application routing, report submission, geolocation capture, application form steps, document verification, payment status polling, and receipt loading.

## Verification

Run `npm run type-check` and `npm run build`. If the build passes, start the dev server and visually inspect `/portal`, `/apply`, `/apply/building_permit`, `/payment/:refNo` where possible, and `/receipt/:refNo` where possible.
