# Migration 208 runbook: the till session lifecycle

Migration: `../Manicipal-drums-backend-3/migrations/208_cash_session_lifecycle.sql`
Rollback: `../Manicipal-drums-backend-3/migrations/rollback/208_cash_session_lifecycle.down.sql`
Design: `docs/superpowers/specs/2026-11-12-cashier-workspace-design.md` §3, §5, §8
Plan: `docs/superpowers/plans/2026-11-12-cash-office-phase-a-sessions.md`

**State:** **applied to `vungu_dev` on 2026-11-12 at 19:49:41 (+02:00)**, on the owner's
instruction, following this runbook. See §6. **Not applied to production or to any other database
in use.** (It is also in the disposable `vungu_acceptance_test` and `vungu_cash208_scratch`.)

## 1. What changes in the database

All additive. No existing row in any table is changed.

| Object | Change |
|---|---|
| `public.users` / `public.invites` `*_role_check` | Rebuilt additively with `cash_supervisor` added (same method as 207). |
| `public.users_default_authority()` | Same role list as 207, plus `cash_supervisor`. |
| `finance.permission` | Two new codes: `finance.cash.session.supervise`, `finance.cash.assignment.manage`. |
| `finance.role_permission` | `cash_supervisor` gets `cash.view`, `cash.session.supervise`, `cash.assignment.manage`, `cash.session.verify` and `rates.view`. `finance_admin` gets supervise and assignment. **No grant is removed from any role.** The migration refuses to commit if the accountant holds supervision, if the supervisor holds anything that takes money or keeps the book, or if the cashier holds supervise, assign or verify. |
| `finance.cashier_session` | Six new **nullable** columns: `suspended_at`, `abandoned_at`, `abandoned_by`, `abandon_reason`, `closed_by`, `witness_id`. The status CHECK widens to add `suspended` and `abandoned`. New CHECKs cover attribution, "never your own" and "witnessed by a third person". `cashier_session_verified_by_another` is extended to the supervisor and the witness. `closed_is_dated` is widened to the new holding states. Every existing row satisfies all of them, because all its new columns are NULL. |
| `uq_cashier_session_open_point`, `uq_cashier_session_open_cashier` | Recreated over `open | suspended | abandoned`, so one drawer still has one cashier. **Stricter than before, never looser.** |
| Trigger `trg_cashier_session_transition` | Allows only the listed state changes, and refuses DELETE of a session. |
| `finance.cashier_session_event` (new) | Append-only history, written by triggers. UPDATE, DELETE and TRUNCATE are refused by trigger and revoked from `vungu_app`. Existing sessions are backfilled from their own timestamps, marked `source = 'backfill'`. |
| `finance.cash_point_assignment` (new) | Which cashiers work which point. Never deleted; ended once, with a reason. |
| `finance.setting` | Two **provisional** rows: `cash.abandon_after_hours = 12` and `cash.require_assignment = false` (decision D29). |
| Functions | New: `suspend_`, `resume_`, `mark_..._abandoned`, `supervised_close_cashier_session`, `assign_cashier`, `end_cashier_assignment`, `write_session_count`, `session_counts_json`, `is_assigned_to_cash_point`, `cash_abandon_after_hours`, plus the trigger functions. Replaced, with signatures unchanged: `close_cashier_session` (same rules, through the shared count), `return_cashier_session` (keeps the returned count in the history; a supervised count returns to the supervisor; refused if the drawer has since been reissued), `cashier_session_for_receipt` (one new refusal: a session from a past business day takes no receipts). |
| `finance.v_cash_drawer` (new view) | One row per cash point, with the session holding it. |
| `vungu_app` privileges | DELETE and TRUNCATE revoked on `cashier_session`. UPDATE, DELETE and TRUNCATE revoked on the event log. DELETE and TRUNCATE revoked on assignments. |

### Existing records are preserved: how this is proven

