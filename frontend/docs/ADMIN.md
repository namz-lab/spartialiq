# IT Admin role (`role: 'admin'`)

Developer-facing reference for the **council IT Administrator** as it is actually
implemented. If you change `AdminWorkspaceView.vue`, `src/admin/console.ts`,
`router/index.ts`, `src/routes/admin-console.js` or the auth getters, keep this
document in sync.

---

## 1. Who the IT Admin is

The IT Admin is the **council IT desk**, not a planner. They keep the portal
running for everyone else: they provision and de-provision staff accounts, assign
the correct system role to each employee, prove who did what, hold the line on
sign-in security, watch the database and the outgoing mail, and configure the
parts of the portal that are the council's to decide.

They are accountable for **access and configuration**, and explicitly **not** for
any planning decision, case file, or citizen's personal data. The person who hands
out accounts is, by design, not the person who decides development applications —
a deliberate **separation of duties**.

Identity in code:

- `stores/auth.ts` → `isAdmin = (user.value?.role === 'admin')`
- `router/index.ts` → `roleHome('admin')` sends them to `/admin/users`, which
  redirects to `/admin?section=employees`

---

## 2. The console

One route, fifteen sections. The open section and its filters live in the **query
string**, not the path — they are a view of one console, not separate
destinations, and a filtered audit trail has to be a link somebody can paste into
a support thread.

```
/admin?section=audit&severity=high&q=moyo
```

The contract is `src/admin/console.ts` (pure, tested in
`src/admin/__tests__/console.spec.ts`). The Vue bindings are
`src/admin/useAdminConsole.ts`. Read both before changing navigation.

| Group | Sections |
|-------|----------|
| **People & access** | Overview · Employee accounts · Invitations · Roles & permissions · Org structure |
| **Security & audit** | Audit trail · Active sessions · Sign-in security |
| **System & operations** | System health · Email & jobs · Backups · Announcements |
| **Configuration** | System settings · Integrations |
| **This device** | Console preferences |

### Rules that are easy to break

- **`go()` drops section-scoped filters; `setParam()` keeps them.** `status`
  means "suspended" on Employees and "failed" on the outbox — carrying it across
  a section change silently filters the next screen by the last one's idea. The
  owned keys are `SECTION_SCOPED_KEYS` in `console.ts`.
- **`?section=` is omitted against the landing PREFERENCE, not against the
  fallback.** With Sign-in chosen as the landing section, a bare `/admin` means
  sign-in — so `?section=` must be written out for the overview and dropped for
  sign-in, the exact opposite of the default case. Pass the same `landing` value
  to `readSection` and `sectionQuery` or the URL will contradict the screen.
- **Section changes push, filter changes replace.** Typing six characters into a
  search box must not put six entries in the history.
- **Badges are work waiting, never totals.** A rail that says "412" beside
  Employees teaches the admin to stop reading the rail.

### Other `/admin/*` routes

These are substantial consoles of their own and stay on their own paths. The
Integrations section links them and says what each one decides.

| Route | View | Purpose |
|-------|------|---------|
| `/admin` | `AdminWorkspaceView.vue` | The console (above) |
| `/admin/users` | redirect → `/admin?section=employees` | Post-login landing |
| `/admin/content` | `admin/ContentManagementView.vue` | The public council website |
| `/admin/land-use` | `admin/LandUseManagementView.vue` | Zones, groups, development matrix |
| `/admin/gis-symbology` | `admin/GisSymbologyRegistryView.vue` | Published style version per layer (also GIS Officer) |
| `/admin/qgis-plugin` | `admin/QGISPluginView.vue` | The desktop GIS bridge |

### Retired routes (now redirects)

