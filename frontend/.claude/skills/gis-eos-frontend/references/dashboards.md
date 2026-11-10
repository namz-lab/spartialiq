# Frontend reference — dashboards

Load when building a role dashboard (`views/<role>/sections/DashboardSection.vue` pattern).

## Anti-reference (from PRODUCT.md)
Not a generic SaaS dashboard (cream + bright blue + hero-metric cards). Register is *product*:
the design serves the planning workflow. No marketing language, no exclamation marks.

## Structure
- Lead with the actor's **next action** (their queue / SLA-breaching cases), not vanity metrics.
- Data tables > 500 rows must virtualize (METRICS.md).
- Every tile links to the underlying register/case — a number with no drill-through is noise.
- Reuse `workflow/ApplicationPipeline` for status; `SlaSummaryCard`, `CommitteeScheduleCard`,
  `ApplicationTrackCard` under `views/planner/` are existing tiles to extend.

## Tokens + a11y
Surfaces/radii/shadows from `--login-*`. Charts: readable without colour alone (label + shape).
Loading/empty/error states per component reference. Honour `prefers-reduced-motion`.
