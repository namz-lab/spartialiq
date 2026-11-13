# Finance module re-engineering — an enterprise finance system for Vungu RDC

Date: 2026-11-11 · Status: **design written on the client's direction; Phase 1 built and verified
2026-11-12 (§12); Phases 2–7 await the client's confirmation of the build order (§10)**
Builds on `2026-11-10-general-ledger-architecture.md` (the ledger core and rates billing, both
built). Supersedes the "no new roles" constraint in `docs/gis-finance/ROLE-WORKFLOW-COVERAGE.md` §2
and the out-of-scope list in specification §1.3 (payments, payroll, procurement).

## 1. What the client asked for, and what it changes

The direction, in the client's words reduced to requirements:

1. Every role an enterprise finance department has must exist, and each must find everything its
   day-to-day work needs on its own desk: "if it is the accountant, all the functions an accountant
   needs; if it is the cashier, whatever the cashier needs."
2. The system must take over from the accounting packages local authorities run today (Pastel /
   Sage, Promun): it must be able to migrate their data in.
3. It must do "almost what ERPNext does", with every ledger entry made properly.
4. The interface must be properly designed.

Three earlier positions are overturned by this, and are recorded here so nobody reads the old
documents as still binding:

| Earlier position | Where it was stated | Now |
|---|---|---|
| "No new roles": nine personas fit seven finance roles plus `admin` | ROLE-WORKFLOW-COVERAGE §2 | Lifted. The seven roles describe a *budget office*. A finance department also has a cash office, a revenue office, an expenditure office, treasury, stores and assets, and the people in them are not interchangeable. |
| Payments, payroll and procurement are out of scope | Specification §1.3; `FinanceWorkspace.vue` header | Lifted for payments and procurement. Payroll is taken as far as its ledger interface only (§5.8). |
| Creditors, cashbook and fixed assets are "deferred" | GL architecture §7 | Scheduled (§9). The position statement stays marked incomplete until each lands. |

What is **not** overturned: every Council decision. D16 (whether this is the book of account), D6
(who may approve what, and thresholds), D4 (no currency conversion) and D17–D19 (the rates
registers) remain the Council's. This design adds three more of the same kind (§10) and builds the
seams for them empty, as before.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1. A role for every finance job at a rural district council, each with a desk that opens on that
  person's work for today, with its primary actions one click away.
- G2. One ledger. Every module — receipting, billing, creditors, payments, stores, assets, payroll —
  is a *subledger* that raises vouchers; `finance.post_voucher()` remains the only writer of
  `finance.ledger_entry`. No module keeps a private balance the ledger cannot explain.
- G3. Every subledger reconciles to its control account, and the reconciliation is on screen, not
  assumed (the rule rates arrears already follows).
- G4. A cut-over path from Pastel/Sage/Promun that ends in a reconciled opening position, with the
  reconciliation kept as audit evidence.
- G5. Separation of duties held by the database on every act that moves money.

**Non-goals**

- A payroll engine (PAYE, NSSA, medical aid calculation). Payroll stays in its own package; this
  system takes its result as a controlled journal (§5.8).
- Manufacturing, CRM, HR, e-commerce, point-of-sale retail: the parts of ERPNext a council does not use.
- Statutory return generation. Still D8.

**Anti-goals** — things that would make this a failure even if every screen works

- A role that can sign in and cannot do its job. A role is released with its module, never before.
- A figure combining USD and ZWG anywhere.
- An "ERP" whose cash office can take money that the ledger never sees, or whose ledger says cash
  the safe does not hold.
- A generic admin dashboard: twelve metric cards and a rail of forty links, the same for everyone.

## 3. Approaches considered

**A. Deploy ERPNext itself beside the portal and integrate.** Complete on day one. Rejected: it
would be a second system with its own users, its own permission model and a functional-currency
ledger that presumes an exchange rate the Council has not approved (D4). The planning workflow, the
parcel register and the ward geography that make this portal worth having would sit on the other
side of an integration, and the invariants proven in migrations 203–206 would be thrown away.

