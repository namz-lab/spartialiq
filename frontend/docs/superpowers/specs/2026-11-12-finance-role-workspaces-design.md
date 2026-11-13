# Finance role workspaces — twelve applications on one finance engine

Status: **approved by the client 2026-11-12, with the amendments in §13** · 2026-11-12
Supersedes: §8 "The interface" of `2026-11-11-finance-enterprise-reengineering-design.md`
(everything else in that spec — role model, modules, separation of duties, build order — stands).

## 1. Intent

Every finance user currently opens one console, `FinanceWorkspace.vue`: twenty sections behind
`/finance?section=…`, with a rail that a role preset (`stores/rolePreset.ts`) reorders into
"Your work" and "Also available to you". The client has rejected that architecture. A cashier, an
accountant and a finance manager do different jobs and should each enter an application built for
that job: its own dashboard, navigation, KPIs, queues, quick actions and screens.

The finance department is to operate as a set of interconnected workspaces inside one system:
one backend, one database, one finance store, one permissions engine.

## 2. Goals, non-goals, anti-goals

Goals
- Twelve workspaces at their own routes, each with its own layout, navigation and dashboard.
- A person lands on the workspace of their primary role.
- A person whose permissions fully cover another workspace (a revenue officer with a cashier
  override) reaches it through a workspace switcher, without losing their own.
- Which workspaces a person may open is decided by the server and checked on every entry.
- Every existing function, API, audit trail and financial control survives.

Non-goals
- No new financial capability. Payroll, creditors and procurement stay in their phases (spec §9).
- No change to the database, the permission catalogue or the grants.
- No change to the public portal (`/council/finances`) or the linked-finance panel in planning
  workspaces.

Anti-goals (failure even if it works)
- Twelve copies of the same shell with different headings, colours or rail labels.
- Business logic duplicated per workspace. One screen component per function; workspaces compose.
- A hidden button treated as security. The route guard is convenience; the API is the gate.
- A person with extra duties forced to choose one workspace and lose the other.
- A cashier dashboard that shows the session's receipt total. The count is blind (control C7).

## 3. Approaches considered

**A. One workspace per account, chosen by role name.** Simplest routing. Rejected by the client:
a relief cashier's till work would be stranded, and it contradicts the established rule that
permissions, not role names, decide what a person can do (overrides and departmental scope).

**B. Workspaces opened by permission, landing chosen by role, switcher between them.** *Chosen by
the client.* The role picks the home; the permission set decides every other workspace a person
may open. A finance administrator, who holds most permissions, can step into the Accounting or
Revenue desk; a cashier sees only the Cash Office.

**C. Keep FinanceWorkspace and deepen the role preset.** Rejected by the client: it remains a
shared dashboard with variations, which is exactly what is being replaced.

## 4. What exists today (audit)

`FinanceWorkspace.vue` (550 lines) is a shell: top bar, year picker, profile, boot/identity states,
setup-incomplete banner, work queue, a two-band rail and one `<component :is>` slot. All work lives
in twenty section components (≈15,900 lines) that read the shared Pinia store
(`stores/finance.ts`: identity, `can()`, years, departments, accounts, department scope).

| Section | Lines | Inside it | Primary users today |
|---|---|---|---|
| Overview | 872 | needs-attention list, position by currency, period charts | admin, committee, accounting officer |
| Finance map | 1475 | ward choropleths, unallocated money, links to budget/projects | most roles |
| Financial years | 353 | create/open/close year | admin |
| Departments & accounts | 939 | tabs: departments, programmes, activities, accounts | admin |
| Budget | 892 | lines, approval, performance vs actual | budget officer, dept head, committee |
| Revisions | 409 | supplementary/reductions, approval | budget officer, dept head, committee |
| Projects | 1081 | register, allocations, spend, progress, location | dept head, officer, committee |
| General ledger | 1431 | three cards: periods, GL chart, vouchers | accountant |
| Statements | 904 | tabs: trial balance, position, performance, ageing | accountant, auditor, accounting officer |
| Cash office | 224 | views: counter, sessions, banking, setup (already 4 components) | cashier, accountant |
| Rates | 1867 | readiness + tabs: billing, roll, accounts, tariffs, arrears… | revenue officer |
| Transactions | 717 | register of imported actuals | officer, accountant, auditor |
| Data imports | 1098 | upload, map, validate, exceptions, commit | officer, admin |
| Reports & exports | 613 | budget vs actual, variance, departmental, project | most roles |
| Documents | 543 | attachments, restricted documents | most roles |
| Publication | 501 | review, approve, publish, withdraw | publisher, committee |
| Audit history | 233 | trail incl. refusals, export | auditor, admin |
| Permissions | 231 | what your role may do | everyone |
| Finance access | 485 | roles, overrides, scopes | IT administrator |
| Settings | 269 | balance display, duty separation | admin |

