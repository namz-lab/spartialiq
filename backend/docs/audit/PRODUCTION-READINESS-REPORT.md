# Production Readiness Report

Date: 2026-11-06
System: Vungu RDC municipal budget/finance module (inside the wider Manicipal Drums platform)
Verdict: **Not production-ready — but the performance blocker is closed.**

The financial controls are sound and backed by security, workflow, backup/restore and load
evidence. The public-portal performance defect that blocked the previous assessment has been
fixed and re-measured across 2k–50k transactions with zero errors. Four conditions for go-live
remain unmet, and none of them is a code defect in the finance module:

1. no external penetration test;
2. no off-host disaster-recovery rehearsal;
3. no accessibility audit;
4. no Council UAT or Council/ICT acceptance of the architecture decisions AD-01–AD-05.

This report replaces the earlier version that recorded performance as a blocker. It separates
six different claims that are often conflated:

| Claim | Status |
| --- | --- |
| **Functionally implemented** | Yes — all audited finance behaviours exist |
| **Automatically tested** | Yes — 29 acceptance, 33 security, 9 workflow, 71 backend unit and 66 frontend tests pass |
| **Performance verified** | **Yes, for this host and dataset** — 32 load runs at 2k/10k/20k/50k × 1/10/30/50, 0 HTTP 500, 0 timeouts |
| **Security reviewed** | Yes — static review, 33 adversarial tests, and publication/tenant visibility re-verified on the 20k load dataset |
| **Operationally verified** | Partly — same-host backup/restore and load testing measured; off-host DR, production monitoring and real network path are not |
| **Council-accepted** | No — AD-01–AD-05 and §15 UAT are outstanding |

## 1. Readiness summary

| Area | Status | Evidence |
| --- | --- | --- |
| Functional finance core | Ready | 29/29 acceptance tests; 71 backend unit tests; 66 frontend tests |
| Security controls | Ready, no external pen test | 33/33 adversarial security tests; static review; **no penetration test** |
| Financial workflow | Ready with synthetic data | 9/9 end-to-end workflow tests; reconciliation and currency separation verified |
| Access administration | Ready | `GET/PUT /api/finance/users/:id/access` guarded by `finance.users.manage_finance_roles`; self-edit refused; before/after audited |
| Public transparency | **Ready** | Publication-driven RLS preserved; year-scoped projects; separate USD/ZWG reporting; paginated documents; performance verified to 20k |
| Data integrity | Ready | Closed-year and SoD controls; cross-year links refused by the database |
| Reporting | Ready | Nine reports and exports, including year-on-year |
| Backup / restore | Locally verified | 709 MB dump restored in 65.35 s; 0 mismatches; 190/190 uploads hash-identical |
| **Performance** | **Passed (G6)** | 20k public c50: p50 1.91 s / p95 4.87 s, **0 errors** (was 27.42% timeouts); 0 errors across all 32 runs |
| Architecture acceptance | Outstanding | A1–A5 assessed and recommended; AD-01–AD-05 unsigned |
| Off-host DR | Outstanding | Restore was same-host only; RTO excludes off-site copy and cut-over |
| Penetration test | Outstanding | No engagement; suite covers known classes only |
| Accessibility | Outstanding | No WCAG/responsive audit |
| Council UAT / sign-off | Not started | No UAT evidence |

## 2. What this review completed

The production-readiness review was run as seven work packages.

