-- Finance module — Chegutu Water-GIS finance component, for Vungu RDC.
-- Links cadastre (land.parcel) to revenue accounts, balances, ledger,
-- billing districts, collection trends, and the existing payments /
-- rates-clearance / tariff registers. Demonstration figures are marked.
-- Idempotent.

BEGIN;

CREATE SCHEMA IF NOT EXISTS finance;

-- ── Billing districts (Chegutu: 18 districts; Vungu: ward + layout cells) ──
CREATE TABLE IF NOT EXISTS finance.billing_district (
  code            varchar(24) PRIMARY KEY,
  name            text        NOT NULL,
  township_group  varchar(40) NOT NULL DEFAULT 'VUNGU',
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Revenue account per stand (linked to parcel + ERP account number) ──
CREATE TABLE IF NOT EXISTS finance.revenue_account (
  account_no         varchar(40) PRIMARY KEY,
  parcel_id          varchar(24) REFERENCES land.parcel(parcel_id) ON DELETE SET NULL,
  stand_no           varchar(40) NOT NULL,
  township_code      varchar(40) NOT NULL,
  district_code      varchar(24) NOT NULL REFERENCES finance.billing_district(code),
  account_holder     varchar(160) NOT NULL,
  holder_phone       varchar(32),
  holder_email       varchar(255),
  account_category   varchar(32) NOT NULL DEFAULT 'residential'
    CHECK (account_category IN (
      'residential','commercial','industrial','institutional','vacant','agricultural'
    )),
  valuation_usd      numeric(14,2) NOT NULL DEFAULT 0 CHECK (valuation_usd >= 0),
  annual_rates_usd   numeric(12,2) NOT NULL DEFAULT 0 CHECK (annual_rates_usd >= 0),
  balance_usd        numeric(14,2) NOT NULL DEFAULT 0,
  last_payment_at    timestamptz,
  last_payment_usd   numeric(12,2),
  status_band        varchar(16) NOT NULL DEFAULT 'current'
    CHECK (status_band IN ('current','in_arrears','closed','disputed')),
  demonstration      boolean NOT NULL DEFAULT true,
  as_at              timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_account_district ON finance.revenue_account (district_code);
CREATE INDEX IF NOT EXISTS idx_finance_account_stand ON finance.revenue_account (stand_no);
CREATE INDEX IF NOT EXISTS idx_finance_account_parcel ON finance.revenue_account (parcel_id);
CREATE INDEX IF NOT EXISTS idx_finance_account_status ON finance.revenue_account (status_band);
CREATE INDEX IF NOT EXISTS idx_finance_account_balance ON finance.revenue_account (balance_usd DESC);
CREATE INDEX IF NOT EXISTS idx_finance_account_holder ON finance.revenue_account USING gin (to_tsvector('simple', account_holder));

-- ── Ledger (charges, payments, adjustments) ──
CREATE TABLE IF NOT EXISTS finance.ledger_entry (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_no         varchar(40) NOT NULL REFERENCES finance.revenue_account(account_no) ON DELETE CASCADE,
  entry_date         date NOT NULL DEFAULT CURRENT_DATE,
  entry_type         varchar(24) NOT NULL
    CHECK (entry_type IN ('charge','payment','adjustment','penalty','write_off','reversal')),
  purpose            varchar(40) NOT NULL,
  description        text NOT NULL,
  amount_usd         numeric(14,2) NOT NULL,
  balance_after_usd  numeric(14,2) NOT NULL,
  payment_id         uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  receipt_no         varchar(40),
  created_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_ledger_account ON finance.ledger_entry (account_no, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_payment ON finance.ledger_entry (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_ledger_date ON finance.ledger_entry (entry_date DESC);

-- ── Monthly collection snapshots (payment / owing trends) ──
CREATE TABLE IF NOT EXISTS finance.collection_snapshot (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_code  varchar(24) NOT NULL REFERENCES finance.billing_district(code),
  month          date NOT NULL,
  billed_usd     numeric(14,2) NOT NULL DEFAULT 0,
  collected_usd  numeric(14,2) NOT NULL DEFAULT 0,
  arrears_usd    numeric(14,2) NOT NULL DEFAULT 0,
  account_count  integer NOT NULL DEFAULT 0,
  UNIQUE (district_code, month)
);

-- ── Grants ──
GRANT USAGE ON SCHEMA finance TO vungu_app, vungu_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finance TO vungu_app, vungu_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vungu_app, vungu_runtime;

-- ── Seed billing districts from wards + layout cells ──
INSERT INTO finance.billing_district (code, name, township_group, sort_order)
SELECT
  p.ward_code,
  'Ward ' || COALESCE(NULLIF(btrim(w.name), ''), right(p.ward_code, 2)),
  'VUNGU',
  row_number() OVER (ORDER BY count(*) DESC, p.ward_code)
FROM land.parcel p
LEFT JOIN admin.ward w ON w.ward_code = p.ward_code
WHERE p.township_code = 'VUNGU' AND p.ward_code IS NOT NULL
GROUP BY p.ward_code, w.name
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  township_group = EXCLUDED.township_group;

INSERT INTO finance.billing_district (code, name, township_group, sort_order) VALUES
  ('LAYOUT-HDR', 'Layout — High Density Residential', 'LAYOUT', 900),
  ('LAYOUT-EC',  'Layout — Economic / Commercial',    'LAYOUT', 901),
  ('LAYOUT-MDR', 'Layout — Medium Density',           'LAYOUT', 902),
  ('LAYOUT-OTHER', 'Layout — Other stands',           'LAYOUT', 903)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- ── Seed revenue accounts from existing account_link + parcel ──
INSERT INTO finance.revenue_account (
  account_no, parcel_id, stand_no, township_code, district_code,
  account_holder, holder_phone, holder_email, account_category,
  valuation_usd, annual_rates_usd, balance_usd,
  last_payment_at, last_payment_usd, status_band, demonstration, as_at
)
SELECT
  a.erp_account_no,
  a.parcel_id,
  p.stand_no,
  p.township_code,
  CASE
    WHEN p.township_code = 'LAYOUT' AND p.stand_no ILIKE 'HDR%' THEN 'LAYOUT-HDR'
    WHEN p.township_code = 'LAYOUT' AND p.stand_no ILIKE 'EC%'  THEN 'LAYOUT-EC'
    WHEN p.township_code = 'LAYOUT' AND p.stand_no ILIKE 'MDR%' THEN 'LAYOUT-MDR'
    WHEN p.township_code = 'LAYOUT' THEN 'LAYOUT-OTHER'
    ELSE COALESCE(p.ward_code, 'ZW170418')
  END AS district_code,
  CASE
    WHEN p.township_code = 'LAYOUT' THEN
      initcap(replace(split_part(a.erp_account_no, '-', 3), '_', ' ')) || ' Holder ' || p.stand_no
    ELSE
      'Account Holder ' || replace(p.stand_no, '-', '')
  END AS account_holder,
  '26377' || lpad((abs(hashtext(a.erp_account_no)) % 10000000)::text, 7, '0'),
  lower(replace(p.stand_no, '-', '')) || '@demo.vungu.test',
  CASE
    WHEN p.township_code = 'LAYOUT' AND p.stand_no ILIKE 'EC%' THEN 'commercial'
    WHEN p.area_m2 > 500000 THEN 'agricultural'
    WHEN p.area_m2 < 5000 THEN 'residential'
    ELSE 'residential'
  END,
  -- Working valuation from measured area (demonstration, not a gazetted roll)
  ROUND((GREATEST(p.area_m2, 200) * CASE
    WHEN p.township_code = 'LAYOUT' THEN 2.50
    WHEN p.area_m2 > 1000000 THEN 0.08
    ELSE 0.35
  END)::numeric, 2),
  -- Annual rates ≈ 0.8% of valuation for layout, 0.4% for farms
  ROUND((GREATEST(p.area_m2, 200) * CASE
    WHEN p.township_code = 'LAYOUT' THEN 2.50
    WHEN p.area_m2 > 1000000 THEN 0.08
    ELSE 0.35
  END * CASE WHEN p.township_code = 'LAYOUT' THEN 0.008 ELSE 0.004 END)::numeric, 2),
  -- Balance: keep in sync with existing billing_status bands
  CASE bs.status_band
    WHEN 'closed' THEN 0
    WHEN 'in_arrears' THEN
      ROUND((20 + (abs(hashtext(a.erp_account_no || 'bal')) % 480)
        + (GREATEST(p.area_m2, 200) * 0.0004))::numeric, 2)
    ELSE
      CASE WHEN abs(hashtext(a.erp_account_no || 'cur')) % 7 = 0
        THEN ROUND((5 + (abs(hashtext(a.erp_account_no)) % 45))::numeric, 2)
        ELSE 0
      END
  END AS balance_usd,
  CASE WHEN bs.status_band = 'closed' THEN NULL
       WHEN abs(hashtext(a.erp_account_no || 'pay')) % 5 = 0 THEN NULL
       ELSE now() - ((abs(hashtext(a.erp_account_no || 'days')) % 120) || ' days')::interval
  END,
  CASE WHEN bs.status_band = 'closed' THEN NULL
       WHEN abs(hashtext(a.erp_account_no || 'pay')) % 5 = 0 THEN NULL
       ELSE ROUND((10 + (abs(hashtext(a.erp_account_no || 'lp')) % 90))::numeric, 2)
  END,
  COALESCE(bs.status_band, 'current'),
  true,
  COALESCE(bs.as_at, now())
FROM revenue_link.account_link a
JOIN land.parcel p ON p.parcel_id = a.parcel_id
LEFT JOIN revenue_link.billing_status bs ON bs.erp_account_no = a.erp_account_no
ON CONFLICT (account_no) DO UPDATE SET
  parcel_id = EXCLUDED.parcel_id,
  stand_no = EXCLUDED.stand_no,
  township_code = EXCLUDED.township_code,
  district_code = EXCLUDED.district_code,
  valuation_usd = EXCLUDED.valuation_usd,
  annual_rates_usd = EXCLUDED.annual_rates_usd,
  balance_usd = EXCLUDED.balance_usd,
  status_band = EXCLUDED.status_band,
  as_at = EXCLUDED.as_at,
  updated_at = now();

-- Sync billing_status from seeded balances (status_band already used above)
UPDATE revenue_link.billing_status b
SET status_band = ra.status_band,
    as_at = now()
FROM finance.revenue_account ra
WHERE b.erp_account_no = ra.account_no
  AND b.status_band IS DISTINCT FROM ra.status_band;

-- ── Ledger seed: opening charge + optional payment / arrears penalty ──
-- One pass per account; skip if ledger already has rows for that account.
INSERT INTO finance.ledger_entry (
  account_no, entry_date, entry_type, purpose, description,
  amount_usd, balance_after_usd, receipt_no
)
SELECT
  ra.account_no,
  (CURRENT_DATE - INTERVAL '90 days')::date,
  'charge',
  'land_rates',
  'Quarterly land rates — demonstration roll',
  ra.annual_rates_usd / 4.0,
  ra.annual_rates_usd / 4.0,
  NULL
FROM finance.revenue_account ra
WHERE NOT EXISTS (
  SELECT 1 FROM finance.ledger_entry le WHERE le.account_no = ra.account_no
);

INSERT INTO finance.ledger_entry (
  account_no, entry_date, entry_type, purpose, description,
  amount_usd, balance_after_usd, receipt_no
)
SELECT
  ra.account_no,
  (CURRENT_DATE - INTERVAL '60 days')::date,
  'charge',
  'refuse_charge',
  'Refuse removal — demonstration',
  8.50,
  (ra.annual_rates_usd / 4.0) + 8.50,
  NULL
FROM finance.revenue_account ra
WHERE ra.status_band <> 'closed'
  AND (SELECT COUNT(*) FROM finance.ledger_entry le WHERE le.account_no = ra.account_no) = 1;

INSERT INTO finance.ledger_entry (
  account_no, entry_date, entry_type, purpose, description,
  amount_usd, balance_after_usd, receipt_no
)
SELECT
  ra.account_no,
  COALESCE(ra.last_payment_at::date, (CURRENT_DATE - INTERVAL '30 days')::date),
  'payment',
  'land_rates',
  'Payment received — demonstration',
  -COALESCE(ra.last_payment_usd, ra.annual_rates_usd / 4.0),
  GREATEST(ra.balance_usd, 0),
  'VRDC-DEMO-' || right(replace(ra.account_no, '-', ''), 8)
FROM finance.revenue_account ra
WHERE ra.last_payment_at IS NOT NULL
  AND ra.status_band <> 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM finance.ledger_entry le
     WHERE le.account_no = ra.account_no AND le.entry_type = 'payment'
  );

INSERT INTO finance.ledger_entry (
  account_no, entry_date, entry_type, purpose, description,
  amount_usd, balance_after_usd, receipt_no
)
SELECT
  ra.account_no,
  (CURRENT_DATE - INTERVAL '14 days')::date,
  'penalty',
  'land_rates',
  'Arrears penalty — demonstration',
  ROUND((ra.balance_usd * 0.05)::numeric, 2),
  ra.balance_usd,
  NULL
FROM finance.revenue_account ra
WHERE ra.status_band = 'in_arrears'
  AND ra.balance_usd > 0
  AND NOT EXISTS (
    SELECT 1 FROM finance.ledger_entry le
     WHERE le.account_no = ra.account_no AND le.entry_type = 'penalty'
  );

-- Link existing paid land_rates / property_search payments into ledger where accountRef matches
INSERT INTO finance.ledger_entry (
  account_no, entry_date, entry_type, purpose, description,
  amount_usd, balance_after_usd, payment_id, receipt_no
)
SELECT
  ra.account_no,
  COALESCE(pay.paid_at::date, pay.created_at::date),
  'payment',
  pay.purpose,
  'Council payment receipt ' || COALESCE(pay.issued_receipt_no, pay.id::text),
  -pay.amount_usd,
  GREATEST(ra.balance_usd, 0),
  pay.id,
  pay.issued_receipt_no
FROM public.payments pay
JOIN finance.revenue_account ra
  ON ra.stand_no = COALESCE(pay.metadata->>'accountRef', pay.related_id)
  OR ra.account_no = COALESCE(pay.metadata->>'accountRef', '')
  OR ra.account_no ILIKE '%' || COALESCE(pay.metadata->>'accountRef', '___never___') || '%'
WHERE pay.status = 'paid'
  AND pay.purpose IN ('land_rates','property_search','rates_clearance','supplementary_charge','refuse_charge','water_charge','sewer_charge')
  AND NOT EXISTS (
    SELECT 1 FROM finance.ledger_entry le WHERE le.payment_id = pay.id
  );

-- ── Six months of collection snapshots per district ──
INSERT INTO finance.collection_snapshot (district_code, month, billed_usd, collected_usd, arrears_usd, account_count)
SELECT
  d.code,
  (date_trunc('month', CURRENT_DATE) - (g.n || ' months')::interval)::date,
  ROUND((COALESCE(SUM(ra.annual_rates_usd), 0) / 12.0 * (0.85 + (g.n % 3) * 0.05))::numeric, 2),
  ROUND((COALESCE(SUM(ra.annual_rates_usd), 0) / 12.0 * (0.55 + (abs(hashtext(d.code || g.n::text)) % 35) / 100.0))::numeric, 2),
  ROUND(COALESCE(SUM(CASE WHEN ra.status_band = 'in_arrears' THEN ra.balance_usd ELSE 0 END), 0)::numeric, 2),
  COUNT(ra.account_no)::integer
FROM finance.billing_district d
CROSS JOIN generate_series(0, 5) AS g(n)
LEFT JOIN finance.revenue_account ra ON ra.district_code = d.code
GROUP BY d.code, g.n
ON CONFLICT (district_code, month) DO UPDATE SET
  billed_usd = EXCLUDED.billed_usd,
  collected_usd = EXCLUDED.collected_usd,
  arrears_usd = EXCLUDED.arrears_usd,
  account_count = EXCLUDED.account_count;

-- Keep rates_clearance rows honest against the new balances where stand matches
UPDATE council_ops.rates_clearance rc
SET charges_outstanding_usd = ra.balance_usd,
    erp_status_band = CASE
      WHEN ra.balance_usd <= 0 THEN 'current'
      ELSE 'in_arrears'
    END,
    updated_at = now()
FROM finance.revenue_account ra
WHERE upper(rc.stand_number) = upper(ra.stand_no)
  AND rc.status = 'requested';

COMMIT;
