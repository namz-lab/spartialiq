# Cash Office Phase A — Till Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status 2026-11-12:** Tasks 1–6 built and tested; Task 7 walked against a restored copy of `vungu_dev`; 208 then applied to `vungu_dev` on the owner's instruction (runbook §6). Deviations are listed in spec §16.

**Goal:** A cashier can always tell which drawer is theirs and why one is unavailable; a cashier can
suspend and resume; a supervisor can see every drawer, mark a long-held session abandoned, and
close it with a witnessed count, without ever relaxing one-cashier-per-drawer.

**Architecture:** Migration 208 extends `finance.cashier_session` with `suspended` and `abandoned`
states, adds `finance.cash_point_assignment`, the `cash_supervisor` role and the
`finance.cash.session.supervise` permission, and four database functions (`suspend`, `resume`,
`mark_abandoned`, `supervised_close`) that enforce every rule. Routes in `finance-cash.js` are thin
wrappers. The frontend gains a session-state-aware counter and a supervisor drawers board, built as
screens that the Phase D workspace will compose.

**Tech Stack:** PostgreSQL 16 + plpgsql, Fastify + jest (backend `../Manicipal-drums-backend-3`);
Vue 3, Pinia, Vitest + @vue/test-utils + happy-dom (frontend).

**Spec:** `docs/superpowers/specs/2026-11-12-cashier-workspace-design.md` §3, §5 (supervise row),
§8.1, §8.2, §12.8 (drawers board only).

## Global Constraints

- Every rule lives in the database function; the route only checks the permission and maps errors.
- `uq_cashier_session_open_point` and `uq_cashier_session_open_cashier` are rebuilt to cover
  `open | suspended | abandoned`. A drawer is freed only by a count.
- No function changes another person's session except `mark_abandoned` and `supervised_close`, and
  both require `finance.cash.session.supervise`, a reason of at least 10 characters, and an actor
  who is not the session's cashier.
- C4 stands: a supervised close goes to verification by someone other than the cashier, the
  supervisor, and the witness.
- Migration 208 is additive and idempotent; existing `open|closed|verified` rows keep their meaning.
- No demo session is closed by the migration. `CS-0000002` is resolved through the new workflow,
  in the running app, as the acceptance test.
- The DB carries a 30 s `statement_timeout`; the migration does no bulk work.
- Frontend tests use the `// @vitest-environment happy-dom` directive; run with
  `npm run test:unit -- <path>`.
- Copy: calm, no exclamation marks, every refusal says why and who can act.

## Review Focus

1. Cashier A holds MAIN, suspended. Cashier B opens the counter → sees MAIN as "Suspended, held by
   A since 12:10", no open button, and any assigned free point offered instead.
2. Supervisor tries to mark a session abandoned 2 hours after opening, same business date → refused
   with the threshold in the message.
3. Supervisor marks their own session abandoned → refused.
4. Supervised close where witness = supervisor, or witness = cashier → refused.
5. After a supervised close, the supervisor tries to verify the same cash-up → refused (C4 extended).
6. Cashier whose session was marked abandoned signs in → sees "Your session CS-… was marked
   abandoned by <name> at <time>: <reason>. It will be counted by a supervisor." and no receipt
   form.
7. Two supervisors mark the same session at once → one succeeds, the other gets "already
   abandoned" (row lock), not a duplicate audit row.

---

### Task 1: Migration 208 — states, assignment, role, permission

**Files:**
- Create: `../Manicipal-drums-backend-3/migrations/208_cash_session_lifecycle.sql`
- Test: `../Manicipal-drums-backend-3/scripts/verify-cash-office-invariants.js` (extend)

- [x] **Step 1: Write failing invariant checks** in `verify-cash-office-invariants.js`: status
  `suspended` and `abandoned` accepted by the CHECK; a second `open` session on a point that has a
  `suspended` one refused by the unique index; `cash_point_assignment` exists with
  `(cash_point_id, user_id, valid_from)` unique and `valid_to > valid_from`; role `cash_supervisor`
  accepted by `users_role_check`; `finance.cash.session.supervise` granted to `cash_supervisor`,
  `accountant`, `finance_admin` (the roles that hold `finance.cash.session.verify` today) and not to `cashier`.
