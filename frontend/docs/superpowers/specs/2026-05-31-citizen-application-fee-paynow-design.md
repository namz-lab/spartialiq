# Citizen Application Fee via Paynow (Slice A) — Design

**Date:** 2026-05-31
**Status:** Approved (pending spec review)
**Surface:** Citizen Portal (`/citizen → New application` + `/payment/:id`) and the planner queue (`/planner-workspace`).
**Scope:** First production payment rail. Slices B (cards via Paynow redirect) and C (Google Pay / Apple Pay) follow.

## Problem

`migrations/064_payments_and_documents.sql` already defines the `payments` and `exchange_rates` tables. `src/routes/payments.js` exposes the full lifecycle (init, get, list, manual confirm, cancel, webhook, quote, rate). `src/services/paymentDriver.js` declares the driver interface and ships a working `manual` driver plus four stubs (`paynow`, `stripe`, `ecocash`, `onemoney`) that throw `NOT_IMPLEMENTED`. On the frontend, `paymentsService.ts`, `PaymentGatewayView.vue`, `PaymentsSection.vue`, `PaymentsView.vue` and `PaymentReceiptView.vue` all exist.

Nothing of that actually settles money. A citizen who clicks "Pay now" on the existing card tab in `PaymentGatewayView.vue` posts raw PAN + CVV + expiry to a `confirm` endpoint that flips the row to paid without verification. The ZimSwitch tab puts the whole site in PCI-DSS scope without delivering any settlement.

Slice A wires the first real rail — Paynow Express Checkout for EcoCash, OneMoney and InnBucks — so a citizen submitting a new permit application can actually pay the council application fee from their phone and the planner sees the application appear only after the fee clears.

## Goals

- The citizen wizard's final step is "Submit & pay". Submission and payment initiation happen together; the permit row is created with `status='pending_payment'` and is not visible to planners until paid.
- Paynow Express Checkout (REST API) initiates the push to the citizen's mobile wallet. The wallet (EcoCash / OneMoney / InnBucks) is chosen by the citizen on a `<PaymentMethodPicker>` tile; the phone field is validated against the picked wallet's prefix (077/078, 071, 086 respectively). Card / Google Pay / Apple Pay tiles are visible but disabled with a "Coming soon" tooltip until Slices B and C ship.
- Paynow's webhook (`POST /api/payments/webhook/paynow`) confirms payment with hash verification. On `Paid`, the linked permit flips `pending_payment` → `registered`, a receipt number is stamped, and a notification is enqueued.
- Citizens see only their own `pending_payment` permits (existing own-row filter already in place); planners see only paid permits in their queue.
- The existing `PaymentGatewayView.vue` becomes the "Check your phone / success" screen, driven by the real `payments` row rather than the legacy `paymentsApi` shape.

## Non-goals

- Cards (Visa / Mastercard / ZimSwitch). Slice B will replace the current PCI-risky card tab with a Paynow Web Initiate redirect to a hosted card page.
- Google Pay / Apple Pay wallet buttons. Slice C. Apple Pay is not officially available in Zimbabwe; that caveat is loaded into Slice C, not this one.
- Per-development-type fee schedule. Slice A uses the single `local_authorities.application_fee` row from the `GET /api/council` response.
- Inspection booking fee, permit fee, occupation certificate fee — all already validate as `purpose` values, but only `application_fee` ships its side-effect branch in Slice A.
- SMS / push notifications. The existing `notifier.enqueue` (email today) is the only fan-out.
- Reconciliation UI for the council clerk. Paynow's own merchant portal covers this in Slice A.

## Architecture and data flow

