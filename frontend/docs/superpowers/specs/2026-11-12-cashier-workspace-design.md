# Cash Office workspace, sundry debtors and till session management

**Status:** Phase A built 2026-11-12 (see §16); Phases B–F not started. K1–K3 held for Council decisions D24–D26.
**Builds on:** `2026-11-12-finance-role-workspaces-design.md` (Phase 1, Cash Office), `2026-11-11-finance-enterprise-reengineering-design.md` §6 (controls C1–C9), migration 207.
**Supersedes, in those documents:** control C5 (post on verification), control C7 (blind count), and the Cash Office paragraph of workspaces spec §9 ("no dashboard of figures"). §2 below records each reversal.

## 1. Intent

The council asked for a complete counter application: identify who is paying, see exactly what
they owe and why, take payment for any revenue stream in one transaction (split across tenders if
need be), issue an official receipt, and manage the drawer from float to banking. Behind the
counter, a supervisor resolves stuck sessions, verifies cash-ups and approves corrections.

Three things stand in the way today:

1. **Only rates is billed.** Water, rentals, licences, refuse and every other stream have income
   codes but no invoices, so there is nothing for a cashier to look up or allocate against. A
   sundry-debtors ledger has to exist first.
2. **One cash point, held all day.** §3 is the diagnosis.
3. **The approved controls point the other way** on two counts (blind count, posting at
   verification). The client has now chosen the brief's position on both; §2.

## 2. Decisions taken on 2026-11-12, and what each reverses

| # | Decision | Reverses | Consequence |
|---|---|---|---|
| K1 | The cashier sees their own drawer: expected cash, takings by tender, running variance after the count | C7 (blind count); workspaces spec §2 anti-goal and §9 | The count loses its independence from the expected figure. Compensating control: the declared count is stored with the expected figure **as it stood when the count was entered**, and a recount after viewing is recorded as a second declaration, never an overwrite (§9.3) |
| K2 | Each receipt posts to the ledger when issued | C5 | The preparer ≠ poster rule cannot bind on receipts (the cashier is both). Compensating controls: receipts post under a dedicated `receipt` posting rule that only `issue_receipt()` may use; non-cash tenders post to a clearing account until verified (§7.3); a posted receipt is corrected only by a reversal approved by someone else (§11) |
| K3 | A general sundry-debtors ledger is built before the counter screens | — (new scope) | Revenue administrators configure categories, services and tariffs; invoices post Dr receivable / Cr income, and receipts allocate against them the same way rates already does (§6) |
| K4 | A supervisor role sits between cashier and accountant | Workspaces spec §12 note that cash-up verification is accounting work | New role `cash_supervisor`; the accountant keeps verification too. Recorded as an extension of D21 |

These are recorded in `docs/finance/COUNCIL-DECISIONS.md` as D24–D27 when the spec is approved, and
the enterprise spec's control table gains a "superseded 2026-11-12" note against C5 and C7. C1–C4,
C6, C8 and C9 stand unchanged.

## 3. The till that will not open: diagnosis

Observed on `vungu_dev`, 2026-11-12:

| Fact | Evidence |
|---|---|
| The council has exactly one cash point | `finance.cash_point`: one row, `MAIN`, "Main counter (demo)" |
| It has a genuinely open session | `CS-0000002`, cashier `demo.cashier2`, opened 07:38, one receipt, never closed |
| The message is therefore true | `CashCounter.vue:77` shows it when every active point has `open_session_id`; `uq_cashier_session_open_point` enforces it in the database |

So the control works; what is missing is everything around it:

- **No assignment.** Any cashier may take any free point; nobody "has" a drawer. A cashier
  cannot tell whether the occupied point is theirs to use.
- **No lifecycle beyond open/closed/verified.** A cashier who goes home without cashing up leaves
  the point locked indefinitely. Nothing distinguishes a cashier at lunch from one who left
  yesterday.
- **No supervisor path.** Only the session's own cashier can close it. Nobody can see who holds
  which drawer across the office, and there is no authorised way to release an abandoned one.
