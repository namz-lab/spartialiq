# Security Test Evidence — Finance Module

Date: 2026-11-06
Suite: `src/routes/__tests__/finance.security.test.js`
Database: `vungu_acceptance_test` (isolated; no production data)
Result: **1 suite passed, 33 tests passed**
Harness: real Fastify app, real JWT/session middleware, real PostgreSQL with row-level
security, real multipart parsing and file-signature checks. Fixtures are tagged and removed
in `afterAll`.

This document records what the adversarial suite actually proves. It does **not** replace a
penetration test; see §4.

## 1. How to reproduce

```bash
cd <backend-repo>
DATABASE_URL='postgresql://<user>:<password>@localhost:5432/vungu_acceptance_test' \
  node node_modules/jest/bin/jest.js \
  src/routes/__tests__/finance.security.test.js \
  --runInBand --testPathIgnorePatterns='/node_modules/'
```

The suite creates an unpublished financial year, a department, one expenditure account and
one budget line, then attaches a real transaction and a real private PDF. It asserts what
each caller **cannot** do, complementing the acceptance suite, which proves the controls work
for authorised users.

## 2. Controls exercised

### 2.1 Authentication and session management (7 tests)

| Assertion | Result |
| --- | --- |
| Protected finance route with no credentials | 401 `unauthenticated` |
| Malformed token (`not-a-jwt`) | 401 |
| Token signed with the wrong secret | 401 |
| Expired token | 401, message names expiry |
| Token with no `sid` (stateless token) | 401, message names session |
| Refresh token used as an access token | 401, message names token type |
| Logout revokes the session immediately | access token 200 before logout, 401 after |

The session-id check is the control that makes logout real: a valid signature alone is not
enough, and a token cannot be used after its server-side session is revoked.

### 2.2 Role and permission enforcement (7 tests)

| Assertion | Result |
| --- | --- |
| Caller with no finance role reads the budget register | 403 |
| Planner reads but cannot prepare a budget line | 200 read / 403 write |
| Auditor reads but cannot prepare a budget line | 200 read / 403 write |
| Budget officer prepares but cannot approve | 403 `finance.budget.approve` |
| Publisher cannot prepare a budget or approve a publication | 403 / 403 `finance.publication.approve` |
| Committee approves but cannot publish | 403 `finance.publication.publish` |
| A refused action is audited with status and actor role | one `FIN_PUBLICATION` row, status 403, actor role `publisher` |

The matrix demonstrates least privilege and separation of duties at the route layer, not only
in the role table.

### 2.3 API access restrictions and public separation (5 tests)

| Assertion | Result |
| --- | --- |
| Administrative routes closed to anonymous callers | 401 on budget lines, publications, audit and documents |
| Public transparency surface open without a session | 200 for years; 404 for an unknown year; 200 with zero rows for an unknown year's transactions |
| Unpublished year absent from the public year selector | not present |
| Unpublished budget and transaction data not visible publicly | overview 404; transaction total 0 |
| `v_published_transaction` has no counterparty identity columns | `counterparty_name`/`counterparty_ref` absent |

The public surface does not confirm the existence of an unpublished year: an unknown year and
an unpublished year both return 404 on the overview. That avoids an existence oracle.

### 2.4 SQL injection protection (4 tests)

Payloads used: `' OR 1=1 --`, `'; DROP TABLE finance.transaction; --`,
`%' UNION SELECT NULL --`.

| Assertion | Result |
| --- | --- |
| Public search `q` treats payloads as literal text | 200, zero rows, table intact |
| Public `department_code`/`account_code` treat payloads as literal text | 200, zero rows |
| Administrative search `q` is parameterised | 200, success |
| Closed-set parameters reject out-of-enum values | 400 for a crafted `sort`; 400 for a non-UUID year |

Sort columns are chosen from a fixed map, and enum/schema validation rejects values before
they reach SQL. The test proves the injection payload is not executed, not merely that it is
escaped by luck.

### 2.5 Document access and upload security (5 tests)

| Assertion | Result |
| --- | --- |
| Unknown document id indistinguishable from unauthorised | 404 |
| Caller without upload permission refused before parsing | 403 |
| Bytes not matching the claimed MIME type rejected | 415 `bad_file_signature` |
| Valid PDF accepted, stored `private`, not served anonymously | 201; `visibility: private`; anonymous download 404 |
| Magic-byte validator rejects a renamed executable and accepts real formats | `MZ…` and PHP rejected; PDF and PNG accepted; empty rejected |

The upload path checks content, not just the `Content-Type` header, and a private document is
hidden from anonymous callers by RLS as well as by the route.

### 2.6 Upload path confinement (2 tests)

| Assertion | Result |
| --- | --- |
| `mayRead` allows the owner or staff, refuses strangers and anonymous | as expected |
| Protected upload route refuses anonymous, traversal, bad folder and other-user requests | 401 / 404 / 404 / 404 |

`/uploads/citizen-documents/..%2F..%2Fetc/passwd` does not escape the upload root.

### 2.7 Audit-trail integrity (3 tests)

| Assertion | Result |
| --- | --- |
| `vungu_app` cannot INSERT/UPDATE/DELETE `public.admin_audit_event` | all three privileges false |
| Guard trigger present | `trg_admin_audit_event_guard` |
| Refused finance mutations are recorded, not just successes | `FIN%` rows with status 403 exist |

The audit trail is append-only by grant and by trigger, and refusals are first-class events.

## 3. What this evidence supports

- Authentication, session revocation, role enforcement and separation of duties are exercised
  against the real middleware, not mocked.
- Publication gating is enforced by the database; unpublished data does not leak through a
  route projection.
- Upload and download paths resist the common file and path attacks tested here.
- The audit trail cannot be rewritten by the application role.

## 4. Honest limits

| Gap | Why it matters | Status |
| --- | --- | --- |
| No external penetration test | The suite tests known classes; it cannot find unknown ones, business-logic abuse or infrastructure exposure | Outstanding |
| No CSRF-specific test | Sessions use httpOnly cookies with `SameSite=Lax`; the strategy has been reviewed but not adversarially tested | Residual (S-05) |
| No rate-limit/brute-force test | Login lockout and rate limiting exist but are not exercised at load | Residual |
| No malware-scanner test | Scanning is wired in, but no infected sample was submitted | Residual |
| Local filesystem storage | No signed, time-limited URLs; downloads pass through the app | Accepted deviation (S-04, AD-04) |
| Tests run on one host | Results describe the application and schema, not a hardened production network | Scope limit |

These gaps are consistent with the security findings in `SECURITY-AUDIT.md`; the suite closes
the "untested controls" gap for the areas it covers, not the "no adversarial engagement" gap.
A short external penetration test focused on authentication, document download, import upload
and public endpoints is still recommended before go-live.