**B. Extend the existing voucher/ledger core with subledger modules, one office at a time.**
*Chosen.* The hard part of an accounting system — an immutable, database-balanced, two-book ledger
with period control and reversal — is built and proven (34 SQL-level invariants). Every remaining
ERPNext capability a council needs is a document type that raises a voucher. ERPNext stays the
reference for *what documents exist and what they post*; this codebase keeps deciding *where the
rules are enforced* (in the database).

**C. Keep importing from Pastel and only improve the dashboards.** Cheapest. Rejected by the
client's direction: the system is to replace the package, not report on it.

## 4. The enterprise role model

Seventeen roles. Eight exist; nine are new. A role is **released with the module that gives it
work** (anti-goal 1), so the "Phase" column is when the role is seeded, not when it was designed.

| Office | Role (`role_name`) | The job | Lands on | Phase |
|---|---|---|---|---|
| Executive | Accounting Officer / CEO (`accounting_officer`) | Reads the council's whole financial position; from Phase 3, the final authorisation on payments above the delegated limit | Overview | **1** |
| Directorate | Director of Finance (`finance_admin`, exists) | Runs the department: setup, period control, commits what officers prepare | Overview | exists |
| Accounting | Accountant (`accountant`) | Keeps the book: journals, posting, reversals, period close, statements; verifies the cash office's cash-up; from Phase 2, bank reconciliation | General ledger | **1** |
| Accounting | Finance Officer (`finance_officer`, exists) | Data custodian: imports, exceptions, registers | Data imports | exists |
| Cash office | Cashier (`cashier`) | Opens a till, receipts every kind of income, cashes up, prepares the banking | Cash office | **1** |
| Revenue | Revenue Officer (`revenue_officer`) | Valuation roll, rates accounts, billing runs, debtors and arrears follow-up | Rates | **1** |
| Expenditure | Creditors Clerk (`creditors_clerk`) | Supplier register, supplier invoices, three-way match, payment vouchers | Creditors | 3 |
| Procurement | Procurement Officer (`procurement_officer`) | Requisitions, quotations, purchase orders against budget | Procurement | 4 |
| Stores | Stores Controller (`stores_officer`) | Goods received, issues, stock counts | Stores | 5 |
| Assets | Asset Officer (`assets_officer`) | Asset register, depreciation runs, disposals | Assets | 6 |
| Payroll | Payroll Officer (`payroll_officer`) | Loads the payroll journal and its control totals | Payroll journal | 7 |
| Budget | Budget Officer (`budget_officer`, exists) | Prepares and revises the budget | Budget | exists |
| Departments | Departmental Head (`dept_head`, exists) | Own votes only: submissions, requisitions (Phase 4), variance explanations | Budget | exists |
| Governance | Finance Committee (`finance_committee`, exists) | Approves budget, revisions, projects, tariffs, publication | Overview | exists |
| Governance | Internal Auditor (`auditor`, exists) | Reads everything, writes nothing | Audit history | exists |
| Governance | Publisher (`publisher`, exists) | Releases approved datasets | Publication | exists |
| IT | Technical Administrator (`admin`, exists) | Provisions accounts; no financial authority | Finance access | exists |

Rules that hold across the table:

- **Permissions, not role names, decide everything** (unchanged). The role is a default bundle;
  `finance.user_permission_override` adjusts one person. A small council where one officer is both
  cashier and revenue clerk grants overrides; it does not need a new role. The database controls
  still refuse that person verifying their own cash-up.
- **Every pair of duties that must be held apart is held apart on the record**, not on the role:
  cashier ≠ verifier of the same session; preparer ≠ poster of a voucher; raiser ≠ committer of a
  billing run; (Phase 3) capturer of an invoice ≠ approver ≠ payer.
