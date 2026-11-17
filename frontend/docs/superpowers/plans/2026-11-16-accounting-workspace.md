# Accounting Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/finance/accountant` a complete accountant's desk: journals, general ledger with account drill-down, trial balance at a date, cashbook, debtors, period and year-end close, statements, ledger reports, tax control and a dashboard, with statements that stay right across a year end.

**Architecture:** Purpose-built Vue pages in `frontend/src/modules/finance/workspaces/accountant/` in the portal's `cw-*` language, over the existing ledger engine. Where the engine has no read for something (balances on the chart, a running balance, a trial balance at a date), a read is added on the server in SQL over NUMERIC. One migration (242) adds journal number series, one balance function every statement reads, and two grants.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Pinia + vue-router + lucide-vue-next; vitest + @vue/test-utils (happy-dom). Fastify + `@fastify/postgres` (CommonJS), PostgreSQL 15 in the `lamis-db` container; jest.

**Spec:** `frontend/docs/superpowers/specs/2026-11-16-accounting-workspace-design.md`

## Global Constraints

- No money arithmetic in JavaScript on the server: SQL over NUMERIC, decimal strings in JSON.
- In the browser, server figures are shown as sent. The only browser sum is the journal editor's running balance, in exact integer cents (`BigInt`), labelled a guide.
- No figure spans USD and ZWG. Every money row carries its currency; lists that need a running balance show one book at a time.
- Preparer is never poster; a posted line is never amended; a correction is a reversal. No control is offered whose only outcome is a 403: an absent permission is explained in words.
- New reads use `finance.ledger.view`. No new permission code. The only grant change is `accountant` → `finance.ledger.account.manage`, `finance.ledger.close_year`.
- Existing route names (`acc-journals`, `acc-ledger`, `acc-trial`, `acc-reports`, `acc-receivable`, `acc-close`, …) keep their names and their `serves` entries.
- `/finance/console`, `pages/sections/*` and other workspaces are not altered.
- UI copy: plain British English, no exclamation marks, no marketing language. WCAG 2.1 AA; no horizontal page scroll from 390 px to 1440 px.
- Every page has loading, empty, error and "not set up yet" states.

**Commands used throughout**

```bash
# Backend unit (no database)
cd backend && npx jest test/<file>.test.js
# Backend integration (disposable database; password from backend/.env DATABASE_URL)
cd backend && DATABASE_URL="$(grep ^DATABASE_URL .env | cut -d= -f2- | sed 's#/vungu_master_db_v1#/vungu_acceptance_test#')" \
  DEMO_DEFAULT_PASSWORD=demo1234 node node_modules/jest/bin/jest.js src/routes/__tests__/<suite>.test.js \
  --testPathIgnorePatterns '/node_modules/' --runInBand
# Frontend
cd frontend && npx vitest run --root . --no-file-parallelism src/modules/finance/__tests__/<spec>.spec.ts
cd frontend && npx vue-tsc --noEmit
```

## Review Focus

1. **A closing voucher that was later reversed.** "Before closing entries" must leave out the closing voucher *and* its reversal, and the year must read as not closed. Test in Task 2.
2. **An account carrying a balance against its nature** (an asset in credit). Shown on the side it is on (`Cr`), never flipped to look tidy: chart balances, account page, trial balance. Tests in Tasks 3 and 7.
3. **Unreadable amounts in the journal editor**: `1,250.50`, `12.345`, `-5`, blank, both sides filled. The line is marked, the guide ignores it and says so, Save is refused with the line named. Test in Task 6.
4. **An empty ledger**: no chart, no periods, no year selected. Every new page renders its "not set up yet" state from empty lists without an error. Tests in Tasks 5, 7, 8, 11.
5. **Several entries on one date across a page break.** The running balance order is `posting_date, posted_at, id`; page 2's first balance continues from page 1's last. Test in Task 3.

---

## File map

```
backend/
  migrations/242_finance_ledger_reporting.sql            new
  migrations/rollback/242_finance_ledger_reporting.down.sql  new
  scripts/migrate.js                                     + '242_finance_ledger_reporting.sql'
  scripts/test-suites.js                                 + finance.accounting in `integration`
  src/config/financeWorkspaces.js                        close_year leaves the committee's list
  src/config/__tests__/financeWorkspaces.test.js, fixtures/financeRoleGrants.json
  src/lib/financeCsv.js                                  new: rows → CSV text (strings only)
  src/routes/finance-ledger.js                           numbering, queues, source doc, TB as-at
  src/routes/finance-ledger-reads.js                     new: chart-balances, account ledger, cash statement, reports
  src/routes/finance-accounting.js                       dashboard, readiness, tax, party statement
  src/routes/__tests__/finance.accounting.test.js        new integration suite
  test/finance-ledger-reads.test.js                      new unit tests (pure helpers)
  server.js, test/helpers/buildApp.js                    register financeLedgerReadRoutes
frontend/src/modules/finance/
  api/ledgerApi.ts, api/accountingApi.ts, models/ledgerTypes.ts      extended
  workspaces/shared/PortalShell.vue, portal.css                      nav groups
  workspaces/accountant/routes.ts, AccountantLayout.vue
  workspaces/accountant/kit/   journalMath.ts · csv.ts · useLedgerLists.ts · AccountPicker.vue
                               PartyPicker.vue · BookSwitch.vue · Pager.vue · DateRange.vue
                               statement.css · print.css · GuidedJournalDialog.vue
  workspaces/accountant/pages/ JournalsPage · JournalEditorPage · VoucherPage · GeneralLedgerPage
                               AccountLedgerPage · TrialBalancePage · CashbookPage · DebtorsPage
                               DebtorStatementPage · PartiesPage (from SupplierManagement)
                               PeriodClosePage · StatementsPage · LedgerReportsPage · TaxControlPage
                               AccountantDashboard (reworked)
  __tests__/accounting*.spec.ts                                      new specs, one per task
frontend/docs/finance/WORKSPACE-ACCESS.md, IMPLEMENTATION-TRACKER.md, COUNCIL-DECISIONS.md
```

`finance-ledger.js` is 1,957 lines; the new reads go in `finance-ledger-reads.js` rather than growing it. Only what changes existing routes is edited there.

---

## Step 1 — Groundwork

### Task 1: Navigation groups, the Asset Register route, and the databases to work on

**Files:**
- Modify: `frontend/src/modules/finance/workspaces/shared/PortalShell.vue`, `portal.css`
- Modify: `frontend/src/modules/finance/workspaces/accountant/AccountantLayout.vue`, `routes.ts`
- Test: `frontend/src/modules/finance/__tests__/accountingNav.spec.ts`

**Interfaces:**
- Produces: `PortalNavItem` gains `group?: string`. Consecutive items sharing a `group` render under one heading (`<p class="cw-nav-group">`); items without a group render as today.
- Produces: route names `acc-voucher`, `acc-journal-new`, `acc-journal-edit`, `acc-account`, `acc-cashbook`, `acc-debtor`, `acc-ledger-reports`, `acc-parties` declared in `routes.ts` (pages arrive in later tasks; until then each points at the existing component it replaces or at `NotBuiltPage` with a `cwWhy`). `acc-assets` → `pages/AssetRegister.vue`. `acc-suppliers` kept as a redirect to `acc-parties`.
- Produces: nav groups exactly: `Desk`, `The book`, `Cash & bank`, `Debtors`, `Creditors`, `Assets`, `Period end`, `Control` with the entries of spec §6.1. Child pages set `meta.cwNav` to their parent entry.

- [ ] **Step 1: Prepare the databases** (no code)

```bash
cd backend && node scripts/prepare-acceptance-db.js prepare      # builds vungu_acceptance_test
cd backend && node scripts/seed-general-ledger-demo.js           # demo chart, periods, vouchers in the dev database
cd backend && node scripts/seed-general-ledger-demo.js --report  # expect: both trial balances balance
```
If the dev database lacks the demo logins, `npm run seed:demo`. Record in the task notes what each command printed.

