# Test Results

Date: 2026-11-06
Environment: Linux, Node.js with Jest 29.7 and Vitest 4.1.8, PostgreSQL 18.6 on `localhost:5432`.

## Summary — 2026-11-07 full-system re-run

After the 2026-11-07 fixes (F-14–F-18), every suite in both repositories is green. No suite was
skipped; each ran to completion.

| Suite class | Command | Result |
|---|---|---|
| Backend unit (54 suites + new cross-tenant suite) | `node node_modules/jest/bin/jest.js` | **55 suites, 602 passed** |
| Backend acceptance/integration (8 suites, freshly migrated DB) | `node scripts/prepare-acceptance-db.js test` | **8 suites, 78 passed** |
| Backend live HTTP (server on :3000) | `node scripts/run-live-server-tests.js` | **2 suites, 18 passed** |
| Frontend unit | `npm run test:unit` | **144 files, 1220 passed, 1 skipped** |
| Frontend types | `npx vue-tsc --noEmit` | clean |
| Frontend production build | `npm run build` | passed |

Previously failing, now green (each traced to a root cause, not skipped):

| Suite | Root cause | Fix |
|---|---|---|
| payments.applicationfee | 085 dropped `pending_payment` from the permit status CHECK (F-16) | migration 196 |
| permit-applications.pending-payment | same (F-16) | migration 196 |
| context-parcels | service reads a column no migration created (F-17) | migration 195 |
| layer-catalogue | parser read `q.mapcanvas.extent` off what is an ARRAY when a project has 2+ canvases | `qgisCatalogue.js` first-canvas fix |
| style-extractor | `acua_stands` layer shipped (183) with no style | registry v1 published + canonical QML |
| surveypro-import | fixture ground met the real farm extract after 187's fill; PROJ renamed the datum | fixtures moved north of the district; `/(Cape\|Arc 1950) -> WGS 84/` |
| gms.acceptance / gms.editing / geometry-validation / soft-delete / stand-allocation | seeding died on the ERP 23502 (F-14); three suites also self-minted authority-less users and never installed the tenancy context | authority contract + test-harness fixes |

The original Summary from the 2026-11-06 audit follows.

## Summary (2026-11-06)

| Suite | Command location | Result |
| --- | --- | --- |
| Backend finance unit (5 suites) | `test/`, `scripts/` | **71/71 passed** |
| Finance acceptance (integration) | `src/routes/__tests__/finance.acceptance.test.js` | **29/29 passed**, three consecutive clean runs |
| Finance security (adversarial) | `src/routes/__tests__/finance.security.test.js` | **33/33 passed** |
| Financial workflow (end-to-end) | `src/routes/__tests__/finance.workflow.test.js` | **9/9 passed** |
| Frontend (finance + route roles + QGIS) | `Manicipal-drums-frontend` | **66/66 passed** |
| Load / performance (32 runs) | `scripts/load-test-finance.js` | **0 errors, 0 timeouts** at 2k–50k |
| Backup / restore | `scripts/backup-db.js`, `restore-db.js`, `verify-restore.js` | **PASS, 0 mismatches** |

These are six different claims. The table below keeps them separate, because "the tests pass"
does not mean "the system is production-ready":

| Claim | Status |
| --- | --- |
| Functionally implemented | Yes |
| Automatically tested | Yes |
| Performance verified | Yes, for this host and dataset (2k–50k; 50k is the ceiling) |
| Security reviewed | Yes — static review, adversarial suite, publication/tenant re-verification on the 20k load dataset |
| Operationally verified | Partly — same-host DR and load measured; off-host DR, monitoring and real network path are not |
| Council accepted | No — AD-01–AD-05 and §15 UAT outstanding |

## 1. Backend finance unit suites

Command:

```bash
cd <backend-repo>
node node_modules/jest/bin/jest.js \
  scripts/migrate.test.js \
  test/finance-primitives.test.js \
  test/finance-spreadsheet.test.js \
  test/finance-pdf.test.js \
  test/finance-roles.test.js \
  --runInBand
```