Cross-links between sections are made by writing `?section=` into the URL: Overview's attention
list, Map → Budget/Projects (with `ward`), Budget's own filter writes, and every queue in
`composables/useFinanceQueues.ts` (≈20 queue definitions keyed by section). These are the only
places that know the old shell's addressing.

Server-side grants (live `finance.role_permission`, checked 2026-11-12) are the basis of §6.
Notable: `revenue_officer` does not hold `finance.cash.session.operate`, so a relief cashier is
always a personal override, which is the case the switcher exists for.

## 5. Route structure

```
/finance                         → redirect to the person's home workspace
/finance?section=<key>&…         → legacy link: redirect to the workspace screen that serves that
                                   section for this person (§9), keeping the other query params
/finance/<workspace>             → that workspace's dashboard
/finance/<workspace>/<screen>    → a screen in that workspace; filters stay in the query
/finance/no-workspace            → signed in, finance role, but no workspace openable (explains why)
```

| Workspace | Route | Application name |
|---|---|---|
| Finance Manager | `/finance/manager` | Finance Management |
| Finance Officer | `/finance/officer` | Finance Operations |
| Accountant | `/finance/accountant` | Accounting |
| Accounting Officer | `/finance/accounting` | Executive Finance |
| Budget Officer | `/finance/budget` | Budget Management |
| Departmental Head | `/finance/department` | Department Finance |
| Finance Committee | `/finance/committee` | Committee Decisions |
| Cashier | `/finance/cashier` | Cash Office |
| Revenue Officer | `/finance/revenue` | Revenue and Rates |
| Publisher | `/finance/publisher` | Publication |
| Auditor | `/finance/audit` | Internal Audit |
| IT Administrator | `/finance/administration` | Finance Access Administration |

Each workspace is one lazy-loaded route with child routes, so a cashier's bundle never contains
the ledger. `ROLE_HOME` in `src/router/index.ts` points each finance role at `/finance`, which
resolves to the home from the server (below).

## 6. Workspace access: decided by the server

The workspace catalogue lives in the backend, in `src/config/financeWorkspaces.js`: for each
workspace, its key, the primary role it is home for, and the predicate over the person's effective
permissions (role grants plus personal overrides) and departmental scope that admits them.

`GET /api/finance/me` gains two fields:
- `workspaces`: the keys this person may open, in catalogue order.
- `home_workspace`: the primary role's workspace if it is in `workspaces`; otherwise the first in
  `workspaces`; otherwise `null`.

The frontend never computes access. A navigation guard on `/finance/:workspace` loads the identity
(cached in the store) and admits only keys in `identity.workspaces`; anything else redirects home
with a one-line notice ("Cash Office is not one of your finance workspaces."). Every API call
inside every screen is still authorised by `financePermissions.js`, and refusals are still audited.
The guard is a courtesy, never the control.

Predicates (the permission that *defines the job*, not a view permission everyone holds; with
`budget.view` as the key, every role would see every workspace):

| Workspace | Admitted when the person holds | Roles admitted by default grants |
|---|---|---|
| manager | `finance.config.manage` | finance_admin |
| officer | `finance.import.upload` | finance_officer, finance_admin |
| accountant | `finance.ledger.voucher.post` | accountant, finance_admin |
| accounting | `finance.audit.view` + `finance.ledger.view` and nothing that writes, exports the audit trail or approves (the existing `oversees` rule) | accounting_officer |
| budget | `finance.budget.prepare` and no departmental scope | budget_officer, finance_officer, finance_admin |
| department | a departmental scope, or primary role `dept_head` | dept_head |
| committee | any of `budget.approve`, `revision.approve`, `project.approve`, `publication.approve`, `rates.tariff.approve`, `ledger.close_year` | finance_committee |
| cashier | `finance.cash.session.operate` | cashier |
| revenue | `finance.rates.bill.prepare` or `finance.rates.valuation.manage` | revenue_officer, finance_officer, finance_admin |
| publisher | `finance.publication.publish` | publisher |
| audit | `finance.audit.export` + `finance.report.export_restricted` | auditor |
| administration | `finance.users.manage_finance_roles` | admin |