| Route | Was | Why it went |
|-------|-----|-------------|
| `/admin/phase2` | `Phase2View.vue` | Probed four `/api/admin/*/statistics` endpoints that are not registered, over tables (`data_cleaning_jobs`, `qml_style_templates`, `approval_workflows`, `batch_jobs`) that migration 002 declares and no Vungu database has ever had. It reported its own absence on screen. → `?section=health` |
| `/admin/security-dashboard` | `SecurityDashboardView.vue` | Charted `security_audit_log`, a table that has never existed (see §4), and called the own-user `/auth/sessions`. Superseded by the Security sections. → `?section=audit` |
| `/admin/video-tutorials` | `VideoTutorialsView.vue` | Six "tutorials", every one with `videoUrl: null`, illustrated from `via.placeholder.com` — an external CDN this project does not use. The real material is the markdown in `public/`, which Integrations links. → `?section=integrations` |

---

## 3. Backend

`src/routes/admin-console.js` in `../app-backend`, registered under
`/api`. **Every endpoint is `requireAdmin`** — there is no read-only tier, because
the audit trail names who did what, the session list carries addresses, and the
settings carry the lockout policy.

```
GET    /admin/overview                every console counter in one round trip
GET    /admin/audit                   the trail, filtered + paginated
GET    /admin/audit/export            the same query as CSV (capped at 50,000)
GET    /admin/audit/events            the event vocabulary actually present
GET    /admin/sessions                live sessions across ALL users
DELETE /admin/sessions/:id            revoke one
POST   /admin/users/:id/revoke-sessions   sign an officer out everywhere
GET    /admin/login-attempts          sign-in history + lockouts in force
POST   /admin/login-attempts/clear    lift a lockout early
GET    /admin/ip-blocks               POST · DELETE /:id (release)
GET    /admin/settings                PUT (bulk, one transaction)
GET    /admin/permissions             role × capability, from config
GET    /admin/system/health           database, process, host, migrations
GET    /admin/system/tables           row estimates and sizes
GET    /admin/outbox                  POST /:id/retry · POST /:id/cancel
GET    /admin/announcements           POST · PATCH /:id · DELETE /:id (withdraw)
GET    /admin/org                     POST · PATCH /:id · DELETE /:id
GET    /admin/backups                 what is actually on disk
```

Pre-existing, in `src/routes/auth.js`: `GET /admin/users?staff=true`,
`PUT /admin/users/:id`, `POST /admin/users/:id/suspend`,
`DELETE /admin/users/:id` (soft), `POST /admin/users/:id/reset-password`,
`GET /admin/invites`, `DELETE /admin/invites/:id`, `POST /auth/invite`.

Schema: **migration 127** (`127_admin_console.sql`). Smoke test:
`node test-admin-console.js` — 64 checks, requires the server running.

---

## 4. The audit trail, and why it was empty

`src/middleware/auditLog.js` has written an audit row on every mutating request
since it was added. Until migration 127 it wrote **nowhere**, for two independent
reasons, and it failed silently because an audit write must never fail the request
it is auditing.

1. **The table never existed.** Migration 041 declares `security_audit_log`, but
   `security_event_types` in the same file carries `CHECK (severity IN (...))` on
   a column actually named `default_severity`, so the script aborts on the fourth
   `CREATE TABLE`. Its `user_id` columns are also `INTEGER` against a `uuid`
   `users.id`, so even with that fixed the FK could not be created.
2. **The hook was encapsulated.** Fastify encapsulates a plugin by default, so
   `fastify.addHook` inside a plain `async function plugin(fastify)` binds the
   hook to a scope containing no routes. Registered bare, it never fired for a
   single request. It is now wrapped in `fastify-plugin`.

Either one alone was enough. For a planning authority whose permit and enforcement
decisions must be attributable to an officer, this was the most serious gap in the
system.

**`src/middleware/httpCache.js` has the same encapsulation problem** and is still
registered bare — so its `Cache-Control` headers and its response LRU are also
inert. Fixing it would change caching behaviour across the whole API, so it is
recorded here rather than changed as a side effect of admin work.