- **Only one drawer.** A second cashier has nowhere to go even when nothing is wrong.

The fix (§8) adds assignment, suspend/resume, an abandoned state reached only by a supervisor's
decision, and a supervised close with a witness count. It never terminates another person's
session automatically and never relaxes one-cashier-per-drawer.

Immediate relief, needing no code: `demo.cashier2` cashes up `CS-0000002`, or an accountant adds a
second cash point in Setup.

## 4. What exists, and what is reused

| Brief entity | Today | Plan |
|---|---|---|
| Customer / ratepayer | `finance.party` (`ratepayer`, `supplier`) | Reused. Gains `debtor` type, ID number (restricted), category, phone search index |
| Property account | `finance.rates_account` → `party`, `parcel_id` | Reused unchanged |
| Rates invoice | `finance.rates_bill`, posted voucher | Reused unchanged |
| Sundry invoice | — | **New** `finance.debtor_invoice`, `finance.debtor_invoice_line` (§6) |
| Revenue category / service / tariff | `finance.income_code` (code, ledger account, fixed or open price per currency) | `income_code` **is** the service. New `finance.revenue_category` groups them; new `finance.tariff` versions their price with an effective date and approval |
| Payment | `finance.cash_receipt` + `cash_receipt_line`; separately `finance.rates_receipt` | `cash_receipt` becomes the one payment record for every counter receipt. New `finance.cash_receipt_tender` holds split tenders. Counter rates payments stop creating `rates_receipt` rows (back-office rates receipts keep using it) |
| Allocation | `voucher_line.against_voucher_id` on a receivable account (how rates allocation works now) | Reused for sundry invoices; gains nullable `against_line_id` for line-level allocation |
| Cash point, session, count | migration 207 | Extended (§8) |
| Bank deposit | `finance.bank_deposit` | Extended with verification and slip attachment (§10) |
| Reversal | `finance.reverse_voucher()`, receipt `cancel_*` columns | Wrapped in a request/approve record (§11) |
| Audit | `auditLog.js` rules + ledger immutability triggers | Reused; new routes get rules at critical/high |

Nothing here creates a second customer, invoice, payment or ledger table for a screen's
convenience.

## 5. Roles and permissions

New permissions (all enforced in `financePermissions.js` on every route and, for the acts that
move money, again inside the database function):

