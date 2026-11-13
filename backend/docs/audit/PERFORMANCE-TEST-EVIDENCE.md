# Performance Test Evidence — Finance Module

Date: 2026-11-06
Harness: `scripts/load-test-finance.js`
Dataset: `scripts/seed-load-dataset.js`
Database: `vungu_workflow_test` (isolated; no production data)
Fix under test: `migrations/194_finance_public_query_performance.sql`

**Result: the public-portal performance blocker is closed.** The public finance read path was
re-measured at 2,000 / 10,000 / 20,000 / 50,000 transactions per year and concurrency
1 / 10 / 30 / 50, in both a public-only and a mixed staff/public workload. Across all 32 runs
there were **0 HTTP 500 responses and 0 statement timeouts**, including at 50,000
transactions. At the operating volumes for the pilot (2k–10k) the public portal answers in
tens to low hundreds of milliseconds at single-user concurrency and stays under 4.3 s at
concurrency 50.

This document records the method, the original measurement, the root cause, the fix, the
before/after results, the 50k ceiling, and the security re-verification. The numbers come from
one local host, not production hardware; they show the shape of the load behaviour, not a
production capacity plan.

---

## Independent re-verification — 2026-11-07

Scratch chain-built database (through migration 197), 50,000 published transactions across one
account and one year, `ANALYZE` run, queried as the public session (`vungu_app`, no authority):

| Query | Plan | Time | Buffers |
|---|---|---|---|
| Public transaction page (`ORDER BY txn_date DESC LIMIT 50`) | index scan over the migration-194 hashed-membership policy; the per-row correlated plan is absent | **0.788 ms** | 179 shared hit |
| Whole-year currency aggregate (worst case: touches every row) | seq scan + hash aggregate, policy evaluated as a hashed subplan | **414.9 ms** | 101,048 shared hit |

The 197 session guard adds no scans (it is evaluated in the same policy expression). Scratch
database dropped after measurement. Conclusion: the fix holds at 2.5× the scale where the
original defect timed out (~3.1 s / HTTP 500), with headroom.

---


## 1. Status of this evidence

| Claim | Status |
| --- | --- |
| **Functionally implemented** | Yes — the public finance endpoints and views exist and serve the published dataset |
| **Automatically tested** | Yes — 29 acceptance, 33 security, 9 workflow, 71 backend unit and 66 frontend tests pass (see `TEST-RESULTS.md`) |
| **Performance verified** | **Yes, for this host and dataset** — 32 load runs, 0 errors, 0 timeouts; before/after comparison below |
| **Security reviewed** | Yes — publication visibility, withdrawal, currency separation and tenant scoping re-verified on the 20k dataset (§8) |
| **Operationally verified** | Partly — load and same-host backup/restore measured; off-host DR, production monitoring and real network path are not |
| **Council accepted** | No — Council UAT and the AD-01–AD-05 architecture decisions are outstanding |

Performance verified is **not** the same as production-ready. This document closes the
performance question only. The go/no-go position is in `PRODUCTION-READINESS-REPORT.md`.

---

## 2. Method

### 2.1 Harness

`scripts/load-test-finance.js` starts the real finance Fastify app as a **separate process**
from the load generator, so the generator cannot stall the server's event loop and inflate
latency. The app is built with the production pool size (`max: 30`). Each level runs a
closed-loop load for a fixed duration (15 s unless stated) and reports:

- requests, throughput (rps), error count and error rate;
- HTTP status counts (200 / 500 / other);
- latency min / mean / p50 / p95 / p99 / max;
- per-scenario breakdown, so a slow endpoint can be attributed rather than averaged away;
- sample errors, including the PostgreSQL SQLSTATE where the app surfaced one.

### 2.2 Datasets

`scripts/seed-load-dataset.js` seeds a self-contained `LOAD-` year with accounts, departments,
budget lines, projects, allocations, transactions and four publications. Volumes tested:
2,000 / 10,000 / 20,000 / 50,000 transactions.