- The migration-188 assertions are re-run by every migration that touches grants: no role holds
  both an approval and a publication permission, and `admin` holds nothing that approves, publishes
  or discloses restricted data.

### 4.1 What each Phase 1 desk holds

A desk is the landing section plus the work queue above it. "Everything they need" is tested
against the list below; a function a role needs that is not reachable from its desk is a defect.

**Cashier.** Open a till session with the float · find a payer (ratepayer by account, name or
stand; or a walk-in) · receipt rates against open bills · receipt sundry income from the Council's
income list · choose method (cash, mobile money, card, transfer, cheque) · print the receipt ·
cancel a receipt taken in error, with a reason, while the session is open · see the session's
receipts as they are issued (but no total of them: the count is blind, C7) · cash up: declare the
count, then see the variance · prepare the banking.
*Cannot*: post to the ledger, verify their own cash-up, edit a receipt, reuse a number.

**Accountant.** Draft, post and reverse journals · post vouchers others prepared · cash-ups awaiting
verification, with the declared count against the system total · open and close accounting periods ·
parties · trial balance, position, performance, ageing · the transaction register · exports.
*Cannot*: post a voucher they prepared; approve a budget; publish.

**Revenue Officer.** Billing readiness · valuation roll and rates accounts · draft tariffs · raise
a billing run and read its refusals · arrears by age and ratepayer, reconciled to the control
account · ratepayer statement · take a payment (a small council's revenue clerk is often the relief
cashier). *Cannot*: approve a tariff; commit their own run; post.

**Accounting Officer.** Budget position per currency · statements · arrears · cash office position
(sessions open, unverified, unbanked) · audit trail · reports and exports. *Cannot*: write anything
in Phase 1. Payment authorisation arrives with creditors.

## 5. Modules, and what every document posts

The ERPNext capability map, with the posting each document makes. Every row posts through a voucher
and `finance.post_voucher()`; "control" names the account the subledger reconciles to (G3).

| # | Module | ERPNext equivalent | Document → posting | Control | State |
|---|---|---|---|---|---|
| 5.1 | General ledger | Journal Entry, GL Entry, Period Closing Voucher | Journal: as drafted. Closing: revenue and expense → accumulated surplus | — | Built |
| 5.2 | Rates and debtors | Sales Invoice, Payment Entry | Bill: Dr receivable / Cr rates revenue. Receipt: Dr bank or cash / Cr receivable | Receivable | Built |
| 5.3 | **Cash office** | POS Opening/Closing Entry, Payment Entry | Sundry receipt: Dr till cash (or bank, for a transfer) / Cr income account per line. Rates receipt: as 5.2, into the till. Over/short on cash-up: Dr or Cr the cash-difference account against till cash. Banking: Dr bank / Cr till cash | Till cash = undeposited takings | **Phase 1** |
| 5.4 | Cashbook and bank reconciliation | Bank Reconciliation, Bank Transaction | Statement lines matched to ledger entries; bank charges and interest as journals | Bank | Phase 2 |
| 5.5 | Creditors and payments | Purchase Invoice, Payment Entry | Invoice: Dr expense or asset or stock / Cr payable. Payment: Dr payable / Cr bank. | Payable | Phase 3 |
| 5.6 | Procurement and commitments | Material Request, Purchase Order | No ledger posting; a PO raises a **commitment** against the budget line (the `finance.commitment` table exists and is fed by import today) | Budget available | Phase 4 |
| 5.7 | Stores | Stock Entry, Purchase Receipt | GRN: Dr stock / Cr goods-received-not-invoiced. Issue: Dr expense (vote) / Cr stock | Stock | Phase 5 |
| 5.8 | Fixed assets | Asset, Depreciation Schedule | Acquisition: Dr asset / Cr payable or bank. Depreciation run: Dr depreciation expense / Cr accumulated depreciation. Disposal: remove cost and accumulated depreciation, gain or loss to performance | Asset register = asset accounts | Phase 6 |
| 5.9 | Payroll interface | Payroll Entry (journal only) | One controlled journal per pay run: Dr employment costs per vote / Cr net pay control, PAYE, NSSA, pensions and other deductions payable. Loaded from the payroll package's export with control totals; never computed here | Net pay control clears to nil on payment | Phase 7 |
| 5.10 | Budget control | Budget, Accounting Dimensions | No posting. Available = approved − committed − actual, per line, read from the ledger once it is the book of account | — | Exists; rewired in Phase 4 |

