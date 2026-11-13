# Security Audit

Date: 2026-11-06
Scope: finance module authentication, authorisation, data exposure, uploads, audit and database controls.
Method: static review of code and migrations, the executed finance acceptance tests, and a 33-test adversarial security suite (`src/routes/__tests__/finance.security.test.js`, see `SECURITY-TEST-EVIDENCE.md`). No external penetration test was performed.

## 1. Controls verified

### 1.1 Authentication and session
- Protected finance routes run `authenticate()` through `requirePermission`/`requireAnyPermission` (`src/middleware/financePermissions.js:126-186`).
- Public routes use `optionalAuth` so a signed-in officer sees the public surface as a resident does (`src/routes/finance-public.js:46-48`).
- Failed authentication and refused mutations are recorded by the global audit hook (`src/middleware/auditLog.js`).
- Passwords use bcrypt in the existing auth routes (not re-audited here).

### 1.2 Permission model
- Permissions are catalogue codes (`finance.permission`), defaults per role (`finance.role_permission`), per-user overrides (`finance.user_permission_override`) and department scopes (`finance.user_scope`). Routes ask for a permission, not a role list.
- Deny overrides win; expired overrides do not count (`financePermissions.js:44-71`).
- System administration holds no approval, publication, import-commit or restricted-data permission by default; the migration asserts this and fails if a role ever holds both approval and publication (`migrations/188_finance_foundation.sql:1235-1253`).
- Finance role names are now accepted by the application registry (this audit's `F-01` fix).

### 1.3 Separation of duties
- Approval and publication are distinct permissions; no seeded role holds both.
- A revision requester cannot approve their own revision; enforced in the route and by a database CHECK on `decided_by <> requested_by`.
- Publication records must carry both approver and publisher before reaching `published` (`migrations/188_finance_foundation.sql:709-712`).

### 1.4 Public exposure
- Public reads are governed by `published_select` RLS policies, each requiring a live `finance.publication` row for the relevant year/dataset (`migrations/188_finance_foundation.sql:1414-1546`). Migration 194 rewrote the same predicates as uncorrelated set membership for performance; the rows visible are unchanged, and withdrawal is still immediate because nothing is materialised.
- `finance.v_published_transaction` does not select `counterparty_ref`/`counterparty_name`; the fields cannot leak through a route projection (`migrations/188_finance_foundation.sql:950-979`).
- Documents are private on upload; only a publisher can change visibility, and the public policy additionally requires the documents dataset to be published (`finance-documents.js:165-181`, migration policy at `1534-1541`).
- Withdrawing a publication removes public visibility without deleting records; acceptance test confirms this.
- Public budget lines require both the budget dataset publication and the line's own `published` status, so releasing a budget does not sweep up drafts.

### 1.5 Upload and document security
- Size limit 25 MiB, one file, MIME allow-list (`finance-documents.js:38-45,91-97`).
- Content is checked by file signature, not only the claimed MIME type; XLSX is checked for ZIP magic (`finance-documents.js:125-134`).
- Malware scanning runs before the file is written (`finance-documents.js:136-141`).
- SHA-256 checksum is stored and re-verified on download; a mismatch returns 409 instead of serving altered bytes (`finance-documents.js:143,273-279`).
- Object keys are generated server-side and read from the database row, so the request never supplies a filesystem path (`finance-documents.js:155-163,240-249`).
- Downloads set `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store` for non-public documents (`finance-documents.js:280-285`).

### 1.6 Audit
- `public.admin_audit_event` is append-only via a trigger (`migrations/132_gis_core_register.sql:334-348`).
- Mutating finance requests are classified by prefix, with publication/revision/import at `critical` (`src/middleware/auditLog.js:65-91`).
- Refused attempts are recorded with their HTTP status, so a 403 on publication is visible.
- Finance audit search/export requires `finance.audit.view`/`finance.audit.export`; the query is read with `systemOf` so the trail is not filtered by the reader's own RLS (`finance-reports.js:482-596`).

### 1.7 Application hardening present
- Helmet, CORS, compression, rate limiting and multipart limits are registered in `server.js`.
- SQL uses parameterised queries throughout the inspected finance routes; dynamic sort columns are selected from a fixed map, not interpolated from user input (`finance-public.js:184`, `293`).
- Error responses use a consistent `{ success, error, message }` shape and do not include stack traces in the inspected handlers.
- Sensitive export requires `finance.report.export_restricted` on top of export permission; the filename is marked `RESTRICTED`.

## 2. Findings

### 2026-11-07 — S-03: cross-tenant read through the published_select policies (Critical, FIXED)

Live two-council probing (a second authority created, a finance officer of it signed in through
the real API) found that migration 194's `published_select` policies matched ANY session: the
other council's officer saw Vungu's published financial year in their staff workspace and the
classifications behind published data. Reads only — `tenant_write` still confined writes — but
the staff surface must not list another council's rows.

Fix: migration `197_published_select_public_session_only.sql` — the same set-based published
conditions, guarded per-table by `(app.authority_id() IS NULL OR app.is_platform() OR
authority_id = ANY (app.visible_authorities()))`. No tenant policy weakened; one narrowed.

Verification (live, all four cells):
- other council's finance officer: 0 years, 0 departments visible (was 1 and 1)
- anonymous public portal: unchanged — year, published budget line and transaction all served
- Vungu's own staff: unchanged
- signed-in citizen (authority NULL → public session): unchanged

Regression: `test/finance-cross-tenant.test.js` (4 tests) — public sees published, own council
sees own, other council sees neither, an unpublished year was never public. The full suite
(55/602) and acceptance (8/78) re-ran green.

Also verified 2026-11-07, by suite evidence rather than new work: authentication/session
management, finance RBAC and duty separation, closed-year write refusal (A9), audit of refused
actions, public/private separation (A7) — all in `finance.security` (33 tests) and
`finance.acceptance` (29 tests), both green on a freshly migrated database.

The original findings from the 2026-11-06 audit follow.

| ID | Severity | Finding | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| S-01 | ~~High~~ **Closed** | No finance-specific access-administration API/UI; overrides and scopes require direct SQL | Closed 2026-11-05: `src/routes/finance-users.js` and `AccessSection.vue` provide list/read/replace; self-edit refused; before/after audited | — |
| S-02 | ~~Medium~~ **Closed** | `finance.users.manage_finance_roles` is not enforced | Closed 2026-11-05: all three access endpoints use `requirePermission(fastify, 'finance.users.manage_finance_roles')`; F-02 proves a non-holder gets 403 | — |
| S-03 | ~~Medium~~ **Closed (test instance)** | No demonstrated restore of database/object storage | Closed 2026-11-06: isolated restore to `vungu_restore_test` passed with 0 mismatches (126 migrations, 26 finance tables, 4 views, 31 triggers, all row counts); 190/190 uploads hash-identical; backup 103.41 s, restore 65.35 s. See `BACKUP-RESTORE-EVIDENCE.md` | Off-host DR rehearsal still required for operational RTO/RPO |
| S-04 | Medium | No signed, time-limited document URLs; local filesystem storage | `finance-documents.js:34-36,240-286` | Accept the deviation or move to MinIO with short-lived signed URLs |
| S-05 | Medium | No dedicated CSRF review for cookie-based sessions | `@fastify/cookie` registered; auth mechanism not fully re-audited | Confirm token storage/CSRF strategy with a targeted test |
| S-06 | Medium | Import/report work is synchronous; large jobs can exhaust a request/worker | `finance-imports.js`; `finance-reports.js` | Add worker/queue or enforce strict file/row limits and timeouts |
| S-07 | ~~Low~~ **Closed** | Public documents list is unpaginated | Closed 2026-11-06: migration 191 derives `document.financial_year_id`; `finance-public.js` accepts year/dataset/subject/type/search/sort/limit/offset, returns `total`, and the panel pages the list | — |
| S-08 | ~~Low~~ **Closed** | Public overview hardcodes council identity | Closed 2026-11-06: the overview reads `public.local_authorities.authority_name` | — |
| S-09 | ~~Low~~ **Closed** | Named public-exposure test does not exist | Closed 2026-11-06: the stale comment now cites the acceptance public-exposure/withdrawal tests that assert the property; no duplicate test added | — |
| S-10 | ~~Low~~ **Closed** | Audit details did not consistently capture before/after values | Closed 2026-11-06: publication approve/reject/publish/withdraw, budget-revision approve/reject and import commit now attach structured before/after through `req.auditDetails`; access changes already did | — |
| S-11 | ~~High~~ **Closed** | Public read path was a denial-of-service surface at realistic volume: per-row RLS policy made public queries take seconds and return 500s under load | Closed 2026-11-06: `migrations/194_finance_public_query_performance.sql` rewrites every publication policy as an uncorrelated set-membership test and short-circuits tenant policies for anonymous sessions. Public view count fell from ~3,064 ms / 990,720 buffers to 68.5 ms / 3,639 buffers. 32 load runs at 2k–50k × c1–c50: **0 HTTP 500, 0 timeouts**. Visibility re-verified on the 20k dataset. See `PERFORMANCE-TEST-EVIDENCE.md` §4 and §8 | — |

## 3. Positive security evidence from tests

Acceptance suite:

- A7: an approver cannot publish, a publisher cannot approve, and the refusal is audited.
- Public transaction JSON does not contain supplier names or source lineage.
- A private document is not served to an anonymous caller; a public document is served only while the documents dataset is published.
- Checksum mismatch is refused rather than served.
- Closed-year writes are refused by the database trigger even when the API is bypassed.
- A departmental head cannot read another vote.

Security suite (33 tests, `SECURITY-TEST-EVIDENCE.md`):

- Missing, malformed, wrong-secret, expired, session-less and wrong-type tokens are all refused; logout revokes the session immediately.
- The role/permission matrix holds: a planner and an auditor can read but not write; a budget officer cannot approve; a publisher cannot approve a publication; the committee cannot publish; a caller with no finance role gets 403.
- Administrative routes are closed to anonymous callers, while the public surface is open and does not reveal unpublished years.
- SQL-injection payloads in search and filter parameters are treated as literal text; closed-set parameters reject out-of-enum values.
- A renamed executable and a file whose bytes contradict its MIME type are rejected; a valid PDF is stored private and not served anonymously; traversal and other-user paths are refused.
- `vungu_app` cannot insert, update or delete audit rows, and the guard trigger is present; refused mutations appear in the trail.

## 4. Residual risk statement

The design is unusually strong for an internal council system: database-enforced publication,
append-only audit, least-privilege finance roles and real separation of duties. The
access-administration, public-surface, audit-detail and availability findings (S-01/S-02,
S-07-S-11) are closed with tests and measurements, and the restore finding (S-03) is closed on
a test instance.

The residual risk is now concentrated in:

- **Operations:** off-host DR rehearsal, monitoring and alerting are still absent.
- **Storage and sessions (S-04/S-05):** local filesystem without signed URLs; CSRF strategy not
  adversarially tested.
- **Synchronous jobs (S-06):** large imports/reports hold a request worker.
- **No external adversarial engagement:** the 33-test suite covers known classes; a short
  penetration test focused on authentication, document download, import upload and public
  endpoints is still recommended before go-live.

### 4.1 Security effect of the performance fix (S-11)

Migration 194 is a policy-shape change, not a relaxation. The publication and tenant models are
unchanged, and the following were re-verified on the 20,000-transaction load dataset as
`vungu_app` with anonymous settings:

- `finance.v_published_transaction` still exposes no supplier/counterparty columns.
- Withdrawing the expenditure publication leaves revenue only (6,667 of 20,000 rows).
- Withdrawing all publications leaves 0 transactions, 0 years and 0 accounts.
- Currency separation is preserved (USD 16,667 / ZWG 3,333).
- A direct database client mapped through `tenancy.role_authority` still sees exactly its
  authority's rows, with `app.authority_id` and `app.platform` unset — the anonymous
  short-circuit does not affect the direct-client path.
- `app.is_platform()` still refuses a mapped direct-client role; a client cannot claim platform
  access by setting `app.platform`.

No route, grant or table access was added. The public portal still reads
`finance.v_published_transaction` through `vungu_app` under the same policies.