- [ ] **Step 2: Write the failing test** `accountingNav.spec.ts`

```ts
it('groups the navigation by the book', async () => {
  const w = await mountLayout()                    // AccountantLayout inside a memory router, store identity = accountant
  expect(w.findAll('.cw-nav-group').map((g) => g.text())).toEqual(
    ['Desk', 'The book', 'Cash & bank', 'Debtors', 'Creditors', 'Assets', 'Period end', 'Control'])
})
it('routes the asset register to the page that exists', () => {
  const r = router.resolve({ name: 'acc-assets' })
  expect(r.matched.at(-1)?.meta.cwWhy).toBeUndefined()   // no longer the "Not built yet" page
})
it('a shell without groups renders no heading', async () => { /* mount PortalShell with ungrouped nav → 0 .cw-nav-group */ })
```

- [ ] **Step 3: Run it** — expect FAIL (no `.cw-nav-group`; `acc-assets` still carries `cwWhy`).
- [ ] **Step 4: Implement** the `group` rendering in `PortalShell.vue` (+ `.cw-nav-group` style: 11.5px uppercase, `--cw-side` muted ink, 14px top margin), the grouped `nav` in `AccountantLayout.vue`, the route changes in `routes.ts`.
- [ ] **Step 5: Run** the new spec plus `financeNav.spec.ts`, `workspaceCoverage.spec.ts`, `workspaceFrame.spec.ts` — expect PASS. `npx vue-tsc --noEmit` — 0 errors.
- [ ] **Step 6: Commit** `feat(accounting): group the navigation by the book and route the asset register`

---

## Step 2 — The book

### Task 2: Migration 242 — number series, the balance function, the grants

**Files:**
- Create: `backend/migrations/242_finance_ledger_reporting.sql`, `backend/migrations/rollback/242_finance_ledger_reporting.down.sql`
- Modify: `backend/scripts/migrate.js` (append to `MIGRATIONS` with the one-line comment the list uses), `backend/scripts/test-suites.js`
- Modify: `backend/src/config/financeWorkspaces.js`, `__tests__/financeWorkspaces.test.js`, `__tests__/fixtures/financeRoleGrants.json`
- Modify: `frontend/docs/finance/COUNCIL-DECISIONS.md`
- Test: `backend/src/routes/__tests__/finance.accounting.test.js` (created here; later tasks add to it)

**Interfaces:**
- Produces: `finance.next_document_no(authority, kind)` accepts `journal`→`JV`, `credit_note`→`CN`, `write_off`→`WO`, `closing`→`YC` (existing kinds unchanged; `closing` is used by Task 11).
- Produces: `finance.ledger_balances(p_financial_year_id uuid, p_as_at date DEFAULT NULL, p_closing text DEFAULT 'after') RETURNS TABLE (currency text, ledger_account_id uuid, account_code text, account_name text, root_type text, report_type text, account_type text, entry_count int, debit_total numeric, credit_total numeric, net_debit numeric)`, `STABLE`, `SECURITY INVOKER`.
  - `p_as_at` NULL or later than the year end → the year end.
  - asset, liability, equity rows: every entry with `posting_date <= as_at`, any year.
  - revenue, expense rows: entries of `p_financial_year_id` with `posting_date <= as_at`.
  - `p_closing = 'before'`: leaves out every voucher of that year whose type is `closing`, and every reversal whose `reverses_voucher_id` is such a voucher.
  - one further row per currency when revenue and expense entries of financial years starting **before** this one do not net to nil: `ledger_account_id NULL`, `account_code NULL`, `account_name 'Surplus of earlier years not yet closed'`, `root_type 'equity'`, `report_type 'balance_sheet'`, `account_type 'unclosed_surplus'`.
  - any other `p_closing` → `RAISE EXCEPTION ... USING ERRCODE = '22023'`.
- Produces: `finance.year_closed(p_financial_year_id uuid, p_currency text) RETURNS boolean` — a posted closing voucher exists for that year and book and no posted reversal of it does.
- Produces: grants as in the constraints; the migration ends with the same approval-and-publication assertion block migration 214 ends with.
- Produces: `APPROVALS` in `financeWorkspaces.js` no longer contains `finance.ledger.close_year`.
- Produces (test file): helpers every later backend task reuses — `call(method, url, token, payload)`, `as.{director,accountant,auditor,cashier}`, `made.{y1,y2,bank,debtors,income,expense,surplus,tax}`, `journal(yearId, date, lines, extra?)` returning the posted voucher id (prepared by the accountant, posted by the Director), and an `afterAll` that removes its own rows the way `finance.bank.test.js` does.

Fixture: `TAG = 'AC' + 6 hex`. Year 1 `2041-01-01..2041-12-31`, Year 2 `2042-01-01..2042-12-31`, both USD-reporting, both with monthly periods opened. Accounts `${TAG}-1100` bank (asset, bank), `-1200` debtors (asset, receivable), `-2100` VAT (liability, tax), `-3000` accumulated surplus (equity, accumulated_surplus), `-4000` income (revenue), `-5000` expense (expense). Year 1 USD: opening Dr bank 1000.00 / Cr surplus 1000.00 (2041-01-05); income Dr bank 900.00 / Cr income 900.00 (2041-03-10); expense Dr expense 400.00 / Cr bank 400.00 (2041-06-20). Year 2 USD: Dr bank 50.00 / Cr income 50.00 (2042-02-01).

- [ ] **Step 1: Write the failing tests**

```js
describe('migration 242', () => {
  test('a journal number is issued when none is typed, and a typed one is kept', async () => {
    const a = await call('POST', '/finance/ledger/vouchers', as.accountant, { voucher_type: 'journal', currency: 'USD', financial_year_id: made.y1, posting_date: '2041-07-01', lines: pair('10.00') })
    expect(a.statusCode).toBe(201)
    expect(a.json().data.voucher.voucher_no).toMatch(/^JV-\d{7}$/)
    const b = await call('POST', '/finance/ledger/vouchers', as.accountant, { voucher_no: `${TAG}-TYPED`, voucher_type: 'journal', /* … */ })
    expect(b.json().data.voucher.voucher_no).toBe(`${TAG}-TYPED`)
  })
  test('a receipt still needs its number typed', async () => { /* voucher_type 'receipt', no voucher_no → 400 number_required */ })
  test('year 2 carries year 1 forward, before year 1 is closed', async () => {
    const rows = await balances(made.y2, null, 'after')            // SELECT * FROM finance.ledger_balances(...)
    expect(net(rows, made.bank)).toBe('1550.00')                    // 1000 + 900 − 400 + 50
    expect(net(rows, made.income)).toBe('-50.00')                   // year 2 only
    expect(unclosed(rows)).toBe('-500.00')                          // year 1 surplus, visible, not silent
    expect(sumNet(rows)).toBe('0.00')
  })
  test('closing year 1 moves its surplus to accumulated surplus and its performance still reads', async () => {
    await call('POST', '/finance/ledger/close-year', as.accountant, { financial_year_id: made.y1, currency: 'USD', voucher_no: `${TAG}-CLOSE`, posted_by: ids.director })
    const before = await balances(made.y1, null, 'before')
    expect(net(before, made.income)).toBe('-900.00'); expect(net(before, made.expense)).toBe('400.00')
    const after = await balances(made.y1, null, 'after')
    expect(net(after, made.income)).toBeUndefined(); expect(net(after, made.surplus)).toBe('-1500.00')
    const y2 = await balances(made.y2, null, 'after')
    expect(unclosed(y2)).toBeUndefined(); expect(net(y2, made.surplus)).toBe('-1500.00'); expect(sumNet(y2)).toBe('0.00')
  })
  test('as at a date inside the year', async () => { /* y1 as_at 2041-03-31 'before': bank 1900.00, income -900.00, no expense row, sum 0.00 */ })
  test('a reversed closing reads as not closed (Review Focus 1)', async () => {
    /* reverse `${TAG}-CLOSE` as the Director; year_closed(y1,'USD') = false; balances(y1,null,'before') income -900.00 and sum 0.00;
       balances(y2) shows the unclosed row -500.00 again */
  })
  test('the accountant now holds the chart and the year-end close, and nothing that publishes', async () => {
    /* SELECT from finance.role_permission: both codes present for 'accountant'; no is_publication code */
  })
})
```
and in `financeWorkspaces.test.js`: `['accountant', ['accountant'], 'accountant']` still holds with the regenerated fixture (which now lists the two new codes), and `['finance_committee', ['committee'], 'committee']` still holds.

