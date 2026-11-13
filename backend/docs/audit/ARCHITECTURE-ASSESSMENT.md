# Architecture Assessment — Finance Module

Date: 2026-11-06
Status: **Final recommendations issued — for Council/ICT decision. No rewrite has been undertaken.**
Scope: the five deviations recorded as F-10 in `SYSTEM_AUDIT_REPORT.md`, assessed against
the code as it exists today. Effort figures are planning estimates for a small team
(1–2 engineers) familiar with the codebase, not quotes.

The purpose of this document is to turn "the system does not match the specification's
architecture" into a set of explicit, costed choices. Choosing to keep a deviation is a
valid outcome; leaving it unrecorded is not.

## Summary

| # | Deviation | Current reality | Recommendation | Effort if remediated |
| --- | --- | --- | --- | --- |
| A1 | Vue instead of Angular | Vue 3.3 SPA, 303 components | **Accept.** Framework choice does not affect the statutory controls | 12–20 person-weeks (rewrite) |
| A2 | JavaScript instead of TypeScript | Frontend is already TypeScript (302/303 components, 359 `.ts` files); backend is mixed (195 `.js`, 53 `.ts`) | **Accept backend JS for now; migrate incrementally, highest-risk modules first** | 6–10 person-weeks (full backend) |
| A3 | `/api` instead of `/api/v1` | All routes registered under `/api` | **Remediate before external integrations**; add `/api/v1` alias | 1–2 person-weeks |
| A4 | Local storage instead of MinIO | Files on local disk under `uploads/`, served through an authenticated route | **Remediate before horizontal scaling or public document delivery at scale** | 2–4 person-weeks |
| A5 | Synchronous processing instead of workers | Imports and report/PDF/XLSX generation run inside the request | **Accept for current volumes; add a queue when import size or concurrency grows** | 3–6 person-weeks |

## A1 — Vue instead of Angular

### Current implementation
- Vue 3.3 SPA with Vite 7, Pinia 2.3, Vue Router and `vue-tsc` (frontend `package.json`).
- 303 single-file components, 302 of them `<script setup lang="ts">`.
- The finance workspace is `src/modules/finance/`, with the public portal at
  `src/modules/finance/pages/CouncilFinanceView.vue`.
- The backend is framework-independent JSON over HTTP; the choice of frontend framework
  does not change any server-side control.

### Advantages of the current choice
- The team already ships and maintains Vue; a rewrite would discard working, tested UI.
- Smaller runtime and simpler mental model than Angular for a council-sized team.
- Vite build and Vitest tests are fast; the finance suite runs in ~2–3 seconds.
- Vue escapes interpolated content by default, which covers the common XSS case.

### Disadvantages
- Diverges from the specification, which named Angular.
- Angular provides a more opinionated dependency-injection, forms and HTTP layer; Vue
  relies more on team convention.
- Fewer built-in security primitives than Angular's DomSanitizer; `v-html` must be
  reviewed manually (the codebase should be checked for it before release).

### Security implications
- Framework choice is not itself a security boundary. The material controls —
  authentication, RBAC, row-level security, publication gating — are server-side and
  unchanged by this decision.
- The real frontend risk is any `v-html` or direct DOM insertion. That is auditable in
  either framework and should be a release checklist item.
- Angular's stricter templating would reduce some classes of mistakes, but it would not
  replace the server-side checks that this system relies on.

### Scalability implications
- None material. Both are client-side SPAs; scaling is determined by the API, database
  and file storage.
- Vue's smaller bundle is marginally better for low-bandwidth council users.

### Estimated remediation effort
- Full rewrite of 303 components and their tests: **12–20 person-weeks**, with a long
  period of dual maintenance and a high regression risk in GIS and finance screens.
- Recommendation: **accept the deviation** and record it. If Council requires Angular,
  commission it as a separate frontend replacement project, not as a finance bug fix.

## A2 — JavaScript instead of TypeScript

### Current implementation
- **Frontend:** effectively already TypeScript. 359 `.ts` files, 302 of 303 `.vue`
  components use `lang="ts"`, and `npm run build` runs `vue-tsc --noEmit` first. The
  earlier audit wording overstated this deviation for the frontend.
- **Backend:** mixed. 195 `.js` files under `src/`, 53 `.ts` files (largely the admin
  area and shared types). The finance routes and migrations are JavaScript/PLpgSQL.