Result: **5 suites passed, 71 tests passed** — 66 finance primitive/spreadsheet/PDF tests,
3 role-registry tests and 2 migration-plan tests.

What this proves:
- Money parsing, rounding and currency rules (`finance-primitives`).
- CSV/XLSX reading and validation (`finance-spreadsheet`).
- PDF report rendering (`finance-pdf`).
- Finance roles are accepted by the application role registry and labelled for the admin console (`finance-roles`).
- The migration plan is pinned and checked: the allowlist matches the reviewed plan and every
  listed file exists exactly once.

The migration-plan test now includes `194_finance_public_query_performance.sql`; the allowlist
in `scripts/migrate.js` and the pinned expectation in `scripts/migrate.test.js` were updated
together, and the test passes with the new file present exactly once.

## 2. Frontend finance, route-role and QGIS suites

Command:

```bash
cd <frontend-repo>
npx vitest run \
  src/modules/finance \
  src/router/__tests__/route-roles.spec.ts \
  src/map/__tests__/qgisVectorStyle.spec.ts \
  src/map/__tests__/vunguBasemap.spec.ts
```

Result: **6 files passed, 66 tests passed** (53 finance + 13 QGIS/basemap).

What this proves:
- Money display/composable behaviour.
- Finance permission/route-role expectations used by the UI.
- Finance workspace rendering/state behaviour covered by the module tests.
- Finance access administration (`access.spec.ts`, 4 tests): the screen does not call the API
  without `finance.users.manage_finance_roles`, saves role/override/reason as one change, and
  refuses to let an administrator edit their own access.
- QGIS layer styling and the Vungu basemap still behave after the type-only fix.

### 2.1 Frontend type check (P3)

The finance review found two type errors in `src/views/QGISMapView.vue` around lines 597/599
where a layer object literal did not satisfy the MapLibre type. They were fixed with
`satisfies maplibregl.AddLayerObject` — a type-only change with no runtime or GIS behaviour
change.

| Command | Result |
| --- | --- |
| `npx vue-tsc --noEmit` | **0 errors** |
| `npx vitest run src/map/__tests__/qgisVectorStyle.spec.ts src/map/__tests__/vunguBasemap.spec.ts` | **13 tests passed** |
| `npx vitest run src/modules/finance src/router/__tests__/route-roles.spec.ts` | **53 tests passed** |
| `npx eslint` on the touched file | 0 errors (14 pre-existing warnings elsewhere) |

## 3. Finance acceptance suite (integration, prepared database)

The suite is intentionally excluded from bare `npm test` by `scripts/test-suites.js` because it
needs seeded users and the migration-188 schema. It was run against the scratch database,
overriding the exclusion:

```bash
cd <backend-repo>
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_acceptance_test' \
  node node_modules/jest/bin/jest.js \
  src/routes/__tests__/finance.acceptance.test.js \
  --runInBand --testPathIgnorePatterns='/node_modules/'
```

Result: **1 suite passed, 29 tests passed**, in three consecutive clean runs after migration
194 was applied (8.516 s, 8.327 s, 9.033 s).

Tests executed:

