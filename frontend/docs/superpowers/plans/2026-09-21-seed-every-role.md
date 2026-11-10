# Seed Every Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every role a populated portal, built around one application traced from lodgement to occupation certificate, so the system can be walked end to end.

**Architecture:** One shared helper module provides tagged, idempotent upserts and `--undo`. A "golden thread" script seeds one complete case across every stage; per-role scripts fill the registers each portal reads. A single runner executes them in dependency order.

**Tech Stack:** Node CommonJS, `pg`, the existing `scripts/seed-*-demo.js` conventions.

**Spec:** `docs/superpowers/specs/2026-09-21-production-test-readiness-design.md`

---

## Before you start

**Depends on `2026-09-21-database-rebuild.md` being complete.** Seeding needs
DDL-adjacent introspection, which the corrupt `pg_depend` blocks. Confirm
first:

```bash
psql -h localhost -U postgres -d Vungu_spatial334 -c "SELECT count(*) FROM information_schema.columns"
```

If this errors, stop — Phase 0 is not done.

**Existing rows are preserved.** The user's 13 users, 28 permit applications
and 48 planning projects stay. Everything this plan writes is new and tagged.

**Follow the house pattern**, set by `scripts/seed-planner-demo.js`: a `TAG`
constant on every written row, a `--undo` flag, one transaction with
`ROLLBACK` on error, and every insert guarded on a natural key so re-running
adds nothing.

### Never guess a column name

The tables below were confirmed to exist, but their columns were not read.
Before writing any `INSERT`, dump the real definition:

```bash
psql -h localhost -U postgres -d Vungu_spatial334 -c "\d+ spatial_planning.stage_inspection"
```

Guessing columns produces a script that fails halfway through a transaction.
Task 1 builds a reference for all of them at once.

---

### Task 1: Column reference for every table to be seeded

**Files:**
- Create: `../app-backend/scripts/db-describe.js`

- [ ] **Step 1: Write the script**

```js
/**
 * Print column definitions for the tables a seed script writes, so nobody has
 * to guess a column name.
 *
 *     node scripts/db-describe.js spatial_planning.stage_inspection ...
 *     node scripts/db-describe.js --empty      # every empty table
 */
const { Client } = require('pg')

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  let tables = process.argv.slice(2).filter(a => !a.startsWith('--'))
  if (process.argv.includes('--empty')) {
    const all = await c.query(`
      SELECT n.nspname || '.' || c.relname AS t FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind='r' AND n.nspname IN ('public','spatial_planning','survey')
      ORDER BY 1`)
    tables = []
    for (const r of all.rows) {
      const n = (await c.query(`SELECT count(*)::int n FROM ${r.t}`)).rows[0].n
      if (n === 0) tables.push(r.t)
    }
  }

  for (const t of tables) {
    const [sch, tbl] = t.split('.')
    const cols = await c.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [sch, tbl])
    if (!cols.rows.length) { console.log(`\n## ${t}\n  (not found)`); continue }
    console.log(`\n## ${t}`)
    for (const r of cols.rows) {
      const req = r.is_nullable === 'NO' && r.column_default === null ? '  REQUIRED' : ''
      const def = r.column_default ? `  default=${r.column_default}` : ''
      console.log(`  ${r.column_name.padEnd(34)} ${r.data_type}${def}${req}`)
    }
    const fks = await c.query(`
      SELECT kcu.column_name, ccu.table_schema||'.'||ccu.table_name AS ref
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2`, [sch, tbl])
    for (const r of fks.rows) console.log(`  FK ${r.column_name} -> ${r.ref}`)
  }
  await c.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