- [ ] **Step 2: Run** the integration suite and `npx jest src/config` — expect FAIL (function does not exist; fixture stale).
- [ ] **Step 3: Write migration 242 and its rollback.** Idempotent like its neighbours (`CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`, `DROP CONSTRAINT IF EXISTS` then `ADD`). Make `voucher_no` optional in `POST /finance/ledger/vouchers`: when absent and the type is `journal`, `credit_note`, `write_off` or `opening`, `SELECT finance.next_document_no(app.authority_id(), kind)` inside the same transaction; when absent for any other type → 400 `number_required` ("A <type> carries the number of the document that raised it. Type it."). Remove `close_year` from `APPROVALS`. Regenerate the fixture from the acceptance database:

```bash
docker exec lamis-db psql -U postgres -d vungu_acceptance_test -At -c \
 "select json_object_agg(role_name, codes) from (select role_name, json_agg(permission_code order by permission_code) codes from finance.role_permission group by 1) t" \
 | python3 -m json.tool --indent 4 > backend/src/config/__tests__/fixtures/financeRoleGrants.json
```
- [ ] **Step 4: Apply and run.** Apply 242 to `vungu_acceptance_test` and to the dev database (`npm run migrate`; if an earlier pending migration fails for a reason outside this work, apply 242 with `psql -f` and insert its row in `schema_migrations`, and say so). Run the integration suite, `npx jest src/config test/finance-ledger.test.js test/finance-roles.test.js`, and `node scripts/verify-ledger-invariants.js` against the acceptance database — expect PASS, 34/34.
- [ ] **Step 5: Test the rollback** on the acceptance database: apply `.down.sql`, confirm the function and grants are gone, re-apply 242.
- [ ] **Step 6: Record the direction** in `COUNCIL-DECISIONS.md`: a row **K5** "The accountant maintains the chart and raises the year-end close" (directed 2026-11-16, built in 242, awaiting Council confirmation under D21), in the K-table's own wording style.
- [ ] **Step 7: Commit** `feat(ledger): journal number series, balances carried across years, accountant grants (migration 242)`

### Task 3: Ledger reads — chart balances, the account, the trial balance at a date, voucher queues

**Files:**
- Create: `backend/src/routes/finance-ledger-reads.js`, `backend/src/lib/financeCsv.js`, `backend/test/finance-ledger-reads.test.js`
- Modify: `backend/src/routes/finance-ledger.js` (vouchers list + detail, trial balance), `backend/server.js`, `backend/test/helpers/buildApp.js`
- Test: `finance.accounting.test.js`

**Interfaces:**
- Produces `GET /finance/ledger/chart-balances?financial_year_id&as_at&closing` → `{ accounts: ChartBalanceRow[], currencies: string[], as_at, closing }` where `ChartBalanceRow = { id, code, name, root_type, report_type, account_type, parent_id, is_group, is_postable, status, notes, balances: { currency, net_debit, amount, side: 'Dr'|'Cr' }[] }`, code order. A heading's `balances` is the sum of every account beneath it (recursive CTE in SQL). `amount` is the absolute figure, `side` where it falls; nil balances are omitted from `balances`.
- Produces `GET /finance/ledger/accounts/:id/ledger?financial_year_id(required)&currency(required)&from&to&limit(≤500, default 100)&offset&format=json|csv` → `{ account, natural_side, currency, from, to, brought_forward: Bal, entries: LedgerLine[], totals: { debit, credit }, carried_forward: Bal, total, limit, offset }`; `Bal = { net_debit, amount, side }`; `LedgerLine = { id, voucher_id, voucher_no, voucher_type, posting_date, narration, party_id, party_name, debit, credit, balance: Bal, reconciled: boolean | null }`. Order `posting_date, posted_at, id`. `reconciled` is non-null only for `bank` accounts: true when the entry is in `finance.bank_match_entry` under a statement whose status is `reconciled`. Brought forward: balance-sheet account → every entry before `from` in any year; revenue or expense → entries of the year before `from`. `from`/`to` default to the year's dates. Refuses a heading with 409 `is_group`.
- Produces `financeCsv.toCsv(columns: {header, key}[], rows: object[]): string` — RFC 4180 quoting, CRLF, values as given (never reformatted); a leading `=`, `+`, `-`, `@` in a text cell is prefixed with `'`, amounts excepted by `type: 'amount'`.
- Changes `GET /finance/ledger/trial-balance`: adds `as_at`, `closing` (default `'after'`); reads `finance.ledger_balances`; response adds `as_at`, `closing`, `closed: { currency, closed }[]`; row shape unchanged plus the unclosed-surplus row (`ledger_account_id: null`).
- Changes `GET /finance/ledger/vouchers`: adds `queue=to_post|mine` (`to_post`: drafts not prepared by the caller, types other than `receipt` and `rates_bill`; `mine`: drafts prepared by the caller) and returns `queues: { to_post, mine, posted, all }` counted for the same year filter.
- Changes `GET /finance/ledger/vouchers/:id`: adds `source: { kind: 'supplier_invoice'|'supplier_payment'|'depreciation_run'|'asset_disposal'|'bank_deposit'|'rates_bill'|'rates_receipt'|'cash_receipt', id, label } | null`, found by looking up `voucher_id` in each document table.

- [ ] **Step 1: Failing tests** (integration, added to the suite; fixture figures from Task 2 with year 1 closed again at the start of this block)

```js
test('the chart carries each account\'s balance and headings carry their sum', async () => {
  // a heading `${TAG}-1000` created with bank and debtors moved beneath it
  const { accounts } = get('/finance/ledger/chart-balances', { financial_year_id: made.y2 })
  expect(bal(accounts, `${TAG}-1100`, 'USD')).toEqual({ currency: 'USD', net_debit: '1550.00', amount: '1550.00', side: 'Dr' })
  expect(bal(accounts, `${TAG}-1000`, 'USD').amount).toBe('1550.00')
})
test('an account in credit against its nature is shown in credit (Review Focus 2)', async () => {
  await journal(made.y2, '2042-03-01', [{ ledger_account_id: made.expense, debit: '2000.00' }, { ledger_account_id: made.bank, credit: '2000.00' }])
  expect(bal(chart(made.y2), `${TAG}-1100`, 'USD')).toMatchObject({ net_debit: '-450.00', amount: '450.00', side: 'Cr' })
})
test('the account page runs a balance from what was brought forward', async () => {
  const p = get(`/finance/ledger/accounts/${made.bank}/ledger`, { financial_year_id: made.y2, currency: 'USD' })
  expect(p.brought_forward).toEqual({ net_debit: '1500.00', amount: '1500.00', side: 'Dr' })
  expect(p.entries.map((e) => [e.debit, e.credit, e.balance.amount, e.balance.side])).toEqual([['50.00', '0.00', '1550.00', 'Dr'], ['0.00', '2000.00', '450.00', 'Cr']])
  expect(p.totals).toEqual({ debit: '50.00', credit: '2000.00' }); expect(p.carried_forward.side).toBe('Cr')
})
test('a revenue account is brought forward within its year only', async () => { /* income, y2, from 2042-02-15 → brought_forward 50.00 Cr */ })
test('the running balance continues across a page break on one date (Review Focus 5)', async () => {
  /* three journals of 1.00, 2.00, 3.00 Dr bank on 2042-04-01; limit=2 offset=0 then offset=2:
     page 2's first balance equals page 1's last balance plus that line */
})
test('csv carries the same figures', async () => { /* format=csv → text/csv; first data line "Brought forward"; a line contains "50.00" */ })
test('the trial balance at a date balances and names the closing state', async () => {
  const tb = get('/finance/ledger/trial-balance', { financial_year_id: made.y1, as_at: '2041-03-31', closing: 'before' })
  expect(tb.books.find((b) => b.currency === 'USD')).toMatchObject({ debit_total: '1900.00', credit_total: '1900.00', balances: true })
  expect(tb.closed).toContainEqual({ currency: 'USD', closed: true })
})
test('the voucher queues count what waits for each person', async () => { /* accountant drafts one: as accountant queues.mine = 1; as director queues.to_post = 1 and queue=to_post lists it */ })
test('a role without the ledger gets 403 on every new read', async () => { /* cashier: chart-balances, accounts/:id/ledger → 403 */ })
```
Unit (`finance-ledger-reads.test.js`): `toCsv` quoting (`a,"b"` → `"a,""b"""`), CRLF, formula-prefix guard, amounts untouched; `sideOf('-450.00')` → `{ amount: '450.00', side: 'Cr' }` computed on the string (no float).

