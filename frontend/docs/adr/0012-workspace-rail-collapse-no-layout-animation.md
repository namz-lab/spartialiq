# ADR 0012 — The workspace rail collapses without animating a layout property

Status: Accepted · Owner: `gis-eos-frontend`
Recorded: 2026-09-14. Supersedes ADR 0009.

## Context

Every role workspace has a left section rail that collapses from `--ent-rail-w` (240px) to
`--ent-rail-w-collapsed` (52px). Until now the collapse was a `transition: width`, which
invalidates layout on every frame — not only for the rail but for the content pane beside it
and everything inside that pane. On a low-end Android handset in the field, which is the
device profile that matters here, that is the most expensive thing on the screen.

ADR 0009 recorded the finding and deliberately deferred the fix. Its objection was never that
the transition was correct; it was that changing one module's rail alone would leave the six
roles behaving differently with no cross-role review. That objection was right, and it is what
this ADR answers.

A second, smaller problem was visible once anyone looked: the labels are `v-if`'d out, not
faded, so the width transition was animating a box whose contents had already vanished. The
motion did not describe what was happening.

## Decision

**The rail width changes in one step. The motion moves to the labels.**

```css
.xx-nav       { /* no transition on width */ }
.xx-nav-label { animation: xx-rail-label var(--ent-dur) var(--ent-ease); }
@keyframes xx-rail-label { from { opacity: 0; transform: translateX(-6px); } }
```

`opacity` and `transform` are compositor properties: the browser can run them without a layout
or paint pass, so the collapse costs one layout instead of one per frame. The label animation
plays when the labels mount — which is exactly when the rail expands — so the change still
reads as movement rather than a snap.

Applied together, in one change, to all six workspace rails:

- `src/views/InspectorWorkspaceView.vue` (`.iw-nav`)
- `src/views/PlannerWorkspaceView.vue` (`.pw-nav`)
- `src/views/GISOfficerPortalView.vue` (`.gis-nav`)
- `src/views/EOPlannerPortalView.vue` (`.eo-nav`)
- `src/views/EnvironmentOfficerWorkspaceView.vue` (`.ew-nav`)
- `src/views/PlanningClerkPortalView.vue` (`.clk-nav`)

`prefers-reduced-motion: reduce` cancels the label animation in all six. Three of them
(`EOPlannerPortalView`, `PlannerWorkspaceView`, `PlanningClerkPortalView`) had no
reduced-motion guard at all and now do, which closes point 3 of ADR 0009's TODO.

### Why not transform the rail itself

The techniques ADR 0009 listed for keeping smooth width motion — `translateX` on a
fixed-width track, a `grid-template-columns` transition, `contain: layout` — all still animate
or relayout the flow, because a sibling in normal flow cannot change the space it occupies
without a layout pass. There is no compositor-only way to animate a flow sibling's width. The
honest fix is to stop animating it.

## Scope — what is deliberately NOT changed

`transition: width` also appears on progress meters (`.sys-bar`, `.an-land-fill`,
`.apps-track-fill`, the planner step meters). Those are a different thing: the width **is** the
datum, the element is a few pixels tall, and nothing follows it in flow. They are left alone.
The preferred spelling for new meters is still `transform: scaleX(var(--fill))`, as
`.ins-bar` in `src/views/inspector/inspector.css` already does.

Four other collapsing panels still animate `width` and are **outside** this review, because
none of them is the `--ent-rail-w` workspace rail: `src/views/MapExplorer.vue`,
`src/views/AdminView.vue` (a hardcoded 260px admin sidebar), `src/views/SurveyorView.vue`, and
`.pw-rail` in `src/views/planner/VunguPlannerView.vue` (the planning studio's grid side rails,
which have no label span to carry the motion). Each needs its own look.

## Consequences

- The `layout-transition` hook finding on the six rails is resolved by fixing it, not by an
  `ignore-value`. No suppression was added, in keeping with ADR 0009's standard.
- The collapse is now instant in geometry. That is a visible behaviour change across six
  roles; it was reviewed as one change, which is what ADR 0009 required.
- ADR 0009's TODO item 1 (profile on a real low-end device) was not performed. The change was
  made on the rule and on the reasoning above, not on measurement. If anyone later wants the
  smooth width motion back, that measurement is the argument they need.

## Related

- ADR 0009 — the deferral this supersedes.
- `docs/enterprise-design-system.md` — the `--ent-rail-w*` tokens.
