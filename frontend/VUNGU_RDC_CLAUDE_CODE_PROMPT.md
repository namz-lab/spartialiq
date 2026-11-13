# Vungu RDC Integrated Budget and Planning System

You are the principal engineer implementing a real, integrated municipal system for Vungu Rural District Council. Deliver working, tested changes in the existing product. Do not stop after an audit, architecture proposal, mock-up, or plan.

## Sources and scope

- Treat `/home/theo-madzinaga/Downloads/Vungu_RDC_Municipal_Budget_System_Technical_Specification.docx` as the functional baseline. It is proposed requirements, not evidence that statutory rules or Council approvals are settled.
- The target is `/home/theo-madzinaga/Documents/Manicipal-drums-frontend`. Integrate budget and financial workflows into this existing planning, GIS, citizen, and environmental product; do not build a second disconnected portal.
- Inspect `/home/theo-madzinaga/Downloads/cityvizor-staging` as a read-only reference for existing budget/accounting concepts, imports, reports, and data model. Reuse only after verifying fit; do not copy Czech-specific assumptions or duplicate a whole application.
- `CLAUDE.md` names a sibling `../app-backend`, but it may not exist. Locate and verify the actual backend repository before API/database work. Never substitute fake APIs or local-only mock data for production behavior.

## Begin, then execute

1. Read the DOCX fully and inspect `CLAUDE.md`, `PRODUCT.md`, `docs/architecture/CODEMAP.md`, `DOMAIN-GRAPH.md`, relevant ADRs, and only the code/docs needed to map the existing finance, planning, environmental, auth, and backend paths.
2. Write a concise impact/gap note: what already works, what is missing, repositories/files affected, data links, permissions, risks, and acceptance checks. Then proceed with implementation. This prompt authorizes routine implementation in the target frontend and its actual backend, including migrations, tests, and documentation. Do not ask for routine approval or commit/push/deploy/run production migrations.
3. Deliver in small end-to-end slices. Keep a short checked-off requirements list in the repo so work can resume after context compaction. Do not generate large duplicate specifications.

## Required product behavior

Implement the specification’s finance foundation: financial years; departments, programmes and account/budget classifications; original and revised budgets with version history; revenue and expenditure actuals; commitments and available balance; transaction/source traceability; projects and linked allocations; reports, exports, documents, controlled publication, and audit history.

Build a repeatable CSV/XLSX import flow with mapping, preview, row-level validation, an exception queue, idempotent commit/retry, duplicate protection, and reconciliation to source control totals. Use decimal-safe money storage and calculations. Keep USD and ZWG amounts distinct; never combine or convert currencies without a Council-approved rate source and rule.

Integrate finance with existing planning and environmental workflows through stable IDs and shared project references. Reuse existing application/project/ward/department entities and role surfaces. Let authorised staff trace a planning or environmental project from approved allocation through revisions, transactions, documents, and actual spend. Link environmental reviews, conditions, mitigation/monitoring actions, and related costs only where the existing domain supports them. Do not invent an EIA or statutory approval process.

Enforce backend RBAC and separation of duties, not just hidden menus. Support least-privilege finance administrators/officers, budget officers, departmental heads, committee reviewers, publishers, read-only auditors, technical administrators, and public users. Technical administrators must not gain financial approval authority by default. Public users see only approved published data; restricted supplier, personal, and commercially sensitive data stays private. Record significant changes and approval decisions; do not hard-delete financial or statutory records.

Keep the specification’s boundaries: do not replace the general ledger, execute payments, run payroll, or build procurement. Treat source formats, chart of accounts, statutory formulas, approval thresholds, disclosure rules, FX policy, retention, hosting, RPO/RTO, and UAT sign-off as Council decisions. Build safe configurable seams, document unresolved decisions, and never fabricate values or claim legal compliance. Do not call the system production-approved until Council validation, UAT, and restore testing are complete.

## Existing skills and engineering bar

The repo already has project Claude skills under `.claude/skills`; do not install duplicate bundles. Invoke the relevant existing skills as needed: `/gis-eos-orchestrator`, `/gis-eos-requirements`, `/gis-eos-municipal`, `/gis-eos-architect`, `/gis-eos-database`, `/gis-eos-backend`, `/gis-eos-frontend`, `/gis-eos-security`, `/gis-eos-qa`, and `/gis-eos-release`. Load specialist guidance on demand; keep the active context lean and follow `CLAUDE.md` and ADRs.

Use the project’s existing stack and patterns. Add migrations with constraints, indexes, rollback/operational notes; validate all input at the API boundary; parameterise SQL; protect uploads and exports; use secure sessions/secrets; add focused unit, integration, permission, import, and end-to-end checks. Verify type-check, build, tests, critical user flows, migration safety, accessibility, and production configuration. Fix regressions introduced by your changes; distinguish unrelated pre-existing failures.

## Completion report

Finish the implementation slices that can be completed safely in this environment. Report: delivered workflows; key files/migrations; commands and checks actually run with results; remaining Council decisions or external blockers; and exact next action for staging/UAT. Be candid: distinguish implemented, verified, and awaiting Council approval. Do not claim completion for unimplemented scope.