The seed is re-run for each volume, and **`ANALYZE` is run on every finance table after the
seed** (`finance.transaction`, `account`, `publication`, `department`, `budget_line`,
`project`, `project_allocation`, `project_transaction`). Without this, autovacuum statistics
lag the bulk load and the planner makes decisions that have nothing to do with the code under
test. This was a defect in the original measurement and is corrected here.

### 2.3 Workloads

Two workloads are reported for every volume:

- **Public-only** — the four anonymous portal reads:
  `public_overview`, `public_transactions`, `public_budget`, `public_projects`.
- **Mixed** — the four public reads plus four authenticated staff reads:
  `admin_budget_lines`, `admin_performance`, `admin_report_budget_vs_actual`,
  `admin_report_transaction_register`.

The mixed workload is dominated by the transaction-register export, which streams the whole
year; it is intentionally heavier than normal browsing and is reported separately so that
public-portal latency is not obscured by a bulk report.

### 2.4 Database CPU and memory

A sampler (`/tmp/opencode/db_sampler.py`, a working artefact) reads
`/proc/<pid>/stat` and `/proc/<pid>/statm` for every `postgres` process once a second and sums
CPU ticks and RSS. CPU is expressed as a percentage of one core, so 200% means two cores busy
on a 4-core host. Sampling covers the whole load level, including the app's own pool.

### 2.5 Environment and role

- Linux, 4 CPU cores, 14 GiB RAM, PostgreSQL 18.6 on `localhost:5432`.
- Application role `vungu_app`, reached with `SET ROLE` after connecting as `postgres`; the
  production `statement_timeout = '30s'` (`migrations/076_production_hardening.sql:92`) is in
  force for load runs.
- The load database holds no production data. `vungu_dev` and `vungu_acceptance_test` were
  not used for load generation.

---

## 3. Before the fix

### 3.1 20,000 transactions — the failing case

| Concurrency | Requests | Duration | Throughput | p50 | p95 | p99 | Errors | Error rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 13.2 s | 0.2 rps | 3,821.8 ms | 5,837.1 ms | 5,837.1 ms | 0 | 0% |
| 10 | 18 | 24.3 s | 0.7 rps | 12,699.4 ms | 26,133.6 ms | 26,133.6 ms | 0 | 0% |
| 30 | 62 | 42.1 s | 1.5 rps | 23,028.0 ms | 30,733.1 ms | 31,033.4 ms | 17 | **27.42%** |

All 17 errors were HTTP 500 with PostgreSQL `code 57014`,
`canceling statement due to statement timeout`. The application role carries
`statement_timeout = '30s'`, so the portal's slow queries were cut off rather than allowed to
run indefinitely. At 20k the portal failed more than a quarter of requests at 30 concurrent
readers.

### 3.2 2,000 transactions — slow but surviving

| Concurrency | Requests | Duration | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 9 | 12.1 s | 0.7 rps | 642.1 ms | 3,434.5 ms | 3,434.5 ms | 0 |
| 10 | 29 | 18.6 s | 1.6 rps | 4,326.5 ms | 17,539.8 ms | 17,871.2 ms | 0 |
| 30 | 105 | 16.4 s | 6.4 rps | 2,012.8 ms | 12,627.8 ms | 14,621.1 ms | 0 |

Even at 2k the portal was not fast — a multi-second p95 for a public site — but it stayed
within the 30 s timeout and returned no errors. The cliff was between 2k and 20k. There was
no before-fix measurement at 10k or 50k; those volumes are reported after the fix only.

### 3.3 Root cause

The cost was in the row-level security policy that decides whether a transaction is public.
`finance.transaction` had a `published_select` policy
(`migrations/188_finance_foundation.sql:1495`):

```sql
CREATE POLICY published_select ON finance.transaction FOR SELECT USING (
  deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM finance.account a
                JOIN finance.publication p
                  ON p.financial_year_id = finance.transaction.financial_year_id
                 AND p.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
               WHERE a.id = finance.transaction.account_id AND p.state = 'published'));
```