Section 0 of the migration fingerprints, by row count and an md5 over every row, these tables:
`cashier_session` (its pre-208 columns), `cashier_session_count`, `cash_receipt`,
`cash_receipt_line`, `rates_receipt`, `bank_deposit`, `voucher`, `voucher_line`, `ledger_entry` and
`document_sequence`. Section 12 recomputes them and **raises an exception if any differs**, so the
whole migration rolls back. A successful run ends with:

```
NOTICE:  migration 208: every existing session, count, receipt, voucher and ledger row is unchanged
```

On the restored copy of `vungu_dev`, CS-0000001 (verified, 3 receipts) and **CS-0000002 (open,
`demo.cashier2`, receipt RC-0000004 for USD 5.00)** came through unchanged. Each gained only its
backfilled history: `opened`, `counted` and `verified` for CS-0000001, and `opened` for CS-0000002.
**The migration does not close, abandon or alter CS-0000002.** That session is resolved through the
new workflow, by people, after the migration.

## 2. Before applying

1. **Stop writes.** Stop the backend (`node server.js`) or put the counter out of use. A
   receipt taken during the migration is safe, because 208 runs in one transaction under row
   locks, but it is cleaner not to race it.
2. **Back up:**
   ```bash
   cd ../Manicipal-drums-backend-3
   F=backups/vungu_dev-pre-208-$(date +%Y%m%dT%H%M).dump
   pg_dump -h localhost -U postgres -Fc -f "$F" vungu_dev && sha256sum "$F" > "$F.sha256"
   ```
   On 2026-11-12 this took 2 min 13 s and produced 677 MB
   (`backups/vungu_dev-pre-208-20261112T1824.dump`, sha256 `cc7dc015…0ad5`).
   `backups/` is git-ignored.
3. **Verify the backup by restoring it.** A dump that has not been restored is not a backup:
   ```bash
   createdb -h localhost -U postgres vungu_restore_check
   pg_restore -h localhost -U postgres -d vungu_restore_check --no-owner -j 4 "$F"
   ```
   Then compare a fingerprint of every `finance` table and `public.users` between the two
   databases. The script used on 2026-11-12 counts each table and takes an md5 over its rows
   ordered by text. Result that day: 1 min 21 s to restore, no errors, all 51 finance tables
   identical. `public.users` was identical except for `last_login`, a sign-in after the dump.
4. **Read the database's state**, so the "after" can be compared:
   ```sql
   SELECT session_no, status, cashier_id, closed_at FROM finance.cashier_session ORDER BY session_no;
   SELECT count(*) FROM finance.cash_receipt; SELECT count(*) FROM finance.ledger_entry;
   ```

## 3. Apply

> **On `vungu_dev`, use the direct path below, not the runner.** `vungu_dev`'s `schema_migrations`
> does not record 207 (it was applied directly), so `scripts/migrate.js` would try to apply 207 a
> second time.

Either through the runner, which records 208 in `schema_migrations`:

```bash
node scripts/migrate.js
```

or directly, in one transaction:

```bash
PGOPTIONS="-c statement_timeout=0" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/208_cash_session_lifecycle.sql
psql "$DATABASE_URL" -c "INSERT INTO schema_migrations (filename) VALUES ('208_cash_session_lifecycle.sql') ON CONFLICT DO NOTHING"
```

Look for the NOTICE in §1. The migration is idempotent: a second run changed nothing on the
clone.

Then:

```bash
DEMO_SEED_ENABLED=true DEMO_DEFAULT_PASSWORD=demo1234 node scripts/seed-demo-users.js   # dev only: demo.supervisor
node scripts/verify-cash-session-lifecycle.js    # 79 checks. L1–L9 roll back. L10 commits tagged fixtures and removes them.
node scripts/verify-cash-office-invariants.js    # 55 checks: migration 207's controls still hold
```

Restart the backend. It does not hot-reload, and the new routes return 404 until it is restarted.

## 4. Roll back

