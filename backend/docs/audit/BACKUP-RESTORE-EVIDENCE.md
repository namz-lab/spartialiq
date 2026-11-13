# Backup and Restore Evidence — 2026-11-06

Scope: prove that the documented backup can be restored into an isolated database and
that the restored finance data is complete and correct. This drill did **not** touch the
production database or production infrastructure. Source was the local working database
`vungu_dev`; target was a new isolated database `vungu_restore_test` on the same
PostgreSQL 18.6 instance.

## Re-run 2026-11-07 (post system-wide fixes)

| Step | Command | Result |
|---|---|---|
| Backup | `node scripts/backup-db.js` | dump 709.7 MB + sha256 sidecar, **126 s** |
| Scratch restore | `pg_restore -d …/vungu_restore_drill --no-owner --no-privileges db-20261107-095330.dump` | **74 s** |
| Verification | `SOURCE_DATABASE_URL=… RESTORE_DATABASE_URL=… node scripts/verify-restore.js` | **PASS, 0 mismatches** |

Same host, same instance as the 2026-11-06 drill; scratch database dropped afterwards. The
restored database included everything up to and including migration 197, proving the repaired
chain round-trips through backup. Timings are consistent with the first drill (103 s / 65 s at
709.4 MB) — both are the same-order-of-magnitude estimate for the same-host recovery step.
Operational RTO (off-site copy, new host, cut-over) remains unmeasured; that is what D10's
demonstration must add on the production host.

---


## 1. Artifacts

| Artifact | Value |
| --- | --- |
| Backup command | `DATABASE_URL=…/vungu_dev node scripts/backup-db.js` |
| Dump | `backups/db-20261106-074529.dump` |
| Dump size | 709,366,992 bytes (709.4 MB, custom format) |
| Dump SHA-256 | `24909e38d7747b69eac515a9a0359e0e6b329aa6fa7af2ee4a3db06fc9655024` |
| Uploads archive | `backups/uploads-20261106-074529.zip` (81,273 bytes, 190 files) |
| Backup duration | **103.41 s** |
| Restore duration | **65.35 s** |
| Restore target | `vungu_restore_test` (dropped and recreated by the drill) |
| Restore command | `CONFIRM_RESTORE=1 DATABASE_URL=…/vungu_restore_test node scripts/restore-db.js <dump>` |

The dump was verified before restore with `sha256sum -c db-20261106-074529.dump.sha256`
(result `OK`). `scripts/backup-db.js` now performs this verification automatically:

- `pg_restore -l` must list `public.schema_migrations` with both schema and data entries.
- Every `finance` base table present in the live database must appear with both a schema
  entry and a data entry.
- A `.sha256` file is written beside the dump.

The drill backup reported: `verified 26 finance tables and schema_migrations`.

## 2. Restore verification

Command:

```bash
SOURCE_DATABASE_URL='postgresql://…/vungu_dev' \
RESTORE_DATABASE_URL='postgresql://…/vungu_restore_test' \
node scripts/verify-restore.js
```

Result: **PASS — 0 mismatches**.

| Check | Source | Restored |
| --- | --- | --- |
| Applied migrations | 126 | 126 |
| Finance base tables | 26 | 26 |
| Finance views | 4 | 4 |
| Finance triggers | 31 | 31 |
| `schema_migrations` rows | 126 | 126 |
| All finance table row counts | matched | matched |
| Migration filenames | matched | matched |
| Trigger list | matched | matched |

Financial totals, kept separate by currency:

| Measure | USD | ZWG |
| --- | --- | --- |
| Budget lines (count / original amount) | 2 / 650,000.00 | 1 / 18,500,000.00 |
| Approved budget revisions | none | none |
| Transactions | none | none |
| Commitments | none | none |
| Project allocations | none | none |
| Project-linked spend | none | none |

Publication and document counts were also compared and matched (both zero in this
source database). The verification script compares them for any future drill.

The current working database contains little transactional data, so this drill proves
schema, migration and count fidelity plus non-zero budget totals. A second drill against
the synthetic end-to-end dataset in `docs/audit/FINANCIAL-WORKFLOW-EVIDENCE.md` is
recommended once that dataset exists, to prove transaction, allocation, publication and
document totals round-trip.

## 3. Document storage verification

```bash
unzip -q backups/uploads-20261106-074529.zip -d /tmp/…/uploads-restored
# compare every file's SHA-256
```

Result: **190 source files, 190 restored files, identical SHA-256 for every file**
(`UPLOADS_HASH_MATCH=yes`). Finance documents are stored under
`uploads/finance-documents/<authority>/<subject-kind>/` and are included because the
archive contains the whole `uploads/` tree.

## 4. Procedure (repeatable)

1. Run `npm run backup`. Confirm the log reports the finance-table verification and the
   checksum line.
2. Copy the dump, its `.sha256`, and the uploads archive off-host.
3. Create an isolated target database. Never point `restore-db.js` at production.
4. Verify the checksum, then run `restore-db.js` with `CONFIRM_RESTORE=1` and the target
   `DATABASE_URL`.
5. Run `verify-restore.js` with source and target URLs; require `PASS`.
6. Extract the uploads archive and compare file counts and hashes.
7. Record backup and restore wall-clock times here.
8. Drop the isolated database.

## 5. Honest limits

- This was a **same-host** restore. It does not measure the time to copy 709 MB off-site,
  provision a new server, change DNS, restart the application or run application-level
  smoke tests. The operational RTO is therefore **not** 65 seconds; it is 65 seconds plus
  those steps.
- The backup is still a nightly logical dump. RPO remains up to 24 hours until WAL
  archiving or continuous backup is configured.
- No restore was attempted into a different PostgreSQL major version.
- This evidence supports **operationally verified backup/restore on a test instance**;
  it does not by itself satisfy Council acceptance or a production DR rehearsal.