- [ ] **Step 2: Run** — expect FAIL (404s).
- [ ] **Step 3: Implement.** `finance-ledger-reads.js` exports `financeLedgerReadRoutes`; registered in `server.js` after `financeLedgerRoutes` and in `buildFinanceAppForTest`. The running balance is `sum(debit - credit) OVER (ORDER BY posting_date, posted_at, id)` plus the brought-forward scalar, computed over the whole range in a CTE and paged in the outer query. `amount`/`side` come from SQL (`abs(x)::text`, `CASE WHEN x < 0 THEN 'Cr' ELSE 'Dr' END`).
- [ ] **Step 4: Run** the integration suite, the unit file, `test/finance-ledger.test.js`, and the existing `finance.bank`, `finance.rates`, `finance.cash` suites (they read the trial balance) — expect PASS.
- [ ] **Step 5: Commit** `feat(ledger): chart balances, account ledger with running balance, trial balance at a date`

### Task 4: Frontend API, types and the kit

**Files:**
- Modify: `api/ledgerApi.ts`, `api/accountingApi.ts`, `models/ledgerTypes.ts`
- Create: everything under `workspaces/accountant/kit/` except `GuidedJournalDialog.vue`
- Test: `__tests__/accountingKit.spec.ts`

**Interfaces:**
- Produces in `ledgerApi`: `chartBalances(params: { financial_year_id: string; as_at?: string; closing?: 'before' | 'after' }): Promise<ChartBalances>`; `accountLedger(id: string, params: AccountLedgerQuery): Promise<AccountLedgerPage>`; `accountLedgerCsvUrl(id, params): string`; `trialBalance` params gain `as_at`, `closing`; `VoucherQuery` gains `queue`; `VoucherList` gains `queues`; `VoucherDetail` gains `source`; `VoucherBody.voucher_no` becomes optional. Types named as in Task 3's shapes: `ChartBalanceRow`, `Bal`, `LedgerLine`, `AccountLedgerPage`.
- Produces `kit/journalMath.ts`:
  - `parseAmount(text: string): bigint | null` — cents; accepts `12`, `12.5`, `12.50`, surrounding spaces; rejects commas, 3+ decimals, signs, empty.
  - `interface DraftLine { debit: string; credit: string }`
  - `lineState(l: DraftLine): 'empty' | 'debit' | 'credit' | 'both' | 'unreadable'`
  - `guide(lines: DraftLine[]): { debit: string; credit: string; difference: string; inBalance: boolean; unreadable: number }` — strings via `centsToText`; `difference` = debits − credits; `inBalance` false when `unreadable > 0` or totals are nil.
  - `balancingAmount(lines: DraftLine[], index: number): { side: 'debit' | 'credit'; amount: string } | null` — what line `index` (empty) must carry to balance; null when already in balance or any line unreadable.
- Produces `kit/useLedgerLists.ts`: `useLedgerLists()` → `{ accounts: Ref<LedgerAccount[]>, parties: Ref<LedgerParty[]>, periods: Ref<LedgerPeriod[]>, loadAccounts(force?), loadParties(force?), loadPeriods(yearId), periodFor(date: string): LedgerPeriod | null, error }` — module-level cache, reset on logout via `resetAccountant()`.
- Produces components: `AccountPicker` (`v-model: string` account id; props `accounts`, `filter?: (a) => boolean`, `label`; text input + listbox, `role="combobox"`, arrows/Enter/Escape, matches code prefix first then name substring, max 50 shown); `PartyPicker` (same contract over parties, with `types?: PartyType[]`); `BookSwitch` (`v-model: Currency`, segmented USD | ZWG, `role="radiogroup"`); `Pager` (`total`, `limit`, `offset`, emits `update:offset`; "1–100 of 340", Previous/Next); `DateRange` (`v-model:from`, `v-model:to`, `min`, `max`).
- Produces `kit/csv.ts`: `download(url: string, filename: string): Promise<void>` — fetches through the axios instance (cookies) as a blob and saves it.
- Produces `kit/statement.css` (`.st-table`, `.st-num`, `.st-total`, `.st-sub`, `.st-bf`), `kit/print.css` (`@media print`: hides `.cw-side`, `.cw-banner`, `.no-print`; white surface; `.print-only` shown).

- [ ] **Step 1: Failing tests** `accountingKit.spec.ts`

```ts
expect(parseAmount('12.5')).toBe(1250n); expect(parseAmount(' 7 ')).toBe(700n)
for (const bad of ['1,250.50', '12.345', '-5', '', 'abc', '1e3']) expect(parseAmount(bad)).toBeNull()
expect(lineState({ debit: '5', credit: '5' })).toBe('both'); expect(lineState({ debit: 'x', credit: '' })).toBe('unreadable')
expect(guide([{ debit: '450.00', credit: '' }, { debit: '', credit: '450' }])).toEqual({ debit: '450.00', credit: '450.00', difference: '0.00', inBalance: true, unreadable: 0 })
expect(guide([{ debit: '0.10', credit: '' }, { debit: '0.20', credit: '' }, { debit: '', credit: '0.30' }]).inBalance).toBe(true)   // the float trap
expect(guide([{ debit: '10', credit: '' }, { debit: '1,0', credit: '' }])).toMatchObject({ unreadable: 1, inBalance: false })
expect(balancingAmount([{ debit: '100', credit: '' }, { debit: '', credit: '40' }, { debit: '', credit: '' }], 2)).toEqual({ side: 'credit', amount: '60.00' })
// AccountPicker: typing "12" lists codes starting 12 first; ArrowDown+Enter emits the id; Escape closes; aria-expanded toggles
// Pager: total 340, limit 100, offset 100 → text "101–200 of 340"; Next emits 200; Previous disabled at 0
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** spec + `vue-tsc` — PASS.
- [ ] **Step 5: Commit** `feat(accounting): ledger API reads and the workspace kit`

### Task 5: Journals register and the voucher page

**Files:**
- Create: `pages/JournalsPage.vue`, `pages/VoucherPage.vue`
- Modify: `routes.ts` (`acc-journals` → `JournalsPage`; `acc-voucher` → `VoucherPage`, `cwNav: 'acc-journals'`)
- Test: `__tests__/accountingJournals.spec.ts`

**Interfaces:**
- Consumes: `ledgerApi.vouchers({ queue, … })`, `.voucher(id)`, `.postVoucher`, `.reverseVoucher`, `.discardVoucher`; kit `Pager`, `DateRange`, `BookSwitch` not used here (book is a filter: Both / USD / ZWG), `PartyPicker`.
- Produces: register state lives in the route query (`queue`, `from`, `to`, `type`, `book`, `party`, `q`, `offset`) so Back returns to the same list. Default queue: `to_post` when its count > 0, else `mine` when > 0, else `all`.
- Produces: `VoucherPage` actions and their guards — Post: `status==='draft' && can('finance.ledger.voucher.post') && prepared_by !== me` (own draft shows "You prepared this voucher, so somebody else posts it."); Reverse: posted, not already reversed, `can('finance.ledger.voucher.reverse')` → `ReasonDialog` (min 10 chars) + optional date; Edit/Discard: own or any draft with `can('finance.ledger.voucher.prepare')`, hidden when `source` is set (document vouchers are discarded from their document); Copy → `acc-journal-new?from=<id>`; Print → `window.print()` with signature lines "Prepared by", "Posted by", "Authorised".
- Produces: links — each line's account → `acc-account`; `reverses`/`reversed by` → `acc-voucher`; `source` → the document's page (`supplier_invoice`,`supplier_payment` → `acc-payable`; `depreciation_run`,`asset_disposal` → `acc-assets`; `bank_deposit` → `acc-banking`; rates → `acc-revenue`; `cash_receipt` → `acc-cashups`).

- [ ] **Step 1: Failing tests**

```ts
it('opens on what waits for this person', …)            // queues {to_post: 2, mine: 1} → first call has queue 'to_post'; tab "To post 2" is aria-selected
it('pages on the server', …)                            // total 120 → Next → vouchers called with offset 50
it('does not offer Post on a voucher the viewer prepared, and says why', …)
it('offers Post to a second person and re-reads after posting', …)   // postVoucher called; note shows entries count
it('asks for a reason before reversing', …)             // reverseVoucher called with { reason } ≥ 10 chars
it('hides Edit and Discard on a voucher raised by a document and links to it', …)   // source: supplier_invoice
it('says there is no year when none is selected (Review Focus 4)', …)   // store.selectedYearId null → "Choose a financial year" and no API call
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** both pages (`cw-pagehead`, `cw-seg` tabs, `cw-table`; voucher page uses `statement.css` and `print.css`). **Step 4: Run** spec + `vue-tsc` — PASS.
- [ ] **Step 5: Walk it** in the running app as `demo.accountant` and `demo.finance-admin` (seeded ledger): queue tabs, open a voucher, post another's draft, reverse, print preview. 1440 px and 390 px. No console error.
- [ ] **Step 6: Commit** `feat(accounting): journals register with queues and the voucher page`

