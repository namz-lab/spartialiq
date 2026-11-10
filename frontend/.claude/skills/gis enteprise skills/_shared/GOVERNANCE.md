# GOVERNANCE — pipeline, gates, Definition of Done (GIS-EOS)

`gis-eos-orchestrator` owns this file and runs it. No code before Impact Analysis + Approval.

## Pipeline
`Request → Impact Analysis → Architecture Review → Technical-Risk Review → Implementation Plan
→ Approval → Development → Integration Review → Runtime Review → Release-Readiness`.

## Freshness pre-check (before Impact Analysis)
Confirm CODEMAP.md / DOMAIN-GRAPH.md / OWNERSHIP.md / docs/adr aren't stale vs recent
`git log`. Stale → the owning skill refreshes it first (owners: see INDEX.md). Decisions made
on stale data are the main failure mode once the orchestrator is good.

## Feature Impact Analysis (template — fill before any change)
Enumerate, sourced from CODEMAP + grep, never guessed:
APIs · tables · GIS layers · permissions/roles · tests · docs · reports · dashboards · components.

## Gate criteria (each is pass/fail)
- **Architecture**: fits boundaries (ARCHITECTURE.md), no ADR violation, no needless module.
- **Reject-gates** (per domain skill): GIS (SRID, GiST index, allowlist, topology),
  Frontend (a11y AA, no duplicate, loading/empty/error states, tokens not hardcoded),
  Backend (input validation, parameterised SQL, error contract, join budget),
  Database (index, constraint, migration file present).
- **Runtime**: budgets in METRICS.md met (traces, API timings, FPS, slow SQL).
- **Simplicity** (Principal): no over-engineering; extend-not-add honoured.

## Confidence score
Every specialist returns `confidence: NN% — reason`. Below 80% → orchestrator triggers a
second review before shipping.

## AI cost tiering (respect the deployment budget)
simple fix ≈ 2 agents · medium ≈ 5 · large GIS feature ≤ 12 · architectural change = full.
Do not wake every specialist for a one-line fix. Delegate budget checks to the installed
`token-budget-advisor` / `context-budget`.

## Definition of Done
Done ONLY when all gates pass AND: docs updated · ADR added/updated if a decision was made ·
PATTERNS.md updated if something reusable emerged · CODEMAP.md · OWNERSHIP.md · DOMAIN-GRAPH.md
(if domain changed) · feature-history.md entry written · unused code deleted. The orchestrator
refuses "done" otherwise and emits the Architecture Health Score for major features.

## Orchestrator authority (acts as CTO)
May reject with "Rejected — here's the simpler path": duplicate module/service, ADR violation,
new abstraction with one caller, feature that duplicates an existing capability.
