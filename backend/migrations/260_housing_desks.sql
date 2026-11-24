-- 260: Housing desks, cash-office housing fees, committee, dual-ownership and cross-module file.
-- Builds on 259. Rollback: migrations/rollback/260_housing_desks.down.sql
--
-- Posts: housing_research, housing_area, housing_legal, housing_committee.
-- A housing fee at the till names the allocation (same pattern as planning fees, 246).
-- Allocation from the waiting list requires a recommendation (officer may record a written waiver).
-- Ordinary cession requires the cessionary on the list. Title is blocked while rates are owing.

-- ── Roles ────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n text; roles text[];
  added text[] := ARRAY['housing_research', 'housing_area', 'housing_legal', 'housing_committee'];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  IF roles IS NULL THEN RAISE EXCEPTION 'users_role_check missing'; END IF;
  roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
  FOR n IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname LIKE '%role_check%'
  LOOP EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', n); END LOOP;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
  IF to_regclass('public.invites') IS NOT NULL THEN
    SELECT array_agg(DISTINCT m[1]) INTO roles
      FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'public.invites'::regclass AND c.conname = 'invites_role_check';
    IF roles IS NOT NULL THEN
      roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
      ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_role_check;
      EXECUTE format('ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (%s))',
        (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
    END IF;
  END IF;
END $$;

DO $$
DECLARE v_ceo uuid; v_head uuid;
BEGIN
  SELECT id INTO v_ceo FROM public.admin_org_position
   WHERE reports_to IS NULL AND title = 'Chief Executive Officer' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_head FROM public.admin_org_position WHERE system_role = 'housing_officer' LIMIT 1;
  IF v_ceo IS NULL THEN RETURN; END IF;
  INSERT INTO public.admin_org_position (title, department, system_role, unit_key, reports_to, sort_order)
  SELECT v.title, 'Housing and Estates', v.role, 'housing', COALESCE(v_head, v_ceo), v.sort_order
    FROM (VALUES
      ('Housing Research and Allocations Officer', 'housing_research', 7),
      ('Area Housing Officer',                     'housing_area', 8),
      ('Housing Legal / Conveyancing Officer',     'housing_legal', 9),
      ('Allocations Committee member',             'housing_committee', 10)
    ) AS v(title, role, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM public.admin_org_position p WHERE p.system_role = v.role);
END $$;

-- ── Allocation clocks and the cash receipt that paid the deposit ─────────────────────────────
ALTER TABLE housing.allocation ADD COLUMN IF NOT EXISTS deposit_receipt_id uuid REFERENCES finance.cash_receipt (id);
ALTER TABLE housing.allocation ADD COLUMN IF NOT EXISTS first_due_on date;
ALTER TABLE housing.allocation ADD COLUMN IF NOT EXISTS balance_due_on date;
ALTER TABLE housing.allocation ADD COLUMN IF NOT EXISTS waiver_reason text;
ALTER TABLE housing.waiting_list ADD COLUMN IF NOT EXISTS seasoning_until date;
UPDATE housing.waiting_list SET seasoning_until = registered_on + interval '6 months' WHERE seasoning_until IS NULL;

-- ── Committee ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housing.committee_sitting (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_on   date NOT NULL DEFAULT CURRENT_DATE,
  minute_ref   text,
  scheme_id    uuid REFERENCES housing.scheme (id),
  notes        text,
  created_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS housing.committee_item (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id         uuid NOT NULL REFERENCES housing.committee_sitting (id) ON DELETE CASCADE,
  waiting_list_id    uuid NOT NULL REFERENCES housing.waiting_list (id),
  parcel_id          varchar(24) REFERENCES land.parcel (parcel_id),
  recommendation     text NOT NULL CONSTRAINT committee_reco_known CHECK (recommendation IN ('allocate', 'defer', 'refuse')),
  decided_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Housing fees in the cash office ──────────────────────────────────────────────────────
ALTER TABLE finance.income_code ADD COLUMN IF NOT EXISTS housing_fee_kind text;
ALTER TABLE finance.income_code DROP CONSTRAINT IF EXISTS income_code_housing_fee_kind_known;
ALTER TABLE finance.income_code ADD CONSTRAINT income_code_housing_fee_kind_known CHECK (
  housing_fee_kind IS NULL OR housing_fee_kind IN (
    'stand_deposit', 'stand_balance', 'lease_rent', 'cession_fee', 'occupation_fee', 'other'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_code_housing_fee_kind
  ON finance.income_code (authority_id, housing_fee_kind)
  WHERE housing_fee_kind IS NOT NULL AND deleted_at IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS finance.housing_fee (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id    integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  fee_kind        text NOT NULL,
  allocation_id   uuid REFERENCES housing.allocation (id),
  lease_id        uuid REFERENCES housing.lease (id),
  cession_id      uuid REFERENCES housing.cession (id),
  cash_receipt_id uuid NOT NULL REFERENCES finance.cash_receipt (id),
  amount          numeric NOT NULL,
  currency        text NOT NULL,
  received_on     date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_housing_fee_allocation ON finance.housing_fee (allocation_id);
CREATE INDEX IF NOT EXISTS idx_housing_fee_receipt ON finance.housing_fee (cash_receipt_id);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY ARRAY['housing.committee_sitting', 'housing.committee_item'] LOOP
      PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finance.housing_fee TO vungu_app;
    GRANT SELECT, INSERT, UPDATE ON housing.committee_sitting, housing.committee_item TO vungu_app;
  END IF;
END $$;

-- Seed housing income codes from an existing postable income code's ledger account, if any.
INSERT INTO finance.income_code (authority_id, code, name, ledger_account_id, pricing, unit_amount_usd, status, housing_fee_kind, created_by)
SELECT i.authority_id, v.code, v.name, i.ledger_account_id, 'variable', NULL, 'active', v.kind, i.created_by
  FROM finance.income_code i
  JOIN (VALUES
    ('HSG-DEP', 'Housing stand deposit', 'stand_deposit'),
    ('HSG-BAL', 'Housing stand balance', 'stand_balance'),
    ('HSG-LSE', 'Housing lease rent', 'lease_rent'),
    ('HSG-CES', 'Housing cession fee', 'cession_fee'),
    ('HSG-OCC', 'Housing occupation certificate fee', 'occupation_fee')
  ) AS v(code, name, kind) ON true
 WHERE i.deleted_at IS NULL AND i.status = 'active'
   AND i.id = (SELECT id FROM finance.income_code WHERE deleted_at IS NULL AND status = 'active' ORDER BY created_at LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM finance.income_code x WHERE x.code = v.code AND x.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION finance.record_housing_fee_receipt(
  p_session_id uuid, p_cashier_id uuid, p_allocation_id uuid, p_payer_name text,
  p_currency finance.currency_code, p_method text, p_lines jsonb,
  p_deposit_account_id uuid DEFAULT NULL, p_party_id uuid DEFAULT NULL,
  p_method_reference text DEFAULT NULL, p_narration text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a record; v_receipt uuid; v_bad text;
BEGIN
  SELECT * INTO a FROM housing.allocation WHERE id = p_allocation_id AND ended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'that housing allocation is not on the register' USING ERRCODE = '23503'; END IF;
  SELECT string_agg(COALESCE(i.code, x->>'income_code_id'), ', ') INTO v_bad
    FROM jsonb_array_elements(p_lines) x
    LEFT JOIN finance.income_code i ON i.id = (x->>'income_code_id')::uuid AND i.deleted_at IS NULL
   WHERE i.housing_fee_kind IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'a housing fee receipt carries housing fees only; % is not one', v_bad USING ERRCODE = '23514';
  END IF;
  v_receipt := finance.record_cash_receipt(
    p_session_id, p_cashier_id, p_payer_name, p_currency, p_method, p_lines,
    p_deposit_account_id, p_party_id, p_method_reference,
    COALESCE(NULLIF(btrim(p_narration), ''), 'Housing fee, stand ' || a.parcel_id));
  INSERT INTO finance.housing_fee (authority_id, fee_kind, allocation_id, cash_receipt_id, amount, currency, received_on)
  SELECT cr.authority_id, i.housing_fee_kind, p_allocation_id, cr.id, sum(l.amount), cr.currency::text, cr.received_on
    FROM finance.cash_receipt cr
    JOIN finance.cash_receipt_line l ON l.cash_receipt_id = cr.id
    JOIN finance.income_code i ON i.id = l.income_code_id
   WHERE cr.id = v_receipt
   GROUP BY cr.authority_id, i.housing_fee_kind, cr.id, cr.currency, cr.received_on;
  IF EXISTS (SELECT 1 FROM finance.housing_fee WHERE cash_receipt_id = v_receipt AND fee_kind IN ('stand_deposit', 'stand_balance')) THEN
    UPDATE housing.allocation SET deposit_receipt_id = COALESCE(deposit_receipt_id, v_receipt),
           deposit_paid_on = COALESCE(deposit_paid_on, CURRENT_DATE), updated_at = now()
     WHERE id = p_allocation_id;
  END IF;
  RETURN v_receipt;
END $$;

-- Tighter allocation: recommended (or a written waiver), six months on the list, one stand.
-- Drop the 259 six-argument form so callers cannot still allocate an un-recommended name.
DROP FUNCTION IF EXISTS housing.allocate_stand(uuid, varchar, uuid, text, numeric, numeric);
CREATE OR REPLACE FUNCTION housing.allocate_stand(
  p_waiting_id uuid, p_parcel_id varchar, p_by uuid, p_minute text, p_price numeric, p_deposit numeric,
  p_waiver text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  w housing.waiting_list%ROWTYPE;
  p record;
  v_id uuid;
BEGIN
  SELECT * INTO w FROM housing.waiting_list WHERE id = p_waiting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'that waiting-list entry is not on the register' USING ERRCODE = '23503'; END IF;
  IF w.status IS DISTINCT FROM 'recommended' AND (p_waiver IS NULL OR btrim(p_waiver) = '') THEN
    RAISE EXCEPTION 'only a recommended waiting-list entry can be allocated a stand; record a written waiver if the committee authorised an exception'
      USING ERRCODE = '23514';
  END IF;
  IF COALESCE(w.seasoning_until, w.registered_on + interval '6 months') > CURRENT_DATE
     AND (p_waiver IS NULL OR btrim(p_waiver) = '') THEN
    RAISE EXCEPTION 'the applicant has not been on the waiting list for six months'
      USING ERRCODE = '23514';
  END IF;
  SELECT parcel_id, township_code INTO p FROM land.parcel WHERE parcel_id = p_parcel_id AND status = 'current';
  IF NOT FOUND THEN RAISE EXCEPTION 'that stand is not on the land register' USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM housing.allocation WHERE parcel_id = p_parcel_id AND ended_at IS NULL AND status NOT IN ('cancelled','repossessed')) THEN
    RAISE EXCEPTION 'that stand is already allocated' USING ERRCODE = '23505';
  END IF;
  INSERT INTO housing.allocation
    (waiting_list_id, person_id, allottee_name, parcel_id, scheme_id, status, committee_minute,
     purchase_price, deposit_due, first_due_on, balance_due_on, waiver_reason, created_by)
  SELECT w.id, w.person_id, w.applicant_name, p.parcel_id, s.id, 'reserved', p_minute, p_price, p_deposit,
         CURRENT_DATE + 30, CURRENT_DATE + 90, NULLIF(btrim(p_waiver), ''), p_by
    FROM (SELECT 1) x LEFT JOIN housing.scheme s ON s.township_code = p.township_code
  RETURNING id INTO v_id;
  UPDATE housing.waiting_list SET status = 'allocated', updated_at = now() WHERE id = w.id;
  INSERT INTO housing.event (kind, subject_id, parcel_id, detail, created_by)
    VALUES ('allocated', v_id, p_parcel_id, jsonb_build_object('waiting_list_id', w.id, 'list_no', w.list_no), p_by);
  RETURN v_id;
END $$;

CREATE OR REPLACE VIEW housing.v_cross_file WITH (security_invoker = true) AS
SELECT v.parcel_id, v.stand_no, v.township_code, v.ward_code, v.area_m2, v.map_status, v.allottee_name,
       v.scheme_name, v.allocation_id, v.water, v.sewer, v.road, v.electricity,
       a.deposit_receipt_id, a.deposit_paid_on, a.first_due_on, a.balance_due_on, a.purchase_price, a.deposit_due,
       cr.receipt_no AS deposit_receipt_no,
       pf.account_no AS rates_account, pf.usd_balance::text AS rates_balance_usd,
       CASE WHEN pf.usd_balance > 0 THEN 'in_arrears' WHEN pf.rates_account_id IS NOT NULL THEN 'current' ELSE NULL END AS rates_band,
       (SELECT count(*)::int FROM spatial_planning.permit_application pa
         WHERE pa.parcel_id = v.parcel_id OR pa.stand_number = v.stand_no) AS planning_files
  FROM housing.v_spatial_stand v
  LEFT JOIN housing.allocation a ON a.id = v.allocation_id
  LEFT JOIN finance.cash_receipt cr ON cr.id = a.deposit_receipt_id
  LEFT JOIN finance.v_property_finance pf ON pf.parcel_id = v.parcel_id;
COMMENT ON VIEW housing.v_cross_file IS
  'One stand as Housing, Finance and Planning each see it: allocation, deposit receipt, rates, permit count.';

DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON housing.v_cross_file TO vungu_app;
    FOR r IN
      SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE (n.nspname, p.proname) IN (('housing','allocate_stand'), ('finance','record_housing_fee_receipt'))
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO vungu_app', r.sig);
    END LOOP;
  END IF;
END $$;
