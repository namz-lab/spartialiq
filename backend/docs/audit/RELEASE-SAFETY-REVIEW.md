# Release Safety Review

Date: 2026-11-06
Scope: the uncommitted finance work in `Manicipal-drums-backend-3` and
`Manicipal-drums-frontend`, immediately before any staging or commit.
Status: **Review complete. Nothing committed or pushed. Approval required before staging.**

This document records what is in the working tree, what is intended, what is generated or
workstation-only, whether any secret or production data could be exposed, and the exact staging
plan recommended. It is a pre-commit gate, not a substitute for the go/no-go decision in
`PRODUCTION-READINESS-REPORT.md`.

---

## 1. Method

1. Read `git status`, `git diff --stat`, `git diff` and `git ls-files` in both repositories.
2. Classified every modified and untracked path as intended, generated, or workstation-only.
3. Scanned modified and untracked files for credentials, tokens, absolute developer paths and
   local connection strings.
4. Confirmed which databases were written to and that no production data was touched.
5. Checked migrations against `scripts/migrate.js` and `schema_migrations`.
6. Checked ignored artefacts (`backups/`, `uploads/`, `.env`) for accidental inclusion.

---

## 2. Repository snapshot

| | Backend | Frontend |
| --- | --- | --- |
| Branch | `main` | `main` |
| Last commit | `88e9beba` "Firt backend commit" | `aef1a306` "Give staff and citizens the screens…" |
| Tracked files modified | 17 (13 source/docs + 4 under `node_modules/`) | 5 |
| Untracked paths | 34 | 4 paths (28 files) |
| Commits / pushes made | none | none |

Backend modified (intended unless marked):

- `package.json`, `package-lock.json` — adds `jszip`, used by `src/lib/spreadsheet.js`,
  `src/lib/spreadsheet-write.js` and `test/finance-spreadsheet.test.js`.
- `scripts/backup-db.js` — self-verifying dump + SHA-256.
- `scripts/migrate.js`, `scripts/migrate.test.js` — allowlist/pin updated for migrations 188–194.
- `scripts/seed-demo-users.js`, `scripts/test-suites.js` — finance users and suite wiring.
- `server.js` — registers the finance route plugins.
- `src/config/permissions.js` — finance permission catalogue.
- `src/middleware/auditLog.js` — structured before/after audit detail.
- `src/routes/auth.js` — seven finance roles added to the invitable/valid role sets.
- `test/helpers/buildApp.js` — optional `poolMax` for the load harness.
- `docs/OPERATIONS_RUNBOOK.md` — backup verification, checksum and restore drill.

Frontend modified: `scripts/seed-gis-style-registry.mjs`, `src/router/index.ts`,
`src/router/__tests__/route-roles.spec.ts`, `src/services/types.ts`, `src/views/QGISMapView.vue`
(type-only `satisfies` fix).

---

## 3. Untracked files — what to commit and what not to

### 3.1 Backend — intended for the release

| Path | Purpose |
| --- | --- |
| `migrations/188`–`194_*.sql` | Finance schema, reporting, year consistency, closed-year links, exchange-rate dormancy, publication-policy performance |
| `migrations/137_parcel_accuracy_basis.sql` | **Pre-existing drift, but required.** `scripts/migrate.js:137` and `scripts/migrate.test.js:96` list it; the file was never committed, so a fresh database fails at 174, which uses the column. It is idempotent and already applied locally |
| `src/lib/{finance,spreadsheet,spreadsheet-write,report-pdf}.js` | Money/query helpers, XLSX reader/writer, PDF rendering |
| `src/middleware/financePermissions.js` | Permission guards |
| `src/routes/finance-*.js` (9 files) | Budget, config, documents, imports, projects, publication, public, reports, users |
| `src/routes/__tests__/finance.{acceptance,security,workflow}.test.js` | The 29 + 33 + 9 suites |
| `test/finance-*.test.js`, `test/helpers/pdf-text.js` | 71 backend unit tests |
| `scripts/load-test-finance.js`, `scripts/seed-load-dataset.js`, `scripts/verify-restore.js` | Load harness, guarded seeder, restore verifier |
| `docs/audit/` (13 files) | This audit set, including this review |

### 3.2 Frontend — intended for the release

- `src/modules/finance/` — 25 files: API client, guard, year picker, money composable, types,
  `FinanceWorkspace.vue`, `CouncilFinanceView.vue`, 12 section components, store, 3 specs.
- `docs/finance/` — `REQUIREMENTS.md`, `COUNCIL-DECISIONS.md`, the impact/gap note.

### 3.3 Do **not** commit — workstation-only

| Path | Why |
| --- | --- |
| `Manicipal-drums-frontend/vite.config.run.ts` | Header says "TEMPORARY … Delete this file; it is not part of the project." It exists only because the workstation hit the inotify watcher limit. Nothing references it |
| `Manicipal-drums-frontend/VUNGU_RDC_CLAUDE_CODE_PROMPT.md` | Untracked agent prompt containing absolute `/home/<user>/...` paths. It is not product documentation |