### 5.3 Cash office, in detail (Phase 1)

**Why it is first.** It is the one office with no screen at all, it is the office the public meets,
and it is where a council loses money: cash taken at a counter and never banked. The design is
arranged around that risk rather than around data entry.

*Records.*

- `finance.cash_point` — a till or counter. Names the **till cash** ledger account (type `cash`)
  its takings sit in until banked, and optionally the **cash difference** account an over or short
  is posted to. No account is guessed; a cash point without a till account cannot open a session.
- `finance.income_code` — the Council's list of things a cashier may receipt that are not rates:
  hall hire, market fees, dog licences, plan fees. Each names a revenue ledger account and may carry
  a fixed amount per currency. **Seeded empty**: the list and its tariffs are the Council's (D22).
  The cashier picks "Hall hire", never a ledger account.
- `finance.cashier_session` — one cashier, one cash point, one working day's takings. `open` →
  `closed` (the cashier has declared the count) → `verified` (somebody else has agreed it and the
  session's vouchers are posted). One open session per cashier and per cash point.
- `finance.cash_receipt` + `finance.cash_receipt_line` — the general receipt. Its number is issued
  by the database from a per-council sequence and is never typed, edited or reused. Each receipt
  has one draft `receipt` voucher.
- `finance.rates_receipt` gains `cashier_session_id`, so a rates payment taken at the counter is in
  the same cash-up as everything else.
- `finance.bank_deposit` — the banking: Dr bank / Cr till cash, with the deposit slip reference.

*The controls, each enforced in the database.*

| # | Control | How it is held |
|---|---|---|
| C1 | A receipt cannot be taken outside an open session of the person taking it | `finance.record_cash_receipt()` refuses |
| C2 | Receipt numbers are gapless per council and never reused | Issued under a row lock from `finance.document_sequence`; a cancelled receipt keeps its number |
| C3 | A receipt is never edited or deleted | Cancelled with a reason while its session is open; reversed through the ledger after posting. Both stay visible |
| C4 | The cashier does not verify their own cash-up | `cashier_session_verified_by_another` CHECK, and `finance.verify_cashier_session()` |
| C5 | Receipts reach the ledger only when the cash-up is verified, all together | `verify_cashier_session()` posts every draft voucher of the session in one transaction with the verifier as poster — which is also what satisfies the ledger's own preparer ≠ poster rule |
| C6 | A cash difference is never absorbed | A non-nil variance needs a written explanation at close, and verification posts it to the cash point's difference account; with no account configured, verification is refused rather than posting nothing |
| C7 | The count is declared blind to the difference | The close request carries the count; the variance is computed by the database and returned after |
| C8 | Currencies are counted, totalled and banked separately | Every total is `GROUP BY currency` |
| C9 | Money that is not physical cash never sits in the till account | A transfer, card or mobile-money receipt debits the bank or wallet account named at the counter; only `cash` and `cheque` debit till cash |

*Permissions (new, category `cash`).* `finance.cash.view` · `finance.cash.setup.manage` (cash
points, income codes) · `finance.cash.session.operate` · `finance.cash.receipt.record` ·
`finance.cash.receipt.cancel` · `finance.cash.deposit.prepare` · `finance.cash.session.verify`
(**approval**).

## 6. Separation of duties across the whole department

| Act | Prepared by | Committed by | Held by |
|---|---|---|---|
| Journal | accountant, finance officer | a *different* holder of `ledger.voucher.post` | CHECK on `finance.voucher` (built) |
| Rates billing run | revenue officer | Director or accountant, not the raiser | function + CHECK (built) |
| Rates tariff | revenue officer | committee | CHECK (built) |
| Cash-up | cashier | accountant or Director, not the cashier | CHECK + function (Phase 1) |
| Banking | cashier | accountant, on the bank statement (Phase 2) | deposit posts as a voucher: preparer ≠ poster |
| Supplier invoice | creditors clerk | accountant | Phase 3 |
| Payment | creditors clerk | Director; above the limit, the Accounting Officer | Phase 3, thresholds from `finance.approval_threshold` (D6) |
| Purchase order | procurement officer | departmental head (budget holder) | Phase 4 |
| Stock count adjustment | stores controller | accountant | Phase 5 |
| Depreciation run, disposal | asset officer | accountant; disposal also committee | Phase 6 |
| Payroll journal | payroll officer | Director | Phase 7 |

## 7. Migrating from Pastel, Sage and Promun

The import pipeline that exists (upload → map columns → validate → exceptions → reconcile → commit,
with a file hash and control totals) is the right machine and is kept. Today it feeds the
*transaction register* — a restatement of what the old package recorded. Migration needs it to feed
the *ledger and the subledgers* as well. Five loads, in this order, each a profile in the same
pipeline:

| # | Load | Source export | Lands in | Gate |
|---|---|---|---|---|
| M1 | Chart of accounts | Pastel "Account list" / Sage GL accounts / Promun vote list | `finance.ledger_account`, with a **mapping table** old code → new account kept permanently | Every old code mapped or explicitly retired |
| M2 | Parties | Customer and supplier masters | `finance.party` (+ rates accounts where the customer is a ratepayer, tied to a parcel) | Duplicates resolved by a person, never merged by name similarity |
| M3 | Opening trial balance | Trial balance at the cut-over date, per currency | One `opening` voucher per currency | Must balance to nil per currency; refused otherwise |
| M4 | Open items | Debtors and creditors age analysis by invoice | Opening bills and opening supplier invoices, so ageing continues from the true dates | Sum of open items = the control account balance in M3, per currency |
| M5 | History | Transaction listings | `finance.transaction` (exists) | Control totals agree with the source |

Then the **parallel run** (GL architecture §6): one period kept in both systems,
`finance.cutover_reconciliation` holding each account's balance in both with the difference and its
explanation; cut-over is refused while any unexplained difference is non-nil.

What is honest to say today: no real export from the Council's package has been supplied (D7), so
the column profiles are built from the published layouts of Pastel Partner and Sage Evolution
exports and stay editable per council. The first real file will change them. The mapping table and
the gates do not depend on the layout.

## 8. The interface

> **Superseded 2026-11-12 by the client's direction.** The single workspace with a two-band rail
> described below is replaced by twelve role workspaces, one application per office at
> `/finance/<workspace>`, admitted by a server-side workspace catalogue, with the primary role
> choosing the landing and a switcher for further workspaces a person's permissions cover. See
> `2026-11-12-finance-role-workspaces-design.md`. The design rules in this section that are not
> about the shared workspace still hold: the cashier's counter, printed receipts, unambiguous
> figures, refusals as sentences, designed states, and restrained motion. The "Lands on" column
> of §4 now names the role's home workspace.

Governed by `PRODUCT.md` and `DESIGN.md`: register *product*, calm, no decoration, one accent under
ten per cent of any surface, WCAG 2.1 AA, the `--ent-*` tokens and the shared `ins-*`/`fin-*` sheets.
The anti-reference is the generic SaaS dashboard.

**The workspace becomes a set of desks, not a list of tables.**

- **The rail is grouped by office**, in the order money moves: Cash office · Revenue · Accounting ·
  Budget and projects · Data and reporting · Governance. Band one stays "Your work"; band two stays
  everything else the person may open. A cashier's band one has one entry.
- **Each role lands on its desk** (§4). The work queue above the desk lists what is waiting on this
  person, each row a link that opens the section already filtered.
- **The cashier's desk is a counter, not a console.** One task on screen at a time, keyboard first,
  large numerals in tabular figures, the running total always visible. Three states only: no
  session (open one), session open (take a payment; the day's receipts beneath), session closed
  (awaiting verification, read-only). It must work at 390 px, because a relief cashier at a
  sub-office uses a phone.
- **A receipt prints.** A print stylesheet produces an A5/80 mm receipt with the council name, the
  number, the payer, the lines, the total in words, the cashier and the session. No PDF dependency.
- **Figures are never ambiguous.** Currency beside every amount; USD and ZWG in separate columns or
  separate cards, never summed; nil shown as `0.00`, not recorded shown as "—".
- **Every refusal is a sentence.** The database's refusals are written to be read and are shown
  verbatim, with what to do next. No control is offered that would only produce a 403.
- **States.** Every desk has a designed loading, empty, error and "not set up yet" state. An empty
  income list is "the Council has not entered its income codes (D22)", with the link to enter them
  for whoever may, not an empty table.
- **Motion** is limited to state changes that would otherwise be missed (a receipt joining the
  day's list, the variance appearing after the count) at 150–200 ms, and is removed entirely under
  `prefers-reduced-motion`.

## 9. Build order

Each phase is a working, tested release with its roles. A phase is done when its SQL invariant
script passes with the routes bypassed, its route tests pass on the disposable database, its screen
has been driven in the running app as each affected role at 1440 px and 390 px, and
`docs/finance/IMPLEMENTATION-TRACKER.md` says so with the date.

| Phase | Delivers | Roles released |
|---|---|---|
| **1** | Role model; cash office (5.3); desks for cashier, accountant, revenue officer, accounting officer | `cashier`, `accountant`, `revenue_officer`, `accounting_officer` |
| 2 | Cashbook and bank reconciliation (5.4); migration loads M1–M3 and the cut-over reconciliation | — (accountant's desk grows) |
| 3 | Creditors, supplier invoices, payment vouchers with thresholds (5.5); migration load M4 | `creditors_clerk` |
| 4 | Requisitions, purchase orders, live commitments and budget control (5.6, 5.10) | `procurement_officer` |
| 5 | Stores (5.7) | `stores_officer` |
| 6 | Fixed assets and depreciation (5.8) | `assets_officer` |
| 7 | Payroll journal interface (5.9); printable bills and statements; interest on arrears if Council resolves a policy | `payroll_officer` |

Phase 2 follows Phase 1 because a cash office that banks into an unreconciled bank account has only
moved the risk one step along.

### Phase 1 acceptance checks

| # | Check |
|---|---|
| P1 | Each of the four new roles signs in, lands on its desk, and every function in §4.1 is reachable from it. |
| P2 | No new role holds a permission §4.1 says it cannot use; the migration-188 assertions pass. |
| P3 | A receipt cannot be recorded without an open session of the caller (C1), proven in SQL with the route bypassed. |
| P4 | Receipt numbers issued concurrently are distinct and consecutive; a cancelled receipt's number is not reissued (C2). |
| P5 | `UPDATE` of a receipt's amount, payer or lines is refused (C3). |
| P6 | The cashier cannot verify their own session (C4), by the function and by the CHECK. |
| P7 | Before verification the ledger holds nothing from the session; after it, every receipt's voucher is posted and till cash for the session equals takings in cash and cheque (C5, C9). |
| P8 | A shortage is refused at close without an explanation, and at verification without a difference account; with both, it posts and till cash equals the declared count (C6). |
| P9 | A session with USD and ZWG receipts cashes up as two counts and two variances (C8). |
| P10 | Banking a session's takings leaves till cash at nil for that currency and the bank debited by the same amount. |
| P11 | An auditor can read every session and receipt and can write none. |

## 10. Decisions that are not the implementation's to take

Added to `docs/finance/COUNCIL-DECISIONS.md`:

| # | Decision | Until decided |
|---|---|---|
| D21 | **The finance establishment**: which of the seventeen roles the Council fills, who holds each, and the delegated limits between Director, Accounting Officer and committee | Roles are seeded with the default grants in §4; no account is created for any of them except the demonstration logins. Extends D6. |
| D22 | **Cash office rules**: the cash points, the income codes and their tariffs, the float per till, the cash-difference account, and how soon takings must be banked | Cash points and income codes are empty. No income code, tariff or float is assumed. |
| D23 | **Cut-over**: the source package and version, the cut-over date, and who signs the reconciliation | Nothing is migrated. Extends D7 and D16. |

Open with the client (not Council): the order of Phases 3–7 above is this design's call, made on
where the money risk lies. If the Council's priority is, say, stores before creditors, the phases
are independent enough to reorder after Phase 2.

## 11. Calls made by this design, for the client to check

- Roles arrive with their modules rather than all at once (anti-goal 1).
- Payroll is an interface, not an engine.
- Receipts post at verified cash-up, not at the counter. The customer's printed receipt is valid
  from the moment it is issued; what waits for a second person is the ledger.
- The accountant, not a separate "cash office supervisor" role, verifies cash-ups. A council that
  has a senior cashier grants that person `finance.cash.session.verify` as an override.
- The existing rail's "Book of account" group is split by office; no section is removed.

## 12. As built — Phase 1, 2026-11-12

Status, gaps and test results are kept in `docs/finance/IMPLEMENTATION-TRACKER.md` §0; this section
records what differs from the design above.

| Artefact | State |
|---|---|
| `migrations/207_finance_cash_office.sql` (backend) | Applied to `vungu_dev` and `vungu_acceptance_test`; idempotent; registered in `scripts/migrate.js` |
| `src/routes/finance-cash.js` | 19 routes under `/api/finance/cash`, registered in `server.js` |
| `scripts/verify-cash-office-invariants.js` | 55 SQL-level proofs of C1–C9, each rolled back |
| `src/routes/__tests__/finance.cash.test.js`, `test/finance-cash.test.js` | 12 end-to-end and 6 unit tests |
| `CashOfficeSection.vue` + `components/cash/*`, `cashApi.ts`, `cashTypes.ts`, `cashMath.ts` | The desk: Counter, Cash-ups, Banking, Setup, and the printed receipt |
| `rolePreset.ts`, `FinanceWorkspace.vue`, `useFinanceQueues.ts` | Four new roles land on their desks; the rail is grouped by office; three cash-office queues |

**What changed from the design while building.**

- **The count is blind in practice, not only in principle (C7).** §4.1 first promised the cashier
  "running totals". That contradicts a blind count, so the server withholds a session's totals from
  its own cashier while it is open (`totals_withheld`) and the counter shows receipts, never a sum.
- **A count can be sent back.** `finance.return_cashier_session()` was added: without it a mistyped
  count had no remedy except posting a difference that never happened.
- **A banking is limited to what the ledger says the till holds**, less bankings not yet posted.
  Takings of an unverified session cannot be banked, which is what forces verification before the
  money leaves the building.
- **The work queue is not shown above the counter.** For a cashier the counter is the state of
  their work; the panel pushed "Take a payment" below the fold.
- **A defect in the existing rail was found and fixed.** The "also available" band omitted the
  ledger group, so the auditor and the committee had General ledger, Statements and Rates on no
  band of their rail. Every group is now listed.

**Not built in Phase 1, and said so.** A cancelled *rates* receipt taken at the counter is cancelled
from Rates, not from the counter. There is no end-of-day cash office report (PDF), no cheque
register, and no float top-up document; a float is established by an ordinary journal. Receipts
print through the browser; a thermal-printer profile has not been tested on real hardware.