| Test | Specification evidence |
| --- | --- |
| Finance administrator sets up year, votes and chart of accounts | UC-04, §3.2 |
| A5: technical administrator can read but not approve, publish, commit or configure | §2.2/§2.3, least privilege |
| F-02: technical administrator administers finance roles, overrides and scope; non-holder refused; self-edit refused; before/after audited | §2.2/§2.3, UC-12 |
| Auditor holds no write permission | §2.2, read-only auditor |
| Budget line prepared, submitted and approved by someone else | §3.3, §5.2 |
| Approved allocation cannot be edited in place | §3.3, version history |
| A4: revision changes revised budget and leaves original visible | §3.3, §6.1 |
| A6: requester cannot approve their own revision | §2.3, separation of duties |
| Reduction cannot take revised allocation below zero | §6.1 |
| A2/A3: malformed rows become exceptions and batch reconciles | §3.8, §6.5 |
| Mismatched control total blocks commit until overridden | §3.8, §6.5 |
| Uploader cannot commit; committer cannot upload blind | §2.3 |
| A1: same file cannot be committed twice; retried commit is same commit | §3.8, idempotency |
| A3: reconciliation shows declared, file and posted figures separately | §6.5 |
| A8: currencies kept apart, not aggregated | §6.4 |
| A10: project traces from allocation through revisions to actual spend | §3.6, UC-07 |
| Nothing is public before publication | §3.1, §3.10 |
| A7: publisher cannot approve, approver cannot publish; refusal audited | §2.3, §3.10 |
| Published budget reaches public portal with original and revised figures | UC-01/UC-06 |
| A7: published transactions carry no supplier identity; overview states currency rule | §3.5, §6.4, §10 |
| Withdrawing a publication removes public data and changes no record | §3.10 |
| Report carries required metadata; restricted columns need permission | §3.9 |
| Departmental head sees only their own vote | §2.2, data scopes |
| A9: closed financial year accepts nothing, through API or around it; project allocations and project-link add/remove return 409 `year_closed`, and direct SQL is refused | §6.5, §13.1 |
| F-03 and F-04: public projects follow the selected year and report other currencies separately | §3.1, §3.6, §6.4 |
| F-05: a transaction cannot cross financial years; a currency mismatch is stored and counted | §6.4, §8.1 |
| F-06: a year-on-year report compares two years without combining currencies | §3.9 |
| F-07 and F-08: public documents are paginated and year-scoped; the council name comes from the register | §3.1, §1.1 |
| Finance audit trail records what was done and refused | §3.10, UC-08 |

### 3.1 The one unexplained stall

On one run the acceptance suite stalled for ~43 minutes in the F-03/F-04 project-year test and
then completed. It did not reproduce in three subsequent clean runs (8.3–9.0 s each). A
`pg_stat_activity` poller running during a targeted re-run of that test recorded no lock, no
long-running query and no idle-in-transaction session. It is recorded as an **unexplained
one-off**, not a known defect, and the suite is not treated as flaky on the evidence available.
If it recurs, capture `pg_stat_activity`, `pg_locks` and the Jest open handles at the time.

## 4. Finance security suite (adversarial)

```bash
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_acceptance_test' \
  node node_modules/jest/bin/jest.js \
  src/routes/__tests__/finance.security.test.js \
  --runInBand --testPathIgnorePatterns='/node_modules/'
```

Result: **1 suite passed, 33 tests passed**.

Covers authentication/session revocation (missing, malformed, wrong-secret, expired,
session-less and wrong-type tokens; logout), the role/permission matrix, anonymous versus
public route separation, unpublished-data separation, SQL-injection payloads and enum
rejection, document access, magic-byte upload rejection, valid private PDF handling, path
traversal, audit-table grants/guard trigger and audited refusals.

Full detail: `SECURITY-TEST-EVIDENCE.md`.

### 4.1 Publication/tenant re-verification after migration 194

Because migration 194 rewrote every publication policy and both tenant policies, the security
properties were re-checked directly against the 20,000-transaction load dataset, not only
through the acceptance fixtures:

| Property | Result |
| --- | --- |
| `v_published_transaction` exposes no supplier/counterparty columns | Yes — 17 columns, none identifying a counterparty |
| Withdraw expenditure publication | Revenue only remains (6,667 of 20,000 rows) |
| Withdraw all publications | 0 transactions, 0 years, 0 accounts, 0 departments, 0 projects |
| Currency separation | USD 16,667 / ZWG 3,333, not combined |
| Direct-client role mapping | Mapped role sees its authority's 20,000 rows with `app.authority_id`/`app.platform` unset |
| Mapped role tenant scope | Sees only its own authority's rows |

## 5. Financial workflow suite (end-to-end, synthetic data)

```bash
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_acceptance_test' \
  node node_modules/jest/bin/jest.js \
  src/routes/__tests__/finance.workflow.test.js \
  --runInBand --testPathIgnorePatterns='/node_modules/'
```

