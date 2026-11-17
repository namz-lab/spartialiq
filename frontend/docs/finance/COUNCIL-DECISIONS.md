# Council decisions required before the finance module can go live

Each item is a configurable seam in the code, deliberately left inert or empty rather than
filled with a plausible-looking value. Nothing here is a defect; all of it is a decision that
belongs to Vungu RDC, not to the implementation.

Full management detail — options, recommendations, consequences, responsible officials — is in
the companion `DECISION-REGISTER.md` (produced 2026-11-07). Status:
**all fifteen in this document are OPEN; none has been decided by Council.** The same holds for the
cash office items added on 2026-11-12: K1–K4 are client directions and D24–D29 are open (see the
section near the end). (D11–D15, the
GIS–finance decisions, are tracked in `DECISION-REGISTER.md`.) D9/D10 (backup-and-restore
demonstrated, UAT sign-off) are the release gate: the same-host restore was re-demonstrated
2026-11-07 (126 s backup / 74 s restore / 0 mismatches); off-host rehearsal and Council UAT
remain.

**D16 to D19 were added on 2026-11-10**, when the client directed that this system become
the Council's general ledger in place of Promun/Pastel. D16 is the largest decision in this
register: it asks Council to retract the statement at the foot of this document. Until it does,
that statement stands, and the ledger built under
`docs/superpowers/specs/2026-11-10-general-ledger-architecture.md` is a system awaiting a
resolution rather than a book of account.

D17, D18 and D19 are the three things rates billing cannot run without, and all three are data
the Council holds rather than code this project can write: a rateable value per property, an
approved rate in the dollar, and a ratepayer of record. D19 is the hardest of the three, because
the owner register is currently empty while 731 parcels exist.

**D20 was added on 2026-11-10** with the management accounts. It is smaller than D16 but it has the
same shape: the code has been built so that it cannot answer the question on Council's behalf. A
budget line may now carry a phasing profile saying how its annual allocation is expected to fall
across the year, and the monthly management account compares actuals against that profile. A line
with NO profile is reported as "phasing not recorded" and given no monthly budget at all. The
obvious shortcut — divide the annual allocation by twelve — was deliberately not taken: an even
twelfth is a figure no Council approved, and printing it in a column headed "budget" would make the
management account assert something false. An even spread is available, but only as a profile
somebody records on purpose.

**D21 to D23 were added on 2026-11-11**, when the client directed that the module be re-engineered
into a full finance system with a role for every finance job
(`docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md`). All three have the
shape of the rest of this register: the seam is built and left empty.