- Runtime validation exists independently of the language: Fastify JSON schemas, Joi,
  and database constraints/triggers.

### Advantages of the current choice
- No build step for the backend; `node server.js` runs the source directly, which suits
  the current deployment.
- Faster iteration and a smaller toolchain; existing tests run without transpilation.
- The controls that matter financially are enforced in SQL (constraints, triggers, RLS),
  not in TypeScript types.

### Disadvantages
- Type errors in backend route payloads and query results are found at runtime or in
  tests rather than at compile time.
- Mixed `.js`/`.ts` makes editor tooling and refactoring less consistent.
- Interfaces between routes and the database are documented by convention and tests, not
  by shared types.

### Security implications
- Types are not a security control. A typed route can still be authorisation-broken.
- Type safety does reduce some input-shape and null-handling bugs that can become 500s or
  logic errors. The existing schema validation already covers the external boundary.
- Migrating to TypeScript would not remove the need for the RBAC/RLS tests.

### Scalability implications
- No runtime difference. Maintainability improves with types as the team and codebase
  grow; that is a people-scaling issue, not a request-throughput one.

### Estimated remediation effort
- Full backend conversion: **6–10 person-weeks**, dominated by route handlers, query
  result typing and test churn. It is not a big-bang prerequisite for go-live.
- Lower-cost intermediate: add `checkJs`/JSDoc to the highest-risk finance modules and
  convert them incrementally. **1–3 person-weeks** for the finance module alone.
- Recommendation: **accept the mixed state for the pilot**, convert finance first if the
  Council wants a typed backend, and do not block acceptance on it.

## A3 — `/api` instead of `/api/v1`

### Current implementation
- Every route is registered with `{ prefix: '/api' }` in `server.js` (public, finance,
  planning, documents, etc.). There is no version segment.
- Clients (the Vue SPA, the QGIS plugin, any script) call `/api/...` directly.

### Advantages of the current choice
- Simple URLs and no client coordination during the pilot.
- No duplicate route surface to maintain.

### Disadvantages
- A breaking change to a payload or route cannot be introduced alongside the old one;
  the only options are coordinated deployment or a flag day.
- External integrations (e.g. a future council data portal or mobile app) have no stable
  contract to pin.
- Deprecation is implicit and undocumented.

### Security implications
- Versioning is not a security control. It does make it safer to retire an insecure or
  over-broad endpoint without breaking every client at once.
- An unversioned public API makes it harder to guarantee that a security fix reaches all
  consumers.

### Scalability implications
- Neutral for throughput. Positive for organisational scalability: multiple clients can
  move at different speeds.

### Estimated remediation effort
- Register the existing route plugins a second time under `/api/v1` and keep `/api` as a
  deprecated alias; add a response header and a deprecation date. **1–2 person-weeks**
  including tests and frontend switch-over.
- Recommendation: **remediate before any external integration**, not necessarily before
  the internal pilot. Low risk, contained change.

## A4 — Local storage instead of MinIO

### Current implementation
- Finance documents are written to
  `uploads/finance-documents/<authority_id>/<subject_kind>/<id><ext>`
  (`src/routes/finance-documents.js`).
- Citizen documents use `uploads/citizen-documents/<userId>/` (`src/routes/documents.js`).
- Files are served by `src/routes/protected-uploads.js`, which requires authentication;
  there are no pre-signed, time-limited URLs.
- `scripts/backup-db.js` zips the whole `uploads/` tree alongside the database.
- Upload controls exist: type/size validation in `src/middleware/fileSecurity.js`, a
  25 MiB limit, and database rows that record visibility and the storage key.

### Advantages of the current choice
- No object-store dependency to operate; the council can run on one server.
- Backup is a single archive next to the database, easy to reason about.
- Access always passes through the application, so the existing auth and audit checks
  apply to every download.

### Disadvantages
- The application is stateful: two app instances behind a load balancer would not see
  each other's files unless they share a volume.
- Disk capacity and durability are the server's problem; a disk failure loses files unless
  the uploads archive was copied off-host.
- No pre-signed URLs, so large downloads consume application workers.
- No lifecycle policy, versioning or server-side encryption at rest beyond the filesystem.
- Restore requires coordinating the database and the `uploads/` archive.

### Security implications
- **Path handling:** `protected-uploads.js` must continue to normalise and confine paths;
  this is the highest-risk area and should be penetration-tested.
- **No signed URLs:** downloads require an authenticated session, which is good for
  private documents but means the app is in the data path for every byte.
