-- 214: the fixed-asset register, depreciation and disposals.
--
-- Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §6 and
-- docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md §5.8 (frontend repo).
-- Routes: src/routes/finance-assets.js. Rollback: migrations/rollback/214_finance_fixed_assets.down.sql.
--
-- WHAT THE REGISTER IS, AND WHAT POSTS
-- The register lists each asset: what it cost, when it was acquired, where it is and who holds it.
-- REGISTERING AN ASSET POSTS NOTHING. Its cost reaches the ledger where it always did: the supplier
-- invoice or journal that bought it, or the opening balances brought across at cut-over. The
-- screen therefore shows, per category, the register's total beside the ledger account's balance,
-- so a difference between the two is seen rather than assumed away.
--
--   depreciation run   Dr depreciation expense / Cr accumulated depreciation, per category, for
--                      one accounting period and one currency. Dated the period's last day.
--   disposal           Cr the asset account with its cost, Dr accumulated depreciation with what
--                      has been charged, Dr bank with any proceeds, and the difference to the
--                      gain-or-loss account named on the disposal.
-- Both are drafts until somebody other than whoever raised them approves, which is
-- finance.post_voucher().
--
-- THE METHOD IS STRAIGHT LINE, BY WHOLE MONTHS: (cost − residual value) ÷ useful life in months,
-- for each month an accounting period covers, from the period `depreciation_start` falls in, never
-- beyond the depreciable amount. A period before the register took an asset on is not caught up:
-- what was charged before is entered on the asset as depreciation already charged. The last month
-- takes whatever remains, so an asset ends at exactly its residual value. A category whose method
-- is `none` (land) is never depreciated. The useful lives and residual values are the Council's
-- accounting policy; none is seeded here and no category exists until the Council's are entered.
--
-- IDEMPOTENT. Safe to re-run.

