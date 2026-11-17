# The Accounting workspace, built out: every ledger task an accountant has, on one desk

Status: **approved by the client 2026-11-16, with the amendment in §13** · 2026-11-16
Builds on: `2026-11-12-finance-role-workspaces-design.md` (the twelve workspaces; §9 "Accounting",
§13.2 "a workspace that only re-files the old sections fails review") and
`2026-11-10-general-ledger-architecture.md` (the ledger engine, which this design reads and does
not re-open).

## 1. Intent

The Accounting workspace at `/finance/accountant` is where the council's book of account is kept.
Today it is a dashboard, four purpose-built pages, and twelve screens of the old finance console
dropped into a card. An accountant cannot open an account and read its entries, cannot see a
balance on the chart, has no cashbook, cannot close the year, and types every voucher number by
hand. The asset register was built and never connected. The request is to make this a complete
accountant's workspace: everything the general ledger needs done, done here, properly.

"Properly" has a second half that the audit below turned up: two of the ledger's statements stop
being right at the first year end. A complete workspace has to fix those, because an accountant
will reach them in the normal course of the job.

## 2. What exists today (audit, 2026-11-16)

**The engine is sound and wider than its screens.** Migrations 203 and 211 to 214 hold the chart,
parties, periods, vouchers, the immutable ledger, bank reconciliation, creditors, fixed assets and
the cut-over loads. The API has 100+ finance routes. The local database
(`vungu_master_db_v1`) holds one demonstration year and an **empty ledger**: no account, no
voucher. `backend/scripts/seed-general-ledger-demo.js` fills it.

**The workspace** (`frontend/src/modules/finance/workspaces/accountant/`): 19 navigation entries in
one flat list.

| Page | How it is built today | State |
|---|---|---|
| Dashboard | `AccountantDashboard.vue` over `GET /finance/accounting/dashboard` | Works. Says bank reconciliation "is not built yet" and marks every bank account "Unreconciled"; both are false since migration 212 |
| Bank Reconciliation, Accounts Payable, Supplier Management, Data Migration | Purpose-built pages | Work |
| Asset Register | `AssetRegister.vue` (493 lines), `assetsApi.ts`, `finance-assets.js`, migration 214 all exist | **The route still points at "Not built yet".** Nothing imports the page |
| Journal Entries, General Ledger, Close Period | `LedgerSection.vue` embedded with `only=` | Console screen in a card; see gaps |
| Trial Balance, Financial Reports, Accounts Receivable | `StatementsSection.vue` embedded on a tab | Console screen in a card; see gaps |
| Cash-Up Approvals, Banking, Budget, Revenue, Audit Trail, Settings | Other desks' screens embedded | Work; not ledger screens |
| Tax & Statutory | "Not built yet" | Nothing behind it |

**What an accountant cannot do, although the server already can:**

| Task | Server | Screen |
|---|---|---|
| Open an account and read its entries | `GET /finance/ledger/entries`, `/accounts/:id/balance` | None. Nothing calls either |
| Amend, deactivate or withdraw an account | `PATCH`, `DELETE /finance/ledger/accounts/:id` | None |
| Close the year | `POST /finance/ledger/close-year` | None, in any workspace |
| Page through vouchers, filter by date or party | `limit`, `offset`, `from`, `to`, `party_id` | First 50 only; no date or party filter |
| Put a party, department or project on a journal line | accepted by `POST /finance/ledger/vouchers` | No field |

**What neither has:** a balance beside each account on the chart; a running balance on an
account; a cashbook; payment, receipt and transfer forms; a debtor's statement; credit notes and
write-offs as guided documents; a trial balance at a date; a cash statement; a period-end
checklist; a tax control view; ledger reports (general ledger detail, journal listing); a number
issued for a journal.

**Two defects in the ledger's read side, latent while there is one year:**

1. **Balances are not brought forward.** The trial balance and the statement of financial position
   read `finance.v_trial_balance`, which sums one financial year's entries. The year-end close
   posts inside the year it closes and nothing opens the next. In the second year the position
   statement would omit every asset and liability carried from the first: the bank would restart
   at nil.
2. **A closed year's performance statement reads nil.** The closing voucher brings revenue and
   expenditure to nil in the same year, and the statement includes it. After the close the year's
   income and expenditure can no longer be printed.

Neither touches what is stored. Both are in how balances are read.

## 3. Goals, non-goals, anti-goals