Result: **1 suite passed, 9 tests passed**.

Covers the chain financial year → department → budget → revision → transaction → project →
report → public portal → withdrawal → close, with these observed figures:

- Revised roads/USD allocation 500,000 + 50,000 = 550,000; actual 50,000.
- Departmental reconciliation: USD revised 750,000 / actual 50,000; ZWG revised 1,000,000 /
  actual 200,000.
- Project spend 40,000 is inside the line's 50,000, not additional.
- Budget-vs-actual report keeps USD and ZWG separate.
- Public portal shows the published figures, then removes expenditure on withdrawal.
- Closed year refuses budget lines, revisions and direct SQL inserts.

Full detail: `FINANCIAL-WORKFLOW-EVIDENCE.md`.

Both the security and workflow suites were re-run after the load harness changed
`test/helpers/buildApp.js` to accept a `poolMax` option: **42/42 passed**.

## 6. Load and performance test

```bash
cd <backend-repo>

# Seed (statement_timeout off only for the large delete)
LOAD_TX_COUNT=20000 \
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_workflow_test?options=-c%20statement_timeout%3D0' \
  node scripts/seed-load-dataset.js

# Refresh statistics — mandatory
psql 'postgresql://<user>:<password>@localhost:5432/vungu_workflow_test' -c "
  ANALYZE finance.transaction; ANALYZE finance.account; ANALYZE finance.publication;
  ANALYZE finance.department; ANALYZE finance.budget_line; ANALYZE finance.project;
  ANALYZE finance.project_allocation; ANALYZE finance.project_transaction;"

# Run
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_workflow_test' \
  node scripts/load-test-finance.js --levels 1,10,30,50 --seconds 15 \
  --json /tmp/opencode/load-20k-after.json
```

### 6.1 Before the fix

| Volume | Concurrency | p50 | p95 | Errors |
| --- | --- | --- | --- | --- |
| 2,000 tx | 1 / 10 / 30 | 642 / 4,327 / 2,013 ms | 3,435 / 17,540 / 12,628 ms | 0 / 0 / 0 |
| 20,000 tx | 1 / 10 / 30 | 3,822 / 12,699 / 23,028 ms | 5,837 / 26,134 / 30,733 ms | 0 / 0 / **17 (27.42%)** |

All 20k/concurrency-30 errors were HTTP 500 with PostgreSQL `57014` statement timeout. The
cause was per-row evaluation of the `finance.transaction` `published_select` RLS policy
(`loops=20000`, ~990k shared buffers, ~3.1 s under `vungu_app` vs ~20 ms as superuser).

### 6.2 After the fix (migration 194)

Full 32-run matrix: 2k/10k/20k/50k × concurrency 1/10/30/50, public-only and mixed.

| Volume | Workload | c1 p50 | c10 p50 | c30 p50 / p95 | c50 p50 / p95 | Errors | Timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | public | 21.6 | 107.9 | 311 / 845 | 541 / 1,327 | 0 | 0 |
| 2,000 | mixed | 31.5 | 145.8 | 462 / 986 | 761 / 1,266 | 0 | 0 |
| 10,000 | public | 45.5 | 209.4 | 663 / 1,852 | 1,059 / 2,820 | 0 | 0 |
| 10,000 | mixed | 73.7 | 440.9 | 1,185 / 2,763 | 2,241 / 4,019 | 0 | 0 |
| 20,000 | public | 75.7 | 335.0 | 1,144 / 3,242 | 1,914 / 4,868 | 0 | 0 |
| 20,000 | mixed | 127.9 | 690.4 | 2,392 / 5,838 | 3,826 / 7,079 | 0 | 0 |
| 50,000 | public | 527.9 | 1,021.9 | 3,453 / 14,385 | 6,124 / 17,091 | 0 | 0 |
| 50,000 | mixed | 305.8 | 1,928.7 | 5,109 / 15,280 | 11,320 / 18,432 | 0 | 0 |

