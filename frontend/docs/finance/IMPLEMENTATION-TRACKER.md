# Finance implementation tracker

Live status of the finance module against the audits in `docs/gis-finance/` and
`../Manicipal-drums-backend-3/docs/audit/`. Updated whenever a module's status changes.

Last updated: 2026-11-12.

**How to read the status column.** *Done* means built, tested and the tests were run on the date
shown. *Partial* means usable with a stated gap. *Blocked* means the code cannot proceed without a
decision or data from the Council. *Pending* means not started. "Not re-verified" means the code
carries the fix but nobody has re-run its proof since the date shown; treat it as unconfirmed.

## 0a. Cash Office Phase A — till session lifecycle (built 2026-11-12; applied to vungu_dev 2026-11-12 19:49, not production)

Spec: `docs/superpowers/specs/2026-11-12-cashier-workspace-design.md` §3, §8, §16. Plan:
`docs/superpowers/plans/2026-11-12-cash-office-phase-a-sessions.md`. Runbook:
`docs/finance/MIGRATION-208-RUNBOOK.md`. Decisions: K1–K4, D24–D29 in `COUNCIL-DECISIONS.md`.

| Item | Status | Evidence |
|---|---|---|
| Diagnosis of "every cash point already has a session open" | Done | One cash point (MAIN), held by `demo.cashier2` in CS-0000002 since 07:38. The control was correct; no supervisor path, assignment or lifecycle existed |
| Backup of `vungu_dev` before 208, verified by restore | Done | `backups/vungu_dev-pre-208-20261112T1824.dump` (677 MB, sha256 recorded); restored to `vungu_cash208_scratch`; 51 finance tables identical |
| Migration 208: suspended/abandoned states, assignment, `cash_supervisor`, append-only session history | **Applied to `vungu_dev` 2026-11-12** (deployment record: runbook §6). Not production | Fingerprint guard proves no existing session, count, receipt, voucher or ledger row changed; idempotent; rollback tested round-trip on the clone |
| Database invariants L1–L10 incl. concurrency (two cashiers racing for a drawer; two supervisors and a receipt racing an abandonment) | Done | `verify-cash-session-lifecycle.js` 79/79 on the clone and on `vungu_acceptance_test` |
| 207's controls unchanged | Done | `verify-cash-office-invariants.js` 55/55, rates 86/86, ledger 34/34 on the migrated clone |
| Routes: suspend, resume, abandon, supervised close, drawers, witnesses, events, assignments | Done | `finance.cash.lifecycle.test.js` 8/8; all seven finance integration suites 128/128 on `vungu_acceptance_test`; backend unit suite 748/748 |
| Counter names who holds each drawer; suspend/resume; abandoned and stale states; supervisor drawers board; session history | Done | Component tests (counter 7 new, drawers 8 new, queue 1 new); frontend suite 1590 passed, 1 skipped; walked in the running app against the clone, screenshots at 1440 and 390 px, no console errors |
| Provisional policy (abandon threshold, assignment required) | **Awaiting Council (D29)** | Stored with `"provisional": true` and labelled provisional on screen |
| Blind count reversal (K1), post per receipt (K2), sundry debtors (K3) | **Not built — awaiting D24–D26** | Phase B onwards, after Phase A is reviewed |

## 0. Enterprise re-engineering — Phase 1: roles and the cash office (built 2026-11-12)

Design: `docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md`. Phases 2–7
(bank reconciliation and migration, creditors, procurement, stores, assets, payroll interface) are
**Pending** and each releases its own role.