- [x] **Step 2: Run** `node scripts/verify-cash-office-invariants.js` — expect the new checks to fail.
- [x] **Step 3: Write the migration**:
  - Rebuild `cashier_session_status_known` to `open, suspended, abandoned, closed, verified`.
  - Add columns `suspended_at`, `abandoned_at`, `abandoned_by`, `abandon_reason`,
    `closed_by` (NULL = the cashier), `witness_id`. CHECKs: abandoned attribution all-or-nothing;
    `abandoned_by <> cashier_id`; `witness_id` not in (`cashier_id`, `closed_by`).
  - Drop and recreate both partial unique indexes with `WHERE status IN ('open','suspended','abandoned')`.
  - Extend `cashier_session_verified_by_another` to `verified_by NOT IN (cashier_id, coalesce(closed_by, cashier_id), coalesce(witness_id, cashier_id))`.
  - `finance.cash_point_assignment (id, authority_id, cash_point_id, user_id, valid_from date, valid_to date NULL, assigned_by, created_at)` with RLS policies copied from `cash_point`.
  - Add role `cash_supervisor` to `users_role_check` and `invites_role_check` the way 207 lines 46–75 do.
  - Insert permission `finance.cash.session.supervise` and grants; grant `cash_supervisor` also
    `finance.cash.view` and `finance.cash.session.verify`.
  - Settings rows: `cash.abandon_after_hours` = `12`, `cash.allow_unassigned_points` = `true`
    (true keeps today's behaviour until the council decides D29).
- [x] **Step 4: Apply** `node scripts/migrate.js`; run the invariant script — expect all pass, old 55 included.
- [x] **Step 5: Commit** `feat(cash): session states, drawer assignment, cash supervisor role (208)`.

### Task 2: Lifecycle functions

**Files:**
- Modify: `migrations/208_cash_session_lifecycle.sql` (append functions)
- Test: `scripts/verify-cash-office-invariants.js`

- [x] **Step 1: Failing checks** for each rule:
  - `finance.suspend_cashier_session(session, actor)`: only the session's cashier; only from `open`.
  - `finance.resume_cashier_session(session, actor)`: only the cashier; only from `suspended`;
    refused if business date ≠ today ("cash up the old session").
  - `finance.mark_cashier_session_abandoned(session, actor, reason)`: actor ≠ cashier; from
    `open|suspended`; refused unless `now() - opened_at > abandon_after_hours` or
    `business_date < current_date`; reason ≥ 10 chars; `FOR UPDATE`.
  - `finance.supervised_close_cashier_session(session, actor, witness, counts jsonb, explanation)`:
    from `abandoned` only; actor ≠ cashier; witness ∉ {cashier, actor} and holds `finance.cash.view`;
    writes declared totals to `cashier_session_count` exactly as `close_cashier_session` does,
    sets `closed_by`, `witness_id`, `closed_at`, status `closed`.
  - `cashier_session_for_receipt` refuses a session in `suspended|abandoned` with the state named.
  - `open_cashier_session`: when `cash.allow_unassigned_points` is false, refuses a point the
    cashier has no current assignment to.
- [x] **Step 2: Run** — expect failures.
- [x] **Step 3: Implement** the functions; refactor the count-writing body of
  `close_cashier_session` into `finance.write_session_count(session, counts, explanation)` and call
  it from both closes, so the variance rules (C6) are not duplicated.
- [x] **Step 4: Run** — all pass.
- [x] **Step 5: Commit** `feat(cash): suspend, resume, abandon and supervised close`.

### Task 3: Routes and desk payload

**Files:**
- Modify: `src/routes/finance-cash.js`
- Modify: `src/middleware/auditLog.js` (rules)
- Test: `src/routes/__tests__/finance.cash.test.js`

- [x] **Step 1: Failing route tests**: `POST /finance/cash/sessions/:id/suspend|resume` (cashier,
  own only → 403/422 otherwise); `POST /finance/cash/sessions/:id/abandon` and
  `/supervised-close` (403 for cashier, 422 for self, 200 for supervisor); `GET /finance/cash/drawers`
  (supervise only) returning every point with holder name, state, since, receipt count, expected
  cash per currency; desk payload gains for each point `session_state`, `held_by_name`, `held_since`,
  `assigned_to_me`, and `my_session.state` including `suspended|abandoned` plus abandon details.
- [x] **Step 2: Run** `npx jest src/routes/__tests__/finance.cash.test.js -i` — fail.
- [x] **Step 3: Implement.** Desk query: replace `s.status = 'open'` with the three holding states;
  `my_session` query includes `suspended|abandoned`. Audit rules: abandon and supervised close at
  `critical`, suspend/resume at `high`.
- [x] **Step 4: Run** — pass; also run the whole finance integration set to catch regressions:
  `npx jest src/routes/__tests__/finance -i`.
- [x] **Step 5: Commit** `feat(cash): lifecycle and drawers routes`.

### Task 4: Assignment administration

**Files:**
- Modify: `src/routes/finance-cash.js` (`GET/POST/PATCH /finance/cash/assignments`, `canSetUp`)
- Modify: `src/modules/finance/components/cash/CashSetup.vue` (frontend) — assignments table per point
- Modify: `src/modules/finance/api/financeApi.ts`, `src/modules/finance/models/types.ts`
- Test: route test + `src/modules/finance/__tests__/cashSetup.spec.ts`

- [x] **Step 1: Failing tests**: create, end-date, list; cashier gets 403; assigning a user without
  `finance.cash.session.operate` refused.
- [x] **Step 2–4:** implement, run, pass.
- [x] **Step 5: Commit** `feat(cash): assign cashiers to cash points`.

### Task 5: Counter states on the frontend

**Files:**
- Modify: `src/modules/finance/components/cash/CashCounter.vue`
- Modify: `src/modules/finance/models/types.ts` (`CashierSessionDetail.state`, point fields)
- Modify: `src/modules/finance/api/financeApi.ts` (suspend, resume)
- Test: `src/modules/finance/__tests__/cashCounter.spec.ts`

- [x] **Step 1: Failing component tests**:
  - the blocker sentence names each occupied point's holder and state, e.g. "Main counter is held by
    Tendai Moyo (open since 07:38). Ask a supervisor if it has been left open." — replacing line 77;
  - assigned free points listed first and marked "Assigned to you";
  - own session `suspended` → Resume button, receipt form hidden;
  - own session `abandoned` → the explanation in Review Focus 6, no actions;
  - own session from an earlier business date → "Cash up yesterday's session" call to action.
- [x] **Step 2: Run** `npm run test:unit -- src/modules/finance/__tests__/cashCounter.spec.ts` — fail.
- [x] **Step 3: Implement.** Keep the component's existing structure; add a `SessionStateBanner`
  section rather than new branches throughout. Suspend button beside Cash up.
- [x] **Step 4: Run** — pass, plus the full finance suite `npm run test:unit -- src/modules/finance`.
- [x] **Step 5: Commit** `feat(cash): counter explains who holds each drawer; suspend and resume`.

### Task 6: Supervisor drawers board

**Files:**
- Create: `src/modules/finance/components/cash/CashDrawers.vue`
- Create: `src/modules/finance/components/cash/SupervisedCloseDialog.vue`
- Modify: `src/modules/finance/pages/sections/CashOfficeSection.vue` (add the Drawers tab, shown when
  `store.can('finance.cash.session.supervise')`)
- Test: `src/modules/finance/__tests__/cashDrawers.spec.ts`

- [x] **Step 1: Failing tests**: table of points (point, holder, state chip, since, receipts,
  expected per currency); "Mark abandoned" only on sessions past threshold, opens a reason dialog;
  "Count drawer" only on abandoned sessions, opens the supervised-close dialog with a witness picker
  that excludes the cashier and the current user; denomination entry reused from the existing count
  form; Esc closes; focus returns to the row's button.
- [x] **Step 2–4:** implement, run, pass. States use text plus colour (WCAG), never colour alone.
- [x] **Step 5: Commit** `feat(cash): supervisor drawers board and supervised close`.

### Task 7: Verify in the running app

- [x] Restart the backend (see memory: driving the running app). Log in as `demo.cashier` →
  counter shows "Main counter is held by … (open since 07:38)".
- [x] Log in as a supervisor (create `demo.supervisor` with role `cash_supervisor` via the existing
  demo-user script) → Drawers shows CS-0000002 past threshold if the business date has moved on;
  otherwise lower `cash.abandon_after_hours` to 0 for the demonstration and restore it afterwards.
- [x] Mark abandoned with a reason, count with a witness, confirm the drawer frees and
  `demo.cashier` can open MAIN.
- [x] Log in as an accountant → verify the cash-up; confirm the supervisor and witness are refused.
- [x] Screenshot each state at 1440 px and 390 px; no console errors, no horizontal overflow.
- [x] Update `docs/finance/IMPLEMENTATION-TRACKER.md` §0 and `docs/finance/WORKSPACE-ACCESS.md`
  (new role, new permission); add D29 to `COUNCIL-DECISIONS.md`.
- [x] Commit `docs(cash): phase A as built`.

## Next plans

Written after Phase A ships, each after re-reading the code it touches:

- **Phase B — sundry debtors** (spec §6): revenue categories, tariffs with approval, party
  extension and flags, invoices and posting, `v_outstanding_charge`, revenue configuration screens
  in the Accounting workspace.
- **Phase C — issue_receipt** (§7): tenders, allocation, idempotency, post at issue (K2), clearing
  accounts and tender verification; migration of counter rates receipts onto `cash_receipt`.
- **Phase D — Cash Office workspace** (§12.1–12.6): `/finance/cashier` registration, header,
  dashboard endpoint, receive payment, customer enquiry, receipts and reprint control.
- **Phase E — end of day** (§8.3, §9, §10): movements, denomination count with declarations,
  banking verification.
- **Phase F — oversight** (§11, §12.7, §12.8): corrections and refunds, the twelve reports,
  supervisor workspace. Then the review gate of the workspaces spec §13.9.
