-- 201_authority_ward_provisional_register.sql
--
-- DECISION D11, PROVISIONALLY — the Council's ward list, loaded as INTERIM reference geography.
--
-- WHAT THIS IS. `admin.authority_ward` held zero rows, so Vungu RDC was linked to no ward
-- boundaries at all: `finance.v_ward_performance.ward_status` reported 'unlinked' for every coded
-- ward, `/api/finance/map/ward-geometry` returned `features: []`, and no choropleth could render.
-- The project owner has directed (docs/finance/DECISION-REGISTER.md, "Addendum — owner direction
-- recorded 2026-11-09") that the COD-AB wards of district ZW1704 be linked to authority VUNGU as
-- PROVISIONAL data so the map can be built, with the provisional status carried in the data.
--
-- WHAT THIS IS NOT. It is not a Council act and it is not evidence of one. D11 remains formally
-- OPEN against the Chief Executive Officer / Chamber Secretary. `basis = 'interim'` — one of the
-- four values migration 163 already provides for exactly this — and `instrument_ref` says in plain
-- words that the list is unconfirmed. Every surface that names the ward list must label it
-- provisional; `basis` is the column that lets it.
--
-- WHAT IT DOES NOT AUTHORISE. This is reference GEOGRAPHY the Council must confirm. It is not a
-- licence to invent a budget figure, a project, a transaction or a ward code on a finance row.
-- Nothing in the finance schema is written here.
--
-- MEASURED, NOT ASSUMED. The count is whatever `admin.ward.parent_pcode = 'ZW1704'` actually
-- contains in THIS database. The audit measured 19 in `vungu_dev`; a database where the national
-- register has not been imported has none, and this migration then links none and says so rather
-- than inventing a ward code to reach a hoped-for total.
--
-- REVERSIBLE BY ONE MIGRATION. When the Council confirms its real list, one migration closes these
-- memberships (`UPDATE admin.authority_ward SET valid_to = <instrument date> WHERE basis =
-- 'interim' AND instrument_ref = 'PROVISIONAL-D11-2026-11-09'`) and inserts the confirmed rows with
-- basis 'proclamation'/'delimitation'. The `instrument_ref` below is the handle for that, which is
-- why it is an exact, greppable string and not free prose. No feature code changes.
--
-- IDEMPOTENT. A fixed `valid_from` (the date of the owner direction, not CURRENT_DATE, which would
-- mint a new primary key on every run) plus a NOT EXISTS guard against any live membership for the
-- same ward.

BEGIN;

DO $$
DECLARE
  v_authority   integer;
  v_candidates  integer;
  v_inserted    integer;
  v_linked      integer;
  -- The handle a future confirming migration greps for. Changing it breaks that reversal.
  c_instrument  text := 'PROVISIONAL-D11-2026-11-09: provisional ward list for Vungu RDC, '
                     || 'loaded from the COD-AB national register (district ZW1704) on owner '
                     || 'direction of 2026-11-09. UNCONFIRMED — pending a Council resolution and '
                     || 'the delimitation instrument. Not evidence of a Council act.';
  c_valid_from  date := DATE '2026-11-09';
  c_district    text := 'ZW1704';
BEGIN
  SELECT id INTO v_authority FROM public.local_authorities WHERE code = 'VUNGU';
  IF v_authority IS NULL THEN
    RAISE NOTICE '[201] no VUNGU authority in this database: no ward memberships loaded';
    RETURN;
  END IF;

  -- Verify the wards exist before inserting anything, and insert exactly what is found.
  SELECT count(*) INTO v_candidates
    FROM admin.ward w WHERE w.parent_pcode = c_district;

  IF v_candidates = 0 THEN
    RAISE NOTICE '[201] admin.ward has no rows with parent_pcode=%: the national ward register '
                 'has not been imported into this database, so authority % is linked to no wards. '
                 'This is the honest D11 state, not a failure.', c_district, v_authority;
    RETURN;
  END IF;

  INSERT INTO admin.authority_ward
    (authority_id, ward_code, valid_from, valid_to, basis, instrument_ref, note)
  SELECT v_authority, w.ward_code, c_valid_from, NULL, 'interim', c_instrument,
         'Provisional: COD-AB district ' || c_district || ' ward list, unconfirmed by Council.'
    FROM admin.ward w
   WHERE w.parent_pcode = c_district
     -- Any live membership for this ward (to any authority) is left exactly as it is: the
     -- authority_ward_check trigger forbids overlapping memberships, and a real confirmed row
     -- must never be displaced by a provisional one.
     AND NOT EXISTS (
       SELECT 1 FROM admin.authority_ward aw
        WHERE aw.ward_code = w.ward_code AND aw.valid_to IS NULL)
  ON CONFLICT (authority_id, ward_code, valid_from) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT count(*) INTO v_linked
    FROM admin.authority_ward aw
   WHERE aw.authority_id = v_authority AND aw.valid_to IS NULL;

  RAISE NOTICE '[201] district % carries % ward(s) in admin.ward; % newly linked to authority % '
               'as basis=interim; % live membership(s) in total.',
               c_district, v_candidates, v_inserted, v_authority, v_linked;
END $$;

-- The assertion this migration is willing to fail on: nothing it loaded may claim a basis it does
-- not have. A provisional row recorded as 'proclamation' or 'delimitation' would read as a Council
-- act in every surface that shows the basis, which is the one thing D11 forbids.
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM admin.authority_ward
   WHERE instrument_ref LIKE 'PROVISIONAL-D11-2026-11-09:%'
     AND basis <> 'interim';
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '[201] % provisional ward membership(s) carry a basis other than ''interim''; the '
      'provisional status must be carried in the data (decision D11)', v_bad;
  END IF;
END $$;

COMMIT;