The smoke test asserts a row actually lands. A catch that cannot fail loudly needs
a test that can.

---

## 5. Sign-in security

- **Lockout is per email address**, counting consecutive failures since that
  address last signed in successfully. A correct sign-in clears the count, so
  there is no counter for anyone to forget to reset. Deliberately not per IP: a
  council office behind one NAT address would otherwise lock out the whole
  planning department when one officer mistypes.
- **The lockout is checked before the password**, so a locked address gets the
  same answer whether or not the guess was right. Otherwise the lockout leaks the
  thing it protects.
- **Every exit records.** `src/services/loginSecurity.js` is called from all six
  failure paths and both success paths; a lockout that missed one would be a
  lockout with a hole in it.
- **Lifting a lockout records a synthetic success**, which both clears the count
  and leaves the failures in place as evidence. Deleting would erase the incident.
- **The blocklist is manual.** Automatic IP banning in front of a shared municipal
  connection locks out the council, not the attacker.

---

## 6. Settings, and the `enforced` flag

`public.admin_setting` marks each key either **enforced** — the server reads it
and behaves differently — or **record only**. The console shows the difference,
because an administrator who switches something off and watches nothing change
will conclude the system is broken.

If you add an enforced setting, **add its call site in the same change** or mark
it `enforced = false`. `src/services/adminSettings.js` is the only reader; its
30-second cache is invalidated on write.

Enforced, and where:

| Key | Bites in |
|-----|----------|
| `security.password_min_length` | `auth.js` — register, invite-accept, change-password, admin reset (all four) |
| `security.max_failed_attempts` · `security.lockout_minutes` | `loginSecurity.js` → `/auth/login`, `/auth/mfa/challenge` |
| `security.session_max_hours` | `jwtAuth.js` → `createSession()` sets `user_session.expires_at` from it |
| `audit.retention_days` | `admin-console.js` → `pruneAudit()`, day-guarded, on the audit listing |
| `system.maintenance_mode` · `system.maintenance_message` | `middleware/maintenanceMode.js` |
| `notifications.email_enabled` · `notifications.outbox_max_attempts` | `workers/emailWorker.js` → `policy()`, read on every poll |

Record-only, and **why** — each of these was marked enforced first and demoted
when it turned out nothing read it, which is the check worth repeating on any
setting you add:

| Key | Why not enforced |
|-----|------------------|
| `security.mfa_required_roles` | Enforcing it needs a "pending enrolment" session — refusing a session outright would lock out precisely the officers who have to sign in to enrol. Enrolment is voluntary today, via `/auth/mfa/setup`. |
| `notifications.sms_enabled` | There is no SMS transport at all. The email switch is enforced because `emailWorker.js` exists and honours it; a switch that claims to stop something that never starts is the lie the flag exists to prevent. |
| `council.*` | Printed on documents. Changing one alters what is printed and nothing else. |

Switching email off **holds** messages as `pending` rather than dropping them; the
queue drains when it is switched back on. Verified end to end.

---

## 7. "Sent" does not mean delivered

The most important thing the **Email & jobs** section says, and the reason it says
it in a standing banner.

`emailWorker.js` selects its transport from `MAIL_TRANSPORT`. On the default
`console` transport it prints each message to the server log and **then advances
the row to `sent`**. So a count of "86 sent" is true of the database and false of
the applicant's inbox — and an administrator answering "were they told?" would
give the wrong answer with complete confidence.

`GET /admin/outbox` therefore returns a `meta.delivery` block —
`{ workerRunning, transport, delivers }` — computed from
`activeTransportName()`, which resolves the same way the worker does (`smtp` only
when `MAIL_TRANSPORT=smtp` **and** `SMTP_HOST` is set **and** nodemailer resolves;
`console` otherwise). The section reports that, and reports the council's
`email_enabled` choice on a **separate line**, because one is the system's state
and the other is the council's intent.