PostgreSQL evaluated that `EXISTS` **per row**. Because the policy referenced
`finance.account`, the account policy ran inside it too, and that policy ran its own
publication lookup. At 20,000 rows that was ~40,000 correlated publication scans.

The tenant policies compounded it: both `tenant_select` and the `FOR ALL tenant_write` policy
(which also applies to SELECT) called `app.is_platform()`, `app.visible_authorities()` and
`app.authority_id()` for every row, and each call performs a table or catalog lookup.

`EXPLAIN (ANALYZE, BUFFERS)` on the public transaction view as `vungu_app` at 20k rows:

| Observation | Before |
| --- | --- |
| Execution time (application role) | ~3,064 ms |
| Execution time (superuser, same count) | ~20 ms |
| Shared buffers | 990,720 |
| Per-row subplan | `SubPlan 3 … loops=20000` |
| Account lookup per row | `account_pkey` index scan, 20,000 loops |
| Publication scan per row | `publication` sequential scan, 20,000 loops |

The publication table has 4 rows and the account table 9, but the policy re-read them once per
transaction. That was the difference between 20 ms and 3 seconds.

A second, compounding issue was an unstable plan on `finance.v_project_performance`, which
sometimes took ~13–14 s and sometimes ~2 s. It is addressed by the same fix's uncorrelated
subqueries and by the corrected statistics; it is re-measured below rather than assumed
fixed.

---

## 4. The fix: migration 194

`migrations/194_finance_public_query_performance.sql` is a **policy-only rewrite**. It makes
no schema change, adds no column, denormalises nothing, caches nothing, and does not touch the
publication workflow.

It has two parts, neither of which changes which rows are visible.

### 4.1 Publication policies become uncorrelated set membership

Each publication test is rewritten from a correlated `EXISTS` to an uncorrelated
`IN (SELECT …)` over the same tables. The transaction policy is now:

```sql
(financial_year_id, account_id) IN (
  SELECT p.financial_year_id, a.id
    FROM finance.account a
    JOIN finance.publication p
      ON p.dataset = CASE a.kind WHEN 'revenue' THEN 'revenue' ELSE 'expenditure' END
     AND p.state = 'published')
```

Because the subquery does not reference the outer row, PostgreSQL evaluates it **once** and
hashes it. It still joins `finance.account` (so the account policy's `deleted_at IS NULL` and
live-publication rule still apply) and still joins `finance.publication` on
`state = 'published'`. Withdrawing a publication removes the row from the set in the same
instant, because nothing is materialised.

### 4.2 Tenant policies short-circuit for an anonymous session

`src/lib/tenancy.js` sets `app.authority_id` to `''` for an anonymous request and to the
authority for staff. The new tenant predicate tests
`COALESCE(current_setting('app.authority_id', true), 'x') <> ''` first, so:

- staff (non-empty) take the normal tenant branch;
- the public session (`''`) is false without calling any session function;
- a **direct database client** (migration 166) never sets the GUC, so the setting is `NULL`,
  not `''`, and it keeps the original role-mapping path.

The platform branch is guarded by `app.is_platform()`, not by the setting alone, so a direct
client cannot claim platform access by setting `app.platform`. `app.is_platform()` itself was
made cheap: it tests the setting before doing the role lookup.

### 4.3 Why not denormalise, cache, or disable RLS

A flag on the transaction would need a trigger on publication and on account, could drift, and
would make withdrawal non-atomic. Disabling RLS or granting the public role direct table
access would remove the control the audit relies on. This migration keeps both the publication
model and the tenant model intact; it changes only the shape of the predicate, not its
meaning. That is why the security re-verification in §8 is part of the acceptance of this fix,
not an afterthought.

### 4.4 Plan after the fix