| # | Work package | Outcome |
| --- | --- | --- |
| P1 | Backup and disaster recovery | `scripts/backup-db.js` hardened to self-verify the dump and write SHA-256; an isolated restore drill passed with 0 mismatches. See `BACKUP-RESTORE-EVIDENCE.md`. |
| P2 | Architecture assessment | Five deviations (A1–A5) assessed with costed options and final recommendations for AD-01–AD-05. No rewrite undertaken. See `ARCHITECTURE-ASSESSMENT.md`. |
| P3 | Frontend type errors | `QGISMapView.vue` fixed with `satisfies maplibregl.AddLayerObject`; `vue-tsc --noEmit` reports 0 errors; QGIS 13/13 and finance 53/53 still pass. |
| P4 | Security testing | 33-test adversarial suite added. See `SECURITY-TEST-EVIDENCE.md`. |
| P5 | Financial workflow verification | 9-test end-to-end suite added, covering budget → revision → project → transaction → report → portal → withdrawal → close. See `FINANCIAL-WORKFLOW-EVIDENCE.md`. |
| P6 | Final audit and documentation | Audit reports, `TEST-RESULTS.md`, `SECURITY-AUDIT.md` and the audit index. |
| P7 | Performance remediation | `migrations/194_finance_public_query_performance.sql` rewrites the publication policies as uncorrelated set membership and short-circuits the tenant policies for anonymous sessions. Full 32-run matrix re-measured. See `PERFORMANCE-TEST-EVIDENCE.md`. |

No production data was changed. Tests and load runs used isolated databases
(`vungu_acceptance_test`, `vungu_workflow_test`, `vungu_restore_test`); read-only inspection
used `vungu_dev`. All changes are uncommitted for review.

## 3. Go-live blockers

1. **Architecture deviations not accepted (F-10).** Vue instead of Angular, mixed
   JavaScript/TypeScript, `/api` instead of `/api/v1`, local storage instead of MinIO, and
   synchronous processing instead of workers. Final recommendations are written
   (AD-01–AD-05); Council/ICT signatures are not. Each recommendation records the business
   justification, technical/security/scalability implications, cost/effort and who must
   approve it.
2. **No Council UAT sign-off (§15).** The specification makes Council UAT an acceptance
   criterion. No UAT has been run. The script is in §9.
3. **Backup restore is only same-host.** The drill proves the dump is complete and restorable,
   but not the operational RTO (off-site copy, new server, DNS, smoke tests) or the 24-hour RPO.
4. **No penetration test and no accessibility audit.** The security suite is adversarial but
   not an external engagement; the public portal has not been checked for WCAG or responsive
   behaviour.

The public-portal performance blocker that appeared here in the previous version is **closed**
and was independently re-verified on 2026-11-07 at 50k transactions — see §7 and
`PERFORMANCE-TEST-EVIDENCE.md`. The 2026-11-07 cross-tenant read (S-03) is fixed by
migration 197 and regression-tested; blockers 1–4 above remain the open ones.

## 4. Financial integrity

The controls that matter to an auditor are implemented and tested:

- **Budget arithmetic:** revised allocation = original + approved revisions; the original
  stays visible. Verified in the workflow suite (`500,000 + 50,000 = 550,000`).
- **Attribution:** revenue and expenditure land on the correct budget line, department and
  currency. USD and ZWG are never combined; a currency mismatch is stored and counted, not
  converted, because §6.4 requires it to be visible.
- **No double counting:** project-linked spend is a view of the same transaction already inside
  the line's actual, never an additional cost (`40,000` project spend inside `50,000` line
  actual).
- **Reconciliation:** departmental totals equal the sum of their lines
  (USD revised 750,000 / actual 50,000; ZWG revised 1,000,000 / actual 200,000).
- **Publication:** nothing is public before an approved publication; withdrawal removes it
  immediately without deleting records; the public transaction view carries no counterparty
  identity.
- **Closed year:** the database refuses new budget lines, revisions and transactions after
  close, even when the API is bypassed.
- **Separation of duties:** approval and publication are distinct permissions; a requester
  cannot approve their own revision; refusals are audited.
- **Audit trail:** append-only by grant and trigger; the application role cannot rewrite it.

Evidence: acceptance suite (29), workflow suite (9), security suite (33).

## 5. Security

Strong static and dynamic controls, with the following honest position:

- Authentication rejects missing, malformed, wrong-secret, expired, session-less and
  wrong-type tokens; logout revokes the session immediately.
- Role and permission matrix, public/administrative separation and SQL-injection handling are
  exercised against the real middleware and database.
- Uploads are checked by magic bytes, not just MIME type; private documents are not served
  anonymously; path traversal is refused.