If either is staged, remove it before commit. Neither is needed by the build or the tests.

---

## 4. Generated and accidental changes

### 4.1 `node_modules` is tracked — the one real packaging problem

`.gitignore` lists `node_modules/`, but **11,928 files under `node_modules/` are already
tracked** from the initial commit. Git therefore reports:

- `node_modules/.package-lock.json` modified by the `jszip` install;
- `node_modules/@esbuild/win32-x64/{README.md,esbuild.exe,package.json}` deleted, because a
  Linux `npm install` pruned the Windows-only binary.

These four entries are **not** part of the finance change. Staging them would:

- add install noise to the release diff;
- remove a Windows esbuild binary from the repository, which would break `npm install`/esbuild
  on a Windows checkout that relies on the committed copy.

Recommended handling:

1. **Do not stage `node_modules/` in this release.** Use explicit paths (§6).
2. Treat "stop tracking `node_modules`" as a separate, deliberate change: `git rm -r --cached
   node_modules`, confirm a clean `npm ci` reproduces the tree, and commit that on its own.
   That is a repository-hygiene decision, not part of the finance feature.

`package.json`/`package-lock.json` **are** intended: `jszip` is a real runtime and test
dependency, and the lockfile diff is the expected 268-line addition.

### 4.2 Local artefacts that are correctly ignored

| Artefact | Size | Status |
| --- | --- | --- |
| `backups/db-20261106-*.dump` (2 files) | ~709 MB each | Ignored (`backups/`). Contain local `vungu_dev` data — **never commit, never copy to a shared location unencrypted** |
| `backups/db-*.dump.sha256` | 90 B | Ignored; verification sidecar |
| `backups/uploads-*.zip` | 81 KB | Ignored; local uploads archive |
| `.env` | — | Ignored (`.gitignore:11`); not staged |

The dumps are large and contain real-looking records. They are working artefacts; the
release must not include them, and the workstation should treat them as sensitive.

---

## 5. Secrets and environment

- **No secret was found in any modified or untracked source file.** A scan for
  `password|secret|api_key|token = '…'` across `docs/audit`, the new scripts, migrations and
  the frontend module returned no hits beyond `process.env` references, placeholders and test
  fixtures.
- `.env` is **untracked and ignored**, and its `DATABASE_URL` points at
  `localhost:5432/vungu_dev` — not a remote or production host.
- `.env` nevertheless has **populated** `JWT_SECRET` and `PAYNOW_INTEGRATION_KEY` fields (and a
  placeholder-like `ANTHROPIC_API_KEY`). It must stay out of git. If this workstation is shared
  or its disk is not encrypted, rotate those values before the pilot.
- `.env.example` and `.env.production.example` contain placeholders only
  (`replace-with-48-byte-random-base64-secret`, `sk-ant-your-key-here`, `0x...`). They are safe
  to commit and are unchanged.
- The new load/seed scripts default to test database names and **refuse a database whose name
  does not contain "test"** unless `ALLOW_NON_TEST_DB=1` is set
  (`scripts/seed-load-dataset.js:24-28`). `scripts/load-test-finance.js` uses
  `DEMO_DEFAULT_PASSWORD` with a local demo fallback and reads `DATABASE_URL` from the
  environment.
- `docs/audit` was sanitised before this review: absolute developer home paths are replaced with
  `<backend-repo>`, `<frontend-repo>` and `<reference-repo>`, and local connection strings with
  `postgresql://<user>:<password>@localhost:5432`.

---

## 6. Migrations

| Check | Result |
| --- | --- |
| Migrations 188–194 present and listed in `scripts/migrate.js` | Yes |
| `scripts/migrate.test.js` pin matches the plan | Yes (71/71 unit tests pass) |
| Migration 137 present and listed | Yes — required by 174; previously never committed |
| Applied on `vungu_dev` | Yes — 127 migrations recorded, latest 194 |
| Applied on `vungu_acceptance_test` | Yes — 194 recorded |
| Applied on `vungu_workflow_test` (load DB) | Yes — 194 recorded; 30 finance tables |
| Ordering | 137 before 188–194; 190 refuses to enforce if live cross-year violations exist (documented in the deploy checklist) |
| Destructive statements | None — 188–194 create/extend; 194 replaces policies only; 137 is `ADD COLUMN IF NOT EXISTS` + idempotent `DO` block |

**Do not omit `137_parcel_accuracy_basis.sql`.** Without it, a clean checkout cannot run
`npm run migrate` past 174. It is unrelated to finance but is a prerequisite the plan already
assumes.

---

## 7. Data safety

- **No production database was touched.** All writes went to `vungu_acceptance_test`,
  `vungu_workflow_test` and `vungu_restore_test`. `vungu_dev` was used for read-only inspection
  and to apply migrations locally.