`EXPLAIN (ANALYZE, BUFFERS)` at 20k rows as `vungu_app`:

| Observation | Before | After |
| --- | --- | --- |
| Public view count | ~3,064 ms | **68.5 ms** |
| Base table count | — | 36.7 ms |
| Shared buffers | 990,720 | **3,639** |
| Publication subplan | `loops=20000` | **`loops=1`, hashed** |

A 45× reduction in wall time and a 272× reduction in buffer touches on the same data, with the
same visibility rules.

---

## 5. After the fix — full matrix

All 32 runs: 0 errors, 0 HTTP 500, 0 `57014` timeouts. `c` is concurrency. CPU and RSS are the
database process totals sampled once a second for the whole level.

### 5.1 Public-only workload

| Transactions | c | Requests | rps | Errors | 200 | 500 | p50 ms | p95 ms | p99 ms | max ms | DB CPU avg/max | DB RSS avg/max MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 1 | 600 | 40.0 | 0 | 600 | 0 | 21.6 | 41.4 | 58.6 | 65.0 | 221/323% | 1,676/2,400 |
| 2,000 | 10 | 1,211 | 80.0 | 0 | 1,211 | 0 | 107.9 | 255.6 | 330.7 | 454.5 | 221/323% | 1,676/2,400 |
| 2,000 | 30 | 1,241 | 81.3 | 0 | 1,241 | 0 | 311.1 | 845.0 | 1,039.7 | 1,439.1 | 221/323% | 1,676/2,400 |
| 2,000 | 50 | 1,227 | 79.0 | 0 | 1,227 | 0 | 540.8 | 1,326.8 | 1,556.2 | 2,038.8 | 221/323% | 1,676/2,400 |
| 10,000 | 1 | 293 | 19.5 | 0 | 293 | 0 | 45.5 | 85.3 | 118.4 | 123.6 | 241/350% | 1,734/2,496 |
| 10,000 | 10 | 610 | 40.2 | 0 | 610 | 0 | 209.4 | 578.4 | 728.4 | 891.4 | 241/350% | 1,734/2,496 |
| 10,000 | 30 | 605 | 39.1 | 0 | 605 | 0 | 662.5 | 1,851.7 | 2,220.9 | 2,493.1 | 241/350% | 1,734/2,496 |
| 10,000 | 50 | 596 | 37.5 | 0 | 596 | 0 | 1,059.3 | 2,820.2 | 3,629.7 | 4,249.3 | 241/350% | 1,734/2,496 |
| 20,000 | 1 | 185 | 12.2 | 0 | 185 | 0 | 75.7 | 147.4 | 178.1 | 203.4 | 245/353% | 1,923/2,813 |
| 20,000 | 10 | 373 | 24.3 | 0 | 373 | 0 | 335.0 | 950.9 | 1,068.2 | 1,129.7 | 245/353% | 1,923/2,813 |
| 20,000 | 30 | 351 | 22.2 | 0 | 351 | 0 | 1,143.8 | 3,241.7 | 3,607.4 | 3,999.7 | 245/353% | 1,923/2,813 |
| 20,000 | 50 | 368 | 21.7 | 0 | 368 | 0 | 1,913.6 | 4,868.2 | 5,951.0 | 6,130.4 | 245/353% | 1,923/2,813 |
| 50,000 | 1 | 41 | 2.7 | 0 | 41 | 0 | 527.9 | 652.7 | 705.8 | 705.8 | 260/349% | 3,474/5,479 |
| 50,000 | 10 | 92 | 5.7 | 0 | 92 | 0 | 1,021.9 | 4,058.2 | 4,802.7 | 4,802.7 | 260/349% | 3,474/5,479 |
| 50,000 | 30 | 92 | 4.9 | 0 | 92 | 0 | 3,452.8 | 14,385.0 | 15,918.9 | 15,918.9 | 260/349% | 3,474/5,479 |
| 50,000 | 50 | 123 | 5.5 | 0 | 123 | 0 | 6,124.2 | 17,090.5 | 18,662.3 | 18,947.7 | 260/349% | 3,474/5,479 |