- **The performance fix did not weaken access control.** It changes the shape of the
  publication and tenant predicates, not their meaning. On the 20k load dataset after the fix:
  no counterparty columns are exposed; withdrawing expenditure leaves revenue only; withdrawing
  all publications leaves 0 transactions, 0 years and 0 accounts; USD and ZWG stay separate;
  direct database clients mapped through `tenancy.role_authority` still see exactly their
  authority's rows.
- Residual risks: no external penetration test, no CSRF-specific test, local filesystem
  storage without signed URLs, synchronous import/report work. See `SECURITY-AUDIT.md` and
  `SECURITY-TEST-EVIDENCE.md`.

## 6. Backup and disaster recovery

| Measure | Result |
| --- | --- |
| 2026-11-07 re-run (709.7 MB dump, sha256 sidecar) | PASS, 0 mismatches |
| Backup duration (2026-11-07) | 126 s |
| Restore duration (same host, 2026-11-07) | 74 s |
| (2026-11-06 first drill) | 709,366,992 bytes / `24909e38…65024`; 103.41 s / 65.35 s |
| Verification | PASS, 0 mismatches: 126 migrations, 26 finance tables, 4 views, 31 triggers |
| Financial totals | USD 650,000.00 / ZWG 18,500,000.00, separate |
| Uploads | 190/190 files, identical SHA-256 |
| RPO | Up to 24 h (nightly logical dump; no WAL archiving) |
| Operational RTO | **Not measured** — 65 s excludes off-site copy, provisioning and cut-over |

The drill closes the "restore never demonstrated" finding **on a test instance**. It does not
constitute an off-host DR rehearsal.

## 7. Performance — blocker closed

**Independently re-verified 2026-11-07** on a scratch chain-built database loaded with 50,000
published transactions (2.5× the scale where the original defect timed out): the public
transaction query runs in **0.79 ms** (paginated, 179 shared buffers — index scan over the
migration-194 hashed-membership policy) and the worst-case whole-year aggregate in **415 ms**;
the per-row correlated plan that caused the 3.1 s timeouts is absent from the EXPLAIN output.
The check ran with migration 197's session guard in place, so the verification covers the policy
as it ships. Scratch database dropped after measurement.

Measured with the real app, production pool size (`max: 30`), server in a separate process
from the generator, `ANALYZE` run after every seed. Full detail in
`PERFORMANCE-TEST-EVIDENCE.md`.

### 7.1 Root cause

The `finance.transaction` publication policy was a correlated `EXISTS` over
`finance.account` and `finance.publication`, evaluated **once per candidate row**
(`loops=20000`, ~990,720 shared buffers, ~3.1 s under `vungu_app` vs ~20 ms as superuser). The
public budget, projects and overview inherited the cost, and the tenant policies added per-row
session-function calls on top.

### 7.2 Fix

`migrations/194_finance_public_query_performance.sql` — a **policy-only rewrite**:

- every publication test becomes an uncorrelated `IN (SELECT …)` over the same tables, so
  PostgreSQL hashes it once per query (`loops=1`);
- the tenant policies short-circuit for an anonymous session (`app.authority_id = ''`) without
  calling any session function, while direct database clients (which never set the GUC) keep
  the role-mapping path;
- `app.is_platform()` tests the setting before doing a role lookup.

No schema change, no denormalisation, no materialised copy, no cached publication state. The
publication and tenant models are unchanged, so withdrawal remains atomic.

### 7.3 Before/after at 20,000 transactions

| Metric | Before | After |
| --- | --- | --- |
| Public view count (plan) | ~3,064 ms / 990,720 buffers | **68.5 ms / 3,639 buffers** |
| Single request (c1) p50 | 3,821.8 ms | **75.7 ms** (public) / 127.9 ms (mixed) |
| c30 p50 / p95 | 23,028 / 30,733 ms | **1,144 / 3,242 ms** (public) |
| c30 errors | **17 / 62 (27.42%)**, all `57014` | **0 / 351** |

