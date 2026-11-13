# General ledger architecture — Vungu RDC becomes the book of account

Date: 2026-11-10 · Status: **design approved by the client; one Council decision outstanding (D16)**
Supersedes the scoping position in `2026-11-10-finance-director-capability-design.md` §0.

## 0. The governance item that is not ours to decide

`docs/finance/COUNCIL-DECISIONS.md` currently closes with:

> "It does not replace the Council's general ledger and cannot be used as a book of account."

The client has directed that this system **become** the general ledger. That sentence must therefore
be retracted, and retracting it is a **Council** act, not a developer's: the Auditor-General audits
local authorities under s309(2) of the Constitution and the Audit Office Act (`ZW3`), and will audit
against whatever the Council has resolved. This is raised as **D16** in the decision register and
the sentence stays in place until Council resolves it. Nothing in this document claims compliance
with any Zimbabwean statute or with IPSAS; "IPSAS-aligned" below describes a presentation target,
and whether it is met is a determination for Council and the Auditor-General.

What changes immediately and legitimately: the system stops describing imported figures as the only
truth it holds, because it will now originate figures of its own.

## 1. The four decisions taken, and what each one forces

| # | Decision | Consequence for the build |
|---|---|---|
| 1 | **Two parallel sets of books**, one per currency, each self-balancing | A voucher carries ONE currency and all its lines share it. A journal may never mix USD and ZWG. The trial balance is `GROUP BY currency` and there are two of them. Council decision D4 survives intact and no exchange rate is applied anywhere. |
| 2 | **Full accrual, IPSAS-aligned** | Rates are recognised as revenue when **billed**, not when received, which raises a receivable. This is what unblocks D13. Statements are a statement of financial position and a statement of financial performance, not a receipts-and-payments account. |
| 3 | **Parallel run for one period, then cut over** | The ledger must be able to run a period that Promun/Pastel also ran, and produce a trial balance that is **reconciled against theirs** before cut-over. That reconciliation is a first-class feature, not a spreadsheet exercise. |
| 4 | **Scope now: rates billing, debtors and arrears** | Plus the ledger core, which is a prerequisite rather than an option. Creditors, cashbook/bank reconciliation and fixed assets are **deferred** — see §7. |

### Why two sets of books is the right answer and not a workaround

A trial balance must balance. With two currencies and no Council-approved conversion basis (D4),
a single balancing trial balance is arithmetically impossible without inventing a rate. Keeping one
self-balancing ledger per currency is also how Zimbabwean councils genuinely keep books through
currency instability, and it is what `public.payments` already anticipates by holding
`amount_usd` and `amount_zwg` as **separate columns** rather than one amount plus a flag
(`docs/finance/2026-11-05-finance-impact-gap-note.md`, "Dual currency precedent").

## 2. Architecture

### 2.1 The voucher / ledger split, taken from ERPNext

ERPNext's one genuinely load-bearing accounting idea is the separation of the **business document**
from the **ledger line**: an invoice, receipt, payment or journal is a *voucher*; posting it emits
`gl_entry` rows; the rows are never edited, and cancellation writes a reversal and sets
`is_cancelled` (`erpnext/accounts/general_ledger.py:643` `make_reverse_gl_entries`,
`:764` `set_as_cancel`). Balance is checked at posting
(`:458` `get_debit_credit_difference`, `:491` `raise_debit_credit_not_equal_error`).

We adopt the split and the immutability. We depart from ERPNext in three ways:

**(a) Balance is enforced in the DATABASE, not only in application code.** ERPNext throws in
Python. This repository's own stated philosophy is that the database constraint "is the one that
holds if the other two are ever edited carelessly"
(`src/routes/finance-budget.js` header, on separation of duties). For a book of account the
Auditor-General will examine, an unbalanced voucher must be impossible, not merely rejected by the
current version of a route. A deferred constraint trigger on posting asserts
`SUM(debit) = SUM(credit)` per voucher.

**(b) No functional-currency column.** ERPNext's `gl_entry` carries `debit` in company currency
*and* `debit_in_account_currency`, which presumes a conversion rate. We carry one amount pair and a
currency, because decision 1 forbids the conversion.

**(c) The chart of accounts is currency-neutral; the BOOK is the partition.** One chart, two books,
selected by the entry's currency. This avoids maintaining two parallel charts that would inevitably
drift.

### 2.2 Immutability, stated precisely

- `finance.ledger_entry` accepts INSERT only. UPDATE and DELETE are revoked and a trigger refuses
  them, so the soft-delete convention used elsewhere in this schema does **not** apply here: a
  posted ledger line is never amended, flagged or hidden.