All latencies in ms. **0 HTTP 500 and 0 statement timeouts in all 32 runs.** Database CPU
averaged 196–260% of one core (max 353% on 4 cores); RSS peaked at 5.5 GB at 50k.

The 50k row is the stress ceiling: it returns no errors, but a p95 of 17 s at c50 is not a
supported operating point. The pilot range is 2k–10k; 20k is usable.

Full detail: `PERFORMANCE-TEST-EVIDENCE.md`.

## 7. Backup and restore drill

```bash
DATABASE_URL='postgresql://…/vungu_dev' node scripts/backup-db.js
CONFIRM_RESTORE=1 DATABASE_URL='postgresql://…/vungu_restore_test' \
  node scripts/restore-db.js backups/db-20261106-074529.dump
SOURCE_DATABASE_URL='postgresql://…/vungu_dev' \
  RESTORE_DATABASE_URL='postgresql://…/vungu_restore_test' \
  node scripts/verify-restore.js
```

Result: **PASS, 0 mismatches** — 126 migrations, 26 finance tables, 4 views, 31 triggers, all
row counts matched; USD 650,000.00 and ZWG 18,500,000.00 kept separate; 190/190 uploads
hash-identical. Backup 103.41 s, restore 65.35 s (same host).

Full detail: `BACKUP-RESTORE-EVIDENCE.md`.

## 8. Not run / not evidenced

| Test area | Status | Reason |
| --- | --- | --- |
| Full backend `npm test` | Not run as a whole | Known unrelated GIS/stands suites fail for their own reasons; the finance suites were run directly |
| Full frontend `npm run test:unit` | Not run as a whole | Finance and route-role suites were run directly |
| Playwright end-to-end | Not run | Requires a running frontend/backend pair and seeded data |
| Accessibility / responsive audit | Not run | Requires manual or automated browser audit |
| Off-host DR rehearsal | Not run | Restore was same-host; RTO excludes off-site copy and cut-over |
| Penetration/security test | Not run | No external engagement; the 33-test suite covers known classes only |
| CSRF-specific test | Not run | Strategy reviewed, not adversarially tested |
| Long soak (hours) | Not run | 15 s levels show steady state, not multi-hour memory/connection drift |
| Production UAT | Not run | Requires Council participation |

The acceptance, security and workflow suites share `vungu_acceptance_test` and create/remove
tagged fixtures. Run them **sequentially** (as documented above); two Jest processes against
the same database at once interfere with each other's fixtures and produce spurious failures.
A cross-suite flake in the acceptance publication-audit assertion (it read the last five
publication refusals globally, so rows from the other suites could push out the row under
test) was fixed on 2026-11-06 by scoping the query to the publication being tested. The three
suites then passed **71/71 on five consecutive combined runs**.

## 9. Documentation discrepancies

- `docs/finance/*` says 65 primitive tests; the executed suites report 66 primitive/PDF/spreadsheet
  tests and 69 including the three role tests, 71 including the two migration tests.
- The acceptance note now says 29 tests, matching the suite after the F-02, F-03/F-04, F-05,
  F-06 and F-07/F-08 tests were added.
- The old `finance-public.js` comment cited `test/finance-public-exposure.test.js`, which did
  not exist. It now cites the acceptance public-exposure and withdrawal tests that actually
  assert the property (F-11).
- `migrations/194_finance_public_query_performance.sql` is the latest migration and is included
  in the plan; earlier notes that stopped at 193 are superseded.

## 10. Verdict

The executed finance evidence is green: **71 backend unit tests, 66 frontend tests, 29
acceptance tests, 33 security tests and 9 workflow tests pass**, the frontend type check is
clean, the local backup/restore drill passed, and the public portal returns **zero errors and
zero timeouts across 32 load runs at 2k–50k transactions**.

That is evidence for the accounting, import, publication, audit, access-administration,
security, workflow and public-performance controls.

It is **not** evidence for operational readiness. Off-host DR, accessibility, an external
penetration test and Council UAT remain untested, and AD-01–AD-05 remain unsigned.