### 7.4 Full matrix summary

All 32 runs (2k/10k/20k/50k × 1/10/30/50, public-only and mixed): **0 HTTP 500, 0 statement
timeouts**.

| Volume | Workload | c50 p50 | c50 p95 | c50 errors | DB CPU avg/max |
| --- | --- | --- | --- | --- | --- |
| 2,000 | public | 541 ms | 1,327 ms | 0 | 221/323% |
| 2,000 | mixed | 761 ms | 1,266 ms | 0 | 199/306% |
| 10,000 | public | 1,059 ms | 2,820 ms | 0 | 241/350% |
| 10,000 | mixed | 2,241 ms | 4,019 ms | 0 | 196/326% |
| 20,000 | public | 1,914 ms | 4,868 ms | 0 | 245/353% |
| 20,000 | mixed | 3,826 ms | 7,079 ms | 0 | 208/317% |
| 50,000 | public | 6,124 ms | 17,091 ms | 0 | 260/349% |
| 50,000 | mixed | 11,320 ms | 18,432 ms | 0 | 222/348% |

The pilot range is 2k–10k and is comfortably served. 20k is usable. 50k is the measured
ceiling — it still returns no errors, but p95 approaches the 30 s timeout, so it is not a
supported operating point without a public read model or a larger host.

### 7.5 Target assessment

| Target | Result |
| --- | --- |
| Zero HTTP 500 from normal public financial queries | **Met** — 0 across all 32 runs |
| No statement timeouts under expected operating load | **Met** — 0 at 2k–20k; max 18.9 s at 50k against a 30 s timeout |
| No deterioration in publication security | **Met** — re-verified on the 20k dataset (§5) |

## 8. Technical debt and architecture decisions

Final recommendations are written in `ARCHITECTURE-ASSESSMENT.md`; the summary is:

| Ref | Area | Recommendation | Approval |
| --- | --- | --- | --- |
| A1 / AD-01 | Vue instead of Angular | **Accept.** Framework choice does not affect statutory controls; a rewrite is 12–20 person-weeks and fixes nothing | ICT |
| A2 / AD-02 | JavaScript instead of TypeScript | **Accept backend JS for the pilot; migrate finance incrementally.** Frontend is already TS; a full rewrite is 6–10 person-weeks | ICT |
| A3 / AD-03 | `/api` instead of `/api/v1` | **Remediate before external integration.** Add a versioned alias; low cost, avoids a breaking change later | ICT |
| A4 / AD-04 | Local storage instead of MinIO | **Accept for a single-server pilot; move to object storage before horizontal scaling.** Needs a documented backup/retention rule in the meantime | Council + ICT |
| A5 / AD-05 | Synchronous processing | **Accept with documented row/time limits for the pilot; add a queue when volume grows.** The limits must be operational, not aspirational | ICT |

Additional debt: no full-stack compose/worker deployment; no monitoring/alerting evidence;
mixed backend language. The architecture assessment deliberately did not start a rewrite — a
rewrite would not have fixed the RLS cost and would have discarded working, tested code.

## 9. Council UAT requirements

UAT must be run by Finance, management, departmental heads and the auditor, on a
non-production copy, and signed off. At minimum:

1. Set up a financial year, departments and the council's real chart of accounts.
2. Prepare, submit and approve a budget; confirm the original and revised figures.
3. Record revenue and expenditure in USD and ZWG; confirm they are reported separately.
4. Create and approve a project; allocate from a budget line; link a transaction; confirm no
   double counting.
5. Produce the report set, including budget-vs-actual and year-on-year, and export one report.
6. Publish budget, revenue, expenditure and projects; confirm the public portal shows the same
   figures and no supplier identity.
7. Withdraw a publication; confirm the public data disappears and no record is deleted.
8. Close a year; confirm new records are refused.
9. Exercise a refused approval and confirm it appears in the audit trail.
10. Confirm approval delegation thresholds and retention rules.
11. Record sign-off against the specification, including acceptance or rejection of AD-01–AD-05.

## 10. Deployment checklist

