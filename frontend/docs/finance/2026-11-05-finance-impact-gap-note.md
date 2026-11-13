# Impact and gap note — integrated budget and financial management

Date: 2026-11-05 · Baseline: `Vungu_RDC_Municipal_Budget_System_Technical_Specification.docx` v1.0
(proposed requirements, **not** settled statutory rules or Council approvals).

## Repositories actually in play

| Role | Path | Notes |
|---|---|---|
| Frontend (target) | `Manicipal-drums-frontend` | Vue 3 + Pinia + MapLibre. 290 SFCs under `src/views/<role>/sections/`. New capabilities go in `src/modules/<capability>/` per ADR 0005. |
| Backend (verified) | `../Manicipal-drums-backend-3` | Fastify 5 + Postgres/PostGIS. `CLAUDE.md` says `../app-backend`; **that path does not exist**. The real repo is `Manicipal-drums-backend-3` (`package.json` name `vungu-master-alpha-backend`, `server.js` registers every route under `/api`). |
| Reference (read-only) | `~/Downloads/cityvizor-staging` | Cityvizor fork. Useful: `server/src/worker/import/zimlg/parser.ts` column-alias table for PROMUN / Pastel-Sage exports, and the vote / economic-line / unit / event dimension set. **Not** reusable: the Czech `item < 5000 = income, 5000–8000 = expenditure` band rule in `public.accounting` (`database/development_db_data.sql:501`). |
| Database | `vungu_dev` on local Postgres | Live, 11 schemas, 291 tables. Migrations run via the ordered allowlist in `scripts/migrate.js`. |

## What already works (reused, not rebuilt)

