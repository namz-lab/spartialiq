# The Executive Arm's units, roles and dashboards

Migration 216; code in `src/config/units.js`, `src/routes/units.js`, `src/services/unitSections.js`,
`src/lib/wardMaps.js`; screens `frontend/src/views/units/UnitDashboardView.vue` and the Chief Executive's overview.

## Who sees what

The Chief Executive (`accounting_officer`) sees every unit. A unit's head sees **that unit only**; the server
refuses (403) any other unit and any other staff role (`canSeeUnit`). The router guard only saves a head the refused
screen. Unit dashboards are read-only.

| Unit (`unit_key`) | Officer post (Vungu website, Executive Arm) | Role | Home | Working desk |
|---|---|---|---|---|
| `planning` | Executive Officer Planner | `eo` | `/eo-planner-portal` | EO desk |
| `finance` | Executive Officer Finance | `finance_admin` | `/finance` | finance workspaces |
| `engineering` | Engineer | `engineer` (new) | `/units/engineering` | parcel and asset map |
| `social_admin` | Human Resources, Social Services and Administration Officer | `hr_social_officer` (new) | `/units/social_admin` | none yet |
| `audit` | Internal Auditor | `auditor` | `/finance` | audit workspace |

Existing roles keep their current home; they reach the unit dashboard by link. The Chief Executive's overview
cards each open their unit ("Unit dashboard"), and a ward selected on the Chief Executive's map is read across
every unit ("Ward N: every unit") with a link into each.

## What a unit page shows

- **Where the unit stands**: the same section readers the overview uses, so a figure cannot differ between pages.
- **Establishment**: posts from `public.admin_org_position` (migration 216 seeds the five Executive Arm posts under
  the Chief Executive, vacant). A post with no holder is shown as **vacant**, never filled in. A holder from another
  council is shown as vacant too (the chart is not tenant-scoped).
- **Ward by ward**: only the unit's own measures (`spatial_engine.measure.unit_key`). Audit has none and says so.
- Honesty rules carry over: no figure for an empty register, HR always "not yet in the system", no arrears (D13),
  wards marked provisional while D11 is open.

## Ward measures by unit

`planning`: parcel_density. `finance`: parcel_account_coverage, budget_execution. `engineering`:
water_points_working, `road_density` (km of active road per km², roads cut at the ward edge; **no data until roads
carry geometry**; demo roads get a stand-in line only where real wards are loaded). `social_admin`:
`premises_certified` (share of premises with an unexpired fitness certificate; premises with neither coordinates nor
a ward are counted as unlocated).

## A trap the migration closes

A user with no `authority_id` sees no council rows (row-level security). `users_default_authority()` lists the roles
that default to the council; 216 adds the two new roles to it and back-fills any existing account.

## Legal and management basis: what is and is not verified

From search summaries, **not read in full text**: Rural District Councils Act [Chapter 29:13] s.66 (officers include
the chief executive officer, treasurer, engineer, medical officer of health and other heads of department);
Regional, Town and Country Planning Act [Chapter 29:12] (local planning authority, delegation); Public Finance
Management Act [Chapter 22:19] (accounting officer; delegation does not remove accountability); Ministry of Local
Government circular LA22 (performance contracts per head of department, urban councils). **Not read at all:** the RDC
Act's duties sections, the Public Health Act, the Environmental Management Act, internal-audit rules. Check each
against the text before citing it. Performance contracts and per-officer targets are not modelled.

## Rollback

`migrations/rollback/216_executive_units.down.sql` (refuses while any account holds the two roles).