Set `SMTP_HOST` / `MAIL_TRANSPORT=smtp` before relying on any of this as proof an
applicant was notified.

---

## 8. Permissions

The matrix under Roles & permissions is served by `GET /admin/permissions`, built
from `src/config/permissions.js` in the backend. It used to be hand-written in
`AdminView.vue`, separately from the role arrays in the forty-odd route files that
actually decide — two copies of an access rule is one copy plus a lie, and the lie
is the one the admin reads before granting somebody a role.

It is still a **description**: Fastify enforces per route, and no registry can
change that. The console says so and shows the route prefixes behind each
capability so a reviewer can check the claim. It is read-only by design — role
*membership* is the editable thing, on the Employees screen, which is the right
grain for that decision.

### Roles the IT Admin can assign

`planner`, `eo`, `env_officer`, `building_inspector`, `planning_clerk`,
`surveyor`, `gis_officer`, `viewer`, `admin`.

Citizen/system roles (`public`, `registered`, `user`) are issued on
self-registration and **must never be granted here**. They are not merely hidden
from the picker: `EmployeesSection.vue` refuses them on the way to the server as
well, because a hidden option is a UI decision and this is an access-control one.

---

## 9. Why admins are blocked from planning routes

`router/index.ts`:

```ts
const ADMIN_BLOCKED = ['/planner', '/analytics', '/explore', '/layers', '/explorer']
```

An admin navigating to any of these is redirected to `/admin/users`. The rationale:

- **Separation of duties** — account provisioning and planning decisions are
  different jobs and must not collapse into one super-user.
- **Privacy** — those routes surface applicant PII and statutory decision data the
  IT desk has no business reading.

Three things agree on this boundary: `ADMIN_BLOCKED`, the role lists on the
planning routes, and the fact that `src/routes/admin-console.js` cannot reach the
planning record at all. The console has no planning, analytics or map entry at any
width — including the mobile bottom bar.

| Area | IT Admin |
|------|----------|
| Planning cases, submissions, decisions | ❌ Must not |
| GIS / map workspaces | ❌ Must not |
| Planning analytics | ❌ Must not |
| Citizen PII (applications, national IDs, reports) | ❌ Must not |
| Outgoing message **contents** | ❌ Not shown — subject, recipient and outcome answer whether it was delivered |
| Staff accounts, invitations, sessions | ✅ Can |
| Audit trail, sign-in security, blocklist | ✅ Can |
| System health, outbox, backups, announcements | ✅ Can |
| Settings, website content, land-use config, symbology | ✅ Can |

---

## 10. Org structure

`public.admin_org_position` holds **posts, not people**. The Vungu establishment
has vacant posts, and a structure keyed on user accounts cannot represent one —
there is no user row for "GIS Officer, vacant". That is why the chart in
`AdminView.vue` was hardcoded. `holder_id` is nullable; a vacancy is a post nobody
holds.

Each post also carries the system role it *should* have. When the holder's account
carries a different one, the console flags a **role mismatch** — the access
problem an admin is asked to find after somebody says "I can't do my job", and one
that is invisible in a user list sorted by name.

---

## 11. The separate `AdminRole` spatial sub-system

There were two distinct admin concepts in this codebase. The second one —
`AdminRole` (`SUPER_ADMIN` / `DATA_MANAGER` / `STYLE_MANAGER` / `VIEWER`), its
`/admin/login` screen, `stores/admin.ts`, `services/adminService.ts` and
`types/admin.ts` — posted to `/api/admin/auth/login`, an endpoint that does not
exist in this backend, so it could never succeed. The whole chain (1,194 LOC) was
unreachable and has been removed; `/admin/login` is kept as a redirect so old
bookmarks resolve instead of 404ing.

Council IT signs in at `/login` like every other role. Spatial-data operations are
governed by the role lists on the GIS routes and by the symbology registry's own
`STYLE_ADMINS`, not by a second role model.
