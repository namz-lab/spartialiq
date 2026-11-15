# Development applications and the plan

The plan drives the application workflow: an application is linked to a parcel of the register, lodged under the plan's zones, assessed against the plan's decision for the use applied for,
and the Executive Officer's approval is constrained by what the plan decides.

## The flow
1. **Lodge** (`POST /api/permit-applications`): the server finds the parcel from the stand number (and ward) or the location (`resolve_stand_parcel`, which reads `land.parcel` only: a number found once is
   `matched`; with no number the smallest current parcel containing the point, a stand before a farm, is `by_location`; several is `ambiguous`; none is `unmatched`, never guessed) and records the plan's
   zones at that moment (`permit_rule_snapshot`, kind `lodgement`, append-only). Lodging never fails because of the land.
   An application that was not linked can be looked for again (`POST /permit-applications/:id/relodge`); a parcel a person set by hand is never overwritten.
2. **Assess** (planner, `ZoningAssessmentCard`): `GET /permit-applications/:id/zoning` shows the parcel, the plan (and whether it is in force), the governing zone and every use of the plan with the decision
   for that zone and **who decided it**: the council (the EO's matrix), a PROPOSED best-practice rule not yet agreed by the EO, or not decided (never shown as allowed). The planner picks the use; the server records
   an `assessment` snapshot.
3. **Determine** (Executive Officer, `POST /permit-applications/:id/eo-decision`): see the gates below. The decision letter carries a "Plan basis" paragraph.

## The gates on an approval (`src/services/planGates.js`)
Read from the latest assessment snapshot's governing result, for approve and approve with conditions. A refusal is never gated.

| The plan's decision for the use | An approval must carry |
|---|---|
| permitted, by the EO | nothing |
| prohibited | `departure_reason` (a sentence) |
| special consent whose pathway needs public notice | the notice completed (advert, abutting owners, site notice, objection period closed), or a `departure_reason` |
| not decided, or only PROPOSED | `rules_acknowledged: true` |
| no parcel, or no land use assessed | `plan_note` saying why the plan was not applied |

A failed gate answers `409 plan_requirements` with what is missing. What was supplied is written to the case history (`plan_departure`, `rules_acknowledged`, `plan_note`) and to the letter.
`GET /permit-applications/:id/plan-gate?decision=` returns the requirements ahead of time, so the decision screen asks for them up front. An admin's override of a determination is gated as well.
The plan's own status (the Vungu plan is "unknown", not in force) is shown as a banner and is not a gate: it would make every approval ask.

## Why the matrix was invisible before migration 231
Migration 186, a hand-applied hotfix, dropped the chain's `zone_effective_controls` and `zone_decision_status` and installed stubs over an empty table. Every reader of the matrix therefore saw "not decided" for
every use, or failed (`rule_snapshot` named columns the stub lacked), whatever `zone_land_use_controls` held, including the EO's matrix. Migration 231 restores both views.

## Demonstration data
`scripts/relink-demo-permits.js` points the demonstration applications (seeded with the dropped demo stands' numbers) at real stands and lodges them (`demo-setup` runs it after the township import).