### 5.2 Mixed staff/public workload

| Transactions | c | Requests | rps | Errors | 200 | 500 | p50 ms | p95 ms | p99 ms | max ms | DB CPU avg/max | DB RSS avg/max MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 1 | 448 | 29.9 | 0 | 448 | 0 | 31.5 | 58.0 | 78.5 | 121.1 | 199/306% | 1,790/2,506 |
| 2,000 | 10 | 974 | 64.6 | 0 | 974 | 0 | 145.8 | 276.5 | 333.7 | 393.7 | 199/306% | 1,790/2,506 |
| 2,000 | 30 | 910 | 60.1 | 0 | 910 | 0 | 462.1 | 986.2 | 1,329.3 | 1,496.4 | 199/306% | 1,790/2,506 |
| 2,000 | 50 | 1,039 | 66.2 | 0 | 1,039 | 0 | 761.0 | 1,266.4 | 1,391.7 | 1,474.5 | 199/306% | 1,790/2,506 |
| 10,000 | 1 | 192 | 12.7 | 0 | 192 | 0 | 73.7 | 178.2 | 224.2 | 230.1 | 196/326% | 1,846/2,611 |
| 10,000 | 10 | 338 | 22.1 | 0 | 338 | 0 | 440.9 | 831.2 | 1,029.7 | 1,207.4 | 196/326% | 1,846/2,611 |
| 10,000 | 30 | 359 | 22.4 | 0 | 359 | 0 | 1,185.2 | 2,763.0 | 3,093.8 | 3,488.3 | 196/326% | 1,846/2,611 |
| 10,000 | 50 | 357 | 21.4 | 0 | 357 | 0 | 2,241.3 | 4,019.4 | 4,552.2 | 4,778.7 | 196/326% | 1,846/2,611 |
| 20,000 | 1 | 109 | 7.3 | 0 | 109 | 0 | 127.9 | 366.0 | 420.1 | 505.0 | 208/317% | 1,989/2,869 |
| 20,000 | 10 | 197 | 12.6 | 0 | 197 | 0 | 690.4 | 1,574.0 | 2,147.7 | 2,205.5 | 208/317% | 1,989/2,869 |
| 20,000 | 30 | 183 | 10.7 | 0 | 183 | 0 | 2,391.6 | 5,838.0 | 8,092.3 | 8,377.4 | 208/317% | 1,989/2,869 |
| 20,000 | 50 | 223 | 11.9 | 0 | 223 | 0 | 3,825.5 | 7,079.3 | 9,435.7 | 10,306.4 | 208/317% | 1,989/2,869 |
| 50,000 | 1 | 38 | 2.5 | 0 | 38 | 0 | 305.8 | 933.9 | 966.5 | 966.5 | 222/348% | 3,204/4,940 |
| 50,000 | 10 | 74 | 4.4 | 0 | 74 | 0 | 1,928.7 | 4,971.1 | 6,099.9 | 6,099.9 | 222/348% | 3,204/4,940 |
| 50,000 | 30 | 75 | 4.2 | 0 | 75 | 0 | 5,109.0 | 15,280.1 | 15,742.1 | 15,742.1 | 222/348% | 3,204/4,940 |
| 50,000 | 50 | 102 | 4.0 | 0 | 102 | 0 | 11,320.3 | 18,432.4 | 24,243.1 | 24,954.1 | 222/348% | 3,204/4,940 |

The mixed workload's higher p50 at 10k–20k is the transaction-register export, not the public
portal. The public-only table is the honest measure of the public experience.

### 5.3 Before/after at the operating volumes

