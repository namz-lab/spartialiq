# DOMAIN-GRAPH — planning business knowledge

Owner: `gis-eos-municipal`. Relationships between domain entities (not files). Agents consult
this to reason about how a change ripples through the *process*.

## Core chain
```
Citizen ──submits──▶ Development Application ──has──▶ Fees (Payment)
        Application ──may be a──▶ Subdivision / Consolidation (Parcel change)
        Application ──assessed by──▶ Planner (Zoning + Constraints from GIS layers)
        Application ──circulated to──▶ Technical departments
        Application ──decided by──▶ Committee ──▶ Decision (Approve | Refuse)
        Approve ──issues──▶ Permit ──carries──▶ Conditions
        Permit ──triggers──▶ Stage Inspections ──result──▶ Certificate | Enforcement
        Every step ──writes──▶ Development Register (+ Audit trail)
```

## Cross-links
| Entity | Depends on / relates to |
|---|---|
| Application | applicant identity, fees, parcel geometry, zoning, constraints |
| Subdivision | parent parcel (tiles it), abutting owners, statutory workflow |
| Committee decision | due-diligence report, technical circulation, public notices |
| Permit | committee decision, conditions; blocks until both exist |
| Inspection | permit, prior stage outcome (ordered) |
| GIS layers | zoning, constraints, parcels, roads, buildings (24-layer registry) |
| Register | every application/decision/permit/inspection (soft-delete + audit only) |

## Invariants (mirror MUNICIPAL-STANDARDS)
Permit only after decision + conditions · inspections strictly ordered · subdivision flows the
full lifecycle · nothing hard-deleted.

> Extend as the process is digitised further. Keep it relationships, not prose.