| # | Decision | Where the code waits | Current behaviour until decided |
|---|---|---|---|
| D1 | Financial year dates and naming convention | `finance.financial_year` rows | No year is seeded. Nothing can be imported until Finance creates one. |
| D2 | Approved chart of accounts, and each account's revenue / expenditure classification | `finance.account.kind` | Empty. Imports citing an unknown account code go to the exception queue; the code never infers the classification from the numeric range of the account code. |
| D3 | Budget hierarchy (vote → programme → activity depth) | `finance.account.parent_id`, `finance.programme` | Hierarchy supported, not populated. |
| D4 | Single- or multi-currency reporting, and the official conversion method | `finance.exchange_rate_policy` | Empty and inert. USD and ZWG are stored and reported separately and are never added together. No conversion is performed. |
| D5 | Public disclosure matrix: which transaction fields, suppliers and documents may be published | `finance.publication`, `finance.document.visibility` | Public API exposes no counterparty identity at all and only published rows. |
| D6 | Approval roles, delegated authorities and thresholds | `finance.approval_threshold` | Empty. Any revision requires an approval event by a holder of `finance.budget.approve` who is not the requester; no amount-based auto-approval exists. |
| D7 | Representative source exports and their control totals | `finance.column_mapping` | Seeded with observed column aliases for PROMUN / Pastel-Sage style exports. Mapping is editable per council; no format is assumed correct. |
| D8 | Statutory report formats and formulas | reporting layer | Only the formulas stated in specification §6 are implemented, labelled as such. No statutory return is generated. |
| D9 | Retention, backup, hosting, RPO and RTO | operations | Soft delete everywhere; no retention job is scheduled. |
| D10 | UAT sign-off and a demonstrated restore test | release | Not done. The system is **not** production-approved. |
| D16 | **Whether this system becomes the Council's book of account**, replacing Promun/Pastel — and the date from which it does | `finance.ledger_entry` and the whole ledger core | The ledger is built and enforces its invariants, but the disclaimer below is unretracted. Creditors, cashbook/bank reconciliation and fixed assets are **not** built, so the position statement shows receivables and no payables and the bank balance is unreconciled. The system cannot be described as a complete replacement until those exist and Council has resolved. The Auditor-General audits against the resolution, not against the code. |
| D17 | **Valuation roll**: its source, its effective date, and the rateable value of each property | `finance.valuation_roll` | Empty, and no table existed before 2026-11-10. A billing run refuses to compute a rates bill for a property with no rateable value rather than guessing one — the same discipline that sends an import citing an unknown account code to the exception queue. 731 parcels exist in `land.parcel`; none has a value. |
| D18 | **Tariff schedule**: the rate in the dollar per property category, per financial year, and who approves it | `finance.rates_tariff` | Empty. No rate is assumed and none is inferred from any other figure. |
| D19 | **Ratepayer register**: who the ratepayer of record is for each parcel | `spatial_planning.parcel_owner` | **0 rows.** A rates account cannot be billed without a ratepayer, so rates billing cannot run at all until this register is populated. This is a data dependency, not a code gap. |
| D20 | **Budget phasing profiles**: how a line's annual allocation is expected to fall across the year, who records a line's phasing, who approves it, and whether an even spread is an approved default | `finance.budget_distribution`, `finance.budget_distribution_period`, `finance.budget_line.distribution_id` (migration 204) | **Empty, and no line is phased.** `distribution_id` is NULL on every budget line, which the management account reports as "phasing not recorded": the annual revised allocation is shown, and there is no per-period budget and no per-period variance for that line. No allocation is divided across periods and no even twelfth is assumed. `distribute_equally` exists as a profile a Council records deliberately, never as a fallback the code applies. The database refuses an active profile whose percentages do not total exactly 100 (a deferred constraint trigger, so an import or a psql session is bound by it too). No route or screen creates a profile yet, because who may record and approve one is the open half of this decision. |
| D21 | **The finance establishment**: which finance roles the Council fills, who holds each, and the delegated limits between the Director of Finance, the Accounting Officer and the committee. Extends D6. | `finance.role_permission` (migration 207), `finance.approval_threshold` | Four roles were added with default grants — `cashier`, `accountant`, `revenue_officer`, `accounting_officer` — and no account exists for any of them except the demonstration logins. The accountant and the Director may both post vouchers and verify cash-ups; the control that binds is on each record (the preparer is never the poster, the cashier is never the verifier) and is enforced by the database. Five further roles (creditors, procurement, stores, assets, payroll) are designed and deliberately not created until their modules exist. |
| D22 | **Cash office rules**: the cash points, the income codes and what each costs, the float per till, the account a cash difference is posted to, and how soon takings must be banked | `finance.cash_point`, `finance.income_code` (migration 207) | **Both empty.** No cashier can open a till until a cash point exists, and only rates can be receipted until the income list is entered. No fee, float or counter is assumed. A cash-up with a difference cannot be verified at a cash point that names no cash-difference account: the difference is posted or the verification is refused, never absorbed. |
| D23 | **Cut-over from the current accounting package**: the package and version, the cut-over date, and who signs the reconciliation. Extends D7 and D16. | Migration loads M1–M5 of the enterprise design §7 (not built) | Nothing is migrated. The existing import pipeline still feeds the transaction register only. |

## Cash office: client directions K1–K4 and Council decisions D24–D29 (added 2026-11-12)

On 2026-11-12 the client issued a brief for a complete cashier workspace
(`docs/superpowers/specs/2026-11-12-cashier-workspace-design.md`). Three of its directions reverse
controls that the enterprise design had already approved. The client chose the brief's position on
each, and those choices are recorded below as **K1–K4**. A client direction is not a Council
resolution. Each K item therefore has a matching **D** item that the Council must confirm before it
becomes a production rule.

**Status legend.** *Directed* = the client has instructed it; *Built* = the code exists and is
tested; *Applied* = it is in a database that people use. **No item below has been decided by
Council.**