| Code | Cashier | Cash supervisor | Accountant | Revenue officer | Director / admin |
|---|---|---|---|---|---|
| `finance.debtor.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `finance.debtor.id_number.view` | — | ✓ | ✓ | ✓ | ✓ |
| `finance.debtor.manage` (create/edit customers) | — | — | ✓ | ✓ | ✓ |
| `finance.debtor.invoice.prepare` | — | — | ✓ | ✓ | ✓ |
| `finance.debtor.invoice.post` | — | — | ✓ | — | ✓ |
| `finance.revenue.config.manage` (categories, services, mappings) | — | — | ✓ | — | ✓ |
| `finance.tariff.approve` | — | — | — | — | ✓ |
| `finance.cash.session.supervise` (see all drawers, mark abandoned, supervised close, reopen) | — | ✓ | — (separation, K4) | — | ✓ |
| `finance.cash.assignment.manage` (assign cashiers to cash points) | — | ✓ | — | — | ✓ |
| `finance.cash.session.verify` (existing) | — | ✓ | ✓ | — | ✓ |
| `finance.cash.tender.verify` (confirm a transfer / mobile money / card) | — | ✓ | ✓ | — | ✓ |
| `finance.cash.correction.request` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `finance.cash.correction.approve` | — | ✓ (up to limit) | ✓ (up to limit) | — | ✓ |
| `finance.cash.deposit.verify` | — | — | ✓ | — | ✓ |
| `finance.cash.report.all` (other cashiers' collections) | — | ✓ | ✓ | ✓ | ✓ |

Self-approval is refused by the database for corrections, cash-ups, deposits and tender
verification, not only by the route. Approval limits come from `finance.approval_threshold`
(existing), keyed `cash_correction`.

## 6. Sundry debtors (K3)

### 6.1 Configuration

- `finance.revenue_category` — code, name, parent (two levels: e.g. *Water and sanitation* →
  *Water consumption*), status. Seeded empty; the brief's list is offered as an importable
  template, not inserted (D22: no fee or counter is assumed).
- `finance.income_code` gains `revenue_category_id`, `receivable_account_id` (where invoices for
  this service sit), `invoiceable` (may be billed), `counter_direct` (may be receipted without an
  invoice).
- `finance.tariff` — income code, currency, amount, effective_from, effective_to, status
  (`draft` → `approved`), approved_by ≠ prepared_by. The counter and invoicing read the tariff in
  force on the document date. `income_code.unit_amount_*` stays as the fallback for codes with no
  tariff rows, so migration 207 behaviour is unchanged until a tariff is approved.

### 6.2 Customer accounts

A customer is a `party`. Its account number is `party.reference` (made unique per authority and
generated `C-0000001` when blank). One party can hold several rates accounts and any number of
sundry invoices; the enquiry screen (§12.3) shows them together. Status gains `suspended`,
`disputed`, `arrangement` flags held in `finance.party_flag` (flag, reason, from, to, set_by) so
alerts have a history.

### 6.3 Invoices

`finance.debtor_invoice` (invoice_no from `document_sequence` kind `invoice`, party, currency,
issued_on, due_on, billing period, reference e.g. stand or licence number, voucher_id, status
`draft|posted|cancelled`) and `finance.debtor_invoice_line` (income code, quantity, unit amount
from tariff, amount, narration). `post_debtor_invoice()` creates and posts one voucher: Dr the
service's receivable account per line (party-tagged) / Cr its income account. Preparer ≠ poster.
A posted invoice is corrected by a credit note (an invoice of negative lines that reverses), never
edited.

`finance.v_outstanding_charge` is the single view the counter reads: one row per unsettled rates
bill and per unsettled sundry invoice line, with party, category, service, period, due date,
original, paid, outstanding, days overdue. "Paid" is computed from ledger lines exactly as
`rates_bill_unsettled()` does now, so it cannot drift from the ledger.

## 7. Receiving payment

### 7.1 One function, one transaction

`finance.issue_receipt(p_session_id, p_cashier_id, p_party_id, p_payer_name, p_currency,
p_tenders jsonb, p_allocations jsonb, p_direct_lines jsonb, p_overpayment text, p_idempotency_key
uuid)` does everything in one database transaction, or nothing:

1. Session check (C1, `cashier_session_for_receipt`) — and the session must be `open`, not
   `suspended`.
2. Idempotency: a repeated key returns the first receipt. A double-clicked confirm never takes
   money twice.
3. Tenders: each has method, amount, and the method's evidence (§7.2). Sum of tenders = amount
   received.
4. Allocations: each names a rates bill or a sundry invoice line and an amount ≤ its outstanding,
   checked under `FOR UPDATE` of the charge so two counters cannot settle the same bill twice.
5. Direct lines: income-code lines without an invoice (only codes flagged `counter_direct`),
   priced from the tariff.
6. Received − allocated − direct = remainder. A remainder is refused unless `p_overpayment =
   'credit'` and the party is identified; it then credits the party's receivable as an
   unallocated advance (council policy D26 decides whether that is allowed; until then the route
   refuses it). Nothing is ever written off silently.
7. Receipt number from `document_sequence` kind `receipt` under row lock (C2), voucher built and
   posted (§7.3), `cash_receipt`, `cash_receipt_tender` and allocation lines written.

The FIFO helper (`finance.suggest_allocation(party, currency, amount, rule)`) only proposes; the
cashier sees and may change the proposal before confirming. Rules: oldest-due first, or by
category priority from `finance.setting` `cash.allocation_priority`. Penalties and interest are
allocated only if a posted charge exists for them; the counter never computes one.

### 7.2 Tenders

| Method | Evidence required | Debits | Settled? |
|---|---|---|---|
| Cash | amount tendered (change computed, not stored as money) | Till account of the cash point | Yes |
| Cheque (if `cash.cheque_allowed`) | drawer bank, cheque number | Till account (C9 as now) | Yes, subject to bank clearing |
| Card | POS reference, terminal id | Card clearing account | When verified |
| Mobile money | provider, reference, payer phone, date | Mobile-money clearing account | When verified |
| Bank transfer / direct deposit | bank, reference, transfer date | Bank-transfer clearing account | When verified |

Each tender reference is unique per method and provider for the authority, so the same transfer
cannot be receipted twice.

### 7.3 Accounting

The receipt voucher: Dr till (cash/cheque) and Dr each clearing account (non-cash tenders) / Cr
receivable per allocation (with `against_voucher_id`, `against_line_id`) / Cr income per direct
line / Cr receivable unallocated for an accepted overpayment. It is posted at issue (K2). The
customer's balance therefore falls as soon as the receipt prints, which is what the brief asks.

Tender verification (`verify_tender`, by someone other than the cashier) posts Dr bank / Cr
clearing. A rejected tender (the transfer never arrived) is not silently reversed: it opens a
correction request (§11) against the receipt. "Pending payment verifications" on the dashboard is
the count of unverified non-cash tenders.

Clearing, card, mobile-money and bank accounts are named per cash point or in settings by the
accountant. Without them a non-cash tender is refused at the counter with the reason, as cash
points without a difference account are today.

## 8. Cash drawer and session lifecycle

### 8.1 Assignment

`finance.cash_point_assignment` (cash point, user, from, to, assigned_by). A cashier sees their
assigned points first; an unassigned free point is offered only if `cash.allow_unassigned_points`
is set. A cash point *is* one drawer (one till account, one session at a time); a counter with
two drawers is set up as two cash points. The
header shows both names (`location` + `name`).

### 8.2 States

```
          open ──suspend──▶ suspended ──resume (same cashier)──▶ open
           │                    │
           │      supervisor marks abandoned (reason, after cash.abandon_after_hours)
           │                    ▼
           ├───────────────▶ abandoned ──supervised close (witness count)──▶ closed
           │
         close (cashier count) ──▶ closed ──verify──▶ verified
                                     │
                                  return (reason) ──▶ open      (exists: "rejected")