### Task 6: The journal editor

**Files:**
- Create: `pages/JournalEditorPage.vue`
- Modify: `routes.ts` (`acc-journal-new` at `journals/new`, `acc-journal-edit` at `journals/:id/edit`, both `cwNav: 'acc-journals'`; declared **before** `journals/:id`)
- Test: `__tests__/accountingJournalEditor.spec.ts`

**Interfaces:**
- Consumes: `journalMath`, `useLedgerLists`, `AccountPicker`, `PartyPicker`, `BookSwitch`, `ledgerApi.createVoucher/updateVoucher/voucher`.
- Produces: query contract for prefilled drafts, used by Tasks 9, 10, 14 through `GuidedJournalDialog` **not** by URL (the dialog posts the draft itself); the editor accepts only `?from=<voucherId>` (copy) and `?type=`.
- Type choices: Journal, Opening balance, Credit note, Write-off (number optional, placeholder "Issued on save"); Rates bill, Receipt, Year-end closing (number required, with the hint "Normally raised from Revenue & Billing / the Cash Office / Period Close").
- Save rules (client-side refusals, each naming the line): fewer than two lines; a line with `lineState` `both`, `unreadable` or `empty` with an account chosen; a line on an account whose `account_type` is `receivable` or `payable` without a party; no account. An out-of-balance draft **may** be saved (the server allows it and it cannot be posted); the page says so.
- After save: route replaces to `acc-voucher` for the saved id with the server's note; the server's `balance` is what the voucher page shows.
- Period line: `periodFor(posting_date)` → "Period 3 · Sep 2026 · open" / "closed: a draft may be saved but cannot be posted until it is reopened" / "No period covers this date".
- Keyboard: Enter in the last line's narration adds a line; "Balance on this line" (button beside an empty amount, and `Alt+B`) applies `balancingAmount`.

- [ ] **Step 1: Failing tests**

```ts
it('shows the guide in exact cents and marks it a guide', …)                 // 0.10 + 0.20 Dr, 0.30 Cr → "In balance"
it('refuses a line with both sides, naming it (Review Focus 3)', …)           // "Line 2 has both a debit and a credit."
it('refuses an unreadable amount and leaves it out of the guide (Review Focus 3)', …)   // '1,250.50' → "Line 1: write the amount as 1250.50"
it('asks for the party on a control account', …)                             // receivable account, no party → "Line 1 is on a control account and needs its party."
it('sends no number when none is typed', …)                                  // createVoucher payload has no voucher_no
it('requires a number for a receipt', …)
it('saves an out-of-balance draft and says it cannot be posted', …)
it('balances on the focused line', …)                                        // 100 Dr, 40 Cr, empty → click → credit '60.00'
it('copies the lines of an existing voucher', …)                             // ?from=v1 → lines prefilled, number blank, date today
it('disables Save while saving', …)                                          // double click → one call
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** spec + `vue-tsc` — PASS.
- [ ] **Step 5: Walk it**: a three-line journal as the accountant, saved, posted by the Director; a copy; an unbalanced draft; keyboard only once. Both widths.
- [ ] **Step 6: Commit** `feat(accounting): the journal editor`

### Task 7: General Ledger and the account page

**Files:**
- Create: `pages/GeneralLedgerPage.vue`, `pages/AccountLedgerPage.vue`
- Modify: `routes.ts` (`acc-ledger` → `GeneralLedgerPage`; `acc-account` at `ledger/:id`, `cwNav: 'acc-ledger'`)
- Test: `__tests__/accountingLedger.spec.ts`

**Interfaces:**
- Consumes: `ledgerApi.chartBalances`, `.accountLedger`, `.accountBalance`, `.createAccount`, `.updateAccount`, `.withdrawAccount`; kit.
- Produces: the tree is built from `parent_id` in the browser (structure only; figures are the server's). Columns: Code and name · Type · one column per currency in `currencies` (amount + `Dr`/`Cr`; a balance against the account's natural side gets `class="is-contra"` and a `title` saying so). Filters: search, root type, "With a balance only". Collapsed state per session.
- Produces: account maintenance dialog for `can('finance.ledger.account.manage')`: New (code, name, root type, behaviour, parent, heading?), Edit (name, behaviour, parent, notes, status), Withdraw (confirm; the server's refusal — "N entries posted" — is shown as sent). Without the permission: no controls and one sentence, "The chart is maintained by the accountant and the Director of Finance."
- Produces: `AccountLedgerPage` route query `book`, `from`, `to`, `offset`; header shows the lifetime balance per book from `accountBalance`; Export CSV (`accountLedgerCsvUrl`), Print. Reused by Task 9 through a `mode?: 'cashbook'` prop (adds the Reconciled column and a slot for actions).

- [ ] **Step 1: Failing tests**

```ts
it('shows each book\'s balance beside the account and the heading\'s sum', …)
it('marks a balance against the account\'s nature (Review Focus 2)', …)       // asset with side 'Cr' → .is-contra, text "450.00 Cr"
it('opens the account on a row click', …)                                    // router push acc-account
it('offers account maintenance only with the permission, and says who maintains the chart otherwise', …)
it('shows the server\'s refusal when an account with postings is withdrawn', …)
it('renders brought forward, the running balance and carried forward as sent', …)
it('asks the server for the next page and keeps the range in the address', …)
it('says the chart is empty and where it comes from (Review Focus 4)', …)     // accounts: [] → link to acc-migration
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** spec + `vue-tsc` — PASS.
- [ ] **Step 5: Walk it**: chart → bank account → a voucher → back; add, edit and deactivate an account as the accountant; both widths (the account table scrolls inside its card at 390 px).
- [ ] **Step 6: Commit** `feat(accounting): general ledger with balances and the account page`

### Task 8: Trial Balance