| Case | Before | After | Change |
| --- | --- | --- | --- |
| 2k, c1, p50 | 642.1 ms | 31.5 ms | ~20× faster |
| 2k, c10, p95 | 17,539.8 ms | 276.5 ms | ~63× faster |
| 2k, c30, p95 | 12,627.8 ms | 986.2 ms | ~13× faster |
| 20k, c1, p50 | 3,821.8 ms | 75.7 ms (public) / 127.9 ms (mixed) | ~50× / ~30× |
| 20k, c10, p95 | 26,133.6 ms | 950.9 ms (public) / 1,574.0 ms (mixed) | ~27× / ~17× |
| 20k, c30, errors | 17 (27.42%) | **0** | blocker removed |
| 20k, c30, p95 | 30,733.1 ms | 3,241.7 ms (public) / 5,838.0 ms (mixed) | ~9× / ~5× |
| 20k view count (plan) | ~3,064 ms / 990,720 buffers | 68.5 ms / 3,639 buffers | 45× / 272× |

At 2k, the after-fix comparison uses the mixed workload because that is the workload that was
measured before the fix; the public-only numbers are better still.

---

## 6. Against the targets

| Target | Result |
| --- | --- |
| Zero HTTP 500 from normal public financial queries | **Met** — 0 across all 32 runs, including 50k |
| No statement timeouts under expected operating load | **Met** — 0 `57014` at 2k–20k; at 50k the maximum observed was 18.9 s against a 30 s timeout |
| No deterioration in publication security | **Met** — §8 re-verifies visibility, withdrawal, currency separation and tenant scoping on the 20k dataset |
| No new query path that bypasses RLS | **Met** — the fix changes the policy predicate only; the public routes still read `finance.v_published_transaction` through `vungu_app` |

### 6.1 The 50k ceiling

50,000 transactions is a stress ceiling, not a target. At 50k the public portal still returns
**no errors**, but at concurrency 50 the p95 is 17.1 s (public) and 24.9 s maximum (mixed) —
inside the 30 s timeout but far beyond a good public experience. The cause is volume, not the
publication policy: the per-request cost now scales with the number of published rows that must
be aggregated for the overview and projects figures.

Guidance for the pilot:

- **2k–10k (expected pilot range):** suitable for public traffic. p95 ≤ 2.8 s at c50
  public-only, ≤ 4.3 s maximum.
- **20k:** usable; p95 4.9 s at c50 public-only, no errors. Plan a follow-up if the council
  reaches this volume with high concurrency.
- **50k+:** do not treat as supported without either a public read model or summary tables
  (options B/D in the original assessment) or a larger database host. This is a capacity
  decision, not a correctness defect.

---

## 7. What this evidence does and does not prove

Proves:

- The public portal no longer times out at the volumes tested, including 20k where it
  previously failed 27% of requests.
- The fix is a policy-shape change with the same visibility semantics; the plan is now hashed
  once per query instead of evaluated per row.
- Staff screens remain functional and no longer queue behind multi-second public work at the
  tested volumes.
- Database CPU stays within the host (avg 196–260%, max 353% of one core on 4 cores) and RSS
  stays below 5.5 GB at 50k.

Does not prove:

| Limit | Effect |
| --- | --- |
| Single local host | Absolute latencies differ on production hardware; the mechanism and the shape will not |
| Synthetic data | Realistic in shape, not Vungu's actual transaction mix |
| Read-only mix | Does not measure import/commit or PDF/XLSX report generation under load (covered as synchronous-processing risk, S-06) |
| No production network | No TLS termination, reverse proxy or real client latency |
| No long soak | 15 s levels show steady-state behaviour, not multi-hour memory or connection drift |
| 50k is a ceiling | It shows the boundary, not a supported operating point |

---

## 8. Security re-verification on the load database

Run against the 20,000-transaction dataset **after** migration 194, as `vungu_app` with
`app.authority_id`, `app.platform` and `app.user_id` set to the anonymous values. All checks
passed.