```
NewApplicationSection (wizard)
  └─ Step "Submit & pay" (replaces the bare Submit step)
       │
       ├─ POST /api/permit-applications
       │       body now includes pay_intent: { phone, walletCcy }
       │       backend creates permit with status='pending_payment',
       │       returns { id }
       │
       └─ POST /api/payments
            { purpose:'application_fee', relatedKind:'permit',
              relatedId:<permit.id>, priceUsd:<council fee>,
              walletCcy:'USD'|'ZWG', driver:'paynow',
              metadata:{ phone, wallet:'ecocash'|'onemoney'|'innbucks' } }
              │
              ├─ payments row INSERT status='pending'
              ├─ paynowDriver.initPayment()
              │     POST to Paynow REST Express Checkout
              │     hash signed with PAYNOW_INTEGRATION_KEY
              │     wallet picked from metadata.wallet
              ├─ payments row → status='awaiting_provider'
              │                  provider_ref=<paynow poll url>
              └─ returns { payment, redirectUrl:null }

  Citizen sees "Check your phone" awaiting screen (PaymentGatewayView).

  Paynow → POST /api/payments/webhook/paynow (hash-signed)
       │
       ├─ paynowDriver.verifyWebhook(): rebuilds hash from rawBody,
       │    decodes Status field → paid|cancelled|pending
       ├─ payments row → status='paid', issued_receipt_no='VRDC-2026-000XXX'
       └─ applyPaid() new branch for purpose='application_fee':
            ├─ permit_application: status='pending_payment' → 'registered'
            │                       fee_paid_at = NOW()
            ├─ notifier.enqueue('application_fee_paid', citizen.email)
            └─ audit row in application_audit_log

  Front-end (awaiting screen):
      polls GET /api/payments/:id every 5s up to 90s
      OR uses "Check now" button → POST /api/payments/:id/poll
        (calls driver.pollPayment which hits Paynow's poll url)
      on status='paid' → transitions to success step, renders receipt,
        offers a link to /citizen Applications.

  Recovery: if Paynow init fails or the webhook never fires,
    the permit row stays pending_payment. The citizen's
    Payments tab surfaces a "Resume payment" link that creates a
    new payments row against the same relatedId, leaving the
    old one as failed/cancelled.
```

Single sources of truth:
- `payments` row keyed by `id`; `provider_ref` is Paynow's poll URL.
- `permit_application.status='pending_payment'` is the gate. Planners' read query excludes that status for non-staff roles.

## Backend

### Migration

`migrations/077_permit_application_pending_payment.sql`:

```sql
BEGIN;

-- Add 'pending_payment' to the existing status enum.
-- The current values (migration 070) are:
--   registered, acknowledged, circulation, objection_period,
--   under_review, deferred, approved, approved_with_conditions,
--   refused, withdrawn, appealed
-- The new value is inserted; every existing value is preserved verbatim
-- so no in-flight row is invalidated.
ALTER TABLE spatial_planning.permit_application
  DROP CONSTRAINT IF EXISTS permit_application_status_check;

ALTER TABLE spatial_planning.permit_application
  ADD  CONSTRAINT permit_application_status_check
  CHECK (status IN (
    'pending_payment',
    'registered',
    'acknowledged',
    'circulation',
    'objection_period',
    'under_review',
    'deferred',
    'approved',
    'approved_with_conditions',
    'refused',
    'withdrawn',
    'appealed'
  ));

-- The application fee timestamp lives on the permit row so we can render
-- "paid 3 Mar 2026" on the citizen receipt and the planner case header
-- without joining payments. Filled in by applyPaid() when the fee clears.
ALTER TABLE spatial_planning.permit_application
  ADD COLUMN IF NOT EXISTS fee_paid_at TIMESTAMP WITH TIME ZONE;

-- Helps the planner queue scan past pending_payment rows quickly.
CREATE INDEX IF NOT EXISTS idx_permit_app_status_received
  ON spatial_planning.permit_application(status, received_at DESC);

-- The v_application_summary view (migration 075) does not need to change:
-- it already exposes status, created_by, received_at, and our route filters
-- on those.

COMMIT;
```

Idempotent. Apply via the project's direct-apply convention (precedent in `2026-05-29-planner-stand-map-picker-design.md`).

### `src/services/paymentDriver.js` — real Paynow driver

Replace the `paynowDriver` stub. Configuration is read from `process.env` once at module load:

