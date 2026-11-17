-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 244 — PROPERTY FINANCE ON THE PLANNING REGISTER (GIS-integrated finance)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/244_finance_property_gis.down.sql
-- Routes: src/routes/finance-property.js (/api/finance/property/*).
--
-- WHAT THIS IS FOR
-- Finance reads the Planning Module's stands and allocations and keeps the money side of each
-- property: the account, its bills, its receipts and its standing. No second property register is
-- made. The property IS land.parcel (Planning's, authoritative); the account IS
-- finance.rates_account (one active per parcel, migration 205); the charges ARE rates bills and the
-- payments ARE rates receipts, both double entries through finance.post_voucher(). This migration
-- adds only what was missing between the two modules:
--
--   1. finance.property_integration_event — the integration log. Every Planning fact Finance has
--      acted on (StandAllocated, StandTransferred, AllocationRevoked, ...) is one row, keyed by a
--      dedupe key, with its outcome, attempts and last error. Re-running discovery cannot act on the
--      same allocation twice, and a failure stays visible and retryable instead of being lost.
--   2. finance.property_integration_run — one row per discovery run, for synchronisation monitoring.
--   3. finance.party_identity — the keys a customer is matched on (national ID, Planning user). A
--      second allocation to the same person finds the same finance.party rather than opening a
--      duplicate customer; the unique index is what makes a duplicate impossible, not the route.
--   4. finance.v_property_finance — one row per current parcel: Planning's facts (stand, township,
--      ward, land use, offer and allocation) beside Finance's (account, billed, paid, outstanding,
--      overdue, receipts awaiting posting) and a derived financial status. Money comes from
--      finance.v_rates_arrears, so the map, the statement and the debtors ledger cannot disagree.
--
-- FINANCE NEVER WRITES A PLANNING TABLE
-- Nothing here updates land.parcel, land.stand_offer or public.stand_allocation. The ward of a
-- parcel whose register row carries none is DERIVED in the view (the ward its point-on-surface
-- falls in); the register row is untouched.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT throughout.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE INTEGRATION LOG
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.property_integration_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  trigger       text NOT NULL DEFAULT 'manual'
                CONSTRAINT property_integration_run_trigger_known CHECK (trigger IN ('manual', 'scheduled', 'retry')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  run_by        uuid REFERENCES public.users (id),
  discovered    integer NOT NULL DEFAULT 0,
  processed     integer NOT NULL DEFAULT 0,
  failed        integer NOT NULL DEFAULT 0,
  duplicates    integer NOT NULL DEFAULT 0,
  error         text
);
CREATE INDEX IF NOT EXISTS idx_property_integration_run_started
  ON finance.property_integration_run (authority_id, started_at DESC);

CREATE TABLE IF NOT EXISTS finance.property_integration_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id     integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  event_type       text NOT NULL CONSTRAINT property_integration_event_type_known CHECK (event_type IN (
                     'StandCreated', 'StandAllocated', 'StandTransferred', 'StandOwnershipUpdated',
                     'AllocationRevoked', 'PropertyUpdated', 'DevelopmentApproved',
                     'ChargeGenerated', 'InvoiceIssued', 'PaymentReceived', 'PropertyAccountUpdated')),
  source           text NOT NULL DEFAULT 'planning'
                   CONSTRAINT property_integration_event_source_known CHECK (source IN ('planning', 'finance')),
  -- The source record the event is about (a stand_allocation id, a parcel id, a receipt id).
  source_ref       text NOT NULL,
  -- event_type:source_ref. The unique index below is the guarantee that an allocation is acted on once.
  dedupe_key       text NOT NULL,
  parcel_id        character varying(24) REFERENCES land.parcel (parcel_id),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'pending' CONSTRAINT property_integration_event_status_known
                   CHECK (status IN ('pending', 'processed', 'failed', 'duplicate', 'ignored')),
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  outcome          text,
  party_id         uuid REFERENCES finance.party (id),
  rates_account_id uuid REFERENCES finance.rates_account (id),
  run_id           uuid REFERENCES finance.property_integration_run (id),
  detected_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  processed_by     uuid REFERENCES public.users (id),
  CONSTRAINT property_integration_event_failure_explained
    CHECK (status <> 'failed' OR length(btrim(COALESCE(last_error, ''))) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_integration_event_dedupe
  ON finance.property_integration_event (authority_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_property_integration_event_parcel
  ON finance.property_integration_event (parcel_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_integration_event_status
  ON finance.property_integration_event (authority_id, status);

COMMENT ON TABLE finance.property_integration_event IS
  'Planning -> Finance integration log (migration 244). One row per Planning fact Finance acted on, '
  'unique by dedupe_key so discovery is idempotent; failures keep their error and are retried, never '
  'dropped. Finance never writes a Planning table: it reads them and records here what it did.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE CUSTOMER MATCHING KEYS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Customer numbers for parties the integration opens (CUS-000001). Gaps are harmless: a customer
-- number is an identifier, not a gapless fiscal document.
CREATE SEQUENCE IF NOT EXISTS finance.customer_no_seq;

CREATE TABLE IF NOT EXISTS finance.party_identity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  party_id      uuid NOT NULL REFERENCES finance.party (id),
  kind          text NOT NULL CONSTRAINT party_identity_kind_known
                CHECK (kind IN ('national_id', 'company_registration', 'planning_user', 'allottee_name')),
  value         text NOT NULL CONSTRAINT party_identity_value_present CHECK (length(btrim(value)) > 0),
  source        text NOT NULL DEFAULT 'planning',
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users (id)
);
-- One customer per identity. A national ID or Planning user that already names a party matches it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_identity_value
  ON finance.party_identity (authority_id, kind, upper(btrim(value)));
CREATE INDEX IF NOT EXISTS idx_party_identity_party ON finance.party_identity (party_id);

COMMENT ON TABLE finance.party_identity IS
  'The keys a finance customer is matched on when Planning allocates a stand (migration 244). Unique '
  'per kind and value, so the same person allocated two stands is one customer with two accounts. '
  'The national ID is personal information: it is read only with finance.property.view_identity.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. TENANCY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- As migration 207: tenancy.make_tenant() (167) adds the authority policies and the application
-- role's privileges; the view runs as the caller, so the underlying policies decide its rows.
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the property integration tables stay pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['finance.property_integration_run', 'finance.property_integration_event', 'finance.party_identity'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'property integration data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;
  FOREACH r IN ARRAY ARRAY['finance.property_integration_run', 'finance.property_integration_event', 'finance.party_identity'] LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE finance.customer_no_seq TO vungu_app;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE PROPERTY FINANCE VIEW
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Status, in order of precedence:
--   cancelled            the stand's allocation was revoked and nothing is owed
--   allocated_no_account Planning allocated it and Finance holds no account: an integration gap
--   unallocated          a stand not allocated, with no account (nothing to collect)
--   no_account           any other parcel without an account (farm parcels mostly)
--   not_billed           an account with no posted bill: billing has not reached it
--   overdue              money owed on a bill more than 30 days old
--   awaiting_payment     billed and owed, nothing ever paid
--   partially_paid       owed, and some has been paid
--   paid_up              billed and nothing owed
-- `payment_pending_posting` is separate: a receipt taken but not yet posted by the accountant. It
-- is shown beside the status and is never counted in the balance (the ledger has not got it yet).
DROP VIEW IF EXISTS finance.v_property_finance;
CREATE VIEW finance.v_property_finance WITH (security_invoker = true) AS
WITH ward AS (
  -- The council's own wards (admin.authority_ward), for the authority the reader belongs to. A parcel
  -- whose point falls in none of them lies outside the council and is not the council's to bill.
  SELECT DISTINCT ON (p.parcel_id) p.parcel_id, w.ward_code, w.name AS ward_name
    FROM land.parcel p
    JOIN admin.authority_ward aw ON aw.valid_to IS NULL
                                AND (app.authority_id() IS NULL OR aw.authority_id = app.authority_id())
    JOIN admin.ward w ON w.ward_code = aw.ward_code
   WHERE p.status = 'current'
     AND ST_Intersects(w.geom, ST_PointOnSurface(p.geom_wgs84))
   ORDER BY p.parcel_id, w.ward_code
), money AS (
  SELECT a.rates_account_id,
         COALESCE(sum(a.billed_amount) FILTER (WHERE a.voucher_type = 'rates_bill' AND a.currency = 'USD'), 0) AS usd_billed,
         COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.currency = 'USD'), 0)                              AS usd_balance,
         COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.currency = 'USD' AND a.outstanding_amount > 0
                                                    AND a.days_outstanding > 30), 0)                          AS usd_overdue,
         COALESCE(sum(a.billed_amount) FILTER (WHERE a.voucher_type = 'rates_bill' AND a.currency = 'ZWG'), 0) AS zwg_billed,
         COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.currency = 'ZWG'), 0)                              AS zwg_balance,
         COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.currency = 'ZWG' AND a.outstanding_amount > 0
                                                    AND a.days_outstanding > 30), 0)                          AS zwg_overdue,
         count(*) FILTER (WHERE a.voucher_type = 'rates_bill')                                                 AS bills,
         count(*) FILTER (WHERE a.voucher_type = 'rates_bill' AND a.outstanding_amount > 0)                    AS open_bills,
         max(a.days_outstanding) FILTER (WHERE a.outstanding_amount > 0)                                       AS oldest_days,
         max(a.posting_date) FILTER (WHERE a.voucher_type = 'rates_bill')                                     AS last_billed_on
    FROM finance.v_rates_arrears a
   GROUP BY a.rates_account_id
), paid AS (
  SELECT rc.rates_account_id,
         COALESCE(sum(rc.amount) FILTER (WHERE v.status = 'posted' AND rc.currency = 'USD'), 0) AS usd_paid,
         COALESCE(sum(rc.amount) FILTER (WHERE v.status = 'posted' AND rc.currency = 'ZWG'), 0) AS zwg_paid,
         COALESCE(sum(rc.amount) FILTER (WHERE v.status = 'draft' AND rc.currency = 'USD'), 0)  AS usd_pending,
         COALESCE(sum(rc.amount) FILTER (WHERE v.status = 'draft' AND rc.currency = 'ZWG'), 0)  AS zwg_pending,
         count(*) FILTER (WHERE v.status = 'posted')                                             AS receipts,
         max(rc.received_on) FILTER (WHERE v.status IN ('posted', 'draft'))                      AS last_paid_on
    FROM finance.rates_receipt rc
    JOIN finance.voucher v ON v.id = rc.voucher_id
   WHERE rc.deleted_at IS NULL
   GROUP BY rc.rates_account_id
), base AS (
  SELECT p.parcel_id,
         p.parcel_kind,
         p.stand_no,
         p.township_code,
         p.area_m2,
         p.tenure_class,
         p.authority_id                                      AS parcel_authority_id,
         wd.ward_code                                        AS ward_code,
         wd.ward_name                                        AS ward_name,
         (p.ward_code IS DISTINCT FROM wd.ward_code)         AS ward_derived,
         p.ward_code                                         AS register_ward_code,
         (wd.ward_code IS NOT NULL)                          AS in_authority,
         gz.land_use,
         o.status                                            AS offer_status,
         o.price_usd                                         AS offer_price_usd,
         o.use_scale,
         p.allocation_status                                 AS register_allocation_status,
         al.id                                               AS allocation_id,
         al.reference_no                                     AS allocation_reference,
         al.allottee_name,
         al.allocated_to                                     AS allottee_user_id,
         al.purpose                                          AS allocation_purpose,
         al.allocated_at,
         rv.revoked_at                                       AS last_revoked_at,
         ra.id                                               AS rates_account_id,
         ra.account_no,
         ra.party_id,
         pt.name                                             AS party_name,
         ra.opened_on,
         ra.erp_account_no,
         (SELECT count(*) FROM finance.rates_account x
           WHERE x.parcel_id = p.parcel_id AND x.deleted_at IS NULL AND x.status = 'closed') AS closed_accounts,
         COALESCE(m.usd_billed, 0)   AS usd_billed,
         COALESCE(pd.usd_paid, 0)    AS usd_paid,
         COALESCE(m.usd_balance, 0)  AS usd_balance,
         COALESCE(m.usd_overdue, 0)  AS usd_overdue,
         COALESCE(pd.usd_pending, 0) AS usd_pending,
         COALESCE(m.zwg_billed, 0)   AS zwg_billed,
         COALESCE(pd.zwg_paid, 0)    AS zwg_paid,
         COALESCE(m.zwg_balance, 0)  AS zwg_balance,
         COALESCE(m.zwg_overdue, 0)  AS zwg_overdue,
         COALESCE(pd.zwg_pending, 0) AS zwg_pending,
         COALESCE(m.bills, 0)        AS bills,
         COALESCE(m.open_bills, 0)   AS open_bills,
         COALESCE(pd.receipts, 0)    AS receipts,
         m.oldest_days,
         m.last_billed_on,
         pd.last_paid_on
    FROM land.parcel p
    LEFT JOIN ward wd ON wd.parcel_id = p.parcel_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(t.name, z.zone) AS land_use
        FROM public.parcel_zoning pz
        JOIN spatial_planning.zone z ON z.id = pz.zone_id
        LEFT JOIN public.plan_zone_type t ON t.id = pz.plan_zone_type_id
       WHERE pz.parcel_layer = 'land.parcel' AND pz.parcel_id = p.parcel_id AND pz.is_governing
       ORDER BY pz.plan_instrument_id LIMIT 1) gz ON true
    LEFT JOIN land.stand_offer o ON o.parcel_id = p.parcel_id
    LEFT JOIN public.stand_allocation al
           ON al.stand_id = p.parcel_id AND al.status = 'active' AND al.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT max(r.revoked_at) AS revoked_at FROM public.stand_allocation r
       WHERE r.stand_id = p.parcel_id AND r.status = 'revoked' AND r.deleted_at IS NULL) rv ON true
    LEFT JOIN finance.rates_account ra
           ON ra.parcel_id = p.parcel_id AND ra.status = 'active' AND ra.deleted_at IS NULL
    LEFT JOIN finance.party pt ON pt.id = ra.party_id
    LEFT JOIN money m ON m.rates_account_id = ra.id
    LEFT JOIN paid pd ON pd.rates_account_id = ra.id
   WHERE p.status = 'current'
)
SELECT b.*,
       (b.allocation_id IS NOT NULL OR b.register_allocation_status = 'allocated' OR b.offer_status = 'allocated') AS is_allocated,
       (b.usd_pending > 0 OR b.zwg_pending > 0) AS payment_pending_posting,
       CASE
         WHEN b.rates_account_id IS NULL AND b.allocation_id IS NULL AND b.last_revoked_at IS NOT NULL THEN 'cancelled'
         WHEN b.rates_account_id IS NULL
              AND (b.allocation_id IS NOT NULL OR b.register_allocation_status = 'allocated' OR b.offer_status = 'allocated')
           THEN 'allocated_no_account'
         WHEN b.rates_account_id IS NULL AND b.parcel_kind = 'stand' THEN 'unallocated'
         WHEN b.rates_account_id IS NULL THEN 'no_account'
         WHEN b.bills = 0 THEN 'not_billed'
         WHEN b.usd_overdue > 0 OR b.zwg_overdue > 0 THEN 'overdue'
         WHEN (b.usd_balance > 0 OR b.zwg_balance > 0) AND b.receipts = 0 THEN 'awaiting_payment'
         WHEN b.usd_balance > 0 OR b.zwg_balance > 0 THEN 'partially_paid'
         ELSE 'paid_up'
       END AS financial_status
  FROM base b;

COMMENT ON VIEW finance.v_property_finance IS
  'One row per current parcel: Planning''s facts (stand, ward, land use, offer, allocation) beside '
  'Finance''s (rates account, billed, paid, balance, overdue, receipts awaiting posting) and a derived '
  'financial status (migration 244). Money is read from finance.v_rates_arrears and posted receipts, '
  'so it agrees with the statement and the debtors ledger. The ward is the council''s ward the parcel '
  'lies in (by location); in_authority is false for a parcel outside '
  'the council''s wards, which the finance map and figures leave out. register_ward_code keeps the '
  'register''s own code.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_property_finance TO vungu_app;
  END IF;
  PERFORM tenancy.classify('finance.v_property_finance', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.property.view', 'View property finance and the property map', 'reporting', false, false, false,
   'Search properties and stands, open a property''s financial profile and statement, and see the '
   'property layers on the finance map. Read only; confers no power over Planning or ledger records.'),
  ('finance.property.view_identity', 'See and search customers by national ID', 'reporting', false, false, true,
   'Personal information: search by and display a customer''s national identification number.'),
  ('finance.property.sync', 'Run and repair the Planning integration', 'revenue', false, false, false,
   'Run property discovery from the Planning Module, retry failed integration events and resolve '
   'exceptions. Opens finance accounts for allocated stands; never changes a Planning record.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted,
      description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.property.view'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'accountant', 'accounting_officer', 'budget_officer',
                    'revenue_officer', 'cashier', 'cash_supervisor', 'auditor', 'dept_head',
                    'finance_committee', 'publisher', 'admin']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.property.view_identity'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'revenue_officer', 'cashier', 'cash_supervisor', 'auditor']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.property.sync'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'revenue_officer']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;