Goals
- Every ledger task in §2 can be done in the workspace, by the person whose permission allows it.
- The ledger screens are the workspace's own, in the portal's visual language (`cw-*`), designed
  around the accountant's work: the chart leads to the account, the account to the voucher, the
  voucher to the document that raised it, and back.
- The statements are right across a year end (§2 defects 1 and 2), proven by a two-year test.
- Nothing on a screen says a module is missing when it exists.
- Every existing control survives unchanged: preparer is never poster, a posted line is never
  amended, a correction is a reversal, two books and no rate between them, the server decides
  access.

Non-goals
- **One change to who may do what, directed by the client on approval (§13):** the accountant
  role is granted `finance.ledger.account.manage` (the chart) and `finance.ledger.close_year`.
  Nothing else in the permission catalogue or the grants changes. `finance.audit.view` stays with
  internal audit, the Director and the committee; the Audit Trail page keeps explaining that.
- No sundry-debtor invoicing (client direction K3, held for Council decision D26; it has its own
  phase in the cashier workspace design).
- No payroll, procurement or stores (phases 4, 5 and 7 of the enterprise design).
- No statutory return forms (D8) and no currency conversion (D4).
- No change to any posting rule, table of record or stored figure.
- The embedded screens that belong to other desks (cash-ups, banking, budget, rates, audit trail,
  cash office settings) stay as they are.
- The old console at `/finance/console` and its sections are not removed or altered.

