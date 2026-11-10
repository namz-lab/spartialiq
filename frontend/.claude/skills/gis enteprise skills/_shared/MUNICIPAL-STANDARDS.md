# MUNICIPAL-STANDARDS — planning domain (GIS-EOS)

The domain truth the platform digitises. `gis-eos-municipal` owns this + DOMAIN-GRAPH.md.

## Roles (map to routes)
| Role | Route | Owns |
|---|---|---|
| Citizen / applicant | `/citizen-portal`, `/development-application` | submits, pays, tracks |
| Planning clerk | `/planning-clerk` | intake, acknowledgements, fees, notices, dispatch, register |
| Planner | `/planner-workspace` | statutory workflow, assessment, permit register |
| EO-planner | `/eo-planner` | due diligence, circulation, committee reports, permit drafting |
| GIS officer | `/gis-officer-portal` | spatial DB, zoning maps, application mapping, constraints |
| Environment officer | `/environment-officer` | plan appraisal, inspections, certificates |
| Inspector | `/inspector-portal` | stage inspections, enforcement, certificates |
| Admin | `/admin/*` | data & content management, styles |

## Statutory application lifecycle (the spine)
`Intake → Identity/Fees check → Due diligence → Technical circulation → Committee →
Decision (approve/refuse) → Permit issue → Conditions → Stage inspections → Certificate`.
Refusals and enforcement are first-class branches, not error paths. Each stage has an actor,
an SLA, and a register entry. Steps are gated — a later step unlocks only when its predecessor
completes (see `src/views/planner/StepLockGate.vue`, `StatutoryStepper.vue`).

## Development register
The permanent record. Every application, decision, permit, and inspection is a register row
(`planning-clerk/sections/DevelopmentRegisterSection.vue`,
`planner/sections/PermitRegisterSection.vue`). Nothing is hard-deleted — soft-delete + audit
trail (`planner/CaseAuditTrail.vue`).

## Correctness rules
- A permit cannot issue before committee decision + conditions are recorded.
- An inspection cannot pass a stage whose predecessor stage failed.
- Zoning/constraint checks (GIS officer) feed the planner's assessment before decision.
- Money paths (fees, `PaymentsView`, receipts) validate amount + status server-side.
