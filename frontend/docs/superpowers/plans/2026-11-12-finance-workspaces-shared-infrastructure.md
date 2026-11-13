# Finance Workspaces — Shared Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server decides which finance workspaces a person may open and which is home; the
frontend routes `/finance/<workspace>` through a guard, a shared frame, a switcher and a
target-based cross-link resolver, with the existing console kept at `/finance/console`.

**Architecture:** A workspace catalogue in the backend (`src/config/financeWorkspaces.js`) adds
`workspaces` and `home_workspace` to `GET /api/finance/me`. The frontend reads them; a route guard
admits only listed workspaces that are built; `useFinanceNav` resolves named targets to routes in
workspaces the person holds. Workspaces are registered by a `routes.ts` each; none is built in
this plan, so every role still reaches the console, now through the new entry route.

**Tech Stack:** Fastify + jest (backend `../Manicipal-drums-backend-3`); Vue 3, vue-router 4,
Pinia, Vitest + @vue/test-utils + happy-dom (frontend).

**Spec:** `docs/superpowers/specs/2026-11-12-finance-role-workspaces-design.md` (§5–§7, §10, §13)

## Global Constraints

- Server authorisation is unchanged: `financePermissions.js` re-checks every API call. The guard is advisory.
- No migration, grant or permission code changes.
- Workspace keys, routes and names exactly as spec §5: `manager officer accountant accounting budget department committee cashier revenue publisher audit administration`.
- Predicates exactly as spec §6. `finance_admin` home is `manager` (§13.1).
- Nothing in `pages/FinanceWorkspace.vue`, `pages/sections/`, `stores/rolePreset.ts`, `components/FinanceWorkQueue.vue` is deleted (§13.7).
- `VITE_FINANCE_WORKSPACES=off` sends every finance URL to `/finance/console`.
- Frontend tests: `// @vitest-environment happy-dom` directive; run with `npm run test:unit -- <path>`.
- Copy: calm, no exclamation marks; unavailable targets explained in a sentence.

## Review Focus

1. A person whose home workspace is not built yet (all of them, until Phase 1) → lands on `/finance/console`, not a blank page or a loop.
2. Identity request fails (network/500) while opening `/finance/cashier` → the frame's identity-error state with Retry, not a redirect loop to `/finance`.
3. A legacy link `/finance?section=budget&status=submitted` for a person whose only workspace is the cashier's → home with the notice, `status` dropped.
4. Sign out in one workspace and sign in as another person on the same tab → the new person's workspaces, not the cached identity (store.reset clears it; guard reloads).
5. A finance role with zero workspaces (e.g. a role whose grants were withdrawn) → `/finance/no-workspace` explaining, not the console with nothing in it.

Each has a test in the task that owns it (Tasks 3 and 4).

---

### Task 1: Backend workspace catalogue and `/finance/me` fields

**Files:**
- Create: `../Manicipal-drums-backend-3/src/config/financeWorkspaces.js`
- Create: `../Manicipal-drums-backend-3/src/config/__tests__/financeWorkspaces.test.js`
- Modify: `../Manicipal-drums-backend-3/src/routes/finance-config.js` (the `/finance/me` handler)

**Interfaces:**
- Produces: `WORKSPACES: ReadonlyArray<{ key: string, label: string, homeFor: string[], admits(held: Set<string>, ctx: { role: string, scoped: boolean }): boolean }>`; `workspacesFor({ role, permissions, scoped }) -> { workspaces: string[], home: string | null }`. `/finance/me` response gains `workspaces: string[]` and `home_workspace: string | null`.

- [ ] **Step 1: Write the failing tests** — one `it` per role using the live default grants (copy the permission lists from `finance.role_permission` into a fixture object in the test), asserting exact `workspaces` and `home`:
  - `finance_admin` → `['manager','officer','accountant','budget','revenue']`, home `manager`
  - `finance_officer` → `['officer','budget','revenue']`, home `officer`
  - `accountant` → `['accountant']`; `accounting_officer` → `['accounting']`
  - `budget_officer` → `['budget']`; `dept_head` scoped → `['department']`, and unscoped dept_head → `['department']`
  - `finance_committee` → `['committee']`; `cashier` → `['cashier']`; `revenue_officer` → `['revenue']`
  - `publisher` → `['publisher']`; `auditor` → `['audit']`; `admin` → `['administration']`
  - override: `revenue_officer` + `finance.cash.session.operate` → `['cashier','revenue']` order per catalogue, home `revenue`
  - home fallback: role `budget_officer` with only cashier permissions → home `cashier`; no permissions → `{ workspaces: [], home: null }`
  - scope excludes budget: `budget_officer` grants + `scoped: true` → `['department']`