```

- [ ] **Step 2: Generate the reference**

```bash
cd ../app-backend
node scripts/db-describe.js --empty > ~/vungu-rebuild/empty-tables.txt
wc -l ~/vungu-rebuild/empty-tables.txt
```

Expected: several hundred lines covering the 76 empty tables. **Keep this file
open while writing every task below.** Columns marked `REQUIRED` have no
default and reject nulls — every insert must supply them.

- [ ] **Step 3: Commit**

```bash
git add scripts/db-describe.js
git commit -m "feat(scripts): describe table columns for seed authoring"
```

---

### Task 2: Shared seed helpers

Two functions: record what a seed created, and remove exactly that again. No
application table has a tag column of its own, so the ledger is the only
mechanism — there is nothing else to build.

**Files:**
- Create: `../app-backend/scripts/lib/seedkit.js`
- Test: `../app-backend/scripts/lib/__tests__/seedkit.test.js`

- [ ] **Step 1: Write the failing test**

A fake `db` records the queries, so the helpers' behaviour is tested without a
live database. What matters is *which* statements are issued and in what
order — deleting children before parents is the whole correctness question.

```js
const { remember, forget } = require('../seedkit')

/** Records every query; returns `rows` from a queue. */
function fakeDb(results = []) {
  const calls = []
  const queue = [...results]
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text: text.replace(/\s+/g, ' ').trim(), params })
      return queue.shift() || { rows: [], rowCount: 1 }
    },
  }
}

describe('remember', () => {
  it('records the tag, table and id in the ledger', async () => {
    const db = fakeDb()
    await remember(db, 'TAG-A', 'spatial_planning.permit_event', 42)
    expect(db.calls[0].text).toContain('INSERT INTO public.seed_demo_ledger')
    expect(db.calls[0].params).toEqual(['TAG-A', 'spatial_planning.permit_event', '42'])
  })

  it('stores the id as text, so uuid and integer keys both work', async () => {
    const db = fakeDb()
    await remember(db, 'TAG-A', 't', 7)
    expect(db.calls[0].params[2]).toBe('7')
  })

  it('tolerates being run twice', async () => {
    const db = fakeDb()
    await remember(db, 'TAG-A', 't', 1)
    expect(db.calls[0].text).toContain('ON CONFLICT DO NOTHING')
  })
})

