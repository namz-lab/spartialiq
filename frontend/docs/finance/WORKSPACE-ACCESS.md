# Finance workspaces: who opens what

The finance department works in twelve role workspaces, one application per office, on one
backend, database, finance store and permissions engine. This page is the authoritative map of
workspace to role to permission, and of where every function of the previous console now lives.

- Design: `docs/superpowers/specs/2026-11-12-finance-role-workspaces-design.md`
- Server catalogue (the source of truth for access): backend `src/config/financeWorkspaces.js`,
  tested by `src/config/__tests__/financeWorkspaces.test.js` against the live grants
- Frontend: `src/modules/finance/shell/` (frame, switcher, guard, cross-link resolver),
  `src/modules/finance/workspaces/<key>/` (one directory per workspace)

## How access is decided

1. `GET /api/finance/me` returns `workspaces` (the keys this person may open, in catalogue order)
   and `home_workspace`, computed on the server from the person's **effective** permissions (role
   grants with personal overrides applied) and their departmental scope.
2. The home is the workspace whose primary role is the person's role, if they hold it; otherwise
   the first workspace they hold; otherwise none (`/finance/no-workspace`).
3. The route guard admits `/finance/<workspace>` only when the server listed it. A direct address
   to any other workspace redirects home with "That workspace is not one of yours."
4. **None of this is the control.** Every API endpoint re-checks its own permission in
   `src/middleware/financePermissions.js` and writes refusals to the audit trail. Departmental
   scope, separation of duties, approval chains and financial-year locks are enforced in the
   database and the routes, unchanged by the workspaces.

## Workspace → role → permission

| Workspace | Route | Application | Primary role (lands here) | Admitted when the person holds | Roles admitted by default grants |
|---|---|---|---|---|---|
| manager | `/finance/manager` | Finance Management | finance_admin | `finance.config.manage` | finance_admin |
| officer | `/finance/officer` | Finance Operations | finance_officer | `finance.import.upload` | finance_officer, finance_admin |
| accountant | `/finance/accountant` | Accounting | accountant | `finance.ledger.voucher.post` | accountant, finance_admin |
| accounting | `/finance/accounting` | Executive Finance | accounting_officer | `finance.audit.view` + `finance.ledger.view`, no `finance.audit.export`, and no permission that writes | accounting_officer |
| budget | `/finance/budget` | Budget Management | budget_officer | `finance.budget.prepare`, not departmental | budget_officer, finance_officer, finance_admin |
| department | `/finance/department` | Department Finance | dept_head | a departmental scope, or role dept_head | dept_head |
| committee | `/finance/committee` | Committee Decisions | finance_committee | any of `finance.budget.approve`, `finance.revision.approve`, `finance.project.approve`, `finance.publication.approve`, `finance.rates.tariff.approve`, `finance.ledger.close_year` | finance_committee |
| cashier | `/finance/cashier` | Cash Office | cashier, cash_supervisor (208) | `finance.cash.session.operate` **or** `finance.cash.session.supervise` (208) | cashier, cash_supervisor, finance_admin (208: the Director holds supervision as a stand-in) |
| revenue | `/finance/revenue` | Revenue and Rates | revenue_officer | `finance.rates.bill.prepare` or `finance.rates.valuation.manage` | revenue_officer, finance_officer, finance_admin |
| publisher | `/finance/publisher` | Publication | publisher | `finance.publication.publish` | publisher |
| audit | `/finance/audit` | Internal Audit | auditor | `finance.audit.export` + `finance.report.export_restricted` | auditor |
| administration | `/finance/administration` | Finance Access Administration | admin | `finance.users.manage_finance_roles` | admin |

"Departmental" means a departmental scope is recorded for the person, or their role is
`dept_head`. An unscoped departmental head is not widened to the council-wide budget.

Admission is by the permission that defines the job, never by a view permission:
`finance.budget.view` is held by nearly every role, and admitting by it would put every workspace
in every switcher.

**Overrides.** A revenue officer granted `finance.cash.session.operate` as relief cashier gets
`workspaces: ['cashier', 'revenue']` and still lands in Revenue and Rates; the Cash Office is in
their switcher. The database still refuses them verifying their own cash-up.