| Check | Result |
| --- | --- |
| `finance.v_published_transaction` exposes no supplier/counterparty columns | Yes — columns are `id, authority_id, financial_year_id, txn_date, amount, currency, description, reference, account_code, account_name, account_kind, department_code, department_name, budget_line_id, published_at, data_as_at, reporting_period_label`. No counterparty or supplier name, ID or account |
| Withdraw the expenditure publication | Visible rows fall to revenue only (6,667 of 20,000); expenditure rows disappear immediately |
| Withdraw every publication | 0 transactions, 0 financial years, 0 accounts, 0 departments, 0 projects visible |
| Currency separation | Preserved — USD 16,667 / ZWG 3,333, not aggregated |
| Direct-client role mapping | A role mapped through `tenancy.role_authority` sees its authority's 20,000 rows with `app.authority_id` and `app.platform` unset — the short-circuit does not break direct database clients |
| Tenant scoping for a mapped role | Mapped role sees only its authority's rows |

These are the same properties the 33-test security suite asserts
(`src/routes/__tests__/finance.security.test.js`), re-checked against the load dataset because
migration 194 touched every publication policy and both tenant policies.

---

## 9. Regression after the fix

Run after migration 194 was applied to `vungu_acceptance_test` and `vungu_dev`:

| Suite | Result |
| --- | --- |
| Backend unit + migration (5 suites, incl. `scripts/migrate.test.js`) | **71/71 passed** |
| Finance acceptance | **29/29 passed**, three consecutive clean runs at 8.3–9.0 s |
| Finance security | **33/33 passed** |
| Finance workflow | **9/9 passed** |
| Frontend (finance module + route roles + QGIS) | **66/66 passed** |

The acceptance suite stalled once for ~43 minutes in the F-03/F-04 project-year test and did
not reproduce in three subsequent clean runs; the stall was investigated against
`pg_stat_activity` and no lock or long-running query was found. It is recorded as an
unexplained one-off, not a known defect, and the suite is not considered flaky on the evidence
available. Details in `TEST-RESULTS.md`.

---

## 10. Reproduction

```bash
cd <backend-repo>

# 1. Seed a volume (statement_timeout must be off for the large delete)
LOAD_TX_COUNT=20000 \
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_workflow_test?options=-c%20statement_timeout%3D0' \
  node scripts/seed-load-dataset.js

# 2. Refresh statistics — do not skip this
psql 'postgresql://<user>:<password>@localhost:5432/vungu_workflow_test' -c "
  ANALYZE finance.transaction; ANALYZE finance.account; ANALYZE finance.publication;
  ANALYZE finance.department; ANALYZE finance.budget_line; ANALYZE finance.project;
  ANALYZE finance.project_allocation; ANALYZE finance.project_transaction;"

# 3. Public-only matrix
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_workflow_test' \
  node scripts/load-test-finance.js \
    --only public_overview,public_transactions,public_budget,public_projects \
    --levels 1,10,30,50 --seconds 15 --json /tmp/opencode/load-20k-public-after.json

# 4. Mixed matrix
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_workflow_test' \
  node scripts/load-test-finance.js --levels 1,10,30,50 --seconds 15 \
    --json /tmp/opencode/load-20k-after.json
```

The raw JSON for all 32 runs and the database CPU/RSS samples are held in
`/tmp/opencode/load-<size>-{after,public-after}.json` and
`/tmp/opencode/db-<size>-{mixed,public}.jsonl`; the consolidated table is
`/tmp/opencode/load-summary.json`. They are working artefacts, not repository content.

---

## 11. Conclusion

The performance blocker recorded in the original version of this document is **closed**. The
public portal now serves the 2k–10k transaction range comfortably and the 20k range without
errors; 50k is the measured ceiling. The fix preserves the publication and tenant security
models exactly, and that preservation was re-verified on the load dataset rather than assumed.

What remains is not performance work: an external penetration test, an off-host DR rehearsal,
an accessibility audit, Council UAT, and Council/ICT sign-off on AD-01–AD-05. Those are
recorded in `PRODUCTION-READINESS-REPORT.md`.