verified ──reopen (director only, reason; reverses difference journal)──▶ closed
```

- `suspended`: cashier steps away; the point stays theirs; no receipts. Cashier only.
- `abandoned`: set only by a supervisor, only on a session that has been open or suspended longer
  than `cash.abandon_after_hours` (default 12) or whose business date is past, with a reason. It
  does not close anything: it freezes receipting and puts the session in the supervisor's queue.
  The cashier is notified.
- Supervised close: the supervisor and a witness (a second user with `finance.cash.view`) count
  the drawer; the count is recorded as the closing count with both names; the session becomes
  `closed` and goes to verification by a third person. The original cashier remains the session's
  cashier for every report and for C4.
- A session whose business date has passed is shown as **stale** on the cashier's own screen with
  "Cash up yesterday's session before opening today's". It is not auto-closed.

The one-open-session-per-point index becomes "one session in `open|suspended|abandoned` per
point", so an abandoned session still holds the drawer until it is counted. The drawer is freed
by the count, never by a status change alone.

### 8.3 Movements

`finance.cash_movement` (session, kind `float_add|withdrawal|transfer_out|transfer_in|refund`,
currency, amount, reason, authorised_by ≠ cashier for withdrawals and refunds, voucher). Each
posts its own voucher (Dr/Cr till against the float account or the other till). Expected cash =
float + cash tenders − change-free (tenders record amount applied) + movements in − movements
out.

## 9. Cash-ups

### 9.1 Count

Denomination grid per currency (`finance.setting` `cash.denominations.USD`, `.ZWG`), entered or
total-only. Stored per denomination in `cashier_session_count_line`.

### 9.2 Statuses shown

Open · Suspended · Abandoned · Submitted (closed, awaiting verification) · Verified · Returned
(the existing return, labelled "Rejected — recount") · Reopened. "Awaiting verification" and
"Submitted" are the same state; the brief lists both and the UI uses one label.

### 9.3 Variance (K1)

The cashier sees expected cash while operating. At count, the screen shows the variance after the
count is entered, and requires an explanation for any non-nil variance (C6, unchanged). Every
declaration is kept (`cashier_session_count_declaration`, numbered); verification uses the last
and the review screen shows all, so a count adjusted after seeing the expected figure is visible
to the supervisor. Verification posts only the difference journal now (receipts were posted at
issue, K2).

## 10. Banking

`bank_deposit` gains `cashier_session_ids` (link table), `slip_document_id` (existing
`finance.document`), `status` `prepared|submitted|verified|rejected`, `verified_by` ≠
`prepared_by`. Deposit posts Dr bank / Cr till on verification (not on preparation, so an
unverified slip does not move the bank balance). Tracking views: collected (cash tenders), deposited
(verified deposits), awaiting banking, discrepancy (bank statement figure entered at verification
≠ deposit). The cashier reads bank accounts; master data stays with the accountant.

## 11. Corrections and refunds

`finance.cash_correction` (kind `wrong_account|duplicate|wrong_allocation|refund|tender_failed`,
receipt, reason, requested_by, status `requested|approved|rejected|executed`, approved_by ≠
requested_by, approval limit check, executed voucher ids). Executing an approved correction:

- wrong account / wrong allocation: reverse the receipt's voucher (`reverse_voucher`) and issue a
  replacement receipt referencing the original; the original stays visible, marked "Reversed by
  …".
- duplicate: reverse; refund or credit per the request.
- refund: a payment voucher from the till (cash, authorised movement) or a payable for EFT.
- tender failed: reverse the clearing amount back onto the customer's receivable.

Nothing is deleted. The "cancel while session open" path from migration 207 is withdrawn for new
receipts, since they are posted at issue; it remains readable for historical rows.

## 12. The workspace

Route `/finance/cashier`, registered from `workspaces/cashier/routes.ts`; supervisors also get
`/finance/cash-supervisor` (registered the same way, home for `cash_supervisor`). Layout under
`PRODUCT.md`/`DESIGN.md`: calm, dense, no decorative charts, accent under 10 %.

### 12.1 Header

Council name, "Cash Office", cashier name and employee number (`users.employee_no`; added if
absent), cash point and location, business date, financial period (`FY 2026/27 · P5`), session
state chip (Open since 07:38 · Suspended · No session · Stale), notification bell, profile.

### 12.2 Navigation

Dashboard · Receive payment · Customer enquiry · Account balances · Payment history · Receipts ·
Corrections & refunds · Cash drawer · Cash-ups · Banking · Reports · Notifications. Persistent
**New payment** button. Shortcuts: Ctrl+K customer search (focus anywhere), Ctrl+N new payment,
Ctrl+P print last receipt (only on the success screen), Esc closes a dialog, Enter confirms the
focused step. Shortcuts are listed under `?`.

### 12.3 Dashboard

Ten tiles, each a link to the filtered listing: today's collections, cash, transfers, mobile
money, card (each per currency, never summed across currencies, C8), transactions, pending
verifications, unallocated receipts, variance of the last closed session, drawer balance. All from
one endpoint, `GET /finance/cash/dashboard`, computed from the tables above; no client-side
arithmetic on money. Below the tiles: the open session panel and the last ten receipts.

### 12.4 Receive payment

One screen, left to right: **customer** (search, or "walk-in" for direct lines only) → **charges**
(grouped by category, checkboxes per invoice, expandable lines, editable amount per row, "Suggest
allocation" for FIFO) → **tender** (rows of method + amount + evidence, remaining-to-tender shown
live, change for cash) → **confirm** (summary, then issue). Success replaces the screen with the
receipt preview and Print / PDF / Email / New payment.

### 12.5 Customer enquiry

Search across name, account no, property account no, stand/parcel, business name, licence no
(invoice reference), ID number (permission-gated, exact match only, never listed), phone, invoice
no, receipt no. One endpoint, ranked results, < 200 ms on the dev dataset (METRICS budget). Account
view: details, financial summary (opening, charges, payments, adjustments, outstanding, credit),
outstanding charges table with expandable lines, payment history, alerts from `party_flag` and
computed overdue state. "Receive payment" from here carries the customer across.

### 12.6 Receipts

Printable A5/80 mm thermal layouts from one component; PDF via the browser print pipeline; amount
in words (English, per currency); verification reference = first 10 chars of an HMAC of receipt
id + amount + date, checkable at `/verify-receipt/:ref` (public, shows only validity, date and
amount). Reprints are recorded (`cash_receipt_print`), and every print after the first carries
"COPY" and the print number. Email only when `notify.smtp` is configured.

### 12.7 Reports

The twelve reports in the brief, each one SQL view or function with the brief's filters, rendered
in one report screen with CSV/XLSX export (existing export helper) and print-to-PDF. Cashiers see
their own collections; `finance.cash.report.all` sees all.

### 12.8 Supervisor workspace

Drawers board (every cash point: who, state, since, receipts, expected cash), queue of sessions
to resolve (stale, abandoned), cash-ups to verify (with every declaration), tenders to verify,
corrections to approve, deposits to verify.

## 13. Phases

| Phase | Delivers | Unblocks |
|---|---|---|
| A | Session lifecycle, assignment, supervisor resolve, drawer board (§8, §12.8 part) | The till problem in §3 |
| B | Revenue categories, tariffs, customers (party extension), sundry invoices, `v_outstanding_charge` (§6) | Something to allocate against |
| C | `issue_receipt` with tenders, allocation, posting at issue, clearing and tender verification (§7) | Receive payment |
| D | Cash Office workspace: header, dashboard, receive payment, enquiry, receipts (§12.1–12.6) | Daily counter work |
| E | Movements, denomination count, declarations, banking verification (§8.3, §9, §10) | End of day |
| F | Corrections and refunds (§11), reports (§12.7), supervisor workspace (§12.8) | Oversight |

Each phase gets its own implementation plan, written after the previous one ships. Phase A is
planned in `docs/superpowers/plans/2026-11-12-cash-office-phase-a-sessions.md`.

## 14. Open questions for the council (become decisions D24–D29)

1. D24–D27: the four reversals in §2, confirmed in writing.
2. D28: overpayments — held as customer credit, or refused at the counter?
3. D29: `cash.abandon_after_hours`, whether a supervised close needs a witness, cheque acceptance,
   and whether cashiers may use an unassigned point.

## 15. Non-goals

- Integration with a payment gateway, bank feed or mobile-money API. References are entered and
  verified by a person.
- Water meter reading, licence issuing, or tenancy management. They produce invoices through §6;
  their own registers are separate modules.
- Penalty and interest calculation. Posted only by the billing that owns it.

## 16. As built

**Phase A — 2026-11-12.** Migration 208, routes, counter states, supervisor drawers board, and tests.
Runbook: `docs/finance/MIGRATION-208-RUNBOOK.md`. Decisions: `docs/finance/COUNCIL-DECISIONS.md`
(K1–K4, D24–D29). Applied to `vungu_dev` on 2026-11-12 (runbook §6). Not production.

Differences from §5 and §8 above, each made on purpose:

- The accountant does **not** hold `finance.cash.session.supervise` or assignment. The client asked
  for the supervisor to be separate from the accountant. The accountant keeps verification, so
  a supervised count is verified by somebody outside the supervision chain. The Director
  (`finance_admin`) holds both, as a stand-in.
- Assignment is its own permission (`finance.cash.assignment.manage`), not part of setup.
- A supervised count **always** has a witness (D29c, provisional). The stricter reading of the
  brief's "documented handover/count procedures must always apply".
- "Reopen a verified session" is not built. Undoing a verified, posted cash-up is a ledger
  reversal, and it belongs with the corrections of Phase F.
- Returning a count for recount is refused once the drawer has been reissued to another cashier.
  Otherwise two sessions would hold one drawer. The same gap was latent in 207, where it surfaced
  as a raw unique-key error.
- K1 is not applied. The blind count (C7) is extended to the suspended and abandoned states,
  pending D24.