- The load dataset is synthetic (`LOAD-` prefix) and isolated in `vungu_workflow_test`.
- The restore drill targeted `vungu_restore_test`, not a live database.
- Backup dumps were written to the ignored `backups/` directory, not to the repository.
- No `.env`, credential file, database dump or `uploads/` content is staged or tracked.

---

## 8. Recommended staging plan

Stage explicit paths, never `git add -A` or `git add .`, so the tracked `node_modules` churn and
the two workstation-only frontend files are excluded.

Backend:

```bash
cd <backend-repo>

git add \
  migrations/137_parcel_accuracy_basis.sql \
  migrations/188_finance_foundation.sql \
  migrations/189_finance_project_reporting.sql \
  migrations/190_finance_transaction_line_year.sql \
  migrations/191_finance_document_year.sql \
  migrations/192_finance_closed_year_project_links.sql \
  migrations/193_finance_exchange_rate_dormant.sql \
  migrations/194_finance_public_query_performance.sql \
  src/lib/finance.js src/lib/spreadsheet.js src/lib/spreadsheet-write.js src/lib/report-pdf.js \
  src/middleware/financePermissions.js \
  src/routes/finance-*.js \
  src/routes/__tests__/finance.acceptance.test.js \
  src/routes/__tests__/finance.security.test.js \
  src/routes/__tests__/finance.workflow.test.js \
  test/finance-primitives.test.js test/finance-spreadsheet.test.js \
  test/finance-pdf.test.js test/finance-roles.test.js test/helpers/pdf-text.js \
  scripts/load-test-finance.js scripts/seed-load-dataset.js scripts/verify-restore.js \
  docs/audit/ docs/OPERATIONS_RUNBOOK.md \
  package.json package-lock.json \
  scripts/backup-db.js scripts/migrate.js scripts/migrate.test.js \
  scripts/seed-demo-users.js scripts/test-suites.js \
  server.js src/config/permissions.js src/middleware/auditLog.js src/routes/auth.js \
  test/helpers/buildApp.js
```

Frontend:

```bash
cd <frontend-repo>

git add \
  src/modules/finance/ docs/finance/ \
  scripts/seed-gis-style-registry.mjs \
  src/router/index.ts src/router/__tests__/route-roles.spec.ts \
  src/services/types.ts src/views/QGISMapView.vue
```

Then confirm the staged set before committing:

```bash
git diff --cached --name-only | grep -E '^(node_modules/|\.env|backups/)'   # must print nothing
git diff --cached --stat
```

Frontend must **not** stage `vite.config.run.ts` or `VUNGU_RDC_CLAUDE_CODE_PROMPT.md`.

---

## 9. Pre-commit checklist

- [ ] Backend staged set excludes `node_modules/` (all four entries) and `.env`.
- [ ] Frontend staged set excludes `vite.config.run.ts` and `VUNGU_RDC_CLAUDE_CODE_PROMPT.md`.
- [ ] `migrations/137_parcel_accuracy_basis.sql` is included.
- [ ] `git diff --cached --name-only | grep -E '^(node_modules/|\.env|backups/)'` prints nothing.
- [ ] Re-run the finance suites from `TEST-RESULTS.md` on the staged tree (71 / 29 / 33 / 9 / 66).
- [ ] Confirm no `backups/` dump or `uploads/` archive is referenced by a committed path.
- [ ] Confirm `package-lock.json` contains only the `jszip`/`pako` additions.
- [ ] Get explicit approval before `git commit`; get separate approval before `git push`.

---

## 10. Residual release risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| `node_modules` tracked | Any `npm install` produces a dirty tree and can silently remove platform binaries from the repo | Do not stage it now; schedule `git rm -r --cached node_modules` as a separate change |
| Migration 137 untracked | Clean checkout cannot migrate past 174 | Include it in this release (it is already in the plan) |
| 709 MB local dumps | Accidental inclusion or copying of local records | `backups/` is ignored; verify before commit; copy off-host encrypted only |
| Populated `.env` secrets | Workstation compromise exposes JWT and payment keys | File is ignored; rotate if the workstation is shared; never commit |
| Workstation-only frontend files | Committing a temporary polling config or an agent prompt with home paths | Explicit staging plan; verify staged list |
| No commit yet | Nothing is recoverable from history if the workstation is lost | Commit promptly after approval; keep the working tree until then |

---

## 11. Conclusion

The working tree is **coherent and safe to stage with explicit paths**. The finance changes,
migrations, tests, tooling and audit documents belong together. Three things must be kept out:
the tracked `node_modules` churn, the two workstation-only frontend files, and the ignored
local artefacts (`.env`, `backups/`, `uploads/`). Migration 137 must be included even though it
predates this work, because the migration plan already depends on it.

No production data was modified, no secret is present in a stageable file, and nothing has been
committed or pushed. Release-safety review is complete; the next action requires approval.