describe('forget', () => {
  it('deletes newest first, so children go before their parents', async () => {
    const db = fakeDb([{ rows: [
      { table_name: 'spatial_planning.occupation_certificate', row_id: '9' },
      { table_name: 'spatial_planning.permit_application', row_id: '3' },
    ] }])
    await forget(db, 'TAG-A')
    expect(db.calls[0].text).toContain('ORDER BY id DESC')
    expect(db.calls[1].text).toContain('DELETE FROM spatial_planning.occupation_certificate')
    expect(db.calls[2].text).toContain('DELETE FROM spatial_planning.permit_application')
  })

  it('clears the ledger rows last', async () => {
    const db = fakeDb([{ rows: [{ table_name: 't', row_id: '1' }] }])
    await forget(db, 'TAG-A')
    expect(db.calls.at(-1).text).toContain('DELETE FROM public.seed_demo_ledger')
  })

  it('returns how many rows it removed', async () => {
    const db = fakeDb([
      { rows: [{ table_name: 't', row_id: '1' }] },
      { rowCount: 1 },
    ])
    expect(await forget(db, 'TAG-A')).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ../app-backend && npx jest scripts/lib/__tests__/seedkit.test.js`
Expected: FAIL — `Cannot find module '../seedkit'`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Shared helpers for the seed-*-demo scripts.
 *
 * No application table carries a demo marker of its own, and adding one to
 * each would reshape the domain schema for a testing concern. So a seed
 * records what it created in a side ledger, and --undo removes exactly those
 * rows. Demo data stays distinguishable from the council's real records
 * without the schema knowing demo data exists.
 */

/**
 * Record that a seed script created `id` in `table`.
 *
 * The id is stored as text so integer and uuid keys both work without the
 * caller caring which a table uses.
 */
async function remember(db, tag, table, id) {
  await db.query(
    `INSERT INTO public.seed_demo_ledger (tag, table_name, row_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [tag, table, String(id)],
  )
}

/**
 * Delete everything `tag` created, then the ledger rows themselves.
 *
 * Newest first: the ledger's own insertion order is the dependency order, so
 * reversing it deletes children before the parents they reference. Deleting
 * a parent first would trip a foreign key and abort the transaction.
 */
async function forget(db, tag) {
  const { rows } = await db.query(
    `SELECT table_name, row_id FROM public.seed_demo_ledger
     WHERE tag = $1 ORDER BY id DESC`, [tag])
  let n = 0
  for (const r of rows) {
    const res = await db.query(`DELETE FROM ${r.table_name} WHERE id::text = $1`, [r.row_id])
    n += res.rowCount
  }
  await db.query('DELETE FROM public.seed_demo_ledger WHERE tag = $1', [tag])
  return n
}

module.exports = { remember, forget }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ../app-backend && npx jest scripts/lib/__tests__/seedkit.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/seedkit.js scripts/lib/__tests__/seedkit.test.js
git commit -m "feat(scripts): shared seed helpers with tagging and undo"
```

---

### Task 3: The demo ledger table

`seedkit.remember` needs somewhere to write. Most application tables have no
`demo_tag` column and adding one to each would change the production schema
for a testing concern.

**Files:**
- Create: `../app-backend/migrations/123_seed_demo_ledger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 123_seed_demo_ledger.sql
--
-- Records which rows a seed-*-demo script created, so --undo can remove
-- exactly those and nothing else.
--
-- A side table rather than a demo_tag column on every table: demo data is a
-- testing concern and should not reshape the domain schema. Dropping this
-- table removes the tracking and nothing else.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.seed_demo_ledger (
  id          BIGSERIAL PRIMARY KEY,
  tag         TEXT        NOT NULL,
  table_name  TEXT        NOT NULL,
  row_id      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tag, table_name, row_id)
);

CREATE INDEX IF NOT EXISTS seed_demo_ledger_tag_idx
  ON public.seed_demo_ledger (tag);
```

- [ ] **Step 2: Apply it**

Per the repo's standing rule, apply migration files individually. Do **not**
run the full migration runner — its allowlist is known to be incomplete.

```bash
cd ../app-backend
psql -h localhost -U postgres -d Vungu_spatial334 -f migrations/123_seed_demo_ledger.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`.

- [ ] **Step 3: Record it as applied**

```bash
psql -h localhost -U postgres -d Vungu_spatial334 -c \
  "INSERT INTO schema_migrations (filename) VALUES ('123_seed_demo_ledger.sql') ON CONFLICT DO NOTHING"
```

- [ ] **Step 4: Add it to the runner**

Append `'123_seed_demo_ledger.sql',` to the end of the `MIGRATIONS` array in
`scripts/migrate.js`. The allowlist is incomplete, but adding to it is
still correct — a new migration should not compound the problem.

- [ ] **Step 5: Commit**

```bash
git add migrations/123_seed_demo_ledger.sql scripts/migrate.js
git commit -m "feat(migrations): ledger tracking seeded demo rows"
```

---

### Task 4: The golden thread

One application walked through every stage, so the walkthrough follows a
single case across portals rather than seeing unrelated rows in each.

The thread, in order: a citizen lodges → the clerk acknowledges → public
notice and consultation → an objection → committee agenda and attendance →
determination → permit issued → stage inspections → occupation certificate.

**Files:**
- Create: `../app-backend/scripts/seed-golden-thread.js`

- [ ] **Step 1: Read the columns for every table in the thread**

```bash
cd ../app-backend
node scripts/db-describe.js \
  spatial_planning.permit_application spatial_planning.permit_event \
  spatial_planning.public_notice spatial_planning.application_consultation \
  spatial_planning.application_objection spatial_planning.committee_meeting \
  spatial_planning.committee_member spatial_planning.agenda_item \
  spatial_planning.meeting_attendance spatial_planning.statutory_clock_event \
  spatial_planning.generated_document spatial_planning.permit_document \
  spatial_planning.stage_inspection spatial_planning.inspection_checklist_result \
  spatial_planning.occupation_certificate
```

Note every `REQUIRED` column. The inserts below must supply all of them.

- [ ] **Step 2: Write the script**

Follow `scripts/seed-planner-demo.js` exactly for structure: the dotenv
require, the `Pool` with the Render SSL check, `TAG`, a `seed(db)`, an
`undo(db)`, and the `BEGIN`/`COMMIT`/`ROLLBACK` wrapper at the bottom.

```js
/**
 * seed-golden-thread.js
 *
 * One development application carried through every stage of the statutory
 * workflow, so a tester can follow a single case across every portal instead
 * of finding unrelated rows in each.
 *
 * Citizen lodges -> clerk acknowledges -> notice and consultation -> an
 * objection -> committee agenda and attendance -> determination -> permit ->
 * stage inspections -> occupation certificate.
 *
 * Idempotent: guarded on the application reference.
 *
 *     node scripts/seed-golden-thread.js
 *     node scripts/seed-golden-thread.js --undo
 */

try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }
const { Pool } = require('pg');
const { remember, forget } = require('./lib/seedkit');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/Vungu_spatial334';

const TAG = 'VUNGU-GOLDEN-THREAD';
const REFERENCE = 'TPD1/2026/0900';
```

Then a `seed(db)` that, in order:

1. Finds the citizen: `SELECT id FROM users WHERE email='demo.citizen@vungu.test'`.
   Create the row if absent, matching the shape `scripts/seed-demo-users.js`
   writes (role `registered`).
2. Inserts the `permit_application` on `REFERENCE`, guarded with
   `ON CONFLICT DO NOTHING`, then re-selects the id so a re-run still wires up
   the stages below. Give it a stand and coordinates near the existing demo
   stands — around `lng 29.79, lat -19.46`.
3. Inserts `permit_event` rows, one per transition, with ascending timestamps
   over the past 90 days. These are what the case timeline renders.
4. Inserts one `public_notice`, two `application_consultation` rows (one
   returned, one still outstanding, so the blocking-consultation logic has
   something to show), and one `application_objection`.
5. Adds five `committee_member` rows, attaches an `agenda_item` to the
   earliest existing `committee_meeting`, and records `meeting_attendance`
   for four of the five — enough for quorum, with one absent so the quorum
   calculation is exercised rather than trivially satisfied.
6. Inserts `statutory_clock_event` rows for lodgement and determination, so
   the deadline displays compute against real dates.
7. Inserts the `generated_document` and `permit_document` for the permit.
8. Inserts `stage_inspection` rows for the first three stages of
   `inspection_stage` (which already holds 9), each with
   `inspection_checklist_result` rows — two stages passed, one with a failed
   item, so the flagging path is visible.
9. Inserts the `occupation_certificate`, referencing the permit.

Call `remember(db, TAG, '<table>', id)` after **every** insert.

`undo(db)` is `return forget(db, TAG)`.

- [ ] **Step 3: Run it**

```bash
cd ../app-backend
node scripts/seed-golden-thread.js
```

Expected: a summary line, exit 0. On any error the transaction rolls back and
nothing is left half-written.

- [ ] **Step 4: Verify it is idempotent**

```bash
node scripts/seed-golden-thread.js
psql -h localhost -U postgres -d Vungu_spatial334 -c \
  "SELECT count(*) FROM spatial_planning.permit_application WHERE reference='TPD1/2026/0900'"
```

Expected: `1`. A second row means a guard is missing.

- [ ] **Step 5: Verify undo is complete**

```bash
node scripts/seed-golden-thread.js --undo
psql -h localhost -U postgres -d Vungu_spatial334 -c \
  "SELECT count(*) FROM public.seed_demo_ledger WHERE tag='VUNGU-GOLDEN-THREAD'"
node scripts/seed-golden-thread.js
```

Expected: `0` after undo, then a clean re-seed. This proves the walkthrough is
repeatable.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-golden-thread.js
git commit -m "feat(scripts): seed one application across the whole workflow"
```

---

### Task 5: Building inspector register

The emptiest console: thirteen sections with almost nothing behind them. The
golden thread gives it one case; this gives it a queue.

**Files:**
- Create: `../app-backend/scripts/seed-inspector-register.js`

Named `-register` to avoid colliding with the existing
`seed-inspector-demo.js`, which stays.

- [ ] **Step 1: Read the columns**

```bash
node scripts/db-describe.js \
  spatial_planning.stage_inspection spatial_planning.stage_inspection_photo \
  spatial_planning.stage_inspection_flag spatial_planning.stage_inspection_field_event \
  spatial_planning.inspection_checklist_result spatial_planning.building_plan \
  spatial_planning.building_plan_annotation spatial_planning.building_complaint \
  spatial_planning.occupation_certificate public.inspection_bookings
```

- [ ] **Step 2: Write the script**

`TAG = 'VUNGU-INSPECTOR-REGISTER'`. Same structure as Task 4. Seed:

- Six `stage_inspection` rows across the approved permits that already exist,
  at different stages and outcomes: two passed, two pending, one failed, one
  overdue. The inspector queue sorts by urgency, so it needs a spread.
- Two `stage_inspection_flag` rows against the failed one.
- Four `building_plan` rows with two `building_plan_annotation` rows each.
- Three `building_complaint` rows. **One must be anonymous** — per the spec,
  anonymity is a schema constraint, so an anonymous report must carry no name
  and no number. Seeding one proves the constraint holds.
- Two `inspection_bookings` rows, which exercises the route that was returning
  500 before the rebuild.

Skip `stage_inspection_photo`: photographs are blobs held in IndexedDB on the
device and uploaded from the field. Seeding fake binary rows would
misrepresent how evidence custody works.

- [ ] **Step 3: Run and verify**

```bash
node scripts/seed-inspector-register.js
node scripts/seed-inspector-register.js   # idempotent
psql -h localhost -U postgres -d Vungu_spatial334 -c \
  "SELECT count(*) FROM spatial_planning.stage_inspection"
```

Expected: 6 plus whatever the golden thread added, stable across both runs.

- [ ] **Step 4: Verify the anonymity constraint**

```bash
psql -h localhost -U postgres -d Vungu_spatial334 -c \
  "SELECT reporter_name, reporter_phone FROM spatial_planning.building_complaint WHERE is_anonymous"
```

Expected: nulls in both columns. If the insert succeeded with a name, the
constraint is missing and that is a finding to report, not to work around.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-inspector-register.js
git commit -m "feat(scripts): seed the building inspector register"
```

---

### Task 6: EHO office records

Field registers already hold 1-3 rows each. Every *office record* is empty,
which is half the console.

**Files:**
- Create: `../app-backend/scripts/seed-eho-office.js`

- [ ] **Step 1: Read the columns**

```bash
node scripts/db-describe.js \
  spatial_planning.health_abatement_notice spatial_planning.health_burial_permit \
  spatial_planning.health_food_handler_cert spatial_planning.health_licence_clearance \
  spatial_planning.health_field_programme spatial_planning.health_premises_inspection
```

- [ ] **Step 2: Write the script**

`TAG = 'VUNGU-EHO-OFFICE'`. Seed against the three `health_premises` rows that
already exist:

- Three `health_abatement_notice` rows: one served, one complied, one overdue.
  These are Public Health Act notices and belong to this register — never to
  `/enforcement-orders`, which refuses `env_officer`.
- Two `health_burial_permit`, three `health_food_handler_cert` (one expiring
  within 30 days, so the expiry warning shows), two
  `health_licence_clearance`, two `health_field_programme`.
- Four `health_premises_inspection` rows across the existing premises, with
  different risk ratings so the risk sort is exercised.

- [ ] **Step 3: Run and verify**

```bash
node scripts/seed-eho-office.js
node scripts/seed-eho-office.js
cd ../app-backend && node test-eho-ops-sql.js
```

Expected: stable counts, and the EHO SQL smoke test passes.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-eho-office.js
git commit -m "feat(scripts): seed EHO office records"
```

---

### Task 7: Surveyor, GIS officer and admin

Three thin portals, one script each. Grouped in one task because each is
small.

**Files:**
- Create: `../app-backend/scripts/seed-surveyor-demo.js`
- Create: `../app-backend/scripts/seed-gis-officer-demo.js`
- Create: `../app-backend/scripts/seed-admin-demo.js`

- [ ] **Step 1: Read the columns**

```bash
node scripts/db-describe.js \
  survey.survey_projects survey.surveyors survey.coordinate_points \
  survey.land_parcels survey.zim_control_points survey.workflow_states \
  spatial_planning.survey_parcel spatial_planning.survey_layout \
  spatial_planning.gis_feature spatial_planning.zoning_designation \
  spatial_planning.parcel_owner spatial_planning.spatial_analysis_result \
  public.site_content public.invites public.exchange_rates
```

- [ ] **Step 2: Surveyor** — `TAG = 'VUNGU-SURVEYOR-DEMO'`

Two `survey_projects` linked to the `surveyor_profiles` row that exists, one
`surveyors` row for `demo.surveyor@vungu.test`, twelve `coordinate_points`
forming two closed parcels, four `zim_control_points` with real Zimbabwe
Arc 1950 / UTM 36S values, and `workflow_states` for both projects at
different stages.

Coordinates must be plausible for Vungu RDC (Midlands, around
`lng 29.79, lat -19.46`). Nonsense coordinates put pegs in the sea and make
the map look broken.

- [ ] **Step 3: GIS officer** — `TAG = 'VUNGU-GIS-DEMO'`

Six `gis_feature` rows, four `zoning_designation` rows over existing
`vungu_parcels`, eight `parcel_owner` rows, two `spatial_analysis_result`
rows. Reuse geometries from `vungu_parcels` rather than inventing them, so
everything lands where the basemap already has data.

- [ ] **Step 4: Admin and payments** — `TAG = 'VUNGU-ADMIN-DEMO'`

Six `site_content` rows for the public pages the router serves
(`/about`, `/services`, `/privacy`, `/terms`, `/contact`, and one
`/council/:slug`), two pending `invites`, and three `exchange_rates` (USD,
ZWG, ZAR). The rates matter: eight payments exist with no rate to value them
against.

- [ ] **Step 5: Run all three and verify**

```bash
for s in surveyor-demo gis-officer-demo admin-demo; do
  node scripts/seed-$s.js && node scripts/seed-$s.js || echo "FAILED: $s"
done
```

Expected: no FAILED lines; each runs twice cleanly.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-surveyor-demo.js scripts/seed-gis-officer-demo.js scripts/seed-admin-demo.js
git commit -m "feat(scripts): seed surveyor, GIS officer and admin portals"
```

---

### Task 8: The runner

**Files:**
- Create: `../app-backend/scripts/seed-all-demo.js`

- [ ] **Step 1: Write it**

```js
/**
 * Run every demo seed in dependency order.
 *
 * Users first, because every other script looks up a user by email. The
 * golden thread next, because the per-role scripts attach to the case it
 * creates. Order within the rest does not matter.
 *
 *     node scripts/seed-all-demo.js
 *     node scripts/seed-all-demo.js --undo    # reverse order
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const SCRIPTS = [
  'seed-demo-users.js',
  'seed-golden-thread.js',
  'seed-planner-demo.js',
  'seed-inspector-demo.js',
  'seed-inspector-register.js',
  'seed-eho-office.js',
  'seed-surveyor-demo.js',
  'seed-gis-officer-demo.js',
  'seed-admin-demo.js',
]

const undoing = process.argv.includes('--undo')
const order = undoing ? [...SCRIPTS].reverse() : SCRIPTS
const failed = []

for (const s of order) {
  const label = `${undoing ? 'undo' : 'seed'} ${s}`
  process.stdout.write(`\n=== ${label} ===\n`)
  try {
    execFileSync(process.execPath,
      [path.join(__dirname, s), ...(undoing ? ['--undo'] : [])],
      { stdio: 'inherit' })
  } catch (_) {
    failed.push(s)
    process.stdout.write(`!! ${s} failed; continuing\n`)
  }
}

if (failed.length) {
  console.error(`\n${failed.length} script(s) failed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nAll demo data seeded.')
```

Each script owns its own transaction, so one failing does not corrupt the
others. The runner continues and reports at the end rather than stopping at
the first failure, which would leave the portals half-populated with no
summary of what is missing.

- [ ] **Step 2: Run the whole thing from clean**

```bash
cd ../app-backend
node scripts/seed-all-demo.js --undo
node scripts/seed-all-demo.js
```

Expected: `All demo data seeded.`, exit 0.

- [ ] **Step 3: Confirm the gaps closed**

```bash
node scripts/db-describe.js --empty | grep '^## ' | wc -l
```

Expected: well below the 76 empty tables measured before. Tables still empty
should be ones nothing reads — check each against the code before adding a
seed for it. Seeding a table no component queries is wasted work, and
`development_applications` already proved such tables exist.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-all-demo.js
git commit -m "feat(scripts): one runner for every demo seed"
```

---

### Task 9: Walk every portal

Seeding is not the goal; a testable system is. This task finds what is still
broken.

- [ ] **Step 1: Start both servers**

```bash
cd ../app-backend && npm run dev     # :3000
npm run dev                                   # :5174
```

- [ ] **Step 2: Walk each role**

Sign in as each and visit every section. Password is whatever
`seed-demo-users.js` sets.

| Role | Account | Route |
| --- | --- | --- |
| admin | `demo.admin@vungu.test` | `/admin` |
| planner | `demo.planner@vungu.test` | `/planner` |
| eo | `demo.eo@vungu.test` | `/eo-planner-portal` |
| env_officer | `demo.envoffice@vungu.test` | `/env-officer-workspace` |
| building_inspector | `demo.inspector@vungu.test` | `/inspector-workspace` |
| planning_clerk | `demo.clerk@vungu.test` | `/planning-clerk-portal` |
| surveyor | `demo.surveyor@vungu.test` | `/surveyor-workspace` |
| gis_officer | `demo.gis@vungu.test` | `/gis-officer-portal` |
| viewer | `demo.viewer@vungu.test` | `/explorer` |
| registered | `demo.citizen@vungu.test` | `/citizen` |
| public | signed out | `/`, `/explorer`, `/development-application` |

For each section record one of: **rows** (working), **empty** (renders an
empty state — acceptable), **dead end** (no loading, empty or error state; a
spinner that never resolves; a crash).

- [ ] **Step 3: Write the findings down**

Create `docs/portal-walkthrough-2026-09-21.md` in the frontend repo, one line
per section with its verdict. This is the deliverable that tells the user what
is actually testable, and it becomes the input to the deferred hardening work.

- [ ] **Step 4: Fix the dead ends**

Only dead ends. An empty state is fine and a section with no data is not a
bug. Each fix is its own commit referencing the walkthrough line.

- [ ] **Step 5: Confirm the golden thread is traceable**

Follow `TPD1/2026/0900` across portals: citizen sees it lodged with its
objection; clerk sees the acknowledgement; planner sees it on the committee
agenda; inspector sees its stage inspections; EHO sees the premises. If a
portal cannot find it, the link is missing — fix the seed, not the view.

- [ ] **Step 6: Commit the walkthrough**

```bash
git add docs/portal-walkthrough-2026-09-21.md
git commit -m "docs: portal walkthrough results"
```

---

### Task 10: Final verification

- [ ] **Step 1: Frontend checks**

```bash
npm run type-check                              # expect exit 0
npm run lint                                    # expect only the 3 known errors
npm run test:unit -- --no-file-parallelism      # expect pass
```

- [ ] **Step 2: Backend smoke tests**

```bash
cd ../app-backend
node test-tiles-endpoint.js                     # 8 checks
node scripts/verify-spatial-tables.js
node test-eho-ops-sql.js
```

- [ ] **Step 3: Confirm the whole thing is reproducible**

```bash
node scripts/seed-all-demo.js --undo
node scripts/seed-all-demo.js
```

Expected: clean both ways. Anyone can now reset to a known state, which is
what makes the system testable rather than merely populated.

- [ ] **Step 4: Document how to reset**

Add to the frontend `CLAUDE.md`, under "Local development":

```markdown
### Demo data

Every role has a seeded account and a populated portal. One application,
`TPD1/2026/0900`, runs through the whole workflow so a case can be followed
across portals.

    cd ../app-backend
    node scripts/seed-all-demo.js          # seed or re-seed
    node scripts/seed-all-demo.js --undo   # remove every seeded row

Seeded rows are tracked in `public.seed_demo_ledger`, so `--undo` removes
exactly what was added and leaves the council's real records alone.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: how to seed and reset demo data"
```
