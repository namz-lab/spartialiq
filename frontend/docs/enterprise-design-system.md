# Vungu RDC — Enterprise Design System

The single source of truth for the frontend chrome of the Vungu planning &
spatial-intelligence platform. Tokens live in
[`src/styles/enterprise.css`](../src/styles/enterprise.css); the shared component
kit lives in [`src/components/ui/`](../src/components/ui/). This document explains
the intent and the rollout.

> **Status.** This system **supersedes** the earlier three fragmented directions
> (the `DESIGN.md` warm-neutral spec, the civic `--ink`/`--accent` emerald scale,
> and the `--login-*` set). Those remain only until each legacy screen migrates.
> New and migrated code uses `--ent-*` tokens and the `Ui*` kit — never a
> hardcoded hex/px in a component style block.
>
> The **map cartography is unchanged** and remains its own SSOT
> (`src/map/vunguBasemapStyle.ts`, documented in `DESIGN.md → Map Cartographic
> System`). The enterprise chrome is deliberately cool so it *frames* the warm
> map rather than competing with it.

## Design intent

Serious GIS / planning / engineering / government enterprise software — **not**
consumer SaaS. Priorities, in order:

1. **Information efficiency** — every pixel earns its place; no decorative cards,
   no oversized empty space, no hero metrics.
2. **Clear hierarchy & scanability** — a planner answers "what needs my
   attention, where, and what's next?" in one glance.
3. **Restraint** — one cool-neutral foundation, one controlled accent, flat
   government-sober elevation. No gradients, no purple, no big rounded corners.
4. **Density without cramping** — comfortable-efficient (34px controls, 36px
   rows), never dense for its own sake.

## Tokens (the SSOT)

All tokens are CSS custom properties on `:root`. Reference them with
`var(--ent-*)`; do not copy the literal value.

| Group | Tokens | Notes |
|---|---|---|
| **Surfaces** | `--ent-canvas`, `--ent-surface`, `--ent-surface-2`, `--ent-surface-sunken` | four elevations: content well → panel → header/hover → rail/well |
| **Borders** | `--ent-line`, `--ent-line-strong` | hairline dividers vs. structural separators |
| **Text** | `--ent-text`, `--ent-text-2`, `--ent-text-3`, `--ent-text-on-accent` | three ranks + on-accent |
| **Accent** | `--ent-accent`, `-hover`, `-active`, `-soft`, `-line`, `-ring` | one deep steel blue, ≤10% of any surface |
| **Semantic** | `--ent-success`, `--ent-warning`, `--ent-danger` (+ `-soft`), `--ent-info` | meaning only, never decoration |
| **Workflow tones** | `--ent-tone-{neutral,info,positive,warning,negative}-{bg,fg,line}` | the five status tones; see below |
| **Type** | `--ent-fs-{micro,xs,sm,base,md,lg,xl,num}`, `--ent-fw-*`, `--ent-lh*` | 11 → 26px, weights 400–700 |
| **Spacing** | `--ent-s1`…`--ent-s8` | 4/8/12/16/20/24/32/40, 8pt rhythm |
| **Radii** | `--ent-r-sm`, `--ent-r`, `--ent-r-md`, `--ent-r-lg`, `--ent-r-pill` | 4/6/8/10 + pill (badges/segmented only) |
| **Elevation** | `--ent-e1`…`--ent-e4` | subtle, ink-tinted, no colour shadows |
| **Controls** | `--ent-control-h`, `-h-sm`, `--ent-row-h`, `-sm`, `--ent-focus-ring` | 34/28px controls, 36/30px rows |
| **Navigation** | `--ent-rail-w`, `-collapsed`, `--ent-topbar-h` | 240/52px rail, 52px topbar |
| **GIS overlay** | `--ent-map-panel-bg/line/shadow` | 96%-opacity floating map controls |
| **Motion** | `--ent-ease`, `--ent-dur`, `--ent-dur-lg` | 150/240ms, ease-out-quart |
| **Layering** | `--ent-z-{sticky,rail,popover,modal,toast}` | z-index scale |

### Colour semantics

- **Accent** (`--ent-accent`, deep steel blue) — primary actions, active nav,
  selected rows/features, links. The *only* saturated UI colour.
- **Semantic** colours carry meaning: success (approve), warning (attention /
  deferral / appeal), danger (refuse / active enforcement). Each has a `-soft`
  background for tinted surfaces.
- **Colour is never the only signal** (WCAG 2.1 AA): status badges pair colour
  with a label and a dot; the accent is reinforced by weight and an inset bar in
  navigation.

### Workflow states — one taxonomy, five tones

Every case/permit/enforcement state maps to exactly one tone, defined once in the
tokens and applied by [`UiStatusBadge`](../src/components/ui/UiStatusBadge.vue):