Overrides apply naturally: a revenue officer granted `finance.cash.session.operate` gets
`workspaces: ['revenue', 'cashier']`, home `revenue`.

## 7. Shared infrastructure (built once)

```
src/modules/finance/
  shell/        WorkspaceFrame.vue      top bar: application name, year picker, notifications,
                                        workspace switcher, profile; skip link; boot, identity-error
                                        and setup-incomplete states; logout incl. store.reset()
                WorkspaceSwitcher.vue   lists identity.workspaces with application names; the
                                        current one marked; hidden when there is only one
                useFinanceNav.ts        go(target, query): resolves a target to a route (below)
                workspaceGuard.ts       the route guard of §6
  screens/      one component per function, decomposed from the sections (§8)
  workspaces/<key>/
                <Key>Workspace.vue      the layout: own navigation component and arrangement
                <Key>Dashboard.vue      own KPIs, queues and quick actions
                routes.ts               child routes, each mapping to a screen
```

The frame is chrome only. It does not own navigation: each workspace renders its own (the Cash
Office has a top tab bar and no sidebar; Accounting a grouped sidebar by ledger task; Committee an
agenda list). The store, `api/financeApi.ts`, composables, charts, dialogs, guards, pickers and the
cash components are shared unchanged.

**Targets instead of sections.** A cross-link names what it wants, not where it lives:
`go('budget.lines', { status: 'submitted' })`. Each workspace's `routes.ts` declares which targets
its screens serve. `go` resolves to the current workspace if it serves the target, else to the
person's home if it does, else to the first of their other workspaces that does. If none does,
the link is rendered as text with the reason (the existing `whyUnavailable` wording), not as a
button that 403s. This replaces every `?section=` write in Overview, Map, Budget and the queues.

**Queues.** `collectFinanceQueues` keeps its reads and rules; each queue's `section` becomes a
`target`. Each dashboard chooses which queues it shows and how (a list, a count on a nav item, a
KPI). Notifications in the frame are the person's queues across all their workspaces, each opening
in the workspace that serves it.

## 8. Component reuse: sections become screens

The sections are split along the seams they already have, into `screens/`:

- General ledger → `LedgerPeriods`, `GlChart`, `Vouchers` (with a `mode` prop: drafts mine,
  awaiting my posting, all).
- Statements → `TrialBalance`, `FinancialPosition`, `FinancialPerformance`, `DebtorAgeing`.
- Rates → `BillingReadiness`, `ValuationRoll`, `RatesAccounts`, `Tariffs`, `BillingRuns`,
  `Arrears`, `RatepayerStatement`, along its existing tabs.