- A correction is a **reversal voucher** plus, where appropriate, a replacement voucher. Both remain
  visible. This is the same rule the existing `finance.transaction.reverses_id` already follows, so
  the register and the ledger behave alike.
- Amounts are SIGNED nowhere in the ledger: the ledger uses explicit `debit` and `credit` columns,
  one of which is zero. (The existing `finance.transaction` register uses signed amounts; that is a
  different table with a different job and it is not changing.)

### 2.3 Period control

`finance.ledger_period` holds one row per accounting period per financial year, with
`status ∈ (open, closed, locked)`. Posting into a non-open period is refused by the posting
function. Year-end runs a closing voucher that transfers the surplus or deficit to accumulated
surplus, so the statement of financial performance opens the next year at nil. This is ERPNext's
`period_closing_voucher` pattern.

## 3. Schema (new migration `203_finance_general_ledger.sql`)

All tables take `authority_id` via `tenancy.make_tenant()` so row-level security and multi-council
tenancy work exactly as they do for the existing finance tables (migration 167).

```
finance.ledger_account      the GL chart. code, name, root_type, account_type,
                            parent_id, is_group, is_postable, status.
                            root_type ∈ (asset, liability, equity, revenue, expense)
                            report_type derived: balance_sheet | performance
                            CURRENCY-NEUTRAL (decision 1c).

finance.ledger_period       financial_year_id, period_no, from_date, to_date,
                            status ∈ (open, closed, locked).

finance.voucher             the business document header.
                            voucher_type ∈ (opening, journal, rates_bill, receipt,
                                            credit_note, write_off, closing, reversal)
                            currency (ONE per voucher — decision 1), posting_date,
                            narration, reference, status ∈ (draft, posted, cancelled),
                            reverses_voucher_id, is_opening, posted_at, posted_by,
                            prepared_by  (prepared_by <> posted_by: separation of duties)

finance.voucher_line        voucher_id, line_no, ledger_account_id, debit, credit,
                            party_id, department_id, programme_id, activity_id,
                            ward_code, project_id, budget_line_id, narration
                            CHECK: exactly one of debit/credit is non-zero.

finance.ledger_entry        the immutable posted ledger. Mirrors voucher_line plus
                            voucher_id, voucher_type, posting_date, currency,
                            financial_year_id, ledger_period_id, against_voucher_id.
                            INSERT ONLY.

finance.party               the ratepayer / debtor / supplier. party_type,
                            name, reference, contact, status.
                            Receivable and payable control accounts are ledger
                            accounts; the per-party balance lives in the subledger.
```

Indexes: `(ledger_account_id, posting_date)`, `(currency, posting_date)`,
`(party_id, posting_date)`, `(voucher_id)`, `(against_voucher_id)`.

Statements are views over `finance.ledger_entry`, never hand-rolled SQL per report:
`finance.v_trial_balance` (grouped by currency), `finance.v_account_balance`,
`finance.v_debtor_ageing`.

## 4. Statements

| Statement | Source | Note |
|---|---|---|
| Trial balance | `v_trial_balance` | One per currency. Each must balance; a non-balancing trial balance is a defect, not a presentation choice. |
| Statement of financial position | `root_type ∈ (asset, liability, equity)` | Per currency. |
| Statement of financial performance | `root_type ∈ (revenue, expense)` | Per currency, per period via `periodList()`. |
| Budget versus actual | existing budget module + ledger | **IPSAS 24** is the presentation of budget information in financial statements, which is exactly what the budget module already computes. The ledger supplies the actual; the budget module keeps supplying the budget. These are joined, not merged. |
| Debtor ageing | `v_debtor_ageing` | Buckets from `posting_date` against open receivable entries settled through `against_voucher_id`. **This is what D13 said could not exist.** |

The period engine `src/lib/financePeriods.js` is reused unchanged, so a ledger statement and a
management account cannot disagree about which month a posting fell in.

## 5. Rates billing and debtors — and the three data foundations it needs

A rates bill posts `Dr receivable control / Cr rates revenue` (decision 2, accrual). A receipt posts
`Dr bank / Cr receivable control` and settles against the bill via `against_voucher_id`, which is
what makes ageing possible.

**The machinery can be built now. The data cannot, and this is a real finding:**

| Foundation | State | Consequence |
|---|---|---|
| Property register | `land.parcel` has **731 rows** and `public.vungu_parcels` 733 | Usable. Rates bill against these, not a new register. |
| Ratepayer / owner | `spatial_planning.parcel_owner` has **0 rows** | **You cannot bill a rates account without a ratepayer.** The owner register is empty. |
| Valuation roll | **No table exists anywhere** (0 tables match `valuation`) | No rateable value, so no bill can be computed. |
| Tariff / rate in the dollar | **No table exists anywhere** (0 tables match `tariff`) | The rate is a Council resolution, per category, per year. |