| # | Client direction (2026-11-12) | Reverses | Status | What the code does today |
|---|---|---|---|---|
| K1 | The cashier sees their own drawer: expected cash, takings by tender, running variance | Control C7 (blind count) | Directed. **Not built, by design**: held until D24 | C7 stands. The server still withholds an uncounted drawer's totals from its own cashier, now in the open, suspended and abandoned states too. |
| K2 | Each receipt posts to the ledger when issued | Control C5 (post on verification) | Directed. **Not built**: Phase C, held until D25 | C5 stands. Receipts post when a second person verifies the cash-up. |
| K3 | A general sundry-debtors ledger (invoices for water, rentals, licences and so on) is built before the counter screens | — (new scope) | Directed. **Not built**: Phase B | Only rates can be billed. Other income is receipted directly against an income code. |
| K4 | A cash supervisor role sits between the cashier and the accountant | Note in the workspaces spec §12 that cash-up verification is accounting work | Directed and approved by the client for Phase A. **Built** in migration 208 (tested on a clone of `vungu_dev` and on `vungu_acceptance_test`). **Not applied** to `vungu_dev` or production. | `cash_supervisor` holds `finance.cash.view`, `.session.supervise`, `.assignment.manage`, `.session.verify` and `finance.rates.view`. It takes no money, sets nothing up, and keeps no book. The accountant does not hold supervision. The migration refuses to commit if either of those changes. |
| K5 | The accountant maintains the chart and raises the year-end close | The chart kept by the Director alone, and the year-end close raised by the committee alone (migration 203) | Directed 2026-11-16. **Built** in migration 242 (tested on `vungu_acceptance_test`). **Not applied** to `vungu_dev` or production. Awaiting Council confirmation under D21. | `accountant` holds `finance.ledger.account.manage` and `finance.ledger.close_year`. The Director and the committee keep both. Whoever raises a closing voucher cannot post it, and the accountant holds no permission that publishes. Holding the close no longer opens Committee Decisions. |
| K6 | The accountant's desk reads the vote book, the statutory bodies are named on the tax accounts, and the month's salaries are journalled from totals | — (new scope; the vote book reads `finance.v_budget_line_performance`, which every budget report already reads) | Directed 2026-11-17. **Built**: the Vote Book page (`GET /finance/accounting/vote-book`, guarded by `finance.budget.view`, which the accountant already holds), Tax Control extended (statutory parties, per-period closing balances, a worksheet CSV), and the salaries journal (migration 243: a `payroll` voucher type numbered SJ- from its own series, raised as a draft by `POST /finance/ledger/salaries-journal` under `finance.ledger.voucher.prepare` and posted by somebody else). All tested on a freshly migrated `vungu_acceptance_test`. **Not a payroll module** — D21 keeps one deliberately unbuilt; the screen takes the month's totals and keeps no employee record. **No statutory return is produced** (D8 stands): the tax page's CSV is a worksheet for the person who writes the return. No new permission is created and no grant changes. | The workspace switcher is also wired into the portal shell (it was built and tested but referenced by no live layout), so a person holding more than one workspace can move between them and back to the previous console. |

K5 and K6 are client directions (2026-11-16 and 2026-11-17), not Council resolutions; K5 awaits Council confirmation under D21.

| # | Decision | Where the code waits | Current behaviour until decided |
|---|---|---|---|
| D24 | **Confirm or refuse K1**: whether the cashier may see the expected figure before declaring the count | `sessionDetail()` in `finance-cash.js` (`totals_withheld`) | **Open.** Blind count (C7) in force. |
| D25 | **Confirm or refuse K2**: whether receipts post at issue (cashier as preparer and poster) or at verification | `finance.verify_cashier_session()`; Phase C `issue_receipt()` | **Open.** Post on verification (C5) in force. |
| D26 | **Confirm K3 and its accounting**: the receivable accounts per service, who prepares and who posts a sundry invoice | Phase B (not built) | **Open.** No sundry invoice exists. |
| D27 | **Confirm K4 and fill it**: whether the Council has a senior cashier post, who holds it, and whether the accountant also keeps cash-up verification. Extends D21. | `finance.role_permission` for `cash_supervisor` (migration 208) | **Open.** The role exists with the grants in K4. No real account holds it; only the demonstration login `demo.supervisor@vungu.test`. |
| D28 | **Overpayments at the counter**: held as customer credit, or refused | Phase C `issue_receipt()` (not built) | **Open.** Not built. Until decided, the design refuses any amount that is not allocated. |
| D29 | **Till session rules**: (a) after how many hours a supervisor may find a session abandoned; (b) whether a cashier may open only an assigned cash point; (c) whether a supervised count must be witnessed; (d) whether cheques are accepted at the counter | `finance.setting` keys `cash.abandon_after_hours` and `cash.require_assignment` (migration 208, both stored with `"provisional": true`); `finance.supervised_close_cashier_session()`; the `cheque` method in `cashier_session_for_receipt()` | **Open. Provisional values in force, marked provisional on screen:** (a) 12 hours, or once the session's business day has passed; (b) not required, so today's behaviour is kept; (c) **always witnessed** (the stricter choice, because the brief requires documented handover); a Council that decides otherwise needs a code change, not a setting; (d) cheques accepted, as before 208. |

Phase A, built 2026-11-12, does **not** depend on D24–D26 or D28. It runs entirely under the
controls that stand today, plus K4. That is why it could be built before the Council meets.

## Statements this implementation does not make

- It does not claim compliance with any Zimbabwean statute, regulation or accounting standard.
- It does not assert that any figure it displays is correct; figures are what was imported, with
  the import batch, source file hash and reconciliation result attached.
- It does not replace the Council's general ledger and cannot be used as a book of account.
  **This statement is pending retraction under D16** (raised 2026-11-10) and is retained verbatim
  until Council resolves. A general ledger has been built to
  `docs/superpowers/specs/2026-11-10-general-ledger-architecture.md`; building it did not retract
  this sentence, and no officer should rely on the system as a book of account before Council does.