CREATE TABLE IF NOT EXISTS finance.asset_category (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id            integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  code                    text NOT NULL,
  name                    text NOT NULL,
  asset_account_id        uuid NOT NULL REFERENCES finance.ledger_account (id),
  accumulated_account_id  uuid REFERENCES finance.ledger_account (id),
  expense_account_id      uuid REFERENCES finance.ledger_account (id),
  method                  text NOT NULL DEFAULT 'straight_line' CONSTRAINT asset_category_method_known
                          CHECK (method IN ('straight_line', 'none')),
  useful_life_months      integer CONSTRAINT asset_category_life_positive CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  residual_pct            numeric(5,2) NOT NULL DEFAULT 0 CONSTRAINT asset_category_residual_in_range CHECK (residual_pct >= 0 AND residual_pct < 100),
  status                  text NOT NULL DEFAULT 'active' CONSTRAINT asset_category_status_known CHECK (status IN ('active', 'inactive')),
  created_by              uuid REFERENCES public.users (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_category_depreciable_is_complete CHECK (
    method = 'none' OR (accumulated_account_id IS NOT NULL AND expense_account_id IS NOT NULL AND useful_life_months IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_category_code ON finance.asset_category (authority_id, upper(code));

CREATE TABLE IF NOT EXISTS finance.fixed_asset (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id          integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  asset_no              text NOT NULL,
  name                  text NOT NULL CONSTRAINT fixed_asset_name_length CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  description           text,
  category_id           uuid NOT NULL REFERENCES finance.asset_category (id),
  currency              finance.currency_code NOT NULL,
  cost                  numeric(18,2) NOT NULL CONSTRAINT fixed_asset_cost_positive CHECK (cost > 0),
  residual_value        numeric(18,2) NOT NULL DEFAULT 0,
  -- Depreciation already charged before this register took the asset on (an asset brought across
  -- at cut-over). The ledger's accumulated-depreciation balance came with the opening balances.
  accumulated_opening   numeric(18,2) NOT NULL DEFAULT 0,
  acquired_on           date NOT NULL,
  depreciation_start    date NOT NULL,
  useful_life_months    integer CONSTRAINT fixed_asset_life_positive CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  serial_no             text,
  location              text,
  custodian             text,
  department_id         uuid REFERENCES finance.department (id),
  -- The document that bought it, when it is in this ledger. A link for the reader, not a posting.
  acquisition_voucher_id uuid REFERENCES finance.voucher (id),
  disposed_on           date,
  disposal_proceeds     numeric(18,2),
  disposal_voucher_id   uuid REFERENCES finance.voucher (id),
  disposal_note         text,
  created_by            uuid NOT NULL REFERENCES public.users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_residual_in_range CHECK (residual_value >= 0 AND residual_value < cost),
  CONSTRAINT fixed_asset_opening_in_range CHECK (accumulated_opening >= 0 AND accumulated_opening <= cost - residual_value),
  CONSTRAINT fixed_asset_start_not_before_acquired CHECK (depreciation_start >= acquired_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_asset_no ON finance.fixed_asset (authority_id, asset_no);
CREATE INDEX IF NOT EXISTS idx_fixed_asset_category ON finance.fixed_asset (category_id);

CREATE TABLE IF NOT EXISTS finance.depreciation_run (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id      integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  run_no            text NOT NULL,
  financial_year_id uuid NOT NULL REFERENCES finance.financial_year (id),
  ledger_period_id  uuid NOT NULL REFERENCES finance.ledger_period (id),
  currency          finance.currency_code NOT NULL,
  period_from       date NOT NULL,
  period_to         date NOT NULL,
  total             numeric(18,2) NOT NULL,
  voucher_id        uuid NOT NULL REFERENCES finance.voucher (id),
  prepared_by       uuid NOT NULL REFERENCES public.users (id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_run_no ON finance.depreciation_run (authority_id, run_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_run_voucher ON finance.depreciation_run (voucher_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_run_period ON finance.depreciation_run (ledger_period_id, currency);

CREATE TABLE IF NOT EXISTS finance.depreciation_charge (
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  run_id       uuid NOT NULL REFERENCES finance.depreciation_run (id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES finance.fixed_asset (id),
  amount       numeric(18,2) NOT NULL CONSTRAINT depreciation_charge_positive CHECK (amount > 0),
  PRIMARY KEY (run_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_depreciation_charge_asset ON finance.depreciation_charge (asset_id);

-- A voucher that stands: not cancelled, and not undone by a posted reversal.
CREATE OR REPLACE FUNCTION finance.voucher_stands(p_voucher_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM finance.voucher v WHERE v.id = p_voucher_id AND v.status <> 'cancelled')
     AND NOT EXISTS (SELECT 1 FROM finance.voucher r WHERE r.reverses_voucher_id = p_voucher_id AND r.status = 'posted')
$$;

-- The register as a person reads it. `charged` counts POSTED runs that still stand; a run awaiting
-- approval is shown separately so the carrying amount is never ahead of the ledger.
DROP VIEW IF EXISTS finance.v_asset_register;
CREATE VIEW finance.v_asset_register WITH (security_invoker = true) AS
SELECT a.id, a.authority_id, a.asset_no, a.name, a.description, a.category_id, c.code AS category_code, c.name AS category_name,
       c.method, a.currency, a.cost, a.residual_value, a.accumulated_opening,
       COALESCE(a.useful_life_months, c.useful_life_months) AS useful_life_months,
       a.acquired_on, a.depreciation_start, a.serial_no, a.location, a.custodian, a.department_id,
       a.acquisition_voucher_id, a.disposed_on, a.disposal_proceeds, a.disposal_voucher_id, a.disposal_note,
       ch.posted AS charged, ch.draft AS charged_in_draft,
       (a.accumulated_opening + ch.posted)::numeric(18,2) AS accumulated,
       (a.cost - a.accumulated_opening - ch.posted)::numeric(18,2) AS carrying_amount,
       CASE WHEN dv.status = 'posted' AND finance.voucher_stands(dv.id) THEN 'disposed'
            WHEN dv.status = 'draft' THEN 'disposal_awaiting_approval'
            WHEN c.method = 'none' THEN 'not_depreciated'
            WHEN a.cost - a.residual_value - a.accumulated_opening - ch.posted <= 0 THEN 'fully_depreciated'
            ELSE 'in_use' END AS status
  FROM finance.fixed_asset a
  JOIN finance.asset_category c ON c.id = a.category_id
  LEFT JOIN finance.voucher dv ON dv.id = a.disposal_voucher_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(dc.amount) FILTER (WHERE rv.status = 'posted'), 0)::numeric(18,2) AS posted,
           COALESCE(sum(dc.amount) FILTER (WHERE rv.status = 'draft'), 0)::numeric(18,2) AS draft
      FROM finance.depreciation_charge dc
      JOIN finance.depreciation_run r ON r.id = dc.run_id
      JOIN finance.voucher rv ON rv.id = r.voucher_id
     WHERE dc.asset_id = a.id AND finance.voucher_stands(rv.id)) ch;

-- ── A depreciation run ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.run_depreciation(p_period_id uuid, p_currency text, p_user uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  p record; v_no text; v_voucher uuid; v_run uuid; v_total numeric; v_line integer := 0; g record; v_due jsonb;
BEGIN
  SELECT lp.id, lp.authority_id, lp.financial_year_id, lp.period_no, lp.label, lp.from_date, lp.to_date, lp.status
    INTO p FROM finance.ledger_period lp WHERE lp.id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such accounting period' USING ERRCODE = '23503'; END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'accounting period % is % and accepts no postings', p.period_no, p.status USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('finance.depreciation_run'), hashtext(p_period_id::text || p_currency));
  IF EXISTS (SELECT 1 FROM finance.depreciation_run r
              WHERE r.ledger_period_id = p_period_id AND r.currency::text = p_currency AND finance.voucher_stands(r.voucher_id)) THEN
    RAISE EXCEPTION 'depreciation for period % in % has already been run', p.period_no, p_currency
      USING ERRCODE = '23514', HINT = 'Discard the draft run, or reverse the posted one, before running it again.';
  END IF;

  -- What each asset is due, held in a variable: no temporary table, so the application's own
  -- database role needs no extra privilege.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('asset_id', x.asset_id, 'category_id', x.category_id,
                                               'amount', LEAST(x.remaining, round(x.monthly * x.months, 2)))), '[]'::jsonb)
    INTO v_due
    FROM (
      SELECT a.id AS asset_id, a.category_id,
             (a.cost - a.residual_value) / COALESCE(a.useful_life_months, c.useful_life_months) AS monthly,
             -- The months this accounting period covers, by its own length (a period that runs from
             -- the 5th to the 4th is one month, a quarter is three, and a short first period counts
             -- as one). An asset that starts depreciating part-way through a period is charged
             -- for the whole of it.
             (date_part('year', age(p.to_date + 1, p.from_date)) * 12 + date_part('month', age(p.to_date + 1, p.from_date))
              + CASE WHEN date_part('day', age(p.to_date + 1, p.from_date)) > 0 THEN 1 ELSE 0 END)::int AS months,
             a.cost - a.residual_value - a.accumulated_opening - COALESCE((
               SELECT sum(dc.amount) FROM finance.depreciation_charge dc
                 JOIN finance.depreciation_run r ON r.id = dc.run_id
                WHERE dc.asset_id = a.id AND finance.voucher_stands(r.voucher_id)), 0) AS remaining
        FROM finance.fixed_asset a
        JOIN finance.asset_category c ON c.id = a.category_id
       WHERE a.authority_id = p.authority_id AND a.currency::text = p_currency AND c.method = 'straight_line'
         AND a.depreciation_start <= p.to_date
         AND (a.disposal_voucher_id IS NULL OR NOT finance.voucher_stands(a.disposal_voucher_id))) x
   WHERE x.remaining > 0 AND x.months > 0;

  SELECT COALESCE(sum(amount), 0) INTO v_total FROM jsonb_to_recordset(v_due) AS d(asset_id uuid, category_id uuid, amount numeric) WHERE amount > 0;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'no asset in % has depreciation to charge for period %', p_currency, p.period_no USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('finance.document_write', 'on', true);
  v_no := finance.next_document_no(p.authority_id, 'depreciation');
  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, narration, status, prepared_by)
  VALUES (p.authority_id, v_no, 'depreciation', p_currency::finance.currency_code, p.financial_year_id, p.to_date,
          'Depreciation for ' || COALESCE(p.label, 'period ' || p.period_no), 'draft', p_user)
  RETURNING id INTO v_voucher;
  INSERT INTO finance.depreciation_run
    (authority_id, run_no, financial_year_id, ledger_period_id, currency, period_from, period_to, total, voucher_id, prepared_by)
  VALUES (p.authority_id, v_no, p.financial_year_id, p.id, p_currency::finance.currency_code, p.from_date, p.to_date, v_total, v_voucher, p_user)
  RETURNING id INTO v_run;
  INSERT INTO finance.depreciation_charge (authority_id, run_id, asset_id, amount)
  SELECT p.authority_id, v_run, d.asset_id, d.amount
    FROM jsonb_to_recordset(v_due) AS d(asset_id uuid, category_id uuid, amount numeric) WHERE d.amount > 0;

  FOR g IN SELECT c.name, c.expense_account_id, c.accumulated_account_id, sum(d.amount) AS amount
             FROM jsonb_to_recordset(v_due) AS d(asset_id uuid, category_id uuid, amount numeric)
             JOIN finance.asset_category c ON c.id = d.category_id
            WHERE d.amount > 0 GROUP BY c.id, c.name, c.expense_account_id, c.accumulated_account_id ORDER BY c.name LOOP
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (p.authority_id, v_voucher, v_line + 1, g.expense_account_id, g.amount, 0, 'Depreciation: ' || g.name),
           (p.authority_id, v_voucher, v_line + 2, g.accumulated_account_id, 0, g.amount, 'Depreciation: ' || g.name);
    v_line := v_line + 2;
  END LOOP;
  PERFORM set_config('finance.document_write', 'off', true);
  RETURN v_run;
END $$;

CREATE OR REPLACE FUNCTION finance.discard_depreciation_run(p_run_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT dr.run_no, dr.voucher_id, v.status INTO r FROM finance.depreciation_run dr JOIN finance.voucher v ON v.id = dr.voucher_id
   WHERE dr.id = p_run_id FOR UPDATE OF dr;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such depreciation run' USING ERRCODE = '23503'; END IF;
  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'run % is % and can no longer be discarded', r.run_no, r.status USING ERRCODE = '23514',
      HINT = 'A posted run is corrected by reversing its voucher.';
  END IF;
  PERFORM set_config('finance.document_write', 'on', true);
  DELETE FROM finance.depreciation_run WHERE id = p_run_id;
  DELETE FROM finance.voucher WHERE id = r.voucher_id;
  PERFORM set_config('finance.document_write', 'off', true);
  RETURN r.run_no;
END $$;

-- ── Disposal ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.dispose_asset(
  p_asset_id uuid, p_disposed_on date, p_proceeds numeric, p_proceeds_account_id uuid,
  p_gain_loss_account_id uuid, p_note text, p_user uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  a record; c record; y record; v_no text; v_voucher uuid; v_line integer := 0; v_diff numeric;
BEGIN
  SELECT * INTO a FROM finance.v_asset_register WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such asset' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM finance.fixed_asset WHERE id = p_asset_id FOR UPDATE;
  IF a.status IN ('disposed', 'disposal_awaiting_approval') THEN
    RAISE EXCEPTION 'asset % is already % ', a.asset_no, replace(a.status, '_', ' ') USING ERRCODE = '23514';
  END IF;
  IF a.charged_in_draft > 0 THEN
    RAISE EXCEPTION 'asset % is in a depreciation run awaiting approval', a.asset_no USING ERRCODE = '23514',
      HINT = 'Approve or discard that run first, so the disposal uses the depreciation actually charged.';
  END IF;
  IF length(btrim(COALESCE(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'a disposal records how the asset left the council (sold, scrapped, stolen)' USING ERRCODE = '23502';
  END IF;
  p_proceeds := COALESCE(p_proceeds, 0);
  IF p_proceeds < 0 THEN RAISE EXCEPTION 'proceeds cannot be negative' USING ERRCODE = '23514'; END IF;
  IF p_proceeds > 0 AND p_proceeds_account_id IS NULL THEN
    RAISE EXCEPTION 'name the bank or debtor account the proceeds are received into' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM finance.asset_category WHERE id = a.category_id;
  SELECT fy.id INTO y FROM finance.financial_year fy
   WHERE fy.deleted_at IS NULL AND p_disposed_on BETWEEN fy.start_date AND fy.end_date AND fy.authority_id = a.authority_id
   ORDER BY (fy.status = 'open') DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no financial year contains %', p_disposed_on USING ERRCODE = '23514'; END IF;

  -- What is left after the asset's cost, its depreciation and the proceeds: a loss when positive.
  v_diff := a.cost - a.accumulated - p_proceeds;
  IF v_diff <> 0 AND p_gain_loss_account_id IS NULL THEN
    RAISE EXCEPTION 'the disposal leaves a % of %; name the account it is posted to',
      CASE WHEN v_diff > 0 THEN 'loss' ELSE 'gain' END, abs(v_diff) USING ERRCODE = '23514';
  END IF;
  IF a.accumulated > 0 AND c.accumulated_account_id IS NULL THEN
    RAISE EXCEPTION 'category % names no accumulated-depreciation account', c.name USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('finance.document_write', 'on', true);
  v_no := finance.next_document_no(a.authority_id, 'asset_disposal');
  INSERT INTO finance.voucher
    (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, narration, reference, status, prepared_by)
  VALUES (a.authority_id, v_no, 'asset_disposal', a.currency, y.id, p_disposed_on,
          'Disposal of ' || a.asset_no || ' ' || a.name || ': ' || btrim(p_note), a.asset_no, 'draft', p_user)
  RETURNING id INTO v_voucher;

  v_line := v_line + 1;
  INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
  VALUES (a.authority_id, v_voucher, v_line, c.asset_account_id, 0, a.cost, 'Cost of ' || a.asset_no || ' removed');
  IF a.accumulated > 0 THEN
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (a.authority_id, v_voucher, v_line, c.accumulated_account_id, a.accumulated, 0, 'Depreciation of ' || a.asset_no || ' removed');
  END IF;
  IF p_proceeds > 0 THEN
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (a.authority_id, v_voucher, v_line, p_proceeds_account_id, p_proceeds, 0, 'Proceeds of ' || a.asset_no);
  END IF;
  IF v_diff <> 0 THEN
    v_line := v_line + 1;
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (a.authority_id, v_voucher, v_line, p_gain_loss_account_id,
            CASE WHEN v_diff > 0 THEN v_diff ELSE 0 END, CASE WHEN v_diff < 0 THEN -v_diff ELSE 0 END,
            CASE WHEN v_diff > 0 THEN 'Loss' ELSE 'Gain' END || ' on disposal of ' || a.asset_no);
  END IF;
  PERFORM set_config('finance.document_write', 'off', true);

  UPDATE finance.fixed_asset
     SET disposed_on = p_disposed_on, disposal_proceeds = p_proceeds, disposal_voucher_id = v_voucher,
         disposal_note = btrim(p_note), updated_at = now()
   WHERE id = p_asset_id;
  RETURN v_voucher;
END $$;

CREATE OR REPLACE FUNCTION finance.withdraw_asset_disposal(p_asset_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_voucher uuid; v_status text;
BEGIN
  SELECT a.disposal_voucher_id INTO v_voucher FROM finance.fixed_asset a WHERE a.id = p_asset_id FOR UPDATE;
  IF v_voucher IS NULL THEN RAISE EXCEPTION 'this asset has no disposal to withdraw' USING ERRCODE = '23514'; END IF;
  SELECT status INTO v_status FROM finance.voucher WHERE id = v_voucher;
  IF v_status = 'posted' AND finance.voucher_stands(v_voucher) THEN
    RAISE EXCEPTION 'the disposal is posted; reverse its voucher to undo it' USING ERRCODE = '23514';
  END IF;
  UPDATE finance.fixed_asset
     SET disposed_on = NULL, disposal_proceeds = NULL, disposal_voucher_id = NULL, disposal_note = NULL, updated_at = now()
   WHERE id = p_asset_id;
  IF v_status = 'draft' THEN
    PERFORM set_config('finance.document_write', 'on', true);
    DELETE FROM finance.voucher WHERE id = v_voucher;
    PERFORM set_config('finance.document_write', 'off', true);
  END IF;
END $$;

-- An asset's figures are frozen once depreciation has been charged on them or it has been disposed of.
CREATE OR REPLACE FUNCTION finance.guard_fixed_asset_figures() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.cost, NEW.residual_value, NEW.accumulated_opening, NEW.depreciation_start, NEW.currency, NEW.category_id,
      COALESCE(NEW.useful_life_months, 0))
     IS DISTINCT FROM
     (OLD.cost, OLD.residual_value, OLD.accumulated_opening, OLD.depreciation_start, OLD.currency, OLD.category_id,
      COALESCE(OLD.useful_life_months, 0))
     AND EXISTS (SELECT 1 FROM finance.depreciation_charge dc JOIN finance.depreciation_run r ON r.id = dc.run_id
                  WHERE dc.asset_id = OLD.id AND finance.voucher_stands(r.voucher_id)) THEN
    RAISE EXCEPTION 'asset % has depreciation charged on these figures and they can no longer be changed', OLD.asset_no
      USING ERRCODE = '23514', HINT = 'Reverse the depreciation runs first, or dispose of the asset and register it again.';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance.fixed_asset'::regclass AND tgname = 'trg_fixed_asset_figures') THEN
    CREATE TRIGGER trg_fixed_asset_figures BEFORE UPDATE ON finance.fixed_asset
      FOR EACH ROW EXECUTE FUNCTION finance.guard_fixed_asset_figures();
  END IF;
END $$;

-- ── Permissions ───────────────────────────────────────────────────────────────────────────────
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.assets.view',    'View the asset register',  'assets', false, false, false, 'The fixed-asset register, depreciation runs and disposals.'),
  ('finance.assets.manage',  'Keep the asset register',  'assets', false, false, false, 'Register assets and categories, raise a depreciation run and a disposal. Each is a draft until somebody else approves it.'),
  ('finance.assets.approve', 'Approve depreciation and disposals', 'assets', true, false, false, 'Approve a depreciation run or a disposal, which posts it. Never the person who raised it.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted, description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, c FROM (VALUES
  ('accountant', 'finance.assets.view'), ('accountant', 'finance.assets.manage'), ('accountant', 'finance.assets.approve'),
  ('finance_admin', 'finance.assets.view'), ('finance_admin', 'finance.assets.manage'), ('finance_admin', 'finance.assets.approve'),
  ('finance_officer', 'finance.assets.view'), ('finance_officer', 'finance.assets.manage'),
  ('finance_committee', 'finance.assets.view'), ('accounting_officer', 'finance.assets.view'), ('auditor', 'finance.assets.view')
) AS t(r, c)
ON CONFLICT (role_name, permission_code) DO NOTHING;

DO $$
DECLARE r text;
  tables text[] := ARRAY['finance.asset_category', 'finance.fixed_asset', 'finance.depreciation_run', 'finance.depreciation_charge'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY tables LOOP PERFORM tenancy.classify(r, 'pending', 'asset register data awaiting the authority it belongs to'); END LOOP;
    RETURN;
  END IF;
  FOREACH r IN ARRAY tables LOOP PERFORM tenancy.make_tenant(r::regclass, 'VUNGU'); END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_asset_register TO vungu_app;
    -- An asset leaves the register by disposal, never by deletion.
    REVOKE DELETE, TRUNCATE ON finance.fixed_asset FROM vungu_app;
  END IF;
  PERFORM tenancy.classify('finance.v_asset_register', 'tenant_view', 'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;