`revenue_link.account_link` (parcel_id → `erp_account_no`, 0 rows) is the existing seam to the
external ERP, and confirms that rates are billed in Promun/Pastel today.

Therefore: the valuation roll and the tariff schedule are built as **tables plus an import path**,
seeded empty, exactly as `finance.account` was left empty pending D2. They are raised as **D17**
(valuation roll source and effective date), **D18** (tariff schedule per property category per
year) and **D19** (the ratepayer of record for each parcel) in
`docs/finance/COUNCIL-DECISIONS.md`. D19 is the binding one: rates billing cannot run at all
without a ratepayer, and the owner register holds 0 rows against 731 parcels. The
billing run refuses to compute a bill for a property with no rateable value rather than guessing one
— the same discipline that sends an import citing an unknown account code to the exception queue
rather than inferring its classification.

## 6. Parallel run and cut-over (decision 3)

1. Load an opening trial balance as an `opening` voucher, per currency, which must balance.
2. Run one full period in both systems.
3. `finance.cutover_reconciliation` records, per ledger account and currency, the Promun/Pastel
   closing balance against this ledger's, with the difference and an explanation field. Cut-over is
   permitted only when every unexplained difference is nil.
4. The reconciliation is retained as audit evidence; it is the artefact that justifies the change of
   book of account to the Auditor-General.

## 7. Deferred, and the honest consequence

The client selected **rates billing, debtors and arrears** only. Not selected, and therefore not
built now:

- **Creditors, purchasing and payments.** Consequence: the statement of financial position will show
  receivables but **no payables**, so it is NOT a complete IPSAS position statement until this is
  built. Supplier spend continues to arrive through the existing import pipeline as it does today.
- **Cashbook and bank reconciliation.** Consequence: the bank balance in the ledger is unreconciled.
  For a book of account this is the most significant of the three gaps.
- **Fixed assets and depreciation.** Consequence: N39 stays blocked and there is no depreciation
  charge, so the performance statement is incomplete.
- **Payroll.** Never in scope; salaries post as journals.

None of these is a defect in what is built. All four must be built before this system can be
described as a complete replacement for Promun/Pastel, and that sentence belongs in D16.

## 8. Acceptance checks

| # | Check |
|---|---|
| G1 | A voucher whose debits and credits differ cannot be posted — refused by the DATABASE, proven by attempting the INSERT directly in SQL with the route bypassed. |
| G2 | A voucher containing two currencies cannot be created. |
| G3 | `UPDATE` and `DELETE` on `finance.ledger_entry` fail for an application role. |
| G4 | A trial balance per currency balances to nil on the demo dataset. |
| G5 | Posting into a `closed` or `locked` period is refused. |
| G6 | A reversal leaves both the original and the reversal visible, and the net effect on every account is nil. |
| G7 | `prepared_by <> posted_by` is enforced, as budget approval already is. |
| G8 | A rates bill raises a receivable; a receipt settles it; the ageing view moves the balance between buckets accordingly. |
| G9 | A billing run refuses a property with no rateable value, and says so, rather than billing nil. |
| G10 | Year-end closing transfers surplus to accumulated surplus and the performance statement opens the next year at nil. |
| G11 | No ledger statement anywhere displays a figure combining USD and ZWG. |
| G12 | Cut-over is refused while any unexplained reconciliation difference is non-nil. |

---

## 9. As built — 2026-11-10

The ledger core (§2, §3, §4) is **built and applied to `vungu_dev`**. Verified independently of the
implementer's report.

| Artefact | State |
|---|---|
| `migrations/203_finance_general_ledger.sql` | 1283 lines, applied, idempotent (52 guarded statements; no bare `CREATE TABLE` or `CREATE INDEX`). Registered in `scripts/migrate.js` after 202. |
| `src/routes/finance-ledger.js` | 1873 lines, 20 routes, registered in `server.js`. |
| `scripts/verify-ledger-invariants.js` | 655 lines, 34 SQL-level proofs, every one in a rolled-back transaction. |
| `test/finance-ledger.test.js` | 51 pure unit tests. Backend finance unit tests total **159 passing**. |

### The invariants, proven with the route bypassed

`node scripts/verify-ledger-invariants.js` → **34 passed, 0 failed**, `ledger_entry` rows 26 before
and 26 after.

- **G1** — a raw `INSERT` of debits 100.00 against credits 60.00 is refused both at
  `SET CONSTRAINTS ALL IMMEDIATE` and at `COMMIT`, by a deferred constraint trigger. A balanced
  voucher still posts, so the check is not refusing everything.
