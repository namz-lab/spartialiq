# Database Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the application onto a healthy database with no corrupt pages, preserving every row.

**Architecture:** `pg_dump` fails on the damaged `pg_depend` page but succeeds under `zero_damaged_pages=on`. Dump schema and data from the damaged database, restore both into a fresh one, reset sequences, then verify by diffing a clean schema dump of the new database against the old. The damaged database is never written to and stays as the fallback.

**Tech Stack:** PostgreSQL 18.3 on Windows, PostGIS 3.x and 15 other extensions, `pg_dump`/`psql` from `C:/Program Files/PostgreSQL/18/bin`.

**Spec:** `docs/superpowers/specs/2026-09-21-production-test-readiness-design.md`

---

## Before you start

**This plan touches the only copy of the data.** Task 1 is not optional and
nothing else may run before it completes.

Facts established by measurement on 2026-09-21:

- Damaged: `pg_depend` (relation 2608, block 121) and
  `public.inspection_bookings` (block 0, a single 8 KB page, never populated).
- Data directory: `C:/Program Files/PostgreSQL/18/data`.
- Source database: `Vungu_spatial333`. Target: `Vungu_spatial334`.
- 16 extensions are installed, including `postgis`, `postgis_topology`,
  `postgis_tiger_geocoder`, `pgrouting`, `h3` and `pointcloud`.
- Credentials are in `../app-backend/.env` as `DATABASE_URL`.

**`zero_damaged_pages` is read-only here.** It zeroes a damaged page in the
reading backend's memory. It destroys data permanently only if that page is
then *written*. Every use of it in this plan is inside a `pg_dump`, which
writes nothing to the source.

Set these once per shell:

```bash
export PGBIN="/c/Program Files/PostgreSQL/18/bin"
export PGPASSWORD=$(grep -oP '(?<=postgresql://postgres:)[^@]+' ../app-backend/.env)
export WORK="$HOME/vungu-rebuild"
mkdir -p "$WORK"
```

---

### Task 1: Filesystem backup

The real fallback. A logical dump cannot be one, because the thing being
recovered from is catalog damage.

**Files:**
- Create: `C:/vungu-db-backup-2026-09-21/` (a copy of the data directory)

- [ ] **Step 1: Stop PostgreSQL**

A file copy of a running cluster's data directory is inconsistent. In an
Administrator PowerShell:

```powershell
Stop-Service postgresql-x64-18
Get-Service postgresql-x64-18
```

Expected: `Status : Stopped`. If the service name differs, find it with
`Get-Service *postgres*`.

- [ ] **Step 2: Copy the data directory**

```powershell
robocopy "C:\Program Files\PostgreSQL\18\data" "C:\vungu-db-backup-2026-09-21" /E /COPYALL /R:1 /W:1
```

Expected: robocopy exits 1 (files copied). Exit 0 means nothing copied —
investigate rather than continuing.

- [ ] **Step 3: Restart PostgreSQL**

```powershell
Start-Service postgresql-x64-18
Get-Service postgresql-x64-18
```

Expected: `Status : Running`.

- [ ] **Step 4: Confirm the backup is complete**

```powershell
(Get-ChildItem "C:\vungu-db-backup-2026-09-21" -Recurse | Measure-Object -Property Length -Sum).Sum
(Get-ChildItem "C:\Program Files\PostgreSQL\18\data" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
```

Expected: within a few MB of each other. A large shortfall means the copy was
partial — do not continue.

- [ ] **Step 5: Confirm the database still answers**

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial333 -c "select count(*) from public.roads"
```

Expected: `210240`.

---

### Task 2: Dump the schema

**Files:**
- Create: `$WORK/schema-old.sql`

- [ ] **Step 1: Dump under zero_damaged_pages**

```bash
PGOPTIONS="-c zero_damaged_pages=on" "$PGBIN/pg_dump" \
  -h localhost -U postgres -d Vungu_spatial333 \
  --schema-only --no-owner --no-privileges \
  -f "$WORK/schema-old.sql"