- [ ] **Step 2:** Run `npx jest src/config/__tests__/financeWorkspaces.test.js` — FAIL (module not found).
- [ ] **Step 3:** Implement the catalogue in spec §6 order (manager, officer, accountant, accounting, budget, department, committee, cashier, revenue, publisher, audit, administration). `accounting` uses the existing "oversees" rule: holds `audit.view` and `ledger.view`, not `audit.export`, and no code that fails `/\.(view|export|view_counterparty|view_restricted|export_restricted)$/`. `department` admits `ctx.scoped || ctx.role === 'dept_head'`. Home: first workspace whose `homeFor` contains the role and is admitted, else first admitted, else null.
- [ ] **Step 4:** In `/finance/me`, call `workspacesFor({ role: request.user.role, permissions, scoped: scope && scope.length > 0 })` and add both fields. Comment that this is a convenience, not the control.
- [ ] **Step 5:** Run the test — PASS. Run `npx jest src/config` — all pass.
- [ ] **Step 6:** Restart the dev backend (check `readlink /proc/<pid>/cwd` first); `curl` `/api/finance/me` with a demo cashier session cookie and confirm `"workspaces":["cashier"]`.
- [ ] **Step 7: Commit** (backend repo) `feat(finance): server-side workspace catalogue on /finance/me`.

### Task 2: Frontend workspace registry, targets and resolver

**Files:**
- Modify: `src/modules/finance/models/types.ts` (`FinanceIdentity` gains `workspaces: WorkspaceKey[]`, `home_workspace: WorkspaceKey | null`)
- Create: `src/modules/finance/shell/workspaces.ts`
- Create: `src/modules/finance/shell/targets.ts`
- Create: `src/modules/finance/shell/useFinanceNav.ts`
- Test: `src/modules/finance/__tests__/financeNav.spec.ts`

**Interfaces:**
- Produces:
  - `type WorkspaceKey` (the twelve keys); `WORKSPACE_META: Record<WorkspaceKey, { name: string; path: string }>` with spec §5 names and paths.
  - `type FinanceTarget` — string union: every section key from `FinanceSectionKey`, plus tab-level targets `'cash.counter' | 'cash.sessions' | 'cash.banking' | 'cash.setup' | 'ledger.periods' | 'ledger.chart' | 'ledger.vouchers' | 'statements.trial-balance' | 'statements.position' | 'statements.performance' | 'statements.ageing' | 'classifications.departments' | 'classifications.programmes' | 'classifications.activities' | 'classifications.accounts'`.
  - `SECTION_TARGETS: Record<FinanceSectionKey, FinanceTarget>` (section → its target; identity for untabbed sections).
  - `interface WorkspaceRegistration { key: WorkspaceKey; routes: RouteRecordRaw[]; serves: Partial<Record<FinanceTarget, string /* child route name */>> }`
  - `registerWorkspace(reg)`, `builtWorkspaces(): WorkspaceKey[]`, `registrationOf(key)`.
  - `resolveTarget(target, ctx: { current: WorkspaceKey | null; home: WorkspaceKey | null; open: WorkspaceKey[] }): { kind: 'route'; workspace: WorkspaceKey; name: string } | { kind: 'unavailable'; reason: string }` — order: current, home, then `open` in catalogue order; only built workspaces count.
  - `useFinanceNav(): { go(target, query?): void; resolve(target): ReturnType<typeof resolveTarget>; current: ComputedRef<WorkspaceKey | null> }` — `current` from `route.meta.financeWorkspace`.

- [ ] **Step 1: Write failing tests** with two fake registrations (`accountant` serves `'ledger.vouchers'` → `'fin-accountant-journals'`; `manager` serves `'overview'`): resolves in current; falls to home; falls to another open workspace; unavailable when held nowhere, `reason` = `'None of your finance workspaces includes this. Ask the finance administrator if your duties have changed.'`; a registered workspace not in `open` is never chosen; an unbuilt key in `open` is skipped.
- [ ] **Step 2:** Run `npm run test:unit -- src/modules/finance/__tests__/financeNav.spec.ts` — FAIL.
- [ ] **Step 3:** Implement the four files. The registry is a module-level `Map`; export `__resetRegistry()` for tests only.
- [ ] **Step 4:** Run — PASS. Run `npx vue-tsc --noEmit -p tsconfig.app.json` — no new errors.
- [ ] **Step 5: Commit** `feat(finance): workspace registry and target resolver`.

### Task 3: Entry routing, guard, legacy redirect and the reversible switch