**Finance administrator.** Lands in Finance Management; reaches Finance Operations, Accounting,
Budget Management and Revenue and Rates through the switcher.

## Where each function of the previous console lives

Updated by each workspace phase. "Console" means the previous console at `/finance/console`, which
stays until every workspace is built and verified.

| Previous section | Tab or part | Workspace screen(s) | Phase |
|---|---|---|---|
| Overview | needs attention, position, charts | console | 4 |
| Finance map | | console | 3 |
| Financial years | | console | 4 |
| Departments & accounts | departments, programmes, activities, accounts | console | 4 |
| Budget | | console | 3 |
| Revisions | | console | 3 |
| Projects | | console | 3 |
| General ledger | periods, chart, vouchers | console | 2 |
| Statements | trial balance, position, performance, ageing | console | 2 |
| Cash office | counter, sessions, banking | console | 1 |
| Cash office | setup | console | 2 |
| Rates | all tabs | console | 5 |
| Transactions | | console | 2 |
| Data imports | | console | 4 |
| Reports & exports | | console | 3 |
| Documents | | console | 3 |
| Publication | | console | 4 |
| Audit history | | console | 4 |
| Permissions | | console | 5 |
| Finance access | | console | 5 |
| Settings | | console | 4 |

`src/modules/finance/__tests__/workspaceCoverage.spec.ts` fails if any of these is neither served
by a built workspace nor listed as pending.

## Switching back

Set `VITE_FINANCE_WORKSPACES=off` and restart or rebuild the frontend. Every `/finance` address
then opens the previous console, with `?section=` links behaving as they did before. No backend
change is needed: the extra `/finance/me` fields are ignored by the console.

## Verification

See the dated entries below, one per phase.

### 2026-11-12 — shared infrastructure (no workspace built yet)

Running app (`:5174` → backend `:3000`, `vungu_dev`), every demo finance login:

| Login | `/finance/me` workspaces | home | After sign-in | `/finance/cashier` typed directly |
|---|---|---|---|---|
| demo.finance-admin | manager, officer, accountant, budget, revenue | manager | console, Overview | console + "not one of yours" |
| demo.finance-officer | officer, budget, revenue | officer | console, Data imports | console + "not one of yours" |
| demo.accountant | accountant | accountant | console, General ledger | console + "not one of yours" |
| demo.ceo | accounting | accounting | console, Overview | console + "not one of yours" |
| demo.budget-officer | budget | budget | console, Budget | console + "not one of yours" |
| demo.dept-head | department | department | console, Budget | console + "not one of yours" |
| demo.treasurer | committee | committee | console, Overview | console + "not one of yours" |
| demo.cashier | cashier | cashier | console, Cash office | console + "not available yet" |
| demo.revenue | revenue | revenue | console, Rates | console + "not one of yours" |
| demo.publisher | publisher | publisher | console, Publication | console + "not one of yours" |
| demo.auditor | audit | audit | console, Audit history | console + "not one of yours" |
| demo.admin | administration | administration | IT admin console (`/admin`, its role home) | console + "not one of yours" |

`/finance?section=rates&state=draft` kept today's behaviour for every login (the console opens
the section if the person may, or corrects it to their landing). No page errors.

API, outside each person's permissions (refused by the server regardless of the screens):
- cashier `GET /api/finance/ledger/vouchers` → 403 `finance.ledger.view`
- accountant `POST /api/finance/financial-years` → 403 `finance.config.manage`, audit row written
- publisher `POST /api/finance/budget-lines` (well-formed) → 403 `finance.budget.prepare`, audit
  row written, no line created
- budget officer `GET /api/finance/audit` → 403 `finance.audit.view`

Observed, not changed: a **malformed** POST from someone without the permission gets 400 (body
validation) before the 403, because Fastify validates the schema before the permission
pre-handler. Nothing is written either way, but the refusal is a 400 and is reported as a
validation error rather than a permission refusal.

`VITE_FINANCE_WORKSPACES=off` (a second dev server on :5175): `/finance/cashier`
and `/finance?section=…` both open the console exactly as before, no notice.