- `PAYNOW_INTEGRATION_ID` — merchant integration id.
- `PAYNOW_INTEGRATION_KEY` — shared hash secret. Never sent to clients.
- `PAYNOW_RETURN_URL` — frontend route the citizen lands on after a redirect flow (not used in Express Checkout, but required by Paynow's POST).
- `PAYNOW_RESULT_URL` — fully-qualified webhook URL (`${PUBLIC_API_URL}/api/payments/webhook/paynow`).
- `PAYNOW_API_BASE` — defaults to `https://www.paynow.co.zw`. Sandbox lives at a different host; tests inject this.

The driver exposes:

```js
async initPayment({ payment }) {
  // wallet picked from payment.metadata.wallet ('ecocash' | 'onemoney' | 'innbucks')
  // phone read from payment.metadata.phone (E.164, +263…)
  // amount in the payment.wallet_ccy (Paynow accepts either, USD by default)
  // body fields per Paynow REST: id, reference, amount, additionalinfo,
  //   returnurl, resulturl, authemail, phone, method, status, hash
  // hash = SHA512(uppercase(concat(field values + integrationKey)))
  // POST application/x-www-form-urlencoded to /interface/remotetransaction
  // parse Status=Ok&PollUrl=... or Status=Error&Error=...
  // return { providerRef: pollUrl, providerStatus: 'sent', redirectUrl: null }
}

async pollPayment({ payment }) {
  // GET payment.provider_ref (Paynow poll URL)
  // Status field can be: Paid, Awaiting Delivery, Delivered, Sent,
  //                      Created, Cancelled, Disputed, Refunded
  // map Paid|Awaiting Delivery|Delivered → { paid:true,  paidAt }
  // map Sent|Created                     → { paid:false, providerStatus }
  // map Cancelled|Disputed|Refunded      → { paid:false, providerStatus }
  // anything else → throw; the route returns 502
}

async verifyWebhook({ headers, body, rawBody }) {
  // Paynow posts form-encoded fields including 'hash'.
  // Rebuild hash from sorted-by-arrival concat of fields (excluding hash) +
  //   integrationKey, SHA512 uppercase, compare with timing-safe equal.
  // Decode reference/pollurl → providerRef = pollurl (matches initPayment).
  // Decode status the same way pollPayment does.
  // return { ok, providerRef, providerStatus, paid }
}

async refund() { throw NOT_IMPLEMENTED('paynow.refund') }
```

The driver uses Node's built-in `crypto` for SHA-512 and `undici`/`global.fetch` for HTTP — no new dependency. Sandbox tests use `nock` to intercept.

### `src/routes/payments.js` — extend `applyPaid` and the create gate

1. New branch in `applyPaid()` for `purpose='application_fee'`:

```js
if (updated.purpose === 'application_fee' && updated.related_kind === 'permit') {
  const { rows } = await client.query(
    `UPDATE spatial_planning.permit_application
        SET status     = CASE WHEN status = 'pending_payment'
                              THEN 'registered'
                              ELSE status END,
            fee_paid_at = COALESCE(fee_paid_at, NOW()),
            updated_at  = NOW()
      WHERE id = $1
      RETURNING id, applicant_email, applicant_name`,
    [updated.related_id],
  )
  const permit = rows[0]
  if (permit?.applicant_email) {
    await notifier.enqueue(client, {
      userId: updated.payer_id, email: permit.applicant_email,
      kind: 'application_fee_paid',
      templateData: {
        permitId: permit.id,
        name:     permit.applicant_name,
        receipt:  updated.issued_receipt_no,
      },
      payload: { permitId: permit.id, paymentId: updated.id },
    })
  }
}
```

`permit_application.fee_paid_at` does not exist in migration 070 today; Slice A's migration 077 adds it alongside the status-CHECK extension.

2. New route `POST /api/payments/:id/poll` — authenticated, owner/staff-only. Calls `driver.pollPayment({ payment })` for whatever driver the row is on, updates `provider_status` and (if paid) calls `applyPaid`. Returns the refreshed payment row. The citizen's "Check now" button uses this; the awaiting screen's auto-poll uses the same.

3. `POST /api/payments` — no shape change. The route already validates `purpose`, `relatedKind='permit'`, `driver='paynow'`, `walletCcy`. Add a small validation: when `driver='paynow'` and `purpose='application_fee'`, require `metadata.wallet ∈ {ecocash, onemoney, innbucks}` (chosen by the citizen on the picker tile) AND `metadata.phone` matches that wallet's allowed prefixes (`ecocash → 077|078`, `onemoney → 071`, `innbucks → 086`). The pairing is the picker's contract; backend rejects with `bad_phone_for_wallet` if the citizen forged a mismatch.

### Planner read filter

`GET /api/permit-applications` currently exposes all rows to staff. Add a default exclusion of `status='pending_payment'` for non-staff:

```js
const includePendingPayment = isStaff && (request.query.includePendingPayment === 'true')
// append: AND ($N::text IS NOT NULL OR status <> 'pending_payment')
//          with $N = includePendingPayment ? 'yes' : null
```

Citizens always see their own `pending_payment` rows because the existing `created_by = $userId` clause overrides. Planners can opt-in with a query flag if they ever need to audit unpaid applications.

### Server registration

`server.js` already registers `paymentRoutes`. No change. The driver file is imported by the route so no new registration is needed.

## Frontend

### `src/components/PaymentMethodPicker.vue` (new)

A single shared component used by both the wizard's Submit step and the standalone Pay-now route. Props:

```ts
interface Props {
  priceUsd: number              // already quoted by the caller
  council: { name: string }
  defaultWalletCcy?: 'USD' | 'ZWG'
}
interface Emits {
  (e: 'submit', payload: {
     wallet: 'ecocash' | 'onemoney' | 'innbucks'
     phone: string             // E.164 with +263 prefix
     walletCcy: 'USD' | 'ZWG'
  }): void
  (e: 'cancel'): void
}
```

Internals: 6 tiles in a 3-column grid — three active (EcoCash / OneMoney / InnBucks) and three disabled (Card / Google Pay / Apple Pay) with `:title="'Available once card payments are enabled'"`. Selecting a tile reveals the phone field, validated against the picked wallet's prefix:

```ts
const PREFIXES: Record<Wallet, RegExp> = {
  ecocash:  /^(?:\+?263|0)?(77|78)\d{7}$/,
  onemoney: /^(?:\+?263|0)?71\d{7}$/,
  innbucks: /^(?:\+?263|0)?86\d{7}$/,
}
```

Mismatch surfaces inline: "InnBucks numbers start with 086 — check the number or pick EcoCash". Currency toggle (USD/ZWG) sits below. Pay button enables only when wallet + valid phone + currency are all set. The `submit` event hands the normalised `+263…` phone back to the parent — the parent decides whether to first submit a permit, or just initiate a payment against an existing row.

### `src/views/citizen/sections/NewApplicationSection.vue` — Submit step

Replace the existing terminal "Submit" with a "Submit & pay" panel that mounts `<PaymentMethodPicker>`:

- Amount banner reads from `citizenPortalService.getCouncil()` (or `GET /api/council`).
- On `<PaymentMethodPicker @submit="onPickerSubmit">`:

```ts
async function onPickerSubmit(p: PickerPayload) {
  // 1. Submit the permit (backend creates it as pending_payment when
  //    pay_intent is present)
  const permit = await cc.submitDraft(draft.value.id, {
    payIntent: { phone: p.phone, walletCcy: p.walletCcy }
  })
  // 2. Initiate the payment
  const payment = await paymentsService.init({
    purpose:    'application_fee',
    relatedKind:'permit',
    relatedId:  permit.id,
    priceUsd:   council.application_fee,
    walletCcy:  p.walletCcy,
    driver:     'paynow',
    metadata:   { phone: p.phone, wallet: p.wallet },
  })
  // 3. Hand off to the awaiting screen
  router.push(`/payment/${payment.id}`)
}
```

If step 1 succeeds and step 2 throws, the permit row exists as `pending_payment` and the citizen's Payments tab shows a "Resume payment" entry. We surface a toast `useUiFeedback().error('Payment couldn’t start — try again from the Payments tab.')` and route to `/citizen?section=payments`.

### `src/views/PaymentInitView.vue` (new) — `/payment/new` route

A thin wrapper page that re-uses the same picker for the "Resume payment" and "Pay an outstanding row" flows. Query params: `?relatedKind=permit&relatedId=<id>`.

- On mount: fetches the related permit via `dmApi.getPermit(relatedId)`, fetches the council fee via `citizenPortalService.getCouncil()`. If either fails: redirect back to `/citizen?section=payments` with a toast.
- Renders `<PaymentMethodPicker :price-usd="council.application_fee" :council="council" />`.
- On `@submit`: calls `paymentsService.init({ purpose:'application_fee', relatedKind:'permit', relatedId, … })` directly (no `submitDraft` — the permit already exists). Routes to `/payment/:paymentId` on success.
- On `@cancel`: `router.back()` (or `/citizen?section=payments` as fallback).

Registered in `src/router/index.ts` under `requiresAuth: true`, role-agnostic (citizens and staff can both reach it; the underlying endpoints already enforce ownership).

### `src/views/PaymentGatewayView.vue` — repurpose as the awaiting / success screen

- Drop method selection, EcoCash phone re-entry, ZimSwitch card form and Bank transfer tab. The method and phone are already known from the `payments` row.
- Drive entirely off `paymentsService.get(id)` (URL param `:id`). The auto-polling loop calls `paymentsService.get(id)` every 5s (cheap DB read; reflects whatever the webhook has already written). The manual "Check now" button calls `paymentsService.poll(id)` instead, which forces a live Paynow hit. On `status='paid'`, render the existing success card with the new payment shape (`issuedReceiptNo`, `amountUsd`, `paidAt`, `driver`).
- Keep the "Check now" button (calls `paymentsService.poll` once), the "Cancel" button (calls `paymentsService.cancel(id)`), and the success-state receipt block.
- Two routes are deleted: the bare card form section and the bank-transfer section. They are stale in Slice A and would mislead.

### `src/views/citizen/sections/PaymentsSection.vue` — Pay-now and Resume

- The button is no longer `:disabled="!p.dev_register_no"` — that gate prevented payment on rows the citizen had submitted but not yet been assigned a register number, which is exactly when payment is needed. Disable instead on `!p.id` (always false for loaded rows) and on `p.fee_paid === true`.
- "Pay now" looks up the latest payments row for the permit (`paymentsService.listForRelated('permit', permit.id)`). If a `pending`/`awaiting_provider` row exists, route to `/payment/:paymentId` (the awaiting screen). Otherwise route to `/payment/new?relatedKind=permit&relatedId=<permit.id>`, which renders `<PaymentMethodPicker>` and initiates a fresh `payments` row on submit.
- "View receipt" is unchanged in shape but switches from `dev_register_no` to `payment.id` for rows that have a paid payment in `paymentsService.listForRelated`. Old receipts keyed by `dev_register_no` still resolve via the existing `/receipt/:refNo` route.

### `src/services/paymentsService.ts` — two thin additions

```ts
async poll(id: string): Promise<Payment> {
  const res = await api.post<{ success: boolean; data: Payment }>(
    `/payments/${encodeURIComponent(id)}/poll`,
  )
  return res.data.data
},

async listForRelated(kind: 'permit', id: string): Promise<Payment[]> {
  const res = await api.get<{ success: boolean; data: Payment[] }>(
    `/payments?relatedKind=${kind}&relatedId=${encodeURIComponent(id)}`,
  )
  return res.data.data
},
```

The `GET /api/payments` route currently lists only the caller's payments and ignores query params. Slice A adds `relatedKind` and `relatedId` as optional filters on that route (one extra `AND` clause).

### `src/composables/useCitizenCase.ts` — `submitDraft` signature

Extend `submitDraft(id, opts?)` so the wizard can pass `payIntent`. The composable's internal `dmApi.createPermit` call forwards it as `body.pay_intent`, which the backend reads to decide whether to set `status='pending_payment'` vs the default `'registered'`. Without `pay_intent`, behaviour is unchanged for any non-citizen caller.

## Error handling

| Case | Behaviour |
|---|---|
| Phone fails the +263 regex | Frontend blocks submit before init. |
| Council fee endpoint returns 0 or null | Frontend disables the pay button and surfaces "Council application fee not configured — contact the office." (catches misconfigured `local_authorities.application_fee`). |
| Paynow returns `Status=Error` on init | Driver throws; route sets `payments.status='failed'`, returns 502 to the frontend. Permit row stays `pending_payment`. Toast + route to Payments tab. |
| Paynow webhook arrives with bad hash | Driver returns `ok:false`; route responds 400 without DB writes. Logged at `error` with the offending `provider_ref`. |
| Webhook for an already-paid row | `applyPaid` rolls back silently (existing `WHERE status <> 'paid'` guard). Route returns 200. |
| Webhook never fires (Paynow outage) | Citizen's awaiting screen polls; 5 polls × 5s = 25s with "Check now" available. After 90s with no terminal state, frontend offers "I'll pay later — go to dashboard" link that lands the citizen on /citizen Applications. The pending row remains; Paynow's own retry brings it home. |
| Citizen cancels | `POST /api/payments/:id/cancel` → row `cancelled`, permit stays `pending_payment`, citizen sees outstanding in Payments tab. |
| Citizen re-initiates after cancel/fail | New `payments` row against the same `relatedId`. The old row remains for audit. The latest non-terminal row is the one the awaiting screen drives. |

## Testing

### Backend — jest, real Postgres + `nock` for Paynow

- `src/services/__tests__/paymentDriver.paynow.test.js`
  - `initPayment` builds the form-encoded body in the correct field order, includes the right SHA-512 hash, parses `Status=Ok&PollUrl=…` and `Status=Error&Error=…`.
  - `verifyWebhook` accepts a known-good Paynow callback fixture (anonymised from their docs) and rejects when any field is tampered or the hash is wrong (timing-safe compare).
  - `pollPayment` returns `{ paid:true }` for `Status=Paid|Awaiting Delivery|Delivered`, `{ paid:false }` for `Status=Sent|Created`, and `{ paid:false }` + the raw status for `Cancelled|Disputed|Refunded`.

- `src/routes/__tests__/payments.applicationfee.test.js`
  - Log in as citizen, POST a permit with `pay_intent`, assert `status='pending_payment'`.
  - POST `/api/payments` with `driver=paynow`, the mocked Paynow init returns `Ok`, assert the row is `awaiting_provider` with the expected `provider_ref`.
  - POST `/api/payments/webhook/paynow` with a fixture body, assert the permit flips to `registered`, `fee_paid_at` is set, and a `application_fee_paid` notification row exists.
  - POST the same webhook a second time, assert idempotency (no second notification, no double receipt number).
  - Tampered hash → 400 and no DB writes.

- `src/routes/__tests__/permit-applications.pending-payment.test.js`
  - Citizen sees their own `pending_payment` rows in `GET /api/permit-applications`.
  - Planner does NOT see `pending_payment` rows by default; planner WITH `?includePendingPayment=true` does.

### Frontend — vitest + happy-dom

- `src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts`
  - Mounts the wizard's submit step with `useCitizenCase` and `paymentsService` mocked.
  - Filling phone `0771234567` flags `wallet='ecocash'`.
  - Submit → `submitDraft` called with `payIntent`, then `paymentsService.init` called with the expected purpose/driver/metadata, then `router.push('/payment/<id>')`.
  - If `paymentsService.init` rejects, asserts the toast + redirect to `/citizen?section=payments`.

- `src/views/__tests__/PaymentGatewayView.awaiting.spec.ts`
  - Given a payment id with status `awaiting_provider`, mounts the view; the polling timer fires, `paymentsService.get` returns `status='paid'` on the third poll, view transitions to the success step and renders the receipt.
  - "Check now" calls `paymentsService.poll` once and transitions the same way on `paid`.
  - "Cancel" calls `paymentsService.cancel`, view returns to the citizen Applications route.

### Manual E2E with Paynow sandbox keys

1. Set sandbox `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY` in backend `.env`.
2. Citizen logs in as `demo.viewer@vungu.test`.
3. `/citizen → New application` → wizard → Submit & pay with phone `0771111111` (Paynow sandbox EcoCash success number).
4. Awaiting screen appears; sandbox confirms in seconds; webhook fires; awaiting screen → success.
5. Planner logs in (`demo.planner@vungu.test`); Permit Register lists the new application with status `Received`. The same application was NOT visible while the row was `pending_payment`.

## Extensibility

- Slice B (cards) reuses the same `payments` row, the same Paynow driver, the same webhook — only `initPayment` branches to `Web Initiate` (returns a `redirectUrl` instead of `null`). The frontend handles the redirect by following the URL; the webhook side is identical.
- Slice C (Google Pay / Apple Pay) re-uses Slice B's hosted card page as the underlying acquirer; the wallet button only changes how the card is tokenised on the citizen's device. The backend doesn't change.
- A per-development-type fee schedule fits as a small lookup (`fee_schedule` table or a JSONB column on `local_authorities`); the `priceUsd` already flows through the quote endpoint, so wiring is one extra read.
- Push / SMS notifications plug into the existing `notifier.enqueue` channels.

## Files

**Add**
- `app-backend/migrations/077_permit_application_pending_payment.sql`
- `app-backend/src/services/__tests__/paymentDriver.paynow.test.js`
- `app-backend/src/routes/__tests__/payments.applicationfee.test.js`
- `app-backend/src/routes/__tests__/permit-applications.pending-payment.test.js`
- `app-frontend/src/components/PaymentMethodPicker.vue`
- `app-frontend/src/components/__tests__/PaymentMethodPicker.spec.ts`
- `app-frontend/src/views/PaymentInitView.vue`
- `app-frontend/src/views/__tests__/PaymentInitView.spec.ts`
- `app-frontend/src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts`
- `app-frontend/src/views/__tests__/PaymentGatewayView.awaiting.spec.ts`

**Edit**
- `app-backend/src/services/paymentDriver.js` — real `paynowDriver` (replaces the stub).
- `app-backend/src/routes/payments.js` — new `applyPaid` branch for `application_fee`; new `POST /api/payments/:id/poll`; `relatedKind/relatedId` filters on `GET /api/payments`.
- `app-backend/src/routes/development-management.js` — accept `pay_intent` on permit create; default-exclude `pending_payment` rows from the planner queue with an opt-in `?includePendingPayment=true`.
- `app-frontend/src/views/citizen/sections/NewApplicationSection.vue` — Submit & pay step mounts `<PaymentMethodPicker>` and runs the submit handler.
- `app-frontend/src/views/PaymentGatewayView.vue` — repurpose as awaiting/success driven by real `payments` row; remove card and bank tabs.
- `app-frontend/src/views/citizen/sections/PaymentsSection.vue` — Pay-now / Resume routing; drop the `dev_register_no` disabled-state gate.
- `app-frontend/src/services/paymentsService.ts` — `poll(id)` and `listForRelated(kind, id)`.
- `app-frontend/src/composables/useCitizenCase.ts` — `submitDraft(id, { payIntent })` forwarding.
- `app-frontend/src/router/index.ts` — register `/payment/new` → `PaymentInitView` with `meta.requiresAuth = true`.

**Env**
- `app-backend/.env` — add `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`, `PAYNOW_RESULT_URL`, `PAYNOW_RETURN_URL`. Sandbox values committed to `.env.example`; real values out of band.