**Files:**
- Create: `src/modules/finance/shell/workspaceGuard.ts`
- Create: `src/modules/finance/shell/NoWorkspaceView.vue`
- Create: `src/modules/finance/workspaces/index.ts` (imports each workspace's `routes.ts`; empty list in this plan)
- Modify: `src/router/index.ts` (the `/finance` record at ~line 806; `ROLE_HOME` unchanged at `/finance`)
- Test: `src/modules/finance/__tests__/workspaceGuard.spec.ts`

**Interfaces:**
- Consumes: Task 2 registry and `resolveTarget`; `useFinanceStore().loadIdentity()`.
- Produces:
  - `financeEntry(to): Promise<RouteLocationRaw>` for `/finance`: flag off → `/finance/console` with the same query; identity null → `/finance/console` (the console renders its own identity error and Retry, Review Focus 2); `to.query.section` set → `legacyTarget`; else home if built, else `/finance/console` if the person has any workspace, else `/finance/no-workspace`.
  - `legacyTarget(section, query, identity)`: `SECTION_TARGETS[section]` resolved with `current: null`; route keeps `status`, `state`, `view`, `ward`; unavailable → home (or console) with `query.notice = 'unavailable'`.
  - `guardWorkspace(to): Promise<true | RouteLocationRaw>` for `/finance/:workspace/*`: flag off → console; identity null → `true` (the frame shows the error state, no loop); key not in `identity.workspaces` or not built → `financeEntry` result with `notice = 'not-yours'`.
  - Routes: `/finance` (beforeEnter `financeEntry`, component never rendered), `/finance/console` (existing `FinanceWorkspace`, same meta), `/finance/no-workspace`, then each registered workspace's route with `meta.financeWorkspace = key` and `beforeEnter: guardWorkspace`. All keep `requiresAuth` and `roles: [...FINANCE_ROLES, 'admin']`.

- [ ] **Step 1: Write failing tests** (pure functions with a stubbed store; one registered fake `cashier` workspace):
  - flag off: `/finance?section=rates` → `{ path: '/finance/console', query: { section: 'rates' } }`
  - home built: cashier identity → cashier dashboard route
  - home unbuilt: accountant identity (no registrations) → `/finance/console` (Review Focus 1)
  - zero workspaces → `/finance/no-workspace` (Review Focus 5)
  - identity load fails → `/finance/console`; `guardWorkspace` returns `true` (Review Focus 2)
  - legacy: cashier-only identity, `/finance?section=budget&status=submitted` → console-or-home with `notice: 'unavailable'` and no `status` (Review Focus 3)
  - direct URL to a workspace not in `identity.workspaces` → redirected with `notice: 'not-yours'`
  - after `store.reset()` the guard calls `loadIdentity` again and uses the new identity (Review Focus 4)
- [ ] **Step 2:** Run the spec — FAIL.
- [ ] **Step 3:** Implement. The flag is `import.meta.env.VITE_FINANCE_WORKSPACES !== 'off'`, read through a one-line exported function so tests can stub it. `FinanceWorkspace.vue`'s own `router.replace({ query })` calls are relative to the current path and keep working at `/finance/console`. Check that its URL-honesty watch does not write `section` onto `/finance` (it only runs when mounted, i.e. on `/finance/console`).
- [ ] **Step 4:** `NoWorkspaceView.vue`: frame-less page in the `ins-*` vocabulary: "You hold a finance role, but none of your permissions opens a finance workspace. The finance administrator can review your access." plus sign-out.
- [ ] **Step 5:** Run the spec — PASS. Run all finance specs `npm run test:unit -- src/modules/finance` — the existing specs still pass.
- [ ] **Step 6: Commit** `feat(finance): workspace entry routing with console fallback`.

### Task 4: Workspace frame and switcher

**Files:**
- Create: `src/modules/finance/shell/WorkspaceFrame.vue`
- Create: `src/modules/finance/shell/WorkspaceSwitcher.vue`
- Create: `src/modules/finance/shell/frame.css` (frame-only rules on `--ent-*` tokens; grep `finance.css` and `inspector.css` before naming classes — `.fin-map` and `.ins-bar` are taken)
- Test: `src/modules/finance/__tests__/workspaceFrame.spec.ts`

**Interfaces:**
- Consumes: store (`identity`, `loadIdentity`, `identityError`, `reset`, `readsReference`, `loadReference`), `WORKSPACE_META`, `builtWorkspaces()`, `ProfileDropdown`, `FinanceYearPicker`.
- Produces: `<WorkspaceFrame :workspace="key" :show-year="boolean">` with slots `nav` (the workspace's own navigation, placed by the workspace's layout), `default` (content) and `actions` (quick actions in the top bar). Emits nothing; owns logout (`auth.logout()`, `store.reset()`, push `/login`). Renders: skip link to `#fin-main`; application name as `h1` and "Vungu Rural District Council · Finance" eyebrow; the year picker when `showYear && store.readsReference`; the switcher; the profile chip with the role label map from `FinanceWorkspace.vue` (moved to `shell/roleLabels.ts` and imported by both); boot states (loading, identity error with Retry); the `notice` query as a dismissible `role="status"` line (`not-yours`: "That workspace is not one of yours. You have been returned to your own work."; `unavailable`: "The page in that link is not part of your finance workspaces.").
  `<WorkspaceSwitcher :current="key">`: a disclosure button listing built workspaces in `identity.workspaces`, current marked `aria-current="page"`, plus "Previous finance console" linking `/finance/console` while the migration lasts; renders nothing when there is only one workspace and no console link is wanted (prop `showConsole`, default true).

- [ ] **Step 1: Write failing tests:** frame shows the application name for `cashier` as "Cash Office"; shows identity error + Retry when `loadIdentity` resolves null; logout calls `store.reset`; notice `not-yours` renders the sentence; switcher lists only built ∩ held workspaces in catalogue order; marks current; keyboard: Escape closes and returns focus to the button.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. The frame is chrome only: no rail, no work queue, no section slot logic.
- [ ] **Step 4:** Run — PASS; full finance specs pass; `vue-tsc` clean.
- [ ] **Step 5: Commit** `feat(finance): shared workspace frame and switcher`.

### Task 5: Queue targets, coverage check and access documentation

**Files:**
- Modify: `src/modules/finance/composables/useFinanceQueues.ts` (each queue gains `target: FinanceTarget` beside the existing `section`, which stays for the console)
- Create: `src/modules/finance/__tests__/workspaceCoverage.spec.ts`
- Create: `docs/finance/WORKSPACE-ACCESS.md`
- Modify: `CLAUDE.md` (Architecture → Frontend: the finance workspaces, the console fallback, the flag)

**Interfaces:**
- Produces: `FinanceQueue.target: FinanceTarget`. The coverage spec exports nothing.

- [ ] **Step 1: Write the coverage spec**: every `FinanceTarget` used by a queue and every value of `SECTION_TARGETS` is either served by a registered workspace or listed in a `PENDING` array in the spec with the phase that will serve it. In this plan every target is in `PENDING`; each workspace plan removes the ones it serves. The test fails if a target is both served and pending, or neither.
- [ ] **Step 2:** Run — FAIL until `target` exists on queues; add it (`target: SECTION_TARGETS[section]` or a tab target where the queue opens a tab, e.g. cash-ups to verify → `'cash.sessions'`, vouchers awaiting posting → `'ledger.vouchers'`). Run — PASS.
- [ ] **Step 3:** Write `docs/finance/WORKSPACE-ACCESS.md`: table workspace → route → name → primary role → admitting permissions → roles admitted by default grants (spec §6, plus the `finance_admin` home rule); the override example; the old-section × tab → workspace-screen coverage table with every row "console (until Phase N)"; how to switch back (`VITE_FINANCE_WORKSPACES=off`).
- [ ] **Step 4:** Commit `docs(finance): workspace access map and queue targets`.

### Task 6: Verify in the running app

- [ ] **Step 1:** Restart the backend; `npm run dev`.
- [ ] **Step 2:** With a scratchpad Playwright script (memory: MCP browser has no Chrome; reject the cookie banner first), sign in as each demo finance login and record: final URL after login (expect `/finance/console` for all, since nothing is built), `/api/finance/me` `workspaces` and `home_workspace` (expect spec §6), `/finance/cashier` direct (expect redirect with notice, since unbuilt), `/finance?section=rates` (expect console on rates for revenue, console with notice for publisher).
- [ ] **Step 3:** For two roles, call one API outside their permissions directly (cashier → `GET /api/finance/ledger/vouchers`; publisher → `POST /api/finance/budget-lines`) and confirm 403 plus a refusal row in the audit trail.
- [ ] **Step 4:** Set `VITE_FINANCE_WORKSPACES=off`, restart vite, confirm `/finance?section=budget` goes to `/finance/console?section=budget`.
- [ ] **Step 5:** Record results in `docs/finance/WORKSPACE-ACCESS.md` under "Verification" with the date.

---

## Next plans (written before each is executed, after reading the sections they absorb)

1. `…-finance-workspace-cash-office.md` — Cash Office (spec §9), splits `CashOfficeSection`.
2. `…-finance-workspace-accounting.md` — Accounting, splits Ledger and Statements.
3. `…-finance-workspace-budget.md` — Budget Management.
4. `…-finance-workspace-management.md` — Finance Management, splits Overview and Classifications.
5. Review gate (spec §13.9) before the other eight.