- Departments & accounts → `Departments`, `Programmes`, `Activities`, `ChartOfAccounts`.
- Cash office → the four existing components become screens directly.
- Overview → `PositionByCurrency`, `PeriodTrend`, `NeedsAttention` (dashboards compose these).
- Budget, Revisions, Projects, Imports, Transactions, Reports, Documents, Publication, Audit,
  Access, Permissions, Settings, Years, Map → one screen each, taking props for the filter the
  workspace opens them with (e.g. `Budget` with a fixed status for the committee's agenda, or
  locked to the person's votes for a department head) instead of reading a role preset.

A split is mechanical: template, script and styles move; behaviour does not change. Shared state
that crossed the old tabs moves into a small composable beside the screens. Each split keeps the
section's existing tests passing before anything is redesigned around it.

At the end, `FinanceWorkspace.vue`, `pages/sections/`, `stores/rolePreset.ts` and
`components/FinanceWorkQueue.vue` are deleted. Their behaviour lives in the screens, the backend
catalogue and the dashboards.

## 9. The workspaces

Each line: dashboard → navigation → quick actions. Screens are from §8.

**Cash Office** (cashier). No dashboard of figures: the counter is the work. Three states (no
session / open / closed awaiting verification), keyboard first, works at 390 px, receipt prints.
Navigation: a top tab bar with Counter · Today's receipts · Cash-up · Banking · My sessions. KPIs
are states, not money: session open since, receipts issued (count only, C7), banking outstanding.
Quick actions: take a payment, cancel a receipt (with reason), cash up.

**Accounting** (accountant). Dashboard: vouchers awaiting my posting (prepared by others), cash-ups
awaiting verification with declared vs system totals, billing runs awaiting posting, period status,
trial balance in balance per currency. Navigation grouped by the book: Journals (draft, post,
reverse) · Posting queue · Cash-ups to verify · Rates runs to post · Periods · General ledger chart
· Parties · Statements (four) · Transaction register · Cash office setup · Reports and exports.
Quick actions: new journal, post next, verify next cash-up.

**Budget Management** (budget officer). Dashboard: preparation progress by vote (draft, submitted,
returned, approved), returned lines, revisions in flight, lines with variance needing explanation,
days left in the preparation calendar if the year carries one. Navigation: Budget lines by vote ·
Returned to me · Revisions · Variance · Allocation by ward (map) · Projects (read) · Reports ·
Documents. Quick actions: new line, submit vote, new revision.

**Finance Management** (finance administrator). Management, not processing. Dashboard: the council's
position per currency (USD and ZWG never summed), where each pipeline stands (budget with
committee, revisions, imports awaiting commit, cash unverified or unbanked, billing runs), period
and year status, setup completeness, recent refusals. Navigation: Position (overview, statements,
map) · Pipelines (budget, revisions, projects, imports to commit, publication requests) · Control
(financial years and close, departments and accounts, settings) · Oversight (audit, documents) ·
Desks: links into the Accounting, Budget, Revenue and Officer workspaces via the switcher, not
duplicated screens. Quick actions: commit an import, open or close a period, request publication.

**Finance Operations** (finance officer). Dashboard: import batches by stage, open exceptions,
registers awaiting update. Navigation: Imports · Exceptions · Transaction register · Valuation
roll and rates accounts · Parties · Projects register · Documents · Reports.

**Executive Finance** (accounting officer). Read-only board: position, statements, arrears, cash
office position, audit trail, reports. No control that writes is rendered.

**Department Finance** (departmental head). Locked to own votes, said once at the top. Dashboard:
my votes' budget vs actual, lines returned, variances to explain, my projects' progress.
Navigation: My budget · Revisions · Variance explanations · My projects · Documents · Reports.

**Committee Decisions** (finance committee). An agenda, not a console. Dashboard: decisions
awaiting, by kind (budget, revisions, projects, tariffs, publication), each with the figures to
decide on. Navigation: Awaiting decision · Decided · Year-end close · Position (for context).

**Revenue and Rates** (revenue officer). Dashboard: billing readiness, arrears by age reconciled to
the control account, runs in progress. Navigation: Readiness · Valuation roll · Accounts · Tariffs
(draft) · Billing runs · Arrears · Ratepayer statement.

**Publication** (publisher). Dashboard: approved and awaiting release, published, withdrawn.
Navigation: Release queue · Published · Withdrawn · Public view (link out).

**Internal Audit** (auditor). Dashboard: refusals and unusual actions in the review window,
corrected transactions. Navigation: Audit trail · Refusals · Ledger and statements (read) ·
Transactions · Restricted documents · Reports and exports.

**Finance Access Administration** (IT administrator). Dashboard: finance accounts by role, overrides
and scopes in force, recent role changes. Navigation: Finance access · Role catalogue (Permissions)
· Audit of access changes. States plainly that it holds no financial authority and no finance map.

Every workspace has designed loading, empty, error and "not set up yet" states, follows `DESIGN.md`
(product register, one accent under 10 %, WCAG 2.1 AA, reduced motion) and the `--ent-*` tokens.

## 10. Legacy links

`?section=` links are already in emails and notes. `/finance?section=X` redirects to the first
workspace in the person's list (home first) whose routes serve the targets section X used to show,
carrying `status`, `state`, `view` and `ward`. A section no workspace of theirs serves goes home
with the notice of §6.

## 11. Migration order

0. **Shared infrastructure.** Backend catalogue and `/finance/me` fields with unit tests per role
   and per override; frame, switcher, guard, `useFinanceNav`, legacy redirect. FinanceWorkspace
   stays reachable as the fallback for roles without a workspace yet.
1. **Cash Office.** Cash screens; counter-first layout.
2. **Accounting.** Ledger and Statements splits.
3. **Budget Management.** Budget, Revisions, Map, Projects screens.
4. **Finance Management.** Overview split; Years, Classifications, Settings, Imports-commit.
5. **The other eight**, in the order officer, revenue, department, committee, accounting officer,
   publisher, audit, administration.
6. **Removal.** FinanceWorkspace, sections, rolePreset, FinanceWorkQueue deleted; docs updated.

Each step ends with: the type check and finance specs passing; the backend `/finance/me` tests;
every demo finance login checked in the running app (landing, switcher contents, a direct URL to a
workspace not held redirects, and a direct API call outside the person's permissions returns 403
and is audited).

## 12. Calls made in this design, for the client to check

- The workspace predicates in §6, in particular that the finance administrator can enter
  Accounting, Budget, Revenue and Officer workspaces from the switcher, and that the accountant,
  who holds cash verification, does **not** get the Cash Office: verifying cash-ups is accounting
  work and lives in the Accounting workspace.
- A departmental head without a departmental scope still gets Department Finance, which then says
  no votes are assigned rather than showing the whole council.
- The Finance Manager reaches desk work through the switcher instead of having its own copies.
- Legacy `?section=` links keep working by redirect.
- Application names in §5.

## 13. Client amendments on approval (2026-11-12)

1. **Finance Management is the finance administrator's home.** The primary-role mapping is
   explicit in the catalogue (`home_for` per workspace), and `finance_admin` → `manager` even
   though the administrator is admitted to five workspaces.
2. **Independence is in the information architecture, not the sidebar.** A workspace that only
   re-files the old sections fails review. Each dashboard is designed from the role's daily work
   (§9), with its own KPIs, queues and quick actions.
3. **Professional interface.** Each workspace is a complete application for a local-authority
   finance professional, under `PRODUCT.md` / `DESIGN.md`.
4. **Functional completeness.** Every tab, workflow and operation in every section (§4) is reachable
   from at least one workspace of every role that could reach it before. A coverage table
   (`docs/finance/WORKSPACE-ACCESS.md`) lists each old section × tab → workspace screen, and a
   test asserts that every target used by a queue or link is served somewhere.
5. **Cross-workspace links** go only to workspaces the person may open, by `useFinanceNav` (§7); an
   unreachable target is rendered as an explanation, never a link.
6. **Security tests** cover direct URLs (guard) and direct API calls (403 + audit row) per role.
7. **Reversible migration.** Nothing is deleted until all twelve workspaces are built, tested and
   verified. Until then the existing console stays mounted at `/finance/console` (same component,
   same `?section=` behaviour), and one switch, `VITE_FINANCE_WORKSPACES=off`, routes every finance
   role back to it. Step 6 of §11 happens only after that verification, as a separate change.
8. **Documentation.** This spec, the superseding note in the November 11 spec, and
   `docs/finance/WORKSPACE-ACCESS.md` (workspace → primary role → admitting permissions → default
   roles admitted, plus the coverage table) are kept current with each step.
9. **Review gate.** After Cash Office, Accounting, Budget Management and Finance Management, the
   build stops for a review before the other eight.

## 14. As built

**Step 0, shared infrastructure — 2026-11-12.** Backend catalogue and `/finance/me` fields; frontend
`shell/` (registry, targets, `useFinanceNav`, guard, frame, switcher, notice, no-workspace page);
routes `/finance` (entry), `/finance/console`, `/finance/no-workspace`, built workspaces, and a
redirecting catch-all; queue targets; coverage test; `docs/finance/WORKSPACE-ACCESS.md` with the
live verification. No workspace is built yet, so every finance role still works in the console.
One catalogue call refined from §6: an unscoped departmental head is departmental and is NOT
admitted to council-wide Budget Management. Plan:
`docs/superpowers/plans/2026-11-12-finance-workspaces-shared-infrastructure.md`.