| Item | Status | Evidence |
|---|---|---|
| Four roles: `cashier`, `accountant`, `revenue_officer`, `accounting_officer` (migration 207) | Done, 2026-11-12 | Role constraint rebuilt additively; grants asserted in `finance.cash.test.js`; migration fails if the cashier holds an approval or the accounting officer anything but read and export |
| Each new role lands on its own desk | Done, 2026-11-12 | Driven in the running app: cashier → Cash office, accountant → General ledger, revenue officer → Rates, accounting officer → Overview. No console errors, no horizontal overflow at 1440px or 390px. 7 tests in `enterpriseRoles.spec.ts` |
| Cash office schema and acts (migration 207) | Done, 2026-11-12 | `verify-cash-office-invariants.js` 55/55 on `vungu_dev` and `vungu_acceptance_test`, routes bypassed |
| Receipt only in the caller's own open session (C1); numbers issued, gapless, never reused (C2) | Done, 2026-11-12 | Proven in SQL, including two connections racing for one number |
| A receipt is never edited or deleted (C3) | Done, 2026-11-12 | Trigger refuses UPDATE and DELETE; cancellation keeps the receipt, its number and the reason |
| Cashier never verifies their own cash-up (C4); session posts all at once on verification (C5) | Done, 2026-11-12 | Function and CHECK constraint; before verification the ledger holds nothing from the session |
| A cash difference is explained and posted, never absorbed (C6); currencies counted separately (C8); non-cash never in the till (C9) | Done, 2026-11-12 | Same script; a shortage posts Dr difference / Cr till and each book still balances |
| Blind count (C7) | Done, 2026-11-12 | The server withholds an open session's totals from its own cashier; asserted in the route suite and the component test |
| Banking limited to verified takings; preparer never posts | Done, 2026-11-12 | Same script and suite |
| API: 19 routes in `src/routes/finance-cash.js`; audit rules at critical/high | Done, 2026-11-12 | `finance.cash.test.js` 12/12; auditor and accounting officer get 403 on all six write routes |
| Screen: Counter, Cash-ups, Banking, Setup, printed receipt | Done, 2026-11-12 | 9 component tests; the whole flow walked in the real app (open till → three receipts in two currencies → blind count short by 2.00 → explained → accountant verifies, 4 vouchers posted → banking recorded) |
| Rates payment at the counter | Partial | Built and reachable; **not exercised on real data** because no rates account exists (D19). Exercised only through `record_rates_receipt`'s own suite |
| Cash office on real data | **Blocked** | No cash point and no income code exist until Council decides D22. `vungu_dev` carries a demonstration counter and three demonstration income codes, each labelled "(demo)" |
| Cancelling a counter-issued rates receipt from the counter | Pending | Refused with a pointer to Rates, where the settled bills are released with it |
| End-of-day cash office report, cheque register, float top-up document | Pending | Not in Phase 1 |
| Receipt printing on a thermal printer | Not verified | Browser print stylesheet only; no hardware was available |

## 1. Rates billing, debtors and arrears (current module)

| Item | Status | Evidence |
|---|---|---|
| Schema: valuation roll, tariff, rates accounts, bills, receipts, billing runs, refusals (migration 205) | Done, 2026-11-11 | Applied to `vungu_dev` and `vungu_acceptance_test` |
| Arrears follow a reversal (migration 206 §1) | Done, 2026-11-11 | **Defect found and fixed.** A reversed receipt left its bill reading "settled"; rates arrears fell short of the receivable control account by the reversed amount (measured: 2,137.00). `scripts/verify-rates-invariants.js` failed 4 checks before the fix, passes after |
| Record a payment, commit a run, cancel a run (migration 206 §2–4) | Done, 2026-11-11 | Database functions, each atomic; none writes the ledger directly |
| A draft receipt cannot double-settle a bill | Done, 2026-11-11 | `finance.rates_bill_unsettled()` counts drafts; proven in the invariant script |
| A bill's voucher cannot be edited to a different amount and posted (migration 206 §6) | Done, 2026-11-11 | Trigger at posting, plus refusal in the ledger's edit and discard routes |
| Whoever drafts a tariff cannot approve it | Done, 2026-11-11 | CHECK constraint and route refusal |
| API: 32 routes in `src/routes/finance-rates.js`, registered in `server.js` | Done, 2026-11-11 | `finance.rates.test.js`, 10 end-to-end tests on a disposable database |
| Permissions on every route; auditor writes nothing | Done, 2026-11-11 | Same suite: 6 write routes return 403 to the auditor, 5 read routes return 403 to a non-finance officer |
| Audit trail: ledger and rates acts had no rule and were filed as generic medium-severity "FINANCE" | Done for rates, 2026-11-11 | 8 rules added to `auditLog.js`; rates routes record structured details (run totals, tariff rate, receipt amount, reasons). Tested for tariff approval and run commit |
| Screen: `RatesSection.vue`, on the workspace rail under "Book of account" | Done, 2026-11-11 | 8 component tests; run in the real app as finance officer and auditor at 1440px and 390px, no console errors, no horizontal overflow |
| Billing on real data | **Blocked** | 731 properties; 0 have a ratepayer of record (D19), 0 a rateable value (D17); no tariff is approved (D18). A run today raises 0 bills and 731 refusals. The registers are entered by the Council, not seeded |
| Bulk import of a valuation roll (file upload) | Pending | Values are entered one property at a time. 731 properties need an import path before D17 can be closed in practice |
| Printable bill and ratepayer statement (PDF) | Pending | The statement is on screen only |
| Reversing a posted bill or receipt from the Rates screen | Partial | Works through General ledger → reverse, and the arrears follow it. No button on the Rates screen |
| Interest on arrears, payment plans, write-offs | Pending | Not in the approved scope; needs a Council policy |
| Structured audit details on ledger posting, reversal and year-end close | Pending | The ledger routes now have audit rules at "critical" severity but record no before/after detail |

