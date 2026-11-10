# ADR 0009 — Workspace rail/sidebar collapse animates `width` (accepted shared pattern, review separately)

Status: **Superseded by ADR 0012** (2026-09-14) · Owner: `gis-eos-frontend`
Recorded: 2026-09-10, during Building Inspector production-readiness work (Phase 3/4).

> **Superseded.** The rail collapse no longer animates `width`. The deferral below was
> conditional on the change being made across roles at once rather than in one module, and
> that is what ADR 0012 does: all five workspace rails changed together. Read this file for
> the reasoning that was current between 2026-09-10 and 2026-09-14; read
> `0012-workspace-rail-collapse-no-layout-animation.md` for what the code does now.

## Context

The impeccable design hook reports `layout-transition` findings against the collapsing
navigation rail and side panels:

- `src/views/InspectorWorkspaceView.vue` — `.iw-nav { transition: width var(--ent-dur-lg) var(--ent-ease) }`
- `src/views/BuildingInspectorView.vue` — `.left-sidebar, .right-sidebar { transition: width 0.25s cubic-bezier(0.4,0,0.2,1) }`

The hook's objection is technically correct: animating `width` invalidates layout on every
frame, so a rail collapse can thrash layout and drop frames on low-end hardware — which is
exactly the hardware profile that matters for field use.

It is **not**, however, an Inspector-module defect. It is the established workspace-shell
pattern across the platform:

- The widths are first-class design-system tokens — `--ent-rail-w: 240px` and
  `--ent-rail-w-collapsed: 52px` in `src/styles/enterprise.css` (lines 118–119) — so the
  collapse geometry is deliberately specified, not incidental.
- `transition: width` appears in **20 files** spanning every municipal role: Admin, Analytics,
  Building Inspector, EO Planner (portal + workspace), Environment Officer, GIS Officer,
  Inspector Workspace, Map Explorer, Planner Workspace, Planning Clerk, Surveyor, Security
  Dashboard, three Citizen sections, and four Planner step components.

## Decision

**Leave the width transitions unchanged. Do not suppress the hook finding.**

The Building Inspector phase must not introduce an unreviewed cross-role visual or interaction
change. Converting the rail collapse to a transform-based animation would alter shared shell
behaviour for every role at once, with no cross-role visual review and no cross-role test
coverage to catch regressions.

Equally, the finding is **not** silenced. No `ignore-value`, `ignore-file` or `ignore-rule`
entry was added. Making the hook green without either fixing the issue or deliberately
reviewing it would convert a real, actionable observation into invisible debt — the opposite
of this project's "a control either works or it does not exist" standard.

The findings are therefore classified: **ACCEPTED SHARED PATTERN — REVIEW SEPARATELY.**

## Consequences

- The hook will keep reporting `layout-transition` on these files. That is intended. The
  warning stays visible until the shared shell is deliberately reviewed.
- Reviewers of Building Inspector changes should expect these two findings and must not treat
  them as regressions introduced by inspector work.
- The debt is real and unpaid: on low-end field devices the rail collapse may drop frames.

## TODO — cross-role shell motion/performance review (not yet scheduled)

A dedicated shell-wide remediation phase should:

1. **Measure the actual cost.** Profile a rail collapse on a representative low-end Android
   device over a throttled connection, on the Inspector and Planner workspaces, and record
   dropped frames. Decide from evidence, not from the lint rule alone.
2. **Evaluate candidate techniques** against a fixed-width rail:
   - `transform: translateX` on the rail with a fixed track width;
   - `grid-template-columns` transition on the shell grid;
   - `content-visibility` / `contain: layout` to bound the invalidated subtree.
   Each has different consequences for focus order, scrollbar behaviour, and the
   `--ent-rail-w-collapsed` icon-only state.
3. **Honour `prefers-reduced-motion: reduce` consistently** — the platform already collapses
   map `fitBounds` to a 0 ms jump (`prefersReducedMotion()` in `src/map/vunguBasemap.ts`); the
   rail collapse should follow the same rule.
4. **Apply the outcome in one change across all 20 files**, with a cross-role visual review,
   rather than per-module drift.
5. **Only then** decide whether the finding is resolved or warrants a documented, narrow
   suppression.

Until that phase runs, no module may unilaterally change the rail collapse behaviour.

## Related

- `docs/enterprise-design-system.md` — the `--ent-*` token system these widths belong to.
- ADR 0006 — precedent for recording a deliberate divergence in one place rather than letting
  individual pages drift.
