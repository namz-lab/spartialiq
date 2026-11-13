# Financial Workflow Evidence — Synthetic Vungu RDC Data

Date: 2026-11-06
Suite: `src/routes/__tests__/finance.workflow.test.js`
Database: `vungu_acceptance_test` (isolated; no production data)
Result: **1 suite passed, 9 tests passed**
Harness: real Fastify app and real PostgreSQL; the fixture is tagged (`WF…`) and removed in
`afterAll`, including reopening the closed year so the tagged rows can be deleted.

This document records the end-to-end financial chain that was exercised and the figures it
produced. It is evidence that the accounting behaviour is **functionally implemented and
automatically tested**; it is not Council UAT and it is not a production transaction.

## 1. Chain under test

```
Financial Year → Department → Chart of Accounts → Budget Line (submit → approve)
  → Budget Revision (submit → approve)
  → Project (submit → approve → allocation)
  → Transaction (revenue / expenditure, USD / ZWG)
  → Project–transaction association
  → Departmental performance and reports
  → Publication (approve → mark budget lines → publish)
  → Public portal (overview, budget, revenue, expenditure, projects, transactions)
  → Withdrawal
  → Year close and post-close refusal
```

## 2. Synthetic dataset

| Item | Value |
| --- | --- |
| Financial year | `WF… Vungu 2033`, 2033-01-01 → 2033-12-31, reporting currency USD |
| Departments | Works and Roads (`WF…-WKS`), Health Services (`WF…-HLT`) |
| Accounts | Property rates (revenue), devolution grant (revenue), roads maintenance (expenditure), clinic operating costs (expenditure) |
| Budget lines | Roads USD 500,000; Roads ZWG 1,000,000; Rates USD 800,000; Clinics USD 200,000 |
| Approved revision | Roads USD +50,000 |
| Project | Gweru urban road rehabilitation, USD 120,000 approved, allocation USD 120,000 on the roads line |
| Transactions | Roads project USD 40,000; roads other USD 10,000; rates USD 300,000; roads ZWG 200,000 |
| Project link | The USD 40,000 transaction is associated to the project once |

All four budget lines are submitted by the budget officer and approved by the committee. The
revision is requested by the budget officer and approved by the committee (different people).
The project is approved by the committee and allocated by the finance administrator.

## 3. Assertions and observed figures

### 3.1 Revised allocation = original + approved revision

`GET /api/finance/performance?kind=expenditure` for Works/USD:

| Field | Observed |
| --- | --- |
| Original | `500000.00` |
| Approved adjustments | `50000.00` |
| Revised | `550000.00` |
| Actual | `50000.00` |
| Available excluding commitments | `500000.00` |
| Currencies present | `["USD", "ZWG"]` |

The revision changes the revised figure and leaves the original visible, as the specification
requires.

### 3.2 Revenue and expenditure land on the correct line and department

| Row | Actual |
| --- | --- |
| Works / USD expenditure | `50000.00` (40,000 + 10,000) |
| Works / ZWG expenditure | `200000.00` |
| Health / USD expenditure | `0.00` |
| Works / USD revenue | `300000.00` (revised `800000.00`) |

No transaction is attributed to the wrong department or to the wrong currency.

### 3.3 Departmental reconciliation

Summing `finance.v_budget_line_performance` for the year:

| Currency | Revised | Actual |
| --- | --- | --- |
| USD | `750000.00` (roads 550,000 + health 200,000) | `50000.00` |
| ZWG | `1000000.00` | `200000.00` |

The departmental totals reconcile to the sum of their lines, and USD and ZWG are never added
together.

### 3.4 Project spend is not double-counted

| Measure | Observed |
| --- | --- |
| Project allocated total | `120000.00` |
| Project actual spend | `40000.00` |
| Execution | `33.33%` |
| Budget-line actual (roads USD) | `50000.00` |
| All USD expenditure on the account | `50000.00` |
| Project-linked spend | `40000.00` (≤ all expenditure) |

The project-linked 40,000 is a view of the same transaction already inside the line's 50,000;
it is not a second cost.

### 3.5 Reports keep currencies separate and match the ledger

`GET /api/finance/reports/run?report=budget_vs_actual&format=json`:

| Currency | Revised (roads row) | Actual (all rows) |
| --- | --- | --- |
| USD | `550000.00` on the roads line | `350000.00` (50,000 expenditure + 300,000 revenue) |
| ZWG | — | `200000.00` |

Every row carries one of `USD`/`ZWG`; no row mixes them.

### 3.6 Nothing is public before publication

Before any publication exists, the year is absent from `/api/public/finance/years` and the
public transaction total for the year is `0`.

### 3.7 Published data reaches the portal

After the budget, revenue, expenditure and projects datasets are approved and published (and
the budget lines are marked published):

| Public surface | Observed |
| --- | --- |
| Overview USD expenditure revised | `750000.00` |
| Overview USD revenue revised | `800000.00` |
| Overview ZWG expenditure revised | `1000000.00` |
| Currency definition | contains “never added together” |
| Public budget rows | `4` |
| Public expenditure Works/USD | `50000.00` |
| Public expenditure Works/ZWG | `200000.00` |
| Public revenue Works/USD | `300000.00` |
| Public project actual / allocated | `40000.00` / `120000.00` |
| Public transaction total | `4`, currencies `{USD, ZWG}`, no `counterparty_name` |

Publication is the switch, and the portal reflects the same figures as the staff reports.

### 3.8 Withdrawal removes the data immediately

Withdrawing the expenditure publication with a reason returns 200, and the public expenditure
`by_department` and `by_account` arrays become empty. No financial record is deleted.

### 3.9 A closed year refuses new records

After the year is closed with a note:

| Attempt | Result |
| --- | --- |
| Create a budget line | 409 `year_closed` |
| Create a budget revision | 409 `year_closed` |
| Insert a transaction through the system connection (bypassing the API) | database error: “accepts no further financial records” |

The closed-year control is enforced by the database, not only by the route.

## 4. How to reproduce

```bash
cd <backend-repo>
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_acceptance_test' \
  node node_modules/jest/bin/jest.js \
  src/routes/__tests__/finance.workflow.test.js \
  --runInBand --testPathIgnorePatterns='/node_modules/'
```

## 5. What this evidence supports

- The accounting chain from budget to public portal works end to end with realistic
  multi-department, multi-currency data.
- Budget revisions, project allocations and transactions reconcile without double counting.
- Currency separation is preserved in performance views, reports and the public portal.
- Publication and withdrawal behave as the transparency model requires.
- Closed-year protection holds even when the API is bypassed.

## 6. Honest limits

| Gap | Why it matters | Status |
| --- | --- | --- |
| Synthetic data, not Council data | Proves behaviour, not that Vungu's real chart, votes and opening balances are loaded correctly | Council UAT required |
| Single-host, small fixture | Does not exercise the volume at which the public portal degrades; see `PERFORMANCE-TEST-EVIDENCE.md` | Separate finding |
| Transactions inserted via the system connection | Exercises the same table and triggers as the import path, but not the full upload → validate → commit UI flow at scale | Import path covered by the acceptance suite |
| No browser/UI walkthrough | The suite calls the API; it does not click through the Vue screens | Playwright/UAT outstanding |
| No approval-delegation or retention scenario | Delegation thresholds and retention rules are governance decisions not yet confirmed | Governance outstanding |

The workflow is **functionally verified with synthetic data**. Council acceptance (F-10) and a
UAT run with Finance, management, departmental heads and auditors remain outstanding.