echo "exit=$?"
```

Expected: `exit=0`, no error output.

`--no-owner` and `--no-privileges` keep the restore portable; everything runs
as `postgres` locally.

- [ ] **Step 2: Verify the dump is complete**

```bash
grep -c '^CREATE TABLE' "$WORK/schema-old.sql"
grep -c '^CREATE VIEW' "$WORK/schema-old.sql"
grep -c '^CREATE FUNCTION' "$WORK/schema-old.sql"
grep -c '^CREATE INDEX' "$WORK/schema-old.sql"
grep -c 'OWNED BY' "$WORK/schema-old.sql"
```

Expected exactly: 163 tables, 16 views, 38 functions, 323 indexes, 138 owned
sequences. These are the measured counts. Any shortfall means the dump lost
something — stop and investigate rather than restoring a partial schema.

---

### Task 3: Dump the data

Extension configuration tables must be excluded. PostGIS marks
`spatial_ref_sys` and the tiger geocoder tables as user-configurable, so
`pg_dump` includes their rows; the new database's extensions will have already
created them, and restoring produces duplicate-key errors that bury real ones.

**Files:**
- Create: `$WORK/data-old.dump`

- [ ] **Step 1: Dump the data**

Custom format, so the restore can be parallel and order itself.

```bash
PGOPTIONS="-c zero_damaged_pages=on" "$PGBIN/pg_dump" \
  -h localhost -U postgres -d Vungu_spatial333 \
  --data-only --format=custom --no-owner --no-privileges \
  --exclude-table-data='public.spatial_ref_sys' \
  --exclude-table-data='tiger.*' \
  --exclude-table-data='tiger_data.*' \
  --exclude-table-data='topology.*' \
  -f "$WORK/data-old.dump"
echo "exit=$?"
```

Expected: `exit=0`. `inspection_bookings` dumps as zero rows — its single page
is zeroed on read. That is correct; the table was never populated.

- [ ] **Step 2: Verify the dump has substance**

```bash
ls -la "$WORK/data-old.dump"
"$PGBIN/pg_restore" --list "$WORK/data-old.dump" | grep -c 'TABLE DATA'
```

Expected: a file of hundreds of MB, and a `TABLE DATA` entry count near 90
(the non-empty tables plus empties).

---

### Task 4: Record the source row counts

The comparison baseline. Taken now, before anything is restored.

**Files:**
- Create: `$WORK/counts-old.txt`
- Create: `scripts/db-row-counts.js` in `../app-backend`

- [ ] **Step 1: Write the counting script**

Reusable — Task 7 runs it against the new database.

```js
/**
 * Print `schema.table<TAB>count` for every ordinary table in the application
 * schemas, sorted. Used to prove a rebuild preserved every row.
 *
 * Reads pg_class rather than information_schema, which is unreadable while
 * pg_depend is damaged.
 *
 *     node scripts/db-row-counts.js "postgresql://..."
 */
const { Client } = require('pg')