- **Malware:** type/size checks are not antivirus scanning. A malicious PDF/XLSX is
  stored and later downloaded by staff. MinIO alone would not fix this; scanning is a
  separate control.
- **Encryption at rest:** local disk encryption is an OS concern; object storage can
  provide server-side encryption and per-object policies.
- **Backup exposure:** the uploads archive contains citizen and finance documents; it
  must be encrypted and access-controlled off-host.

### Scalability implications
- Local storage is the main blocker to horizontal scaling. It also makes zero-downtime
  deploys harder because a new instance needs the same volume.
- MinIO/S3 enables multiple app instances, lifecycle rules and off-host durability.

### Estimated remediation effort
- Introduce an object-store abstraction, migrate existing files, add signed URL
  generation for downloads, update backups and tests: **2–4 person-weeks** plus the
  operational work of running MinIO (TLS, credentials, bucket policy, backup).
- Recommendation: **remediate before horizontal scaling or a multi-council deployment.**
  For a single-server pilot, accept local storage with the existing authenticated download
  route, encrypted off-host backups and a penetration test of the upload/download paths.

## A5 — Synchronous processing instead of asynchronous workers

### Current implementation
- CSV/XLSX import validation and commit run inside the HTTP request
  (`src/routes/finance-imports.js`); commit is one database transaction.
- Report generation, PDF and XLSX rendering run inside the request
  (`src/routes/finance-reports.js`).
- There is an email worker (`src/workers/emailWorker.js`) for notifications, but finance
  imports and reports do not use a queue.
- No BullMQ/Redis job queue is wired into the finance paths.

### Advantages of the current choice
- Simpler correctness story: the request either commits or rolls back; the caller gets
  the result immediately.
- No queue infrastructure, no orphaned jobs, no duplicate-delivery semantics to design.
- Easier to test end to end; the acceptance suite exercises the real path.

### Disadvantages
- A large import or report holds an HTTP connection and a Node worker for its duration.
- Client timeouts or a proxy limit can abort work after the database has already changed
  (particularly for commit, which is transactional but the response may be lost).
- No retry/backoff, no progress polling, no dead-letter queue.
- CPU-heavy PDF/XLSX generation competes with request handling.

### Security implications
- Long-running requests increase exposure to resource-exhaustion attempts; rate limiting
  helps but does not isolate CPU.
- A queue introduces its own security surface (Redis auth, job payloads containing
  financial data, worker permissions). It is not automatically safer.
- Synchronous commit keeps the authorisation check and the write in one request, which is
  simple to audit.

### Scalability implications
- Current volumes (council-scale imports, occasional reports) are well within synchronous
  limits. The design becomes a bottleneck when imports reach hundreds of thousands of
  rows or many users generate reports concurrently.
- Workers allow independent scaling and protect request latency, at the cost of
  operational complexity.

### Estimated remediation effort
- Add a durable queue (e.g. pg-boss on the existing PostgreSQL, or BullMQ/Redis), a
  worker process, idempotency keys, progress endpoints and UI polling: **3–6 person-weeks**
  plus operational runbooks.
- Recommendation: **accept synchronous processing for the pilot**, set a documented row
  and time limit for imports, and revisit when measured volume approaches it. Do not add a
  queue without a worker deployment and monitoring plan.

## Final recommendations (AD-01 – AD-05)

These are the recommendations put to Council and ICT. Each states the decision, the business
justification, the technical/security/scalability implications, the cost or effort, and who must
approve it. Nothing here authorises a rewrite; the default for every item is to keep the working
system and record the deviation.

| ID | Decision | Recommended decision | Cost / effort | Approval owner |
| --- | --- | --- | --- | --- |
| AD-01 | Frontend framework | **Accept Vue.** Do not commission an Angular rewrite | Zero; rewrite would be 12–20 person-weeks | ICT (Council noted) |
| AD-02 | Backend language | **Accept mixed JS/TS for the pilot; convert the finance module incrementally** | 1–3 person-weeks for finance; 6–10 for full backend | ICT |
| AD-03 | API versioning | **Add `/api/v1` as an alias before any external integration** | 1–2 person-weeks | ICT |
| AD-04 | Document storage | **Accept local disk for a single-server pilot; move to object storage before horizontal scaling or multi-council use** | 2–4 person-weeks + operations | Council + ICT |
| AD-05 | Processing model | **Accept synchronous processing with documented row/time limits; add a queue when volume approaches the limit** | 3–6 person-weeks when triggered | ICT |

