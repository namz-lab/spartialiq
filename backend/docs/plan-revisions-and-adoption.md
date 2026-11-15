# Plan revisions and adoption (migration 232)

A plan is a revision of a plan, adopted before it is approved and approved by the Minister before it is gazetted.

## Revisions keep their shapes
`new_plan_version()` copies the plan in force whole: zone types, land uses, decisions, standards **and the zone polygons**. The new revision is a draft the planner edits; the revision it replaces is untouched.
When the new revision is gazetted the old one is closed (`superseded`, `effective_to` the day before) and **kept with its own shapes**; parcels are re-linked to the new revision.
`plan_revision_changes(from, to)` lists what changed: decisions that differ, and zones added, removed or reshaped (hectares changed). `GET /workbench/plans/:id/revision-changes`.

## Which plan decides a parcel
`plan_governs(plan)`: not a template, not superseded, not a draft or in-notice **revision**, and inside its effective dates. `compute_parcel_zoning()` applies it, so parcel zoning, rule snapshots and the application gates follow.
A first plan (no predecessor) governs while a draft, shown as provisional, as before.

## Adoption record
For an authority with signatory roles configured (`plan_signatory_role`; Vungu: District Planner, District Engineer, Chief Executive Officer, Council Chairman):

| Step | Needs |
|---|---|
| public notice → approved | the Full Council's adoption (date, resolution reference: `POST …/adoption`) and a sign-off by every role on the plan **as it is now** (an edit makes every sign-off stale) |
| approved → gazetted | the Minister's approval (number, date: `POST …/ministerial-approval`), a gazette reference and an effective date |

An authority with no signatory roles behaves as before (one current sign-off to approve). The zone shapes of an approved, gazetted or superseded plan are frozen (`zone_freeze_guard`); the content hash that sign-offs are checked against now includes them.
`GET /workbench/plans/:id/checklist` returns each step, its state and who did it. Every record is an append-only `plan_event`.

## Identity
`revision_label`, `revision_date`, `map_scale` carry the sheet's "Rev 005, July 2026, 1:120 000" (`POST …/identity`). The Vungu plan has them; revisions 001 to 004 were paper issues and are not held.
**Nothing is marked adopted or approved**: no council resolution or ministerial approval number is in the sources; the council enters them.