async function main() {
  const url = process.argv[2] || process.env.DATABASE_URL
  if (!url) throw new Error('Pass a connection string or set DATABASE_URL.')
  const c = new Client({ connectionString: url })
  await c.connect()
  const { rows } = await c.query(`
    SELECT n.nspname || '.' || c.relname AS tbl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('public','spatial_planning','survey')
    ORDER BY 1`)
  for (const r of rows) {
    let n
    try { n = (await c.query(`SELECT count(*)::int AS n FROM ${r.tbl}`)).rows[0].n }
    catch (e) { n = `ERROR:${e.code}` }
    console.log(`${r.tbl}\t${n}`)
  }
  await c.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
```

- [ ] **Step 2: Record the baseline**

```bash
cd ../app-backend
node scripts/db-row-counts.js "postgresql://postgres:$PGPASSWORD@localhost:5432/Vungu_spatial333" > "$WORK/counts-old.txt"
wc -l "$WORK/counts-old.txt"
grep ERROR "$WORK/counts-old.txt"
```

Expected: 163 lines, and exactly one ERROR line —
`public.inspection_bookings	ERROR:XX001`.

- [ ] **Step 3: Commit the script**

```bash
cd ../app-backend
git add scripts/db-row-counts.js
git commit -m "feat(scripts): row-count snapshot for verifying a rebuild"
```

---

### Task 5: Create and populate the new database

**Files:** none in the repo — this is database state.

- [ ] **Step 1: Create the database**

```bash
"$PGBIN/psql" -h localhost -U postgres -d postgres \
  -c "CREATE DATABASE \"Vungu_spatial334\" TEMPLATE template0 ENCODING 'UTF8'"
```

Expected: `CREATE DATABASE`. `template0` avoids inheriting anything from
`template1`.

- [ ] **Step 2: Restore the schema**

`ON_ERROR_STOP=0`, because the dump recreates extensions that the restore may
report as already present. Errors are captured and reviewed in the next step
rather than ignored.

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial334 \
  -v ON_ERROR_STOP=0 -f "$WORK/schema-old.sql" \
  > "$WORK/restore-schema.log" 2>&1
grep -c '^ERROR' "$WORK/restore-schema.log"
```

- [ ] **Step 3: Review every restore error**

```bash
grep '^ERROR' "$WORK/restore-schema.log" | sort | uniq -c | sort -rn
```

Expected: only `already exists` errors for extension-owned objects. **Any
error mentioning a table, view, function or index in `public`,
`spatial_planning` or `survey` is a real failure** — stop and resolve it
before continuing. Restoring onto a schema that silently lost objects is the
one outcome this whole plan exists to avoid.

- [ ] **Step 4: Restore the data**

```bash
"$PGBIN/pg_restore" -h localhost -U postgres -d Vungu_spatial334 \
  --data-only --no-owner --no-privileges --disable-triggers \
  "$WORK/data-old.dump" > "$WORK/restore-data.log" 2>&1
echo "exit=$?"
grep -c '^pg_restore: error' "$WORK/restore-data.log"
```

Expected: 0 errors. `--disable-triggers` stops foreign keys from rejecting
rows that arrive before the rows they reference.

- [ ] **Step 5: Review any data errors**

```bash
grep '^pg_restore: error' "$WORK/restore-data.log" | head -20
```

Expected: no output. Anything here means rows were dropped.

---

### Task 6: Reset the sequences

A data-only restore inserts explicit id values without advancing the
sequences, so every sequence still reads 1. The first insert after cutover
would fail on a duplicate key. This is the single most likely way the rebuild
looks fine and breaks later.

**Files:**
- Create: `scripts/db-reset-sequences.js` in `../app-backend`

- [ ] **Step 1: Write the script**

```js
/**
 * Advance every owned sequence to its column's maximum.
 *
 * A --data-only restore writes explicit ids without touching sequences, so
 * they all still read 1 and the next insert collides. Run this immediately
 * after any such restore.
 *
 *     node scripts/db-reset-sequences.js "postgresql://..."
 */
const { Client } = require('pg')

async function main() {
  const url = process.argv[2] || process.env.DATABASE_URL
  if (!url) throw new Error('Pass a connection string or set DATABASE_URL.')
  const c = new Client({ connectionString: url })
  await c.connect()
  const { rows } = await c.query(`
    SELECT s.relname AS seq, n.nspname AS sch, t.relname AS tbl, a.attname AS col
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a','i')
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S'
    ORDER BY 1`)
  let done = 0
  for (const r of rows) {
    const q = `SELECT setval(pg_get_serial_sequence('${r.sch}.${r.tbl}', '${r.col}'),
                 GREATEST(COALESCE((SELECT max("${r.col}") FROM ${r.sch}.${r.tbl}), 0), 1))`
    try { await c.query(q); done++ }
    catch (e) { console.error(`FAILED ${r.sch}.${r.tbl}.${r.col}: ${e.message.split('\n')[0]}`) }
  }
  console.log(`reset ${done}/${rows.length} sequences`)
  await c.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
```

- [ ] **Step 2: Run it against the new database**

```bash
cd ../app-backend
node scripts/db-reset-sequences.js "postgresql://postgres:$PGPASSWORD@localhost:5432/Vungu_spatial334"
```

Expected: `reset 138/138 sequences`, no FAILED lines. 138 is the measured
`OWNED BY` count from Task 2.

- [ ] **Step 3: Spot-check one**

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial334 -c \
  "SELECT last_value FROM spatial_planning.permit_application_id_seq"
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial334 -c \
  "SELECT max(id) FROM spatial_planning.permit_application"
```

Expected: `last_value` >= `max(id)`. If the sequence name differs, find it
with `\ds spatial_planning.*`.

- [ ] **Step 4: Commit the script**

```bash
cd ../app-backend
git add scripts/db-reset-sequences.js
git commit -m "feat(scripts): reset sequences after a data-only restore"
```

---

### Task 7: Verify before cutover

Nothing points at the new database until every check here passes.

- [ ] **Step 1: The corruption is gone**

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial334 \
  -c "SELECT count(*) FROM pg_depend" \
  -c "SELECT count(*) FROM information_schema.columns"
```

Expected: two counts, no error. Both fail on the old database — this is the
headline proof the rebuild worked.

- [ ] **Step 2: The schema matches**

A clean dump of the new database, taken **without** `zero_damaged_pages`,
diffed against the old. This is the real check that nothing was lost.

```bash
"$PGBIN/pg_dump" -h localhost -U postgres -d Vungu_spatial334 \
  --schema-only --no-owner --no-privileges -f "$WORK/schema-new.sql"
diff <(grep -E '^(CREATE|ALTER)' "$WORK/schema-old.sql" | sort) \
     <(grep -E '^(CREATE|ALTER)' "$WORK/schema-new.sql" | sort) \
  > "$WORK/schema.diff"
wc -l "$WORK/schema.diff"
cat "$WORK/schema.diff"
```

Expected: empty diff. Object *names* differing is a failure. Ordering
differences are already removed by the sort.

That this dump needs no `zero_damaged_pages` is itself the proof the new
database is healthy.

- [ ] **Step 3: Every row arrived**

```bash
cd ../app-backend
node scripts/db-row-counts.js "postgresql://postgres:$PGPASSWORD@localhost:5432/Vungu_spatial334" > "$WORK/counts-new.txt"
diff "$WORK/counts-old.txt" "$WORK/counts-new.txt"
```

Expected: exactly one difference —
`public.inspection_bookings ERROR:XX001` becomes `public.inspection_bookings 0`.
Any other difference means rows were lost.

- [ ] **Step 4: Sequences are safe**

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial334 -t -c "
SELECT string_agg(x, E'\n') FROM (
  SELECT format('%s.%s', schemaname, sequencename) AS x
  FROM pg_sequences WHERE last_value IS NULL OR last_value < 1
) s"
```

Expected: empty. Any sequence listed will collide on its next insert.

- [ ] **Step 5: The application boots against it**

```bash
cd ../app-backend
DATABASE_URL="postgresql://postgres:$PGPASSWORD@localhost:5432/Vungu_spatial334" node server.js
```

Expected: listening on :3000 with no startup error. Leave it running for the
next step, then stop it.

- [ ] **Step 6: Tiles still serve**

In another shell, with that server running:

```bash
cd ../app-backend
node test-tiles-endpoint.js
```

Expected: all 8 checks pass. This exercises PostGIS, the GiST indexes and the
layer registry against the new database.

---

### Task 8: Cut over

- [ ] **Step 1: Stop the backend**

Stop any `node server.js` still running.

- [ ] **Step 2: Point the environment at the new database**

Edit `../app-backend/.env` and change the database name on the
`DATABASE_URL` line from `Vungu_spatial333` to `Vungu_spatial334`. Change
nothing else.

```bash
grep -c 'Vungu_spatial334' ../app-backend/.env
```

Expected: `1`.

`.env` is not in git. Record the change in the note below instead.

- [ ] **Step 3: Start the backend and confirm**

```bash
cd ../app-backend && npm run dev
```

Expected: listening on :3000.

- [ ] **Step 4: Confirm through the application**

With the frontend running (`npm run dev`, port 5174), open
`http://localhost:5174/explorer`. Expected: the basemap renders with roads and
landuse — the same 210,240 roads, now from the new database.

- [ ] **Step 5: Confirm the previously-broken route works**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/inspections
```

Expected: `401` (unauthorised), **not** `500`. This route returned a 500 on
the old database because `inspection_bookings` was unreadable. A 401 proves it
now reaches the auth check.

- [ ] **Step 6: Record the rebuild**

Create `../app-backend/docs/db-rebuild-2026-09-21.md`:

```markdown
# Database rebuild, 2026-09-21

`Vungu_spatial333` had two corrupt relations: `pg_depend` (block 121) and
`public.inspection_bookings` (block 0). The first broke `information_schema`,
most DDL and `pg_dump`, so the damage could not be worked around.

Rebuilt as `Vungu_spatial334` by dumping schema and data under
`zero_damaged_pages=on`, restoring into a fresh database, and resetting all
138 sequences. Verified by diffing a clean schema dump of the new database
against the old, and by diffing per-table row counts.

**Nothing was lost.** `inspection_bookings` restored empty; `pg_class` showed
`relpages=0` and `reltuples=-1`, so it had never been populated.

`DATABASE_URL` now points at `Vungu_spatial334`.

## Fallbacks

- `Vungu_spatial333` still exists, untouched. Repoint `DATABASE_URL` to roll back.
- Filesystem copy of the pre-rebuild data directory:
  `C:\vungu-db-backup-2026-09-21`.

Keep both until the system has been tested end to end.

## Still outstanding

`schema_migrations` was carried across as-is and still records only 23 of the
78 migration files. This database is **not** reproducible from
`scripts/migrate.js`: that runner lists 54 of the 78 files, omitting
`000`-`002` and `116`-`122`, and five migration numbers collide. A fresh
Render deploy will not match this schema until the allowlist is reconciled.
```

```bash
cd ../app-backend
git add docs/db-rebuild-2026-09-21.md
git commit -m "docs(db): record the 2026-09-21 rebuild and its fallbacks"
```

---

### Task 9: Confirm the old database is untouched

The fallback is only a fallback if it still works.

- [ ] **Step 1: It still answers**

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial333 -c "SELECT count(*) FROM public.roads"
```

Expected: `210240`.

- [ ] **Step 2: It is damaged exactly as before, and no worse**

```bash
"$PGBIN/psql" -h localhost -U postgres -d Vungu_spatial333 -c "SELECT count(*) FROM pg_depend"
```

Expected: the same `invalid page in block 121` error. Seeing it is the
confirmation that `zero_damaged_pages` never wrote the zeroed page back. A
*successful* count here would mean the damaged page was silently written and
the rows in it are now permanently gone.

- [ ] **Step 3: Do not drop it**

`Vungu_spatial333` and `C:\vungu-db-backup-2026-09-21` stay until the
end-to-end walkthrough passes. Dropping either is a separate decision for the
user, not part of this plan.