**Files:**
- Create: `pages/TrialBalancePage.vue`; Modify: `routes.ts` (`acc-trial`); Test: `__tests__/accountingTrialBalance.spec.ts`

**Interfaces:**
- Consumes: `ledgerApi.trialBalance({ financial_year_id, as_at, closing, include_nil })`.
- Produces: query `as_at`, `closing`, `nil`. Default `as_at` = the earlier of today and the year end. The Before/After control appears only when `closed` has a true entry. Each account row links to `acc-account` with `book` and `to=as_at`. The unclosed-surplus row (`ledger_account_id === null`) is not a link and carries the sentence "Revenue and expenditure of an earlier year that has not been closed. Close that year in Period Close." Per book: "In balance" or "Out of balance by <difference>" from `books[].balances`/`difference`. Export CSV (`/finance/ledger/trial-balance?format=csv` — add `format` to the route here, using `toCsv`), Print.

- [ ] **Step 1: Failing tests**: two books render as two tables with no combined figure; the closing control is absent for an open year and present for a closed one; the unclosed row is text, not a link; "Out of balance by 0.01" renders with `role="alert"`; no year → the empty state (Review Focus 4); changing the date calls the API with `as_at`.
- [ ] **Step 2–4:** FAIL → implement (incl. the `format=csv` branch and an integration test asserting the CSV's totals line) → PASS.
- [ ] **Step 5: Walk it** and **Step 6: Commit** `feat(accounting): trial balance at a date, before or after closing`

---

## Step 3 — Cash and bank

### Task 9: Cashbook and its three documents

**Files:**
- Create: `pages/CashbookPage.vue`, `kit/GuidedJournalDialog.vue`
- Modify: `backend/src/routes/finance-ledger-reads.js` (cash accounts read), `api/ledgerApi.ts`, `routes.ts` (`acc-cashbook` at `cashbook`)
- Test: `finance.accounting.test.js`, `__tests__/accountingCashbook.spec.ts`

**Interfaces:**
- Produces `GET /finance/ledger/cash-accounts?financial_year_id` → `{ accounts: { id, code, name, account_type: 'bank'|'cash', currency, balance: Bal, last_entry, reconciled_to: string | null, reconciled_balance: string | null, unreconciled: { entries: number, debit: string, credit: string } }[] }` — one row per account and currency with entries; `reconciled_to` = latest `to_date` of a `reconciled` statement; `unreconciled` = entries not in a match under a reconciled statement (bank accounts only; null for cash).
- Produces `GuidedJournalDialog` props `{ title, lead, currency, fixed: { ledger_account_id, side: 'debit'|'credit', label }, counter: { label, filter: (a: LedgerAccount) => boolean, partyTypes?: PartyType[] }, voucherType?: CreatableVoucherType, against?: { voucher_id, voucher_no, max?: string } }`, fields: date, amount, counter account, party (when the counter account is a control account or `against` is set), reference, narration; emits `saved(voucher: { id, voucher_no })`. It calls `ledgerApi.createVoucher` with two lines and no number; shows the server's refusal as sent; on success says "<no> saved as a draft. Somebody other than you posts it." with a link to `acc-voucher`.
- Cashbook documents: Payment (`fixed.side: 'credit'`, counter filter: not bank/cash, not `payable` — the lead says supplier invoices are paid in Accounts Payable, with a link); Receipt (`fixed.side: 'debit'`, counter filter: not bank/cash — the lead says counter takings come through the Cash Office); Transfer (`fixed.side: 'credit'`, counter filter: `account_type` bank or cash and not this account). All need `can('finance.ledger.voucher.prepare')` and an open period for the date; otherwise the buttons are absent and a sentence says why.
- Page: account/book chooser from `cash-accounts`; head figures (ledger balance, "Reconciled to 30 Sep 2026 at 14,695.00" or "Never reconciled", unreconciled count with a link to `acc-bank`); body = `AccountLedgerPage` in `mode="cashbook"`.

- [ ] **Step 1: Failing tests.** Integration: after the bank fixture's entries with no statement, `cash-accounts` returns the bank with `reconciled_to: null` and `unreconciled.entries` = its entry count; `accounts/:id/ledger` entries carry `reconciled: false`. Frontend: Payment builds `[{counter, debit}, {bank, credit}]` with no `voucher_no`; Transfer's counter list excludes the account itself and non-cash accounts; without `voucher.prepare` no document button renders and the reason is shown; "Never reconciled" renders when `reconciled_to` is null.
- [ ] **Step 2–4:** FAIL → implement → PASS (integration, spec, `vue-tsc`).
- [ ] **Step 5: Walk it**: a payment and a transfer raised by the accountant, posted by the Director, visible in the cashbook with the balance moved; both widths.
- [ ] **Step 6: Commit** `feat(accounting): cashbook with payment, receipt and transfer`

---

## Step 4 — Debtors and creditors

### Task 10: Debtors, the statement, credit note and write-off; Parties

**Files:**
- Create: `pages/DebtorsPage.vue`, `pages/DebtorStatementPage.vue`, `pages/PartiesPage.vue` (moved from `SupplierManagement.vue`, which is deleted)
- Modify: `backend/src/routes/finance-accounting.js`, `api/accountingApi.ts`, `routes.ts` (`acc-receivable` → `DebtorsPage`; `acc-debtor` at `receivable/:partyId`; `acc-parties` at `parties`; `acc-suppliers` redirects to `acc-parties?type=supplier`)
- Test: `finance.accounting.test.js`, `__tests__/accountingDebtors.spec.ts`

**Interfaces:**
- Produces `GET /finance/accounting/party-statement/:partyId?currency(required)&from&to&kind=receivable|payable(default receivable)` → `{ party, currency, kind, brought_forward: Bal, entries: (LedgerLine & { account_code })[], carried_forward: Bal, open_items: { voucher_id, voucher_no, voucher_type, posting_date, billed_amount, settled_amount, outstanding_amount, days_outstanding, ageing_bucket }[], as_at }` — entries on control accounts of that kind for that party, running balance as in Task 3; `open_items` from `finance.v_debtor_ageing` (receivable) or `finance.v_creditor_open` (payable).
- `DebtorsPage`: `ledgerApi.debtorAgeing({ outstanding_only: true, limit: 500 })`; `BookSwitch`; per book the six age columns by party (figures from `by_party` and a per-party bucket breakdown — add `by_party_bucket: { currency, party_id, ageing_bucket, outstanding_amount }[]` to the ageing route, summed in SQL), the reconciliation sentence from `reconciliation` ("Agrees with the control account 1200" / "Differs from the control account by <difference>", `role="alert"` when it differs), unallocated receipts in their own column.
- `DebtorStatementPage`: open items table with **Credit note** and **Write-off** per bill (both `GuidedJournalDialog` with `voucherType: 'credit_note' | 'write_off'`, `fixed: { receivable account of the bill, side: 'credit' }`, `against: { voucher_id, max: outstanding_amount }`, party preset; counter filter: revenue accounts for a credit note, expense accounts for a write-off). The dialog sends `party_id` and `against_voucher_id` on the receivable line. An amount above `max` is refused in the dialog ("More than the 120.00 still open on RB-0000012."), compared in cents. Statement prints as a statement of account (council name, party, address, as-at date, open items, entries).
- `PartiesPage`: today's supplier screen with a type filter (Suppliers default, Debtors, Ratepayers, Employees, Other) and the type chosen on create; each debtor/ratepayer row links to `acc-debtor`.

- [ ] **Step 1: Failing tests.** Integration: a bill (Dr debtors 300.00 party P / Cr income) then a credit note of 100.00 against it posted → `party-statement` open item outstanding `200.00`, carried forward `200.00 Dr`, and `debtor-ageing` reconciliation `agrees: true`; `by_party_bucket` sums to `by_party`. Frontend: ageing shows one book at a time; a difference renders as an alert; Credit note payload is `voucher_type 'credit_note'`, lines `[{counter, debit}, {receivable, credit, party_id, against_voucher_id}]`; an amount over the open figure is refused with the sentence above; Parties creates with the chosen type.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Walk it** (seeded rates bill): statement, a credit note raised and posted by two people, the ageing still reconciling. Both widths.
- [ ] **Step 6: Commit** `feat(accounting): debtors, statements of account, credit notes and write-offs`

---

## Step 5 — Period end

### Task 11: Period Close and the year end

**Files:**
- Create: `pages/PeriodClosePage.vue`
- Modify: `backend/src/routes/finance-accounting.js`, `backend/src/routes/finance-ledger.js` (period PATCH records readiness in the audit details; close-year accepts an omitted number), migration 242 is **not** reopened: add kind `closing` (`YC`) to the sequence in 242 before it is committed in Task 2 — see note
- Modify: `api/accountingApi.ts`, `routes.ts` (`acc-close`)
- Test: `finance.accounting.test.js`, `__tests__/accountingPeriodClose.spec.ts`

Note: Task 2's migration therefore includes the `closing` → `YC` kind from the start; `POST /finance/ledger/close-year` makes `voucher_no` optional and issues `YC-…` when absent.

**Interfaces:**
- Produces `GET /finance/accounting/period-readiness?period_id` → `{ period: { id, period_no, label, from_date, to_date, status }, checks: { key, label, count: number, ok: boolean, detail: string | null, target: string | null }[], books: { currency, balances: boolean, difference }[], ready: boolean }` with keys, in order: `draft_vouchers`, `cashups_unverified`, `deposits_unposted`, `payables_awaiting`, `depreciation_not_run` (present only when an in-use depreciable asset exists), `bank_statements_open`, `bank_not_reconciled`. `target` is an accountant route name (`acc-journals`, `acc-cashups`, `acc-banking`, `acc-payable`, `acc-assets`, `acc-bank`). `books` from `ledger_balances(year, to_date, 'after')`. `ready` = every check ok and every book in balance.
- Produces `GET /finance/accounting/year-end?financial_year_id` → `{ year, periods_open: number, books: { currency, closed: boolean, revenue, expenditure, surplus, side: 'surplus'|'deficit', closing_voucher: { id, voucher_no } | null }[], surplus_account: { id, code, name } | null, posters: { id, name }[] }` — `posters` = active users whose role holds `finance.ledger.voucher.post`, excluding the caller (read through `systemOf`).
- `PATCH /finance/ledger/periods/:id`: when the new status is `closed` or `locked`, the audit details carry `{ readiness: checks.filter(!ok).map(({key,count}) => …) }`.
- Page: periods list (number, dates, status pill, entries); selecting one loads readiness; Close / Reopen / Lock per `finance.ledger.period.manage` (Lock behind a confirm that says it is final). Closing a not-ready period asks for confirmation listing what is outstanding. Year end card when `periods_open === 0`: per book the surplus or deficit, the poster select, "Close the USD book"; needs `finance.ledger.close_year`; `surplus_account === null` → "Mark the equity account that carries accumulated surplus" with a link to `acc-ledger`; an open period → "Close every period first".

- [ ] **Step 1: Failing tests.** Integration: a draft voucher dated in period 3 → `draft_vouchers` count 1, `ok: false`, `ready: false`; after posting → ok; closing the period writes an audit row whose details list nothing outstanding; `year-end` for year 2 shows `surplus: '50.00'`, `side: 'surplus'` before the 2,000 expense and a deficit after; the accountant may call `close-year` (201) and the cashier may not (403); `posters` excludes the caller. Frontend: checks render with counts and links; Close asks before closing a not-ready period and lists what is outstanding; Lock says it is final; the year-end card is absent while a period is open; without `close_year` the card explains who holds it; no periods → "Open the twelve monthly periods" for holders (Review Focus 4).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Walk it**: close a month with a draft outstanding, clear it, close again; raise a year-end close on a scratch year in the acceptance database only (the dev demo year is left open). Both widths.
- [ ] **Step 6: Commit** `feat(accounting): period close with readiness and the year-end close`

### Task 12: Financial Statements

**Files:**
- Create: `pages/StatementsPage.vue`
- Modify: `backend/src/routes/finance-ledger.js` (position, performance), `backend/src/routes/finance-ledger-reads.js` (cash statement), `api/ledgerApi.ts`, `routes.ts` (`acc-reports` → `StatementsPage`, tabs by `?statement=position|performance|cash`)
- Test: `finance.accounting.test.js`, `test/finance-ledger.test.js` (if a helper changes), `__tests__/accountingStatements.spec.ts`

**Interfaces:**
- Changes `GET /finance/ledger/statements/position`: adds `as_at`; reads `ledger_balances(year, as_at, 'after')`; response adds `surplus_to_date: { currency, amount, side: 'surplus'|'deficit' }[]` (net of that year's revenue and expense rows; absent for a closed book), `check: { currency, assets, liabilities, equity_and_surplus, balances }[]`, and `incomplete` computed: no `payable` account in the chart; each bank account with entries after its last reconciled statement ("<code> is reconciled to <date>; <n> later entries are not"), or never reconciled; no asset registered while a `fixed_asset` account carries a balance.
- Changes `GET /finance/ledger/statements/performance`: totals from `ledger_balances(year, as_at, 'before')`; period buckets exclude closing vouchers and their reversals; `incomplete` computed (depreciation: only when assets exist and a period of the range has no approved run); adds `compare=prior_year` → `prior: { currency, ledger_account_id, balance }[]` and `prior_year: { id, label } | null`.
- Produces `GET /finance/ledger/statements/cash?financial_year_id&from&to` → `{ from, to, accounts: { currency, id, code, name, opening, receipts, payments, closing }[], books: { currency, opening, receipts, payments, closing }[], by_counter: { currency, group: 'revenue'|'expense'|'receivable'|'payable'|'fixed_asset'|'tax'|'other_asset'|'liability'|'equity', label, inflow, outflow, net }[], reconciles: { currency, movement, analysed, agrees }[], note }`. `by_counter`: for every posted voucher with an entry on a bank or cash account in range, each **other** entry contributes `-(debit - credit)`; transfers between cash accounts net out. `note` states it is a statement of cash receipts and payments and not an IPSAS 2 cash flow statement.
- Page: three tabs; `BookSwitch`; As at / range controls; performance keeps periodicity and accumulated and gains "Compare with <prior year label>"; every statement has Export CSV (`format=csv` on each route) and Print; `incomplete` notes render above the figures in an alert region, and are absent when the list is empty.

- [ ] **Step 1: Failing tests.** Integration (two-year fixture): year 2 position — assets `1550.00` before the 2,000 expense test or the then-current figure, `check.balances: true`, `surplus_to_date` present for the open year 2 and absent for closed year 1; year 1 performance after closing — revenue `900.00`, expenditure `400.00` (not nil); `compare=prior_year` on year 2 returns year 1's `900.00` against income; cash statement year 1 — opening `0.00`, receipts `1900.00`, payments `400.00`, closing `1500.00`, `reconciles.agrees: true`, `by_counter` revenue inflow `900.00`, equity inflow `1000.00`, expense outflow `400.00`; a transfer between two cash accounts leaves `by_counter` unchanged. Frontend: `incomplete` renders as an alert when present and nothing when empty; the surplus line appears under equity; cash statement shows the "not an IPSAS 2 cash flow statement" sentence; one book at a time.
- [ ] **Step 2–4:** FAIL → implement → PASS, including `finance.rates`, `finance.acceptance` and `verify-ledger-invariants.js` (G10 still passes: `v_trial_balance` is untouched).
- [ ] **Step 5: Walk it**, print preview of each statement. **Step 6: Commit** `feat(accounting): statements carried across years, and the cash receipts and payments statement`

### Task 13: Ledger Reports

**Files:**
- Create: `pages/LedgerReportsPage.vue`; Modify: `finance-ledger-reads.js`, `api/ledgerApi.ts`, `routes.ts` (`acc-ledger-reports` at `ledger-reports`)
- Test: `finance.accounting.test.js`, `__tests__/accountingReports.spec.ts`

**Interfaces:**
- Produces `GET /finance/ledger/reports/general-ledger?financial_year_id&currency(required)&from&to&root_type&account_from&account_to&limit(accounts, ≤100, default 25)&offset&format` → `{ accounts: { account: {id, code, name, root_type}, brought_forward: Bal, entries: LedgerLine[], totals, carried_forward: Bal }[], total_accounts, limit, offset }` — accounts with a brought-forward balance or an entry in range; CSV is one flat file with the account code and name on every line.
- Produces `GET /finance/ledger/reports/journal-listing?financial_year_id&from&to&voucher_type&status&currency&limit(≤200)&offset&format` → `{ vouchers: { id, voucher_no, voucher_type, currency, posting_date, status, narration, reference, prepared_by_name, posted_by_name, lines: { line_no, account_code, account_name, party_name, debit, credit, narration }[], debit_total, credit_total }[], total, totals: { currency, debit_total, credit_total }[] }`.
- Page: two report cards with their filters, results below, `Pager`, Export CSV, Print; then "Budget and management reports" — a link resolved with `useFinanceNav().resolve('reports')`; when unresolved, the reason as text.

- [ ] **Step 1: Failing tests.** Integration: general ledger for year 2 USD lists the bank with brought-forward `1500.00 Dr` and omits an account with neither balance nor entries; journal listing totals per currency equal the sum of its vouchers; both CSVs parse and carry the same figures. Frontend: filters drive the query; the catalogue link is text with a reason when no workspace of the person serves `reports`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Walk it. Step 6: Commit** `feat(accounting): general ledger detail and journal listing reports`

### Task 14: Tax Control

**Files:**
- Create: `pages/TaxControlPage.vue`; Modify: `finance-accounting.js`, `api/accountingApi.ts`, `routes.ts` (`acc-tax`)
- Test: `finance.accounting.test.js`, `__tests__/accountingTax.spec.ts`

**Interfaces:**
- Produces `GET /finance/accounting/tax?financial_year_id` → `{ accounts: { id, code, name, root_type, balances: (Bal & { currency })[] }[], periods: { period_id, period_no, label, from_date, to_date }[], movements: { ledger_account_id, currency, period_id, debit, credit }[], bank_accounts: { id, code, name }[], note }`.
- Page: per tax account and book, a period table (debits, credits) with each figure linking to `acc-account` for that period's range; "Record a payment to the tax authority" → `GuidedJournalDialog` (`fixed`: the bank account chosen first, `side: 'credit'`; counter fixed to this tax account). Empty state: "No account in the chart is marked as tax" with how to mark one and a link to `acc-ledger`. The standing sentence: "This page reads the tax accounts as the ledger holds them. It produces no statutory return."

- [ ] **Step 1: Failing tests.** Integration: Dr expense 100.00, Dr VAT 15.00 / Cr bank 115.00 in 2042-05 → the VAT account's movement for period 5 is debit `15.00`, balance `15.00 Dr`. Frontend: empty state; figures link with the period's dates; the payment dialog builds Dr tax / Cr bank.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Walk it. Step 6: Commit** `feat(accounting): tax control`

---

## Step 6 — The desk

### Task 15: The dashboard

**Files:**
- Modify: `backend/src/routes/finance-accounting.js`, `api/accountingApi.ts`, `pages/AccountantDashboard.vue`, `pages/SectionPage.vue` (the bank table's "Reconcile" column shows the real state)
- Test: `finance.accounting.test.js`, `__tests__/accountingDashboard.spec.ts`

**Interfaces:**
- Changes `GET /finance/accounting/dashboard`: `tasks` gains keys `payables` (invoices and payments awaiting approval not prepared by the caller), `assets` (depreciation runs and disposals awaiting approval not raised by the caller), `bank` (open statements); `banks[]` gains `reconciled_to`, `unreconciled_entries`; adds `books: { currency, balances, difference }[]` (from `ledger_balances`) and `readiness: { ready: boolean, outstanding: number } | null` for `current_period`; `position` from `ledger_balances`; the "not built yet" alert is removed and replaced by one alert per bank account never reconciled or with unreconciled entries older than 31 days.
- Page order: work waiting (cash-ups table kept; tasks list with the new keys routed: `payables` → `acc-payable`, `assets` → `acc-assets`, `bank` → `acc-bank`); the books (per book "In balance" / "Out of balance by …", current period, days left, readiness with a link to `acc-close`); cash and bank (real reconciliation state, each linking to `acc-cashbook`); debtors, creditors; recent postings each linking to `acc-voucher`. Quick actions: New journal (`acc-journal-new`), Record payment (`acc-cashbook`), Bank reconciliation, Trial balance, Statements, Period close. The tiles stay.

- [ ] **Step 1: Failing tests.** Integration: a supplier invoice awaiting approval raised by the Director appears in the accountant's `payables` count and not in the Director's; `books` reports in balance; no alert text contains "not built". Frontend: no "not built" or hard-coded "Unreconciled" string; a bank with `reconciled_to` shows "Reconciled to <date>"; recent rows link to the voucher; an out-of-balance book renders as an alert.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Walk it. Step 6: Commit** `feat(accounting): the dashboard, around the accountant's day`

### Task 16: Documents and the whole-workspace verification

**Files:**
- Modify: `frontend/docs/finance/WORKSPACE-ACCESS.md` (Accounting's screens, the accountant's two new permissions, the catalogue change), `IMPLEMENTATION-TRACKER.md` (a section 0b for this work with its evidence), `frontend/docs/superpowers/specs/2026-11-12-finance-role-workspaces-design.md` (§14 as-built entry), `frontend/CLAUDE.md` (one line under the finance workspaces paragraph), `backend/src/routes/finance-accounting.js` header comment (the "WHAT IS NOT HERE" paragraph is no longer true)

- [ ] **Step 1: Run everything.**

```bash
cd backend && npx jest                                   # unit
cd backend && <integration command> for: finance.accounting finance.bank finance.payables finance.assets finance.rates finance.cash finance.cash.lifecycle finance.acceptance finance.access-control finance.security finance.workflow finance.migration
cd backend && DATABASE_URL=<acceptance> node scripts/verify-ledger-invariants.js
cd frontend && npx vitest run --root . --no-file-parallelism src/modules/finance
cd frontend && npx vue-tsc --noEmit && npx eslint src/modules/finance/workspaces/accountant src/modules/finance/workspaces/shared --ext .vue,.ts
```
Expected: all pass; record the counts.
- [ ] **Step 2: Walk the workspace** in the running app (dev database, seeded ledger), as `demo.accountant` then `demo.finance-admin`, at 1440 px and 390 px: every navigation entry opens; journal prepared → posted → drilled chart → account → voucher → reversed; cashbook payment and transfer; debtor statement and credit note; a period closed and reopened; the three statements and both reports exported; tax control; the dashboard's links. Check the browser console is clean and no page scrolls sideways. As `demo.cashier`, a direct URL to `/finance/accountant` is turned away, and `GET /api/finance/ledger/chart-balances` returns 403.
- [ ] **Step 3: Write the documents** with the counts and what was walked.
- [ ] **Step 4: Commit** `docs(finance): the Accounting workspace as built`

---

## Self-review notes

- Spec §6.1–§6.12 map to Tasks 1, 5–15; §7.1 to Task 2 (with the `closing` series noted in Task 11); §7.2 to Tasks 3, 8–15; §13 to Task 2; §9 to each task's tests and Task 16.
- Names used across tasks: `Bal`, `LedgerLine`, `ChartBalanceRow`, `AccountLedgerPage`, `GuidedJournalDialog`, `journalMath.{parseAmount,lineState,guide,balancingAmount}`, `useLedgerLists`, `financeCsv.toCsv`, `finance.ledger_balances`, `finance.year_closed`.
- Review Focus 1 → Task 2; 2 → Tasks 3, 7; 3 → Task 6; 4 → Tasks 5, 7, 8, 11; 5 → Task 3.