### 4a. Down migration: keeps everything that happened since

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/208_cash_session_lifecycle.down.sql
```

- **It refuses, and changes nothing,** if any session is suspended or abandoned, was counted
  under supervision, or if anyone holds `cash_supervisor`. Migration 207 cannot represent those.
  Resolve them in the application first, or use 4b.
- **It keeps the evidence.** The history and the assignments are renamed to
  `finance.cashier_session_event_208_archive` and `finance.cash_point_assignment_208_archive`,
  not dropped.
- It restores 207's constraints, indexes and function bodies verbatim, and fingerprints sessions,
  counts, receipts and ledger entries before and after.
- **Tested 2026-11-12 on the clone**: after rollback, every finance table matched the pre-208
  backup, and so did the three replaced functions and the session constraints. 208 was then
  re-applied cleanly.

### 4b. Restore the backup: loses everything since the backup

Only if 4a cannot run, for example because a session was counted under supervision and must be
undone:

```bash
dropdb vungu_dev && createdb vungu_dev
pg_restore -h localhost -U postgres -d vungu_dev --no-owner -j 4 "$F"
```

Every receipt and session after the backup is lost, so re-key them from the paper record. This is
why §2.1 asks for writes to stop.

## 5. After applying: resolving CS-0000002

Walked on the clone on 2026-11-12 and screenshotted:

1. The cash supervisor opens **Cash office → Drawers**. CS-0000002 shows as held by Demo Relief
   Cashier.
2. Once the threshold has passed (provisional: 12 hours, or the next business day), the supervisor
   chooses **Find abandoned** and records what they found.
3. With a witness who is neither the cashier nor the supervisor, they choose **Count with a
   witness** and enter the count (expected: USD 5.00, no float). The drawer is freed by this
   count.
4. The accountant verifies the count under **Cash-ups**. The supervisor and the witness cannot.
5. The main counter can now be opened again, by a cashier assigned to it.

If `demo.cashier2` is simply asked to cash up CS-0000002 the ordinary way, none of this is needed.

## 6. Deployment record — `vungu_dev`, 2026-11-12

| Step | Result |
|---|---|
| Writes stopped | Dev backend (:3000, `node server.js`) stopped. 0 connections and 0 prepared transactions on `vungu_dev` before the backup |
| Fresh backup | `backups/vungu_dev-pre-208-20261112T194206.dump`, 677 MB, sha256 `bdeddde240c64190cb17ba268c5dc9fcbed44e23b48bbcf5a63e43ca3d11aa27`, 4 min 23 s |
| Backup verified | Restored to `vungu_pre208_verify_scratch` in 2 min 27 s with no errors. All 51 finance tables and `public.users` identical to `vungu_dev` by row count and md5 |
| Applied | `psql -1 -f 208_cash_session_lifecycle.sql`, exit 0, 0.75 s. Recorded in `schema_migrations` at 19:49:41 |
| Integrity after | Byte-identical: `cash_receipt`, `cash_receipt_line`, `voucher`, `voucher_line`, `ledger_entry`, `bank_deposit`, `document_sequence`, `rates_receipt`, `cashier_session_count`. `cashier_session`: pre-208 columns identical to the backup; all 6 new columns NULL on both rows. Added only: 2 permissions, 7 grants, 2 provisional settings, 4 backfilled history events |
| CS-0000002 / RC-0000004 | Session (still **open**), receipt, its line and its draft voucher identical by md5 before and after. **Not closed or abandoned by the deployment** |
| Database proofs on `vungu_dev` | lifecycle 79/79, cash office 55/55, rates 86/86, ledger 34/34. Document numbers unchanged; no proof rows left behind |
| Role check | `demo.supervisor` holds exactly `cash.view`, `cash.session.supervise`, `cash.assignment.manage`, `cash.session.verify`, `rates.view`. Nothing in ledger, tariff, receipting, till operation, setup or banking. Live API: supervisor 403 on opening a till and on the ledger; cashier and accountant 403 on the drawers board |
| Backend restarted | :3000 against `vungu_dev`. `/api/finance/cash/drawers` shows CS-0000002 held 12.2 h, abandonable under the provisional threshold, **left for the authorised workflow** |