- **Authentication and sessions** — `src/middleware/jwtAuth.js`: HS256, session rows (`public.user_session`), idle timeout, immediate revocation, MFA/TOTP, httpOnly cookies. No change needed.
- **Multi-council tenancy** — `public.local_authorities` is the spec's `councils` entity (Vungu = id 1, code `VUNGU`). `tenancy.make_tenant(relation, code)` (migration 167) adds `authority_id`, backfills, and installs row-level-security policies in one call. `src/lib/dbContext.js` makes `fastify.pg` run **as the requesting person**; `systemOf(fastify.pg)` is the explicit system escape hatch. This is the seam the spec's "later support additional Zimbabwean local authorities" needs, and it already exists.
- **Audit trail** — `public.admin_audit_event` (migration 124) written by the `onResponse` hook in `src/middleware/auditLog.js` for every mutating request by an identified user.
- **Soft delete** — migration 103 convention: `deleted_at` / `deleted_by`, DELETE endpoints are UPDATEs. Satisfies "do not hard-delete financial or statutory records".
- **Dual currency precedent** — `public.payments` already carries `amount_usd NUMERIC(14,2)` and `amount_zwg NUMERIC(16,2)` as **separate columns**. Follow this; never one `amount` plus a currency flag that invites summing.
- **Documents** — `src/routes/documents.js`, `src/routes/protected-uploads.js`, `src/middleware/fileSecurity.js` (type/size validation), `spatial_planning.permit_document`.
- **Planning / environmental domain** — `development_applications`, `spatial_planning.*` (83 tables), `council_ops.*` registers, `admin.ward`, `survey.projects`, `spatial_planning.planning_project`. These are the stable IDs finance must reference.
- **Wards and areas** — `admin.ward`, `admin.authority_ward`, `admin.authority_area` (the spec's "unit" / cost-centre dimension).

## What is missing

| Spec area | Gap |
|---|---|
| Financial years | No entity of any kind. |
| Departments / votes | No table. `users.department` is free text only. |
| Chart of accounts | None. `revenue_link.account_link` maps a parcel to an ERP account; it is not a classification. |
| Budgets | No original budget, no revisions, no version history, no commitments, no available balance. |
| Actuals | `public.payments` is citizen application fees only — not a council-wide revenue/expenditure register. |
| Transaction traceability | No source-system identifier, no import batch lineage. |
| Import flow | No CSV/XLSX import, mapping, preview, exception queue, idempotent commit or reconciliation anywhere in the backend. |
| Publication control | No approved/published distinction for financial data; no publication versions. |
| Finance RBAC | `users_role_check` has 19 roles, **none** of them financial. `requireRole()` checks a single `users.role` string against an allow-list — there is no permission catalogue and no separation of preparation / approval / publication. `admin` is currently permitted nearly everywhere, which would hand the technical administrator financial approval authority. |
| Reports / exports | No financial reporting or export surface. |

## Data links to existing domain

Finance references existing entities by their own primary keys — no parallel copies:

```
finance.financial_year ──┬─▶ finance.budget_line ──▶ finance.budget_revision (version history)
public.local_authorities │        │        │
  (= spec `councils`)    │        │        └──▶ finance.commitment
finance.department ──────┘        │
  (the vote)                      ├──▶ finance.transaction (actuals, source_ref, import lineage)
finance.account                   │
  (economic line, kind set        └──▶ finance.project_allocation ──▶ one of:
   explicitly per account)                   development_applications.id
finance.programme                            spatial_planning.planning_project.id
admin.ward (the unit)                        survey.projects.id
                                             council_ops.* register rows
```

## Permissions model

New `finance.permission` catalogue + `finance.role_permission` grants, checked by a
`requirePermission()` preHandler in the backend — not menu hiding. Separation of duties is
enforced as data, not convention:

- `finance.budget.prepare` / `.submit` / `.approve` and `finance.publication.publish` are distinct
  permissions and **no seeded role holds both `.approve` and `.publish`**.
- `admin` (technical administrator) is seeded with **no** finance approval or publication
  permission. It gets `finance.config.*` and nothing that moves money.
- A revision cannot be approved by the user who requested it (DB CHECK + route guard).
- `auditor` is read-only including audit history; it holds no write permission at all.

## Risks

1. **Chart of accounts is a Council decision.** The reference implementation infers revenue vs
   expenditure from a numeric band (Czech `položka` convention). That is wrong for Zimbabwe and
   wrong in principle. Each `finance.account` row carries an explicit `kind`, loaded from the
   Council-approved chart. Until Finance supplies it, imports referencing unknown codes go to the
   exception queue rather than being guessed.
2. **Currency.** USD and ZWG are stored in separate columns and never summed. Conversion requires a
   Council-approved rate source; the seam is `finance.exchange_rate_policy` and it is **empty and
   inert** until the Council sets it.
3. **Source formats unknown.** No representative council export has been supplied. The import
   mapping is configuration (`finance.column_mapping`), seeded with the alias set observed in the
   reference importer, not hard-coded.
4. **Approval thresholds and disclosure matrix unknown.** Thresholds are configuration rows; the
   public API returns only published rows and never counterparty identity fields.
5. **`admin` role breadth.** Existing routes permit `admin` widely. Finance routes deliberately do
   not follow that precedent; this is a behavioural difference reviewers should expect.

## Acceptance checks

| # | Check | How |
|---|---|---|
| A1 | Same file imported twice commits once | import idempotency test (file hash + idempotency key) |
| A2 | Malformed rows produce row-level exceptions, not a failed batch | import validation test |
| A3 | Imported totals reconcile to declared source control totals | reconciliation test |
| A4 | Original and revised allocations both remain visible after approval | budget revision test |
| A5 | Technical administrator cannot approve or publish | permission test |
| A6 | Requester cannot approve their own revision | permission test |
| A7 | Public API returns no unpublished row and no counterparty identity | public exposure test |
| A8 | Amounts in different currencies are never aggregated together | calculation test |
| A9 | A closed financial year rejects writes | financial year test |
| A10 | Planning project traces allocation → revisions → transactions → actual spend | integration test |

## Unresolved Council decisions

Tracked in `docs/finance/COUNCIL-DECISIONS.md`. Nothing in this implementation claims legal
compliance, and the system is not production-approved until Council validation, UAT and a
documented restore test are complete.