Anti-goals (failure even if it works)
- The old sections restyled and called new. Each ledger screen is rebuilt around its task.
- Money added up in the browser as floating point. Server figures are shown as sent; the one
  browser-side sum (a journal's running balance while typing) is exact integer cents, labelled a
  guide, and the saved figure is the server's.
- Any figure that spans USD and ZWG.
- A button whose only outcome is a 403. An absent permission is explained in words.
- A screen that claims more than the ledger knows (a "cash flow statement" that cannot classify
  financing, a "VAT return" no statute was checked against).

## 4. Constraints

- Backend `src/lib/finance.js` rule: no money arithmetic in JavaScript; SQL over NUMERIC, decimal
  strings in JSON.
- Every read is authorised by `requirePermission`; the new reads use `finance.ledger.view`, which
  the accountant, the Director, the accounting officer and the auditor already hold. No new
  permission code.
- Multi-tenant row-level security: new SQL is `security_invoker` and filters nothing by hand that
  a policy already filters.
- `PRODUCT.md` and `DESIGN.md`: product register, one accent, WCAG 2.1 AA, reduced motion, 390 px
  to 1440 px without horizontal page scroll. Statements look like statements: ruled tables,
  right-aligned tabular figures.
- Backend route tests refuse a non-disposable database; they run on `vungu_acceptance_test`.
- `workspaceCoverage.spec.ts` must keep passing: every target the console served stays served.

## 5. Approaches considered

**A. Purpose-built ledger screens in the workspace, over the existing engine, adding server reads
where the engine has none.** *Recommended.* It is what the workspaces design already prescribes
(§8: sections become screens, one component per function) and what the client's amendment §13.2
requires. The old sections stay where they are for the console and the other workspaces that
embed them, so nothing else moves.

**B. Keep embedding the console sections and add the missing features inside them.** Less new
code. Rejected: it is the arrangement the client said fails review, it leaves two visual languages
on one screen, and every change would also land in the console and in four other workspaces that
embed the same components.

**C. Screens only, no server change.** Rejected: the running balance, balances on the chart, the
trial balance at a date and both defects of §2 are sums over money, and the house rule is that
those are computed in SQL. Doing them in the browser would break the rule the whole module is
built on.

## 6. The workspace

### 6.1 Navigation, grouped by the book

`PortalShell` gains optional group headings (a `group` on a nav item; a shell without groups
renders as today). Accounting's navigation becomes:

```
Desk          Dashboard
The book      Journals · General Ledger · Trial Balance
Cash & bank   Cashbook · Bank Reconciliation · Cash-Up Approvals · Banking & Deposits
Debtors       Debtors · Revenue & Billing
Creditors     Accounts Payable · Parties
Assets        Asset Register
Period end    Period Close · Financial Statements · Ledger Reports · Tax Control
Control       Budget · Audit Trail · Data Migration · Settings
```

Route names that exist keep their names (`acc-journals`, `acc-ledger`, …) so every link, queue
target and `serves` entry keeps working. New routes: `acc-voucher` (`journals/:id`),
`acc-journal-new`, `acc-journal-edit`, `acc-account` (`ledger/:id`), `acc-cashbook`,
`acc-debtor` (`receivable/:partyId`), `acc-statements` (alias of today's `acc-reports`),
`acc-ledger-reports`.

### 6.2 Journals

*Register.* Four queues as tabs, each with its count: **To post** (drafts prepared by others),
**My drafts**, **Posted**, **All**. Filters: date range, type, book, party, text. Server-side
paging. A row opens the voucher.

*Editor* (its own page, so a long journal has room and a refresh does not lose the address):

```
New journal                                         Book  (USD) ZWG     Period 3 · Sep 2026 · open
Number  [issued on save      ]  Type [Journal v]  Date [2026-09-14]  Reference [          ]
Narration [                                                                              ]
 #  Account                         Party            Debit        Credit   Narration
 1  [1200 · Bank – CBZ current   ]  [            ]              [ 450.00 ] [             ]  x
 2  [5310 · Fuel and oils        ]  [            ]  [ 450.00 ]             [             ]  x
 + Add a line      Show analysis columns (department, project)
 Debits 450.00   Credits 450.00   In balance                    guide while typing; exact on save
                                                    [Cancel]  [Save draft]
```

- The number is issued by the server when left blank (JV-0000001 for a journal, CN- for a credit
  note, WO- for a write-off, OB- for an opening balance); a council number may still be typed.
  Rates bills, receipts and closing vouchers keep a typed number: they are normally raised by
  their own screens and the receipt series is the cash office's gapless one.
- Accounts are chosen by typing a code or a name (a filtered listbox, keyboard operable), not from
  one long select.
- Debit and Credit are two columns, as a journal is ruled. A line takes one or the other.
- A line on a receivable or payable control account asks for its party.
- The posting date shows the period it falls in and that period's status before saving.
- The running balance is a guide in exact integer cents; on save the server's figures replace it.
- "Balance on this line" puts the outstanding difference into the focused empty amount.
- "Copy as a new draft" on any voucher starts the editor with its lines (the month-end standing
  journal).

*Voucher.* The whole document on one page: header, lines with analysis, the ledger entries it
produced, who prepared and who posted and when, what it reverses or is reversed by, the source
document where one raised it (supplier invoice, payment, depreciation run, bank deposit). Actions
by permission and by the preparer rule: Post, Reverse (reason, date), Edit, Discard, Copy, Print
(a print stylesheet; the voucher prints as a document with signature lines).

### 6.3 General Ledger and the account

*Chart.* The tree as now, with **the balance of each account in each book** for the selected
year, headings carrying the sum of what is beneath them (summed by the server). Search, root type
filter, "with a balance only". A row opens the account. Holders of
`finance.ledger.account.manage` get New, Edit (name, behaviour, parent, notes), Deactivate and
Withdraw; the code and the root type stay fixed, as the server already insists. After §13 that
is the accountant and the Director.

*Account* (`ledger/:id`):

```
1200 · Bank – CBZ current          Asset · bank · normally debit        Book (USD) ZWG
From [2026-07-01] to [2026-09-30]                                   [Export CSV] [Print]
Date        Voucher      Narration                       Debit      Credit     Balance
            Brought forward                                                   12,400.00 Dr
02 Jul 26   RC-0000041   Counter takings, session 12     830.00                13,230.00 Dr
03 Jul 26   PV-0000007   Payment to Zesa                            2,000.00   11,230.00 Dr
…
            Period totals                               9,410.00   7,115.00
            Carried forward                                                   14,695.00 Dr
```

One book at a time (a running balance cannot span two). The balance column and the brought-forward
figure are computed by the server. A voucher number opens the voucher. For a balance-sheet account
brought forward is its carrying balance before the range; for a revenue or expenditure account it
is the year to date before the range.

### 6.4 Trial Balance

One per book, side by side at width, stacked on a phone. **As at** a date (default today or the
year end, whichever is earlier). When the year is closed: "Before closing entries" or "After".
Each row opens the account for the same range. States per book whether it balances and by how
much. Export and print. Balances include what was brought forward from earlier years (§7.1).

### 6.5 Cashbook

Choose a bank or cash account and a book: the account page of §6.3 with two additions, a column
showing whether each entry is matched on a completed bank reconciliation, and three guided
documents that each raise a draft journal for somebody else to post:

- **Payment**: credit this account, debit the expense or other account chosen. Paying a supplier
  invoice stays in Accounts Payable, and the form says so.
- **Receipt**: debit this account, credit the income or other account chosen. Counter takings stay
  in the Cash Office.
- **Transfer**: credit this account, debit another bank or cash account of the same book.

The head shows the ledger balance, the last reconciled statement's date and closing balance, and
the count and total of entries not yet reconciled, with a link to Bank Reconciliation.

### 6.6 Debtors

Ageing per book, grouped by party, with the reconciliation to the receivable control account
stated per book (the server already returns it). A party opens their statement: open items, every
receivable entry with a running balance, printable as a statement of account. From an open bill:
**Credit note** and **Write-off**, each a guided draft voucher (credit the receivable against that
bill; debit the account chosen) posted by somebody else. Unallocated receipts are listed as what
they are.

Parties (today's Supplier Management) lists every party type with a type filter; suppliers remain
the default.

### 6.7 Period Close and the year end

Each period of the year with its status and entry count, and for the period selected a
**readiness list computed by the server**, each line a count and a link to where it is cleared:

- draft vouchers dated in the period
- cash-ups closed and not verified, by business date
- bank deposits not posted
- supplier invoices and payments awaiting approval
- depreciation not run for the period (only when assets are registered)
- bank statements still open, and bank accounts with no reconciliation completed to the period end
- each book's trial balance at the period end, in balance or not

Close, Reopen and Lock as today, for holders of `finance.ledger.period.manage`. Lock stays final
and says so. A period that is not ready can still be closed: the list informs, the accountant
decides, and the close records what was outstanding in the audit trail.

*Year end*, on the same page when every period is closed or locked: one closing per book, the
surplus or deficit it will transfer shown first, the person who will post it named (never the
person raising it, and a holder of `finance.ledger.voucher.post`). Shown to holders of
`finance.ledger.close_year` (after §13: the accountant and the committee); others are told who
holds it.

### 6.8 Financial Statements

Position, performance and a new third statement, each per book, each with export and print.

- **Position**: balances carried from earlier years included; the surplus or deficit of the year
  to date shown as its own line under equity until the year is closed, so the statement balances
  on its face. The "what this statement does not include" notes are computed from the ledger's
  actual state (no payable account; bank accounts not reconciled to the date; no asset
  registered), not fixed sentences.
- **Performance**: always before closing entries, so a closed year still prints. Monthly,
  quarterly, half-yearly, accumulated, as now. Optional comparison with the prior year.
- **Cash receipts and payments**: for each bank and cash account and in total per book, the
  opening balance, receipts, payments and closing balance for the range; and the same movement
  analysed by the account on the other side of each voucher, grouped by root type and behaviour.
  It reconciles exactly to the movement in cash because every voucher balances. It is titled what
  it is. It is not an IPSAS 2 cash flow statement, because the chart carries nothing that
  separates financing from operating activities, and the page says so.

### 6.9 Ledger Reports

Two ledger reports with filters, paging, CSV export and print: **General ledger detail** (every
account with entries in a range, each with brought-forward, entries and carried-forward) and
**Journal listing** (vouchers with their lines for a range, by type and status). Below them, the
existing report catalogue (budget against actual, management accounts and the rest) opens through
`useFinanceNav` in whichever workspace serves it for this person.

### 6.10 Tax Control

For every account whose behaviour is `tax`: its balance per book, its debits and credits per
period of the year, and the entries behind any figure. "Record a payment to the tax authority"
raises a draft journal (debit the tax account, credit a bank account). The page states that it
reads the tax accounts as the ledger holds them and produces no statutory return (D8). With no
tax account in the chart it says how to mark one.

### 6.11 Dashboard

Rebuilt around the day, in this order: **work waiting** (to post, to verify, deposits, billing
runs, supplier invoices and payments to approve, depreciation runs and disposals to approve, bank
statements open); **the books** (each book's trial balance in balance, current period and days
left, readiness of the period); **cash and bank** (each account's ledger balance with its real
reconciliation state); debtors and creditors by age; recent postings, each opening its voucher.
The tinted figure tiles stay, as the council's approved layout; the false statements go.

### 6.12 Asset Register

The route points at the page that exists.

## 7. Server additions

All reads under `finance.ledger.view`. No new table of record.

### 7.1 Migration `242_finance_ledger_reporting.sql` (with rollback)

- `finance.document_sequence`: kinds `journal` (JV), `credit_note` (CN), `write_off` (WO) added to
  the check and to `finance.next_document_no`.
- `finance.ledger_balances(p_financial_year_id uuid, p_as_at date, p_closing text)`:
  per currency and account, the balance a statement needs.
  - asset, liability, equity: every entry dated on or before `p_as_at`, in any year;
  - revenue, expense: entries of that year dated on or before `p_as_at`;
  - `p_closing = 'before'` leaves out that year's closing voucher entirely; `'after'` includes it;
  - revenue and expense of **earlier** years that no closing voucher has brought to nil appear as
    one extra row per currency, "Surplus of earlier years not yet closed", so the trial balance
    still balances and the omission is visible rather than silent.
  The result balances per currency by construction: it is a set of whole vouchers.
- `finance.account_ledger(p_account uuid, p_currency text, p_year uuid, p_from date, p_to date)`:
  brought-forward, entries with a running balance (window sum in NUMERIC), totals.
- `finance.v_trial_balance` is left as it is for its other readers.
- Grants (§13): `accountant` → `finance.ledger.account.manage`, `finance.ledger.close_year`. The
  migration asserts afterwards, as 203 to 214 do, that no role holds both an approval and a
  publication permission.

### 7.2 Routes

| Route | Change |
|---|---|
| `POST /finance/ledger/vouchers` | `voucher_no` optional for journal, credit note, write-off, opening; issued inside the same transaction |
| `GET /finance/ledger/vouchers` | `queue=to_post|mine` (drafts by others, drafts by me); returns counts per queue |
| `GET /finance/ledger/vouchers/:id` | adds the source document, if any |
| `GET /finance/ledger/chart-balances` | new: the chart with per-book balances, headings rolled up |
| `GET /finance/ledger/accounts/:id/ledger` | new: §6.3, also `format=csv`; `reconciled` flag per entry for bank accounts |
| `GET /finance/ledger/trial-balance` | `as_at`, `closing`; reads `ledger_balances` |
| `GET /finance/ledger/statements/position`, `/performance` | read `ledger_balances`; position adds the year's surplus line and computed omissions; performance adds `compare=prior_year` |
| `GET /finance/ledger/statements/cash` | new: §6.8 |
| `GET /finance/ledger/reports/general-ledger`, `/journal-listing` | new: §6.9, JSON and CSV |
| `GET /finance/accounting/dashboard` | more work queues; real reconciliation state; position from `ledger_balances`; the "not built" alert removed |
| `GET /finance/accounting/period-readiness` | new: §6.7 |
| `GET /finance/accounting/tax` | new: §6.10 |
| `GET /finance/accounting/party-statement/:partyId` | new: §6.6 |

## 8. Frontend structure

```
workspaces/accountant/
  routes.ts · AccountantLayout.vue · useAccountant.ts
  kit/      AccountPicker.vue · PartyPicker.vue · BookSwitch.vue · Pager.vue · DateRange.vue
            StatementTable.css · print.css · csv.ts · useLedgerLists.ts (accounts, parties, periods, cached)
  pages/    AccountantDashboard · JournalsPage · JournalEditorPage · VoucherPage
            GeneralLedgerPage · AccountLedgerPage · TrialBalancePage · CashbookPage
            DebtorsPage · DebtorStatementPage · PeriodClosePage · StatementsPage
            LedgerReportsPage · TaxControlPage
            (kept) BankReconciliation · AccountsPayable · SupplierManagement → PartiesPage
                   AssetRegister · DataMigration · SectionPage (other desks' screens)
api/        ledgerApi.ts and accountingApi.ts extended; types in models/ledgerTypes.ts
```

Each page has designed loading, empty, error and "not set up yet" states. The empty ledger is a
first-class state: with no chart, the workspace says the chart comes from Data Migration or the
Director, and links there.

## 9. Testing and verification

- **Backend, on a disposable database:** a new `finance.accounting.test.js` covering numbering
  (issued, typed, concurrent, rolled back), chart balances and roll-up, the account ledger's
  running balance and brought-forward, the trial balance at a date, **a two-year case** (year 1
  posted and closed, year 2 posted: year 2's position carries year 1's balances; year 1's
  performance still reads its figures; both trial balances balance; an unclosed earlier year
  shows its row), the cash statement reconciling to cash movement, period readiness, and 403 for
  a role without `finance.ledger.view`. Existing finance suites and
  `verify-ledger-invariants.js` stay green.
- **Frontend, vitest:** the journal editor (cent arithmetic, one side per line, party required on
  a control account, server figures replacing the guide), the register queues, the account page,
  the trial balance, period close, the guard on controls the person cannot use; the coverage and
  navigation specs.
- **In the running app**, with the demonstration ledger seeded: as `demo.accountant` and
  `demo.finance-admin`, a journal prepared by one and posted by the other, drilled from chart to
  account to voucher, reversed; a payment and a transfer from the cashbook; a period closed; the
  statements printed; at 1440 px and 390 px with no console error and no horizontal overflow.

## 10. Build order

Each step ends with its tests passing and the step walked in the running app.

1. **Groundwork**: seed the demonstration ledger locally; nav groups in the shell; the kit; route
   the Asset Register; correct the stale statements.
2. **The book**: migration 242 and the ledger routes; Journals (register, editor, voucher);
   General Ledger and the account; Trial Balance.
3. **Cash and bank**: Cashbook and its three documents; reconciliation state.
4. **Debtors and creditors**: Debtors, the statement, credit note and write-off; Parties.
5. **Period end**: Period Close and the year end; Financial Statements; Ledger Reports; Tax
   Control.
6. **The desk**: Dashboard; `WORKSPACE-ACCESS.md`, the implementation tracker and §14 of the
   workspaces design updated; the full verification of §9.

## 11. Calls made in this design, for you to check

1. **The read side of the ledger changes** (§7.1): statements carry balances forward and a closed
   year's performance still prints. Stored data and posting rules do not change. This is the one
   item that goes beyond screens, and it is included because the workspace cannot be called
   complete with it open.
2. **Permissions:** superseded by §13. The accountant is granted the chart and the year-end close.
3. **Sundry-debtor invoicing, payroll, procurement, stores and statutory returns are out**, each
   for the Council decision or phase named in §3.
4. **The cash statement is a statement of receipts and payments**, not an IPSAS 2 cash flow.
5. **Tax Control reads the tax accounts**; it files nothing.
6. **Closing a period that is not ready is allowed**, with what was outstanding recorded.
7. **Other desks' embedded screens are not redesigned** in this work.
8. Journal numbers are issued as JV-, CN-, WO-, OB-; a typed council number is still accepted.

## 12. Left to the builder

- Whether `ledger_balances` and `account_ledger` are SQL functions or inline queries in the route,
  provided the arithmetic stays in SQL and one definition serves every statement.
- The exact split of pages into components, and the tests' file layout.
- Before offering Credit note and Write-off on a rates bill: confirm how
  `finance.rates_bill_unsettled()` reads settlement. If rates arrears would not follow a ledger
  credit note, those two actions are offered on non-rates bills only and a rates bill links to
  Rates. The ageing and the rates arrears must never disagree.
- CSV is produced by the server from the same query as the screen. PDF and XLSX for the ledger
  reports are not required; the print stylesheet covers paper.

## 13. Client decisions on approval (2026-11-16)

1. **Scope: all of it.** The six steps of §10, including the change to the ledger's read side
   (§7.1).
2. **The accountant is granted the chart and the year-end close**
   (`finance.ledger.account.manage`, `finance.ledger.close_year`), by migration 242. This is a
   client direction, not a Council resolution: it is recorded in `COUNCIL-DECISIONS.md` beside D21
   as awaiting the Council's confirmation, like K1 to K4. Before this, the chart was the
   Director's alone and the year-end close was the committee's alone (the Director did not hold
   it; the design draft said otherwise and was wrong).
   - The second-person rule is untouched: whoever raises a closing voucher cannot post it, and the
     person named to post must hold `finance.ledger.voucher.post`. In practice the accountant
     raises and the Director posts, or the reverse through an override.
   - **Side effect handled:** the workspace catalogue admitted anyone holding
     `finance.ledger.close_year` to Committee Decisions. That permission is removed from the
     committee's admitting list in `backend/src/config/financeWorkspaces.js`; the committee is
     still admitted by its budget, revision, project, publication and tariff approvals, and the
     accountant's switcher still shows Accounting only. The catalogue test and its grants fixture
     are updated to the new table.
3. **Git:** a feature branch, `feat/accounting-workspace`. **Nothing is committed**: the machine has
   no git author identity and the client chose to commit the work themselves. Every change is left
   uncommitted on the branch. Nothing is pushed.
4. **Execution:** one fresh agent per task with a review after each
   (`docs/superpowers/plans/2026-11-16-accounting-workspace.md`).