| Tone | Meaning | Example states |
|---|---|---|
| `neutral` | inert / not yet actioned | Registered, Acknowledged, Pending docs, Withdrawn, Lapsed, Closed |
| `info` | in progress | Under review, In circulation, Consultation, Objection period, Awaiting EO decision |
| `positive` | favourable outcome | Approved, Approved (conditions), Complied |
| `warning` | needs attention | Deferred, On appeal, Extended |
| `negative` | adverse outcome | Refused, Active (enforcement) |

`<UiStatusBadge :status="permit.status" />` resolves both the human label and the
tone, so "Approved" reads identically in the register, the dashboard, and the map.

## Component kit (`src/components/ui/`)

Reuse these before writing bespoke markup. All consume `--ent-*` only.

| Component | Purpose |
|---|---|
| [`UiButton`](../src/components/ui/UiButton.vue) | one control, four roles (`primary`/`secondary`/`ghost`/`danger`), two sizes, loading + `#icon` slot |
| [`UiPanel`](../src/components/ui/UiPanel.vue) | the container primitive — header (icon/title/subtitle/actions), body, footer; `flush` for edge-to-edge tables/lists |
| [`UiStatusBadge`](../src/components/ui/UiStatusBadge.vue) | canonical workflow-state indicator (see taxonomy above) |
| [`UiKpi`](../src/components/ui/UiKpi.vue) | a single metric tile; keyboard-reachable when `clickable` |
| [`UiEmptyState`](../src/components/ui/UiEmptyState.vue) | one sentence explaining what would appear + optional action; no illustrations |
| [`UiDataTable`](../src/components/ui/UiDataTable.vue) | registers/queues/lists — sticky header, per-column client sort, alignment, mono cols, loading/empty, `#cell-<key>` slots |

**Planned next** (build on second real use, not speculatively): `UiTabs`
(the underline-tab pattern currently inlined in Enforcement & Reference),
`UiToolbar` (filter/search/actions bar), `UiField`/`UiSelect` (form controls —
currently tokenised inline per section), `UiSplitView` (map + data),
`UiDrawer` (case file / feature info).

## Reference implementation

The **planner workspace** is the reference. Study these before migrating a
screen:

- Layout: [`PlannerShell.vue`](../src/views/planner/PlannerShell.vue) (topbar,
  segmented map/console switch, sync chip) +
  [`PlannerWorkspaceView.vue`](../src/views/PlannerWorkspaceView.vue) (left rail
  + section header + content).
- Screen: [`DashboardSection.vue`](../src/views/planner/sections/DashboardSection.vue)
  — KPI row, panels, status badges, empty states, workload lists. Zero hardcoded
  colours.

## Responsive behaviour

- Shells are full-bleed; content wells cap where reading (not scanning) is the
  task. The map is always full-bleed.
- The left rail collapses to `--ent-rail-w-collapsed` (icon-only) on demand and
  narrows under 900px.
- Panels flow in an `auto-fit, minmax(360px, 1fr)` grid — one column on narrow
  viewports, more as space allows. No fixed multi-column layouts.
- Tables scroll inside their own container; the page body never scrolls
  horizontally.

## Migration rules

1. Replace hardcoded hex/px in a component's `<style>` with `var(--ent-*)`.
2. Replace hand-rolled cards → `UiPanel`; status pills → `UiStatusBadge`;
   metric tiles → `UiKpi`; "nothing here" copy → `UiEmptyState`; buttons →
   `UiButton`.
3. Never change a component's script/props/emits while restyling — keep diffs
   scoped to presentation so behaviour and tests are preserved.
4. If you need a colour or measure that isn't a token, add it to
   `enterprise.css` (with a comment) rather than hardcoding it.

## Rollout order (highest value first)

1. ✅ Foundation: tokens + kit + planner workspace reference.
2. ✅ Planner console — Permit Register (→ `UiDataTable`), Enforcement, Building
   Plans, Reports & Returns, Reference, **Statutory Workflow** (Section 26
   stepper: shell, clock banner, lock gate, and all 5 step forms migrated by
   aliasing the local `--sw-*` tokens to `--ent-*`). Residual: a handful of
   subtle secondary hexes inside the step forms (verdict/pill semantic colours,
   already near-identical to the enterprise palette) — low-ROI sweep pending.
3. ✅ Map pane chrome (`VunguPlannerView.vue`) — full sweep. Selected Parcel
   floating panel, layer/measure/zoom controls, statusbar, both sidebars, tabs,
   cards, checks, stand modal, planning-assistant panel and Google-style search
   migrated onto `--ent-map-panel-*` + `--ent-*` (240 → ~110 raw hexes). The
   fabricated "View Analytics" panel (placeholder 82% / 45-30-15) was removed.
   The remaining hexes are deliberately kept: cartographic layer colours, the
   POI/search category colour system, map-paint tool colours (draw/measure/
   buffer), a dark-button variant, and status pills already near-identical to
   the enterprise semantic tokens. Map paint stays on its own SSOT.
4. Case management & the case-file drawer.
5. Property / parcel file.
6. Other role portals (GIS officer, EO planner, environmental officer,
   inspector, planning clerk, surveyor), then citizen & admin surfaces.