- **G2** — `currency` is a column on `voucher` and `ledger_entry` and **not** on `voucher_line`, so a
  line has nowhere to carry a second currency. A ZWG entry on a USD voucher, and a USD receipt
  settling a ZWG bill, are both refused by name.
- **G3** — `UPDATE`, `DELETE` and `TRUNCATE` are refused for the application role by privilege AND
  **for the table owner** by trigger: *"finance.ledger_entry is insert-only: a posted ledger line is
  never amended, deleted or hidden"*. The table has no `deleted_at` column.
- **G4 / G11** — live trial balances: USD 291,150.50 Dr = Cr; ZWG 11,050,000.00 Dr = Cr; difference
  0.00 on both. `currency` is a grouping key of `v_trial_balance`, so a combined row cannot exist.
- **G5, G6, G7, G10** — period locks, reversal visibility and nil net effect, `prepared_by <>
  posted_by` (both in the function and as a CHECK), and year-end closing to accumulated surplus are
  each proven, including the double-action refusals.

**The database caught a real defect during the build.** `finance.close_ledger_year()` had its debit
and credit inverted, so a 5,000 surplus was debited to accumulated surplus rather than credited,
producing a closing voucher out by twice the surplus. The deferred balance trigger refused it and
G10 failed until the sign was corrected. This is the clearest available answer to whether enforcing
the invariants in the database rather than in a route earns its cost.

### Not built, and deliberately so

- **§6 cut-over reconciliation (G12).** Belongs with the cut-over workstream. An empty table nobody
  writes to would look like audit evidence and be none.
- **§5 rates billing (G8, G9).** In progress. Blocked on data, not on code: `land.parcel` holds 731
  rows, `spatial_planning.parcel_owner` holds **0**, and no valuation or tariff table existed before
  this programme (D17, D18, D19).
- **Creditors, cashbook and bank reconciliation, fixed assets.** Out of the client's selected scope.
  The consequence is recorded in D16 and the statement-of-financial-position endpoint returns them
  in an `incomplete` array rather than letting a reader assume a complete position statement.

### One control decision referred to Council, not taken here

`finance.ledger.voucher.post` (flagged `is_approval`) was granted to **`finance_admin`**, departing
from migration 188's documented doctrine that the finance administrator "prepares everything,
approves nothing". The argument for it: a ledger needs a daily poster, the finance committee does
not sit daily, and the binding control is per-voucher and in the database
(`prepared_by <> posted_by`, enforced by both the posting function and a CHECK constraint). The
migration argues the departure explicitly and migration 188's machine-checked separation-of-duties
assertions still pass over the result.

This is a change to who may move money. It touches **D6** (approval roles, delegated authorities and
thresholds) and is for Council to confirm or reverse, not for the implementation to settle.

---

## 10. As built — rates billing, 2026-11-11

§5 is built end to end. Status, gaps and test results are kept in
`docs/finance/IMPLEMENTATION-TRACKER.md`; this section records what differs from the design above.

| Artefact | State |
|---|---|
| `migrations/205_finance_rates.sql` | Applied. Registers, eligibility, the billing run. |
| `migrations/206_finance_rates_operations.sql` | Applied. Corrected ageing, receipts, commit and cancel, the voucher/document guard. |
| `src/routes/finance-rates.js` | 32 routes under `/api/finance/rates`, registered in `server.js`. |
| `scripts/verify-rates-invariants.js` | 86 SQL-level proofs, each rolled back. |
| `src/routes/__tests__/finance.rates.test.js` | 10 end-to-end tests; in the `integration` list. |
| `RatesSection.vue`, `ratesApi.ts`, `ratesTypes.ts` | The screen, on the rail under "Book of account". |

**A defect in §4's debtor ageing was found and fixed.** `finance.v_debtor_ageing` counted only the
credits naming a bill. `finance.reverse_voucher()` carries the settlement link onto a reversal, so a
reversed receipt debits the bill again — and the view ignored that debit. The bill stayed "settled",
the debt reappeared under the reversal voucher, and `v_rates_arrears` dropped it because a reversal
is neither a bill nor a receipt. The arrears then disagreed with the receivable control account by
the reversed amount. The view now nets everything that acts on a bill, and its rows always sum to
the control balance.

**Three controls were added that the design did not name.**
- A draft receipt reduces what a bill has open, so two receipts taken before either is posted cannot
  settle the same bill twice.
- A rates bill's voucher must debit exactly the bill's amount at the moment it is posted. Draft
  voucher lines were editable through the ledger, so a bill and its posting could be made to differ.
- Whoever drafts a tariff cannot approve it, as a constraint on the row.

**G8 and G9 are met on fixture data only.** No bill has been raised on real data and none can be
until D17, D18 and D19 are answered: a run over the live registers raises 0 bills and 731 refusals.