### Data and database
- [ ] Run `npm run migrate` against a production-like copy; the plan now includes
      `194_finance_public_query_performance.sql` after `193`. Migration 190 refuses cross-year
      enforcement if live violations exist — correct or retire those rows first.
- [ ] Confirm `finance` grants for `vungu_app` and RLS enabled on every finance table.
- [ ] Load the council's approved chart of accounts, departments, programmes and year labels
      (not seeded guesses).
- [ ] Confirm `finance.setting` currency, commitment and overspend thresholds with Finance.

### Performance
- [x] Rewrite the `finance.transaction` publication read path; migration 194 applied and
      recorded in `schema_migrations` on `vungu_workflow_test`, `vungu_acceptance_test` and
      `vungu_dev`.
- [x] Re-run the load harness at 2k/10k/20k/50k × 1/10/30/50; 0 errors, 0 timeouts.
- [x] Re-run the security suite and re-verify publication visibility after the policy change.
- [ ] Set a documented import row/time limit until a worker exists (AD-05).
- [ ] If the council expects >20k transactions/year with heavy public concurrency, plan a
      public read model or summary tables before launch.

### Security
- [x] Enforce `finance.users.manage_finance_roles` on access administration.
- [ ] External penetration test covering auth, public endpoints, document download and import.
- [ ] Confirm TLS termination, HSTS and secure cookies at the reverse proxy.
- [ ] Confirm secrets are outside the repository and rotation ownership is assigned.
- [ ] Confirm the malware scanner is installed and reachable.
- [ ] Decide the CSRF strategy for cookie-based sessions and test it.

### Operations
- [ ] Schedule `npm run backup` nightly and copy backups **off-host**, encrypted.
- [ ] Perform an off-host restore rehearsal; record operational RTO/RPO including cut-over.
- [ ] Configure `/health` and `/ready` probes and alerting.
- [ ] Configure log aggregation with restricted access and retention.
- [ ] Define maintenance windows and a cross-migration rollback procedure.
- [ ] Provide a full-stack deployment (frontend + backend + PostgreSQL + Redis + storage) or
      document the manual equivalent.

### Accessibility and UAT
- [ ] WCAG/responsive review of the public portal and finance workspace.
- [ ] Complete the UAT script in §9 and record sign-off.

### Governance
- [ ] Record Council/ICT acceptance of AD-01–AD-05.
- [ ] Confirm the public disclosure matrix (transactions, suppliers, documents).
- [ ] Confirm approval delegation thresholds and retention rules.

## 11. Release gates

| Gate | Exit criterion | Status |
| --- | --- | --- |
| G1 — Functional | F-01–F-09, F-11 closed with tests | **Passed** |
| G2 — Data integrity | Cross-year trigger in place; live violations reviewed | **Passed (review at deploy)** |
| G3 — Reporting | Year-on-year delivered; Council confirms the report set | **Partial** |
| G4 — Security | Penetration test findings closed; access permission enforced | **Not passed** (no pen test) |
| G5 — Operations | Restore drill passed; off-host DR, monitoring and backups live | **Not passed** (same-host only) |
| G6 — Performance | Public portal meets the agreed threshold at expected volume | **Passed** — 0 errors to 20k; 50k ceiling documented |
| G7 — UAT | Signed Council UAT and accepted architecture deviations | **Not passed** |

## 12. Final assessment

The module should be described to the Council as **functionally strong, automatically tested,
and now performance-verified, but not yet production-ready**. The accounting, import,
publication and audit design is better than a typical first release, and this review closed the
evidence gaps for security, workflow, local backup/restore and public-portal performance. The
remaining work is not "finish the finance features" and it is not "fix the database": it is
produce the external and operational evidence — penetration test, off-host DR, accessibility
audit — and obtain Council UAT and written acceptance of the architecture decisions.

A staged pilot remains sensible — one financial year, a small set of published datasets, two
finance users — and it may now include the public portal at the expected 2k–10k volume. It
should still not be called production-ready until G4, G5 and G7 are passed.