### AD-01 — Accept Vue as the frontend framework

- **Recommended decision:** accept Vue; record the deviation from the specification's Angular
  requirement. If Council insists on Angular, treat it as a separate frontend replacement
  project, not a finance defect.
- **Business justification:** the Vue SPA is built, tested (66 frontend tests) and maintained by
  the team. A rewrite delivers no new statutory control, no new finance capability and no
  reduction in risk, but consumes 12–20 person-weeks and puts the working finance and GIS
  screens through a high-regression rewrite before go-live.
- **Technical implications:** the backend is framework-independent JSON over HTTP. The choice of
  frontend does not change authentication, RBAC, RLS or publication gating. Vue escapes
  interpolated content by default; any `v-html` or direct DOM insertion must be reviewed as a
  release checklist item.
- **Security implications:** framework choice is not a security boundary. The material controls
  are server-side. Angular's stricter templating would reduce some classes of UI mistake but
  would not replace the server-side checks this system relies on.
- **Scalability implications:** none material. Both are client-side SPAs; scaling is determined
  by the API, database and file storage. Vue's smaller bundle marginally helps low-bandwidth
  users.
- **Cost / effort:** zero to accept. Rewrite: 12–20 person-weeks plus dual maintenance and
  regression risk.
- **Approval:** ICT; Council noted because it changes the specified technology stack.

### AD-02 — Accept mixed JavaScript/TypeScript for the pilot; convert finance incrementally

- **Recommended decision:** accept the current mixed state for the pilot, and convert the
  highest-risk finance modules to TypeScript incrementally (or add `checkJs`/JSDoc first). Do
  not make a full backend conversion a go-live prerequisite.
- **Business justification:** the frontend is already TypeScript (302 of 303 components,
  359 `.ts` files), so the deviation is now mostly a backend one. The financial controls are
  enforced in SQL (constraints, triggers, RLS), not in TypeScript types. A full conversion costs
  6–10 person-weeks and adds test churn without changing what the system does.
- **Technical implications:** type errors in backend payloads and query results surface at
  runtime or in tests rather than at compile time. External input is already validated by Fastify
  schemas, Joi and database constraints. Mixed `.js`/`.ts` makes refactoring less consistent.
- **Security implications:** types are not a security control; a typed route can still be
  authorisation-broken. Types reduce some null-handling and input-shape bugs that can become 500s
  or logic errors, but the RBAC/RLS tests remain the real control.
- **Scalability implications:** no runtime difference. Types improve maintainability as the team
  and codebase grow — a people-scaling issue, not a throughput one.
- **Cost / effort:** finance-module conversion 1–3 person-weeks; full backend 6–10 person-weeks.
- **Approval:** ICT.

### AD-03 — Add `/api/v1` before any external integration

- **Recommended decision:** register the existing route plugins a second time under `/api/v1`,
  keep `/api` as a deprecated alias, add a deprecation header and date, and switch the SPA over.
  This is the one deviation recommended for remediation, and it can wait until an external client
  is planned — but not until after that client is built.
- **Business justification:** a versionless public API means a future breaking change requires a
  coordinated flag-day deployment or breaks every consumer. Adding the alias is cheap now and
  expensive to retrofit once a council data portal, mobile app or third-party integration
  depends on `/api`.
- **Technical implications:** two route surfaces for a transition period, with a documented
  deprecation window. Low-risk, contained change; tests and the frontend switch-over are the bulk
  of the work.
- **Security implications:** versioning is not itself a control, but it makes it safer to retire
  an insecure or over-broad endpoint without breaking every client at once, and helps guarantee a
  security fix reaches all consumers.
- **Scalability implications:** neutral for throughput; positive for organisational scalability
  because multiple clients can move at different speeds.
- **Cost / effort:** 1–2 person-weeks including tests and frontend switch-over.
- **Approval:** ICT.

### AD-04 — Accept local disk for a single-server pilot; move to object storage before scaling

- **Recommended decision:** accept local filesystem storage for a single-server pilot, subject to
  three conditions: authenticated downloads stay in place, backups are encrypted and copied
  off-host, and the upload/download paths are covered by the penetration test. Move to object
  storage (MinIO/S3) before horizontal scaling or a multi-council deployment.