## 2. General ledger (built 2026-11-10, regression-checked 2026-11-11)

| Item | Status | Evidence |
|---|---|---|
| Vouchers, immutable ledger, two books, period locks, reversal, year-end close | Done | `verify-ledger-invariants.js` 34/34 on 2026-11-11 |
| Trial balance, position, performance, debtor ageing | Done | Ageing corrected by migration 206 |
| Cut-over reconciliation against Promun/Pastel (spec §6, check G12) | Pending | Deliberately not built until the cut-over workstream starts |
| Creditors, cashbook and bank reconciliation, fixed assets | Pending | Outside the selected scope. The position statement is incomplete without them and says so |
| Whether this system is the Council's book of account | **Blocked** | Council decision D16 |
| `finance_admin` may post vouchers and commit billing runs | **Blocked** | Departs from the "prepares everything, approves nothing" rule; Council decision D6 to confirm or reverse |

## 3. Audit blockers and major findings (`docs/gis-finance/PRODUCTION-READINESS.md`)

| Finding | Status | Evidence |
|---|---|---|
| BLOCKER-1 public API served unpublished data to signed-in staff | Done | `finance.access-control.test.js` 26/26 on 2026-11-11 |
| BLOCKER-2 separation of duties dissolvable by overrides | Done | Same suite. One test in it had gone stale when new approval permissions were added; it now reads the approvals from the catalogue |
| BLOCKER-3 auditor could withdraw a document | Done | Same suite |
| MAJOR-7 tests wrote into the development database | Done | Finance suites refuse a non-disposable database; all runs on 2026-11-11 used `vungu_acceptance_test` |
| MAJOR-1 reduction not re-checked against spatial allocations | Not re-verified | Migration 202 §7 |
| MAJOR-8 spatial allocations outside the closed-year guard | Not re-verified | Migration 202 |
| MAJOR-5 transaction report truncates at 100,000 rows | Pending | `LIMIT 100000` is still in `finance-reports.js`; whether the cut-off is now stated to the reader was not checked |
| MAJOR-2, 3, 4, 6, 9, 10, 11 | Not re-verified | Not examined in this pass |

## 4. Outside the code

| Item | Status |
|---|---|
| Council decisions D16–D19 (book of account, valuation roll, tariff, ratepayers) | Blocked on Council |
| Council UAT and sign-off | Pending |
| External penetration test | Pending |
| Off-host disaster-recovery rehearsal | Pending |
| Accessibility audit | Pending |

## 5. Test results, 2026-11-12

| Suite | Result |
|---|---|
| Backend unit (`test/`) | 565 passed, 34 suites |
| Backend finance integration (acceptance, access-control, security, rates, workflow, cash), on `vungu_acceptance_test` | 120 passed, 6 suites |
| `verify-cash-office-invariants.js` | 55 passed (`vungu_dev` and `vungu_acceptance_test`) |
| `verify-ledger-invariants.js` | 34 passed on `vungu_dev` |
| `verify-rates-invariants.js` | 86 passed on `vungu_dev`; 85 on `vungu_acceptance_test`, where one check expects all 731 parcels and that database holds 60 — a fixture difference that predates this work |
| Frontend finance (`vitest`) | 306 passed, 19 files |
| Frontend type check (`vue-tsc --noEmit`) | 0 errors |

Not run on 2026-11-12: `finance.map`, `finance.spatial-map`, `finance-spatial-allocation`,
`finance-cross-tenant`, `verify-budget-phasing.js`, the non-finance backend suites and the
non-finance frontend tests.

## 5a. Test results, 2026-11-11

| Suite | Result |
|---|---|
| Backend unit (`test/`) | 559 passed, 33 suites |
| Backend finance integration, on `vungu_acceptance_test` | 158 passed, 9 suites |
| `verify-rates-invariants.js` | 86 passed |
| `verify-ledger-invariants.js` | 34 passed |
| `verify-budget-phasing.js` | 21 passed |
| Frontend finance (`vitest`) | 285 passed, 16 files |
| Frontend type check (`vue-tsc --noEmit`) | 0 errors |

Not run: the non-finance backend suites that build an app against the development database, and
the non-finance frontend tests.