- **Business justification:** a single-server pilot does not need an object store, and running
  MinIO adds TLS, credentials, bucket policy and backup work the council would have to operate.
  Local storage with authenticated downloads is simpler and keeps every access inside the
  application's auth and audit checks. The decision must be revisited before a second app instance
  or a second council.
- **Technical implications:** the application is stateful — two instances would not see each
  other's files without a shared volume. Restore must coordinate the database and the `uploads/`
  archive. There are no pre-signed URLs, lifecycle rules, versioning or server-side encryption
  beyond the filesystem.
- **Security implications:** path normalisation in `protected-uploads.js` is the highest-risk
  area and must be penetration-tested. Type/size checks are not antivirus scanning; a malicious
  PDF/XLSX is stored and later downloaded by staff, so a scanner remains a separate required
  control. The uploads archive contains citizen and finance documents and must be encrypted and
  access-controlled off-host.
- **Scalability implications:** local storage is the main blocker to horizontal scaling and makes
  zero-downtime deploys harder. Object storage enables multiple instances, lifecycle rules and
  off-host durability.
- **Cost / effort:** accept now at zero; object storage 2–4 person-weeks plus operational work.
- **Approval:** Council + ICT (it affects infrastructure, backup and procurement).

### AD-05 — Accept synchronous processing with documented limits; queue when volume grows

- **Recommended decision:** accept synchronous import validation/commit and report generation for
  the pilot, with a **documented row and time limit** for imports and a monitored request
  duration. Revisit when measured volume approaches the limit, or when many users generate
  reports concurrently. Do not add a queue without a worker deployment and monitoring plan.
- **Business justification:** at council-scale volumes the synchronous path is simpler, easier to
  audit and easier to test: the request either commits or rolls back, and the caller sees the
  result. A queue adds infrastructure, orphaned-job and duplicate-delivery semantics that the
  council would have to operate.
- **Technical implications:** a large import or report holds an HTTP connection and a Node worker
  for its duration. A client timeout or proxy limit can abort work after the database has already
  changed. There is no retry/backoff, progress polling or dead-letter queue, and CPU-heavy
  PDF/XLSX generation competes with request handling.
- **Security implications:** long-running requests increase exposure to resource-exhaustion
  attempts; rate limiting helps but does not isolate CPU. A queue introduces its own security
  surface (Redis auth, job payloads containing financial data, worker permissions) and is not
  automatically safer. Synchronous commit keeps the authorisation check and the write in one
  auditable request.
- **Scalability implications:** current volumes are within synchronous limits. The design becomes
  a bottleneck at hundreds of thousands of import rows or heavy concurrent report generation.
  Workers allow independent scaling and protect request latency at the cost of operational
  complexity.
- **Cost / effort:** zero to accept with limits; 3–6 person-weeks for a durable queue, worker,
  idempotency keys, progress endpoints and UI polling, plus runbooks.
- **Approval:** ICT.

## Decision record

| ID | Decision needed | Options | Recommended | Owner |
| --- | --- | --- | --- | --- |
| AD-01 | Frontend framework | Accept Vue / commission Angular replacement | **Accept Vue** | Council + ICT |
| AD-02 | Backend language | Accept JS + incremental TS / full TS migration | **Accept JS + incremental TS** | ICT |
| AD-03 | API versioning | Add `/api/v1` alias now / defer until external client | **Add alias before external integration** | ICT |
| AD-04 | Document storage | Accept local disk with controls / move to MinIO | **Accept local disk for pilot; MinIO before scaling** | Council + ICT |
| AD-05 | Processing model | Accept synchronous with limits / add queue | **Accept synchronous with limits** | ICT |

### What each approval commits the council to

- **AD-01 and AD-02 (ICT):** the delivered stack is accepted as the supported stack; future
  framework/language changes are normal maintenance, not a go-live condition.
- **AD-03 (ICT):** the API will be versioned before any external consumer is onboarded; the
  unversioned `/api` is a temporary internal contract.
- **AD-04 (Council + ICT):** document storage and its backup/encryption obligations are accepted
  for a single-server pilot, with a planned move to object storage before scaling. This is the
  only decision with a direct procurement and backup-policy consequence.
- **AD-05 (ICT):** import and report limits become operational limits, published in the runbook
  and monitored, rather than an unstated assumption.

Until these are signed, the honest status is **functionally implemented, automatically tested,
security-reviewed and performance-verified, with architecture deviations awaiting acceptance** —
not "production-ready".
