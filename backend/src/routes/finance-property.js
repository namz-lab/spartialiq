/**
 * Property finance on the Planning register — the GIS-integrated finance surfaces and the
 * Planning -> Finance integration (migration 244).
 *
 *   GET  /finance/property/map                 every current parcel as GeoJSON, with its financial status
 *   GET  /finance/property/layers              ward boundaries with their figures, planning zones, projects, roads
 *   GET  /finance/property/search?q=           stand number, account, customer, allocation ref, ward, township (national ID with permission)
 *   GET  /finance/property/analytics           figures by ward and township, status counts, largest balances
 *   GET  /finance/property/:parcelId           the property financial profile: Planning facts, account, bills, receipts, history
 *   GET  /finance/property/integration         synchronisation monitoring: runs, event counts, events, exceptions
 *   POST /finance/property/integration/run     discover Planning allocations and open the finance accounts they need
 *   POST /finance/property/integration/events/:id/retry
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE
 *  1. It never writes a Planning table. land.parcel, land.stand_offer and public.stand_allocation
 *     are read; what Finance did about them is recorded in finance.property_integration_event.
 *  2. It never computes money. Balances, overdue amounts and paid totals come from
 *     finance.v_property_finance, which reads finance.v_rates_arrears and posted receipts; payments
 *     are taken by the existing cash office route (POST /finance/cash/receipts/rates) and posted by
 *     somebody else, exactly as before. Ward totals are GROUP BYs in SQL, returned as strings.
 *  3. It does not bill. Opening an account makes a property billable; the next rates billing run
 *     bills it under the approved tariff, prepared and committed by two different people.
 */

const { requirePermission, hasPermission } = require('../middleware/financePermissions')
const { dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/** The broad land-use class the map colours by, from the governing zone's name and the tenure. */
function landUseClass(landUse, tenure, kind) {
  const t = `${landUse || ''} ${tenure || ''}`.toLowerCase()
  if (/industr/.test(t)) return 'industrial'
  if (/commerc|business|mixed business|economic corridor|retail|cbd/.test(t)) return 'commercial'
  if (/institution|school|church|clinic|civic|government|public/.test(t)) return 'institutional'
  if (/residential|housing|density/.test(t)) return 'residential'
  if (/state land|council/.test(t)) return 'council'
  if (kind === 'farm' || /agric|farm|resettlement|communal/.test(t)) return 'agricultural'
  return 'other'
}

/** The council's current wards (admin.authority_ward), for the authority of the request. */
const COUNCIL_WARDS = `(SELECT w.ward_code, w.name, w.geom FROM admin.authority_ward aw
     JOIN admin.ward w ON w.ward_code = aw.ward_code
    WHERE aw.valid_to IS NULL AND (app.authority_id() IS NULL OR aw.authority_id = app.authority_id()) AND w.geom IS NOT NULL)`
/** The council's area: its wards merged. */
const COUNCIL_AREA = `(SELECT ST_Union(geom) AS g FROM ${COUNCIL_WARDS} cw)`

const STATUS_LABELS = {
  paid_up: 'Paid up',
  partially_paid: 'Partially paid',
  awaiting_payment: 'Awaiting payment',
  overdue: 'Overdue',
  not_billed: 'Account open, not yet billed',
  allocated_no_account: 'Allocated, no finance account',
  unallocated: 'Unallocated',
  no_account: 'No finance account',
  cancelled: 'Allocation cancelled',
}

/** The parcel columns every list and the profile share. Money stays text. */
const PROPERTY_COLUMNS = `
  f.parcel_id, f.parcel_kind, f.stand_no, f.township_code, f.area_m2::text AS area_m2, f.tenure_class,
  f.ward_code, f.ward_name, f.ward_derived, f.land_use, f.offer_status, f.offer_price_usd::text AS offer_price_usd,
  f.use_scale, f.register_allocation_status, f.allocation_id, f.allocation_reference, f.allottee_name,
  f.allocation_purpose, f.allocated_at, f.rates_account_id, f.account_no, f.party_id, f.party_name,
  f.opened_on::text AS opened_on, f.erp_account_no, f.closed_accounts::int AS closed_accounts,
  f.usd_billed::text AS usd_billed, f.usd_paid::text AS usd_paid, f.usd_balance::text AS usd_balance,
  f.usd_overdue::text AS usd_overdue, f.usd_pending::text AS usd_pending,
  f.zwg_billed::text AS zwg_billed, f.zwg_paid::text AS zwg_paid, f.zwg_balance::text AS zwg_balance,
  f.zwg_overdue::text AS zwg_overdue, f.zwg_pending::text AS zwg_pending,
  f.bills::int AS bills, f.open_bills::int AS open_bills, f.receipts::int AS receipts, f.oldest_days,
  f.last_billed_on::text AS last_billed_on, f.last_paid_on::text AS last_paid_on,
  f.is_allocated, f.payment_pending_posting, f.financial_status`

function decorate(row) {
  return {
    ...row,
    land_use_class: landUseClass(row.land_use, row.tenure_class, row.parcel_kind),
    financial_status_label: STATUS_LABELS[row.financial_status] || row.financial_status,
  }
}

async function financePropertyRoutes(fastify) {
  const pool = fastify.pg
  /**
   * Reads run with JIT off. Under row-level security the planner's cost for
   * finance.v_property_finance passes the JIT threshold, and compiling the plan took 10.7 s of an
   * 11 s query that runs in under a second without it. SET LOCAL keeps the change to this one read.
   */
  const pg = {
    query: async (sql, params) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SET LOCAL jit = off')
        const result = await client.query(sql, params)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    connect: () => pool.connect(),
  }
  const canView = { preHandler: requirePermission(fastify, 'finance.property.view') }
  const canSync = { preHandler: requirePermission(fastify, 'finance.property.sync') }

  async function transact(work) {
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL jit = off')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  // ═══ The map ═════════════════════════════════════════════════════════════════════════════════
  fastify.get('/finance/property/map', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { kind: { type: 'string', enum: ['stand', 'farm', 'all'], default: 'all' } },
      },
    },
  }, async (request, reply) => {
    const kind = request.query.kind
    const { rows } = await pg.query(
      `SELECT ${PROPERTY_COLUMNS},
              ST_AsGeoJSON(CASE WHEN p.parcel_kind = 'stand' THEN p.geom_wgs84
                                ELSE ST_SimplifyPreserveTopology(p.geom_wgs84, 0.0004) END, 6)::json AS geometry
         FROM finance.v_property_finance f
         JOIN land.parcel p ON p.parcel_id = f.parcel_id
        WHERE f.in_authority AND ($1 = 'all' OR f.parcel_kind = $1)
        -- Farms first, stands last: a later feature is drawn on top, and the large farm parcel around a
        -- township would otherwise cover its stands.
        ORDER BY (f.parcel_kind = 'stand'), f.parcel_id`, [kind])
    const features = rows.map(({ geometry, ...props }) => {
      const d = decorate(props)
      return {
        type: 'Feature',
        id: d.parcel_id,
        geometry,
        properties: {
          parcel_id: d.parcel_id, kind: d.parcel_kind, stand_no: d.stand_no, township: d.township_code,
          ward_code: d.ward_code, ward_name: d.ward_name, land_use: d.land_use, land_use_class: d.land_use_class,
          allocated: d.is_allocated, offer_status: d.offer_status, account_no: d.account_no, party_name: d.party_name,
          status: d.financial_status, status_label: d.financial_status_label,
          usd_balance: d.usd_balance, usd_overdue: d.usd_overdue, zwg_balance: d.zwg_balance,
          pending: d.payment_pending_posting, area_m2: d.area_m2,
        },
      }
    })
    return ok(reply, {
      type: 'FeatureCollection', features,
      source: 'land.parcel (Planning register) joined to finance.v_property_finance',
    })
  })

  // Boundaries and planning layers change when Planning changes them, not between two clicks; the
  // council area is a union of its ward polygons and costs ~2 s, so a response is kept 10 minutes.
  const layerCache = new Map()
  fastify.get('/finance/property/layers', { ...canView }, async (request, reply) => {
    const cacheKey = String(request.user?.authority_id ?? 'all')
    const cached = layerCache.get(cacheKey)
    if (cached && cached.at > Date.now() - 10 * 60 * 1000) return ok(reply, cached.data)
    const [wards, zones, projects, roads, townships, area] = await Promise.all([
      pg.query(
        `SELECT w.ward_code, w.name,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(w.geom, 0.0008), 6)::json AS geometry
           FROM ${COUNCIL_WARDS} w ORDER BY w.ward_code`),
      // Planning zones over the parts of the district that hold stands: the zoning the stands sit in.
      pg.query(
        `WITH ext AS (SELECT ST_Expand(ST_Envelope(ST_Collect(geom_wgs84)), 0.01) AS g
                        FROM land.parcel WHERE parcel_kind = 'stand' AND status = 'current')
         SELECT z.id, COALESCE(t.name, z.zone) AS name, z.zone_code, z.zone_type, z.map_color,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(z.geom, 0.00005), 6)::json AS geometry
           FROM spatial_planning.zone z
           LEFT JOIN public.plan_zone_type t ON t.id = z.plan_zone_type_id
           CROSS JOIN ext
          CROSS JOIN ${COUNCIL_AREA} ca
          WHERE z.geom IS NOT NULL AND COALESCE(z.is_active, true) AND ST_Intersects(z.geom, ext.g)
            AND ST_Intersects(z.geom, ca.g)`),
      pg.query(
        `SELECT p.id, p.reference, p.name, p.status, p.ward_code, p.currency,
                p.approved_budget::text AS approved_budget, p.location_text,
                p.physical_progress_percent::text AS progress,
                ST_X(p.location) AS lng, ST_Y(p.location) AS lat
           FROM finance.project p
          CROSS JOIN ${COUNCIL_AREA} ca
          WHERE p.deleted_at IS NULL AND p.location IS NOT NULL AND ST_Intersects(ca.g, p.location)
          ORDER BY p.reference`),
      pg.query(
        `SELECT r.id, r.name, r.hierarchy, r.surface, r.condition, r.status,
                ST_AsGeoJSON(r.geom, 6)::json AS geometry
           FROM council_ops.road_asset r WHERE r.geom IS NOT NULL`).catch(() => ({ rows: [] })),
      // A township (suburb) has no boundary of its own in the register: its outline is drawn as the
      // merged extent of its current stands, and labelled as such.
      pg.query(
        `SELECT p.township_code, count(*)::int AS stands,
                ST_AsGeoJSON(ST_Simplify(ST_Buffer(ST_Union(ST_Buffer(p.geom_wgs84, 0.0002)), -0.0001), 0.00005), 6)::json AS geometry
           FROM land.parcel p
          CROSS JOIN ${COUNCIL_AREA} ca
          WHERE p.status = 'current' AND p.parcel_kind = 'stand' AND p.township_code IS NOT NULL
            AND ST_Intersects(ca.g, ST_PointOnSurface(p.geom_wgs84))
          GROUP BY p.township_code HAVING count(*) >= 3`),
      // The council's boundary, and the world outside it, so the map can mute what is not Vungu's.
      pg.query(
        `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(ca.g, 0.0005), 6)::json AS boundary,
                ST_AsGeoJSON(ST_Difference(ST_MakeEnvelope(20, -26, 37, -12, 4326), ST_SimplifyPreserveTopology(ca.g, 0.0005)), 6)::json AS outside,
                ARRAY[ST_XMin(ca.g), ST_YMin(ca.g), ST_XMax(ca.g), ST_YMax(ca.g)] AS bbox,
                (SELECT authority_name FROM public.local_authorities WHERE id = app.authority_id()) AS name
           FROM ${COUNCIL_AREA} ca`),
    ])
    const fc = (rows, props) => ({
      type: 'FeatureCollection',
      features: rows.filter((r) => r.geometry).map((r) => ({ type: 'Feature', geometry: r.geometry, properties: props(r) })),
    })
    const data = {
      wards: fc(wards.rows, (r) => ({ ward_code: r.ward_code, name: r.name })),
      zones: fc(zones.rows, (r) => ({ id: r.id, name: r.name, zone_code: r.zone_code, zone_type: r.zone_type, color: r.map_color })),
      projects: {
        type: 'FeatureCollection',
        features: projects.rows.map((r) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
          properties: {
            id: r.id, reference: r.reference, name: r.name, status: r.status, ward_code: r.ward_code,
            currency: r.currency, approved_budget: r.approved_budget, location_text: r.location_text, progress: r.progress,
          },
        })),
      },
      roads: fc(roads.rows, (r) => ({ id: r.id, name: r.name, hierarchy: r.hierarchy, surface: r.surface, condition: r.condition })),
      townships: fc(townships.rows, (r) => ({ township: r.township_code, stands: r.stands })),
      council: area.rows[0]?.boundary
        ? { name: area.rows[0].name || 'Vungu Rural District Council', boundary: area.rows[0].boundary, outside: area.rows[0].outside, bbox: area.rows[0].bbox.map(Number) }
        : null,
      // Layers the Planning register does not yet hold. Named so the map can say so rather than hide them.
      unavailable: [
        { id: 'water', label: 'Water infrastructure', reason: 'No water network has been captured in the Planning register.' },
        { id: 'sewer', label: 'Sewer infrastructure', reason: 'No sewer network has been captured in the Planning register.' },
        { id: 'electricity', label: 'Electricity infrastructure', reason: 'No electricity network is held; ZESA data has not been supplied.' },
      ],
    }
    layerCache.set(cacheKey, { at: Date.now(), data })
    return ok(reply, data)
  })

  // ═══ Search ══════════════════════════════════════════════════════════════════════════════════
  fastify.get('/finance/property/search', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false, required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 120 },
          status: { type: 'string', maxLength: 40 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
  }, async (request, reply) => {
    const raw = request.query.q.trim()
    const canIdentity = await hasPermission(fastify, request, 'finance.property.view_identity')
    const like = `%${raw.replace(/[%_]/g, '')}%`
    // Stand numbers are matched exactly first, so "1231" finds stand 1231 before stands 11231 and 2123.
    const { rows } = await pg.query(
      `SELECT ${PROPERTY_COLUMNS},
              ST_X(ST_PointOnSurface(p.geom_wgs84)) AS lng, ST_Y(ST_PointOnSurface(p.geom_wgs84)) AS lat,
              CASE WHEN upper(f.stand_no) = upper($1) OR upper(f.account_no) = upper($1)
                        OR upper(f.parcel_id) = upper($1) OR upper(f.allocation_reference) = upper($1) THEN 0
                   WHEN $4 AND EXISTS (SELECT 1 FROM finance.party_identity i
                                        WHERE i.party_id = f.party_id AND i.kind = 'national_id'
                                          AND upper(replace(i.value, '-', '')) = upper(replace($1, '-', ''))) THEN 0
                   WHEN f.party_name ILIKE $2 OR f.allottee_name ILIKE $2 THEN 1
                   ELSE 2 END AS rank
         FROM finance.v_property_finance f
         JOIN land.parcel p ON p.parcel_id = f.parcel_id
        WHERE (upper(f.stand_no) = upper($1) OR f.stand_no ILIKE $2 OR f.parcel_id ILIKE $2
               OR f.account_no ILIKE $2 OR f.erp_account_no ILIKE $2 OR f.party_name ILIKE $2
               OR f.allottee_name ILIKE $2 OR f.allocation_reference ILIKE $2
               OR f.ward_name ILIKE $2 OR f.ward_code ILIKE $2 OR f.township_code ILIKE $2
               OR upper(f.township_code || ' ' || f.stand_no) = upper($1)
               OR ($4 AND EXISTS (SELECT 1 FROM finance.party_identity i
                                   WHERE i.party_id = f.party_id AND i.kind = 'national_id'
                                     AND upper(replace(i.value, '-', '')) = upper(replace($1, '-', '')))))
          AND f.in_authority
          AND ($5::text IS NULL OR f.financial_status = $5)
        ORDER BY rank, (f.rates_account_id IS NULL), length(f.stand_no), f.stand_no
        LIMIT $3`,
      [raw, like, request.query.limit, canIdentity, request.query.status || null])
    return ok(reply, { results: rows.map(decorate), identity_search: canIdentity })
  })

  // ═══ Analytics ═══════════════════════════════════════════════════════════════════════════════
  fastify.get('/finance/property/analytics', { ...canView }, async (request, reply) => {
    const groupCols = `
      count(*)::int AS parcels,
      count(*) FILTER (WHERE parcel_kind = 'stand')::int AS stands,
      count(*) FILTER (WHERE is_allocated)::int AS allocated,
      count(*) FILTER (WHERE rates_account_id IS NOT NULL)::int AS accounts,
      count(*) FILTER (WHERE financial_status = 'allocated_no_account')::int AS allocated_no_account,
      count(*) FILTER (WHERE financial_status = 'not_billed')::int AS not_billed,
      count(*) FILTER (WHERE financial_status = 'overdue')::int AS overdue,
      count(*) FILTER (WHERE financial_status IN ('awaiting_payment', 'partially_paid', 'overdue'))::int AS owing,
      count(*) FILTER (WHERE financial_status = 'paid_up')::int AS paid_up,
      count(*) FILTER (WHERE is_allocated AND financial_status <> 'paid_up')::int AS allocated_not_paid_up,
      sum(usd_billed)::numeric(18,2)::text AS usd_billed,
      sum(usd_paid)::numeric(18,2)::text AS usd_paid,
      sum(GREATEST(usd_balance, 0))::numeric(18,2)::text AS usd_outstanding,
      sum(usd_overdue)::numeric(18,2)::text AS usd_overdue,
      sum(usd_pending)::numeric(18,2)::text AS usd_pending,
      CASE WHEN sum(usd_billed) > 0 THEN round(100 * sum(usd_paid) / sum(usd_billed), 1)::text END AS usd_collection_rate,
      sum(zwg_billed)::numeric(18,2)::text AS zwg_billed,
      sum(zwg_paid)::numeric(18,2)::text AS zwg_paid,
      sum(GREATEST(zwg_balance, 0))::numeric(18,2)::text AS zwg_outstanding,
      CASE WHEN sum(zwg_billed) > 0 THEN round(100 * sum(zwg_paid) / sum(zwg_billed), 1)::text END AS zwg_collection_rate`
    const [byWard, byTownship, totals, statuses, debtors, projects] = await Promise.all([
      // Every one of the council's wards, with or without figures, in ward order.
      pg.query(`WITH v AS (SELECT * FROM finance.v_property_finance WHERE in_authority)
                SELECT w.ward_code, w.name AS ward_name, ${groupCols.replace(/count\(\*\)/g, 'count(v.parcel_id)')}
                  FROM ${COUNCIL_WARDS} w LEFT JOIN v ON v.ward_code = w.ward_code
                 GROUP BY w.ward_code, w.name ORDER BY w.name::text ~ '^[0-9]+$' DESC, NULLIF(regexp_replace(w.name, '\\D', '', 'g'), '')::int, w.name`),
      pg.query(`SELECT COALESCE(township_code, 'Rural (farm parcels)') AS township, ${groupCols}
                  FROM finance.v_property_finance WHERE in_authority GROUP BY 1 ORDER BY 1`),
      pg.query(`SELECT ${groupCols} FROM finance.v_property_finance WHERE in_authority`),
      pg.query(`SELECT financial_status, parcel_kind, count(*)::int AS n FROM finance.v_property_finance WHERE in_authority GROUP BY 1, 2`),
      pg.query(`SELECT ${PROPERTY_COLUMNS} FROM finance.v_property_finance f
                 WHERE f.in_authority AND f.usd_balance > 0 ORDER BY f.usd_balance DESC LIMIT 10`),
      // Projects placed in the council's ward their location falls in (finance.project.ward_code
      // carries another delimitation's codes); a project with no location is counted as unlocated.
      pg.query(`SELECT COALESCE(w.ward_code, CASE WHEN p.location IS NULL THEN 'unlocated' ELSE 'outside' END) AS ward_code,
                       p.currency, count(*)::int AS projects, sum(p.approved_budget)::numeric(18,2)::text AS approved_budget
                  FROM finance.project p
                  LEFT JOIN ${COUNCIL_WARDS} w ON p.location IS NOT NULL AND ST_Intersects(w.geom, p.location)
                 WHERE p.deleted_at IS NULL GROUP BY 1, 2 ORDER BY 1, 2`),
    ])
    return ok(reply, {
      by_ward: byWard.rows,
      by_township: byTownship.rows,
      totals: totals.rows[0],
      statuses: statuses.rows.map((r) => ({ ...r, label: STATUS_LABELS[r.financial_status] || r.financial_status })),
      largest_balances: debtors.rows.map(decorate),
      projects_by_ward: projects.rows,
      basis: 'Billed and paid are posted rates bills and posted receipts; outstanding is the posted ledger balance. '
        + 'Receipts taken but not yet posted are shown as pending and are not in any balance.',
    })
  })

  // ═══ Synchronisation monitoring ══════════════════════════════════════════════════════════════
  // Registered before /:parcelId so "integration" is not read as a parcel id.
  fastify.get('/finance/property/integration', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['pending', 'processed', 'failed', 'duplicate', 'ignored'] },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const [runs, counts, events, gaps, mismatches] = await Promise.all([
      pg.query(`SELECT r.*, u.full_name AS run_by_name FROM finance.property_integration_run r
                  LEFT JOIN public.users u ON u.id = r.run_by ORDER BY r.started_at DESC LIMIT 15`),
      pg.query(`SELECT status, event_type, count(*)::int AS n FROM finance.property_integration_event GROUP BY 1, 2`),
      pg.query(
        `SELECT e.id, e.event_type, e.source, e.source_ref, e.parcel_id, p.stand_no, p.township_code, e.payload,
                e.status, e.attempts, e.last_error, e.outcome, e.detected_at, e.processed_at,
                ra.account_no, pt.name AS party_name
           FROM finance.property_integration_event e
           LEFT JOIN land.parcel p ON p.parcel_id = e.parcel_id
           LEFT JOIN finance.rates_account ra ON ra.id = e.rates_account_id
           LEFT JOIN finance.party pt ON pt.id = e.party_id
          WHERE ($1::text IS NULL OR e.status = $1)
          ORDER BY e.detected_at DESC, e.id LIMIT $2`, [q.status || null, q.limit]),
      // Allocated in Planning with no finance account and no event yet: what the next run will pick up.
      pg.query(
        `SELECT f.parcel_id, f.stand_no, f.township_code, f.allocation_reference, f.allottee_name, f.allocated_at
           FROM finance.v_property_finance f
          WHERE f.financial_status = 'allocated_no_account' AND f.in_authority
          ORDER BY f.allocated_at DESC NULLS LAST LIMIT 50`),
      // An account still open on a stand whose Planning allocation was revoked: a matching exception.
      pg.query(
        `SELECT f.parcel_id, f.stand_no, f.township_code, f.account_no, f.party_name, f.usd_balance::text AS usd_balance
           FROM finance.v_property_finance f
          WHERE f.parcel_kind = 'stand' AND f.rates_account_id IS NOT NULL AND NOT f.is_allocated AND f.in_authority
          LIMIT 50`),
    ])
    return ok(reply, {
      runs: runs.rows, counts: counts.rows, events: events.rows,
      awaiting_discovery: gaps.rows, account_without_allocation: mismatches.rows,
      can_sync: await hasPermission(fastify, request, 'finance.property.sync'),
    })
  })

  /** Discover what Planning has done since the last run and record each fact as an event. */
  async function discover(runId) {
    const inserted = await pg.query(
      `WITH found AS (
         SELECT 'StandAllocated' AS event_type, a.id::text AS source_ref, a.stand_id AS parcel_id,
                jsonb_build_object('allocation_reference', a.reference_no, 'allottee_name', a.allottee_name,
                                   'allocated_to', a.allocated_to, 'purpose', a.purpose, 'allocated_at', a.allocated_at,
                                   'stand_no', p.stand_no, 'township', p.township_code,
                                   'price_usd', o.price_usd) AS payload
           FROM public.stand_allocation a
           JOIN land.parcel p ON p.parcel_id = a.stand_id
           LEFT JOIN land.stand_offer o ON o.parcel_id = a.stand_id
          WHERE a.deleted_at IS NULL
         UNION ALL
         SELECT 'AllocationRevoked', a.id::text, a.stand_id,
                jsonb_build_object('allocation_reference', a.reference_no, 'revoked_at', a.revoked_at,
                                   'reason', a.revoke_reason, 'stand_no', p.stand_no)
           FROM public.stand_allocation a JOIN land.parcel p ON p.parcel_id = a.stand_id
          WHERE a.deleted_at IS NULL AND a.status = 'revoked'
         UNION ALL
         -- Marked allocated on the offer with no allocation record: Planning has not said to whom.
         SELECT 'StandAllocated', 'offer:' || o.parcel_id, o.parcel_id,
                jsonb_build_object('stand_no', p.stand_no, 'township', p.township_code, 'price_usd', o.price_usd,
                                   'allocated_at', o.allocated_at, 'allocated_to', o.allocated_to)
           FROM land.stand_offer o JOIN land.parcel p ON p.parcel_id = o.parcel_id
          WHERE o.status = 'allocated'
            AND NOT EXISTS (SELECT 1 FROM public.stand_allocation a
                             WHERE a.stand_id = o.parcel_id AND a.deleted_at IS NULL)
         UNION ALL
         -- Flagged allocated on the register itself, with neither an allocation record nor an offer.
         SELECT 'StandAllocated', 'register:' || p.parcel_id, p.parcel_id,
                jsonb_build_object('stand_no', p.stand_no, 'township', p.township_code)
           FROM land.parcel p
          WHERE p.status = 'current' AND p.allocation_status = 'allocated'
            AND NOT EXISTS (SELECT 1 FROM public.stand_allocation a WHERE a.stand_id = p.parcel_id AND a.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM land.stand_offer o WHERE o.parcel_id = p.parcel_id AND o.status = 'allocated')
       )
       INSERT INTO finance.property_integration_event (event_type, source_ref, dedupe_key, parcel_id, payload, run_id)
       SELECT event_type, source_ref, event_type || ':' || source_ref, parcel_id, payload, $1 FROM found
       ON CONFLICT (authority_id, dedupe_key) DO NOTHING
       RETURNING id`, [runId])
    return inserted.rowCount
  }

  /**
   * Act on one event. Opens the customer and the account an allocation needs, or says why not.
   * Returns { status, outcome | error }. Runs in its own transaction so one failure does not
   * undo the others.
   */
  async function processEvent(eventId, userId, runId) {
    return transact(async (c) => {
      const { rows: [e] } = await c.query(
        `SELECT * FROM finance.property_integration_event WHERE id = $1 FOR UPDATE`, [eventId])
      if (!e) return { status: 'failed', error: 'No such event.' }
      if (['processed', 'duplicate', 'ignored'].includes(e.status)) return { status: e.status, outcome: e.outcome }
      const finish = async (status, fields) => {
        await c.query(
          `UPDATE finance.property_integration_event
              SET status = $2, attempts = attempts + 1, outcome = $3, last_error = $4, party_id = COALESCE($5, party_id),
                  rates_account_id = COALESCE($6, rates_account_id), processed_at = CASE WHEN $2 = 'failed' THEN NULL ELSE now() END,
                  processed_by = $7, run_id = COALESCE($8, run_id)
            WHERE id = $1`,
          [e.id, status, fields.outcome || null, fields.error || null, fields.party_id || null,
            fields.rates_account_id || null, userId, runId || null])
        return { status, ...fields }
      }

      if (e.event_type === 'AllocationRevoked') {
        const { rows: [acct] } = await c.query(
          `SELECT ra.account_no FROM finance.rates_account ra
            WHERE ra.parcel_id = $1 AND ra.status = 'active' AND ra.deleted_at IS NULL`, [e.parcel_id])
        return finish('processed', {
          outcome: acct
            ? `Planning revoked the allocation. Account ${acct.account_no} stays open until its balance is settled and Revenue closes it.`
            : 'Planning revoked the allocation. Finance held no account for it.',
        })
      }
      if (e.event_type !== 'StandAllocated') return finish('ignored', { outcome: `No finance action is defined for ${e.event_type}.` })

      const p = e.payload || {}
      // Who the allottee is: the Planning user if named, else the allottee name on the allocation.
      let person = null
      if (p.allocated_to) {
        const { rows } = await c.query(
          `SELECT id, full_name, national_id, email, phone FROM public.users WHERE id = $1`, [p.allocated_to])
        person = rows[0] || null
      }
      const name = (person?.full_name || p.allottee_name || '').trim()
      if (!name) {
        return finish('failed', {
          error: 'Planning marks this stand allocated but names no allottee, so no customer can be opened. '
            + 'Record the allocation in Planning (who it was allocated to), then retry.',
        })
      }

      const { rows: [existing] } = await c.query(
        `SELECT ra.id, ra.account_no, ra.party_id, pt.name FROM finance.rates_account ra
           JOIN finance.party pt ON pt.id = ra.party_id
          WHERE ra.parcel_id = $1 AND ra.status = 'active' AND ra.deleted_at IS NULL`, [e.parcel_id])

      // Match the customer: national ID, then the Planning user, then (for a name-only allocation) the name.
      const keys = []
      if (person?.national_id) keys.push(['national_id', person.national_id])
      if (person?.id) keys.push(['planning_user', person.id])
      if (!person) keys.push(['allottee_name', name])
      let partyId = null
      let matchedBy = null
      for (const [kind, value] of keys) {
        const { rows } = await c.query(
          `SELECT party_id FROM finance.party_identity WHERE kind = $1 AND upper(btrim(value)) = upper(btrim($2))`,
          [kind, value])
        if (rows[0]) { partyId = rows[0].party_id; matchedBy = kind; break }
      }

      if (existing) {
        if (!partyId || existing.party_id === partyId) {
          return finish('duplicate', {
            outcome: `Account ${existing.account_no} (${existing.name}) is already open on this stand; no second account was opened.`,
            party_id: existing.party_id, rates_account_id: existing.id,
          })
        }
        return finish('failed', {
          error: `Account ${existing.account_no} is open on this stand for ${existing.name}, but Planning allocated it to ${name}. `
            + 'A change of owner is a transfer: Revenue closes the old account and this event is retried.',
        })
      }

      let newCustomer = false
      if (!partyId) {
        const { rows: [party] } = await c.query(
          `INSERT INTO finance.party (party_type, name, reference, contact_phone, contact_email, notes, created_by)
           VALUES ('ratepayer', $1, 'CUS-' || lpad(nextval('finance.customer_no_seq')::text, 6, '0'), $2, $3, $4, $5)
           RETURNING id`,
          [name, person?.phone || null, person?.email || null,
            `Opened from Planning allocation ${p.allocation_reference || e.source_ref}.`, userId])
        partyId = party.id
        newCustomer = true
        for (const [kind, value] of keys) {
          await c.query(
            `INSERT INTO finance.party_identity (party_id, kind, value, created_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`, [partyId, kind, String(value), userId])
        }
      }

      const accountNo = `${(p.township || 'ST').toUpperCase()}-${String(p.stand_no || e.parcel_id).toUpperCase()}`
      const { rows: clash } = await c.query(
        `SELECT 1 FROM finance.rates_account WHERE account_no = $1 AND deleted_at IS NULL`, [accountNo])
      const finalNo = clash.length ? `${accountNo}-${String(e.id).slice(0, 4).toUpperCase()}` : accountNo
      const { rows: [acct] } = await c.query(
        `INSERT INTO finance.rates_account (account_no, parcel_id, party_id, opened_on, notes, created_by)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz::date, CURRENT_DATE), $5, $6)
         RETURNING id, account_no`,
        [finalNo, e.parcel_id, partyId, p.allocated_at || null,
          `Opened by the Planning integration from allocation ${p.allocation_reference || e.source_ref}.`, userId])
      const { rows: [valued] } = await c.query(
        `SELECT 1 FROM finance.valuation_roll WHERE parcel_id = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        [e.parcel_id])
      return finish('processed', {
        outcome: `Opened account ${acct.account_no} for ${name} (${newCustomer ? 'new customer' : `existing customer, matched by ${matchedBy.replace('_', ' ')}`}). `
          + (valued ? 'The property has a value on the roll and is billed by the next rates run.'
            : 'The property has no value on the roll yet, so the next rates run will list it as waiting for a valuation.'),
        party_id: partyId, rates_account_id: acct.id,
      })
    }).catch(async (err) => {
      // A failure inside the transaction is recorded outside it, so it is never lost.
      const message = err.code === '23505'
        ? 'A customer or account with the same identity already exists; matching needs a person to confirm it.'
        : (err.message || 'Unexpected error')
      await pg.query(
        `UPDATE finance.property_integration_event SET status = 'failed', attempts = attempts + 1, last_error = $2,
                processed_by = $3 WHERE id = $1`, [eventId, message.slice(0, 1000), userId])
      return { status: 'failed', error: message }
    })
  }

  fastify.post('/finance/property/integration/run', { ...canSync }, async (request, reply) => {
    const { rows: [run] } = await pg.query(
      `INSERT INTO finance.property_integration_run (trigger, run_by) VALUES ('manual', $1) RETURNING id`, [request.user.id])
    try {
      const discovered = await discover(run.id)
      // Pending events, and failed ones that have not yet been tried five times.
      const { rows: work } = await pg.query(
        `SELECT id FROM finance.property_integration_event
          WHERE status = 'pending' OR (status = 'failed' AND attempts < 5)
          ORDER BY detected_at, id`)
      const tally = { processed: 0, failed: 0, duplicate: 0, ignored: 0 }
      for (const w of work) {
        const r = await processEvent(w.id, request.user.id, run.id)
        tally[r.status] = (tally[r.status] || 0) + 1
      }
      const { rows: [done] } = await pg.query(
        `UPDATE finance.property_integration_run
            SET finished_at = now(), discovered = $2, processed = $3, failed = $4, duplicates = $5
          WHERE id = $1 RETURNING *`,
        [run.id, discovered, tally.processed, tally.failed, tally.duplicate])
      request.auditDetails = { action: 'property_integration_run', run_id: run.id, discovered, ...tally }
      return ok(reply, { run: done })
    } catch (err) {
      await pg.query(
        `UPDATE finance.property_integration_run SET finished_at = now(), error = $2 WHERE id = $1`,
        [run.id, String(err.message).slice(0, 1000)])
      fastify.log.error({ err }, 'property integration run failed')
      return fail(reply, 500, 'integration_error', 'The integration run stopped. Its events are kept and the next run picks them up.')
    }
  })

  fastify.post('/finance/property/integration/events/:id/retry', {
    ...canSync,
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { rowCount } = await pg.query(
      `UPDATE finance.property_integration_event SET status = 'pending' WHERE id = $1 AND status = 'failed'`,
      [request.params.id])
    if (!rowCount) return fail(reply, 409, 'not_failed', 'Only a failed event is retried.')
    const result = await processEvent(request.params.id, request.user.id, null)
    request.auditDetails = { action: 'property_integration_retry', event_id: request.params.id, result: result.status }
    return ok(reply, result)
  })

  // ═══ The property financial profile ══════════════════════════════════════════════════════════
  fastify.get('/finance/property/:parcelId', {
    ...canView,
    schema: { params: { type: 'object', required: ['parcelId'], properties: { parcelId: { type: 'string', maxLength: 24 } } } },
  }, async (request, reply) => {
    const id = request.params.parcelId
    const { rows: [row] } = await pg.query(
      `SELECT ${PROPERTY_COLUMNS}, f.in_authority, p.source AS register_source, p.sg_ref, p.accuracy_basis, p.cadastre_ref,
              ST_AsGeoJSON(p.geom_wgs84, 7)::json AS geometry,
              ST_X(ST_PointOnSurface(p.geom_wgs84)) AS lng, ST_Y(ST_PointOnSurface(p.geom_wgs84)) AS lat,
              ARRAY[ST_XMin(p.geom_wgs84), ST_YMin(p.geom_wgs84), ST_XMax(p.geom_wgs84), ST_YMax(p.geom_wgs84)] AS bbox
         FROM finance.v_property_finance f JOIN land.parcel p ON p.parcel_id = f.parcel_id
        WHERE f.parcel_id = $1`, [id])
    if (!row) return fail(reply, 404, 'not_found', 'No current property has that reference in the Planning register.')
    if (!row.in_authority) return fail(reply, 404, 'outside_council', 'That property lies outside the council\'s wards, so it is not on the council\'s books.')
    const canIdentity = await hasPermission(fastify, request, 'finance.property.view_identity')

    const [allocations, accounts, bills, receipts, events, partyQ, identity] = await Promise.all([
      pg.query(
        `SELECT a.id, a.reference_no, a.allottee_name, a.purpose, a.status, a.allocated_at, a.revoked_at, a.revoke_reason,
                u.full_name AS allocated_to_name
           FROM public.stand_allocation a LEFT JOIN public.users u ON u.id = a.allocated_to
          WHERE a.stand_id = $1 AND a.deleted_at IS NULL ORDER BY a.allocated_at`, [id]),
      // Every account the property has had: the open one and those closed on a change of owner.
      pg.query(
        `SELECT ra.id, ra.account_no, ra.status, ${dateText('ra', 'opened_on', 'closed_on')}, ra.notes,
                pt.name AS party_name, pt.reference AS party_reference
           FROM finance.rates_account ra JOIN finance.party pt ON pt.id = ra.party_id
          WHERE ra.parcel_id = $1 AND ra.deleted_at IS NULL ORDER BY ra.opened_on, ra.account_no`, [id]),
      pg.query(
        `SELECT rb.id, rb.bill_no, ra.account_no, ${dateText('rb', 'period_from', 'period_to', 'issued_on', 'due_on')},
                rb.currency, rb.amount::text AS amount, v.status AS voucher_status, v.voucher_no,
                finance.rates_bill_unsettled(rb.id)::numeric(18,2)::text AS open_amount,
                ar.ageing_bucket, ar.days_outstanding, rb.narration
           FROM finance.rates_bill rb
           JOIN finance.rates_account ra ON ra.id = rb.rates_account_id
           JOIN finance.voucher v ON v.id = rb.voucher_id
           LEFT JOIN finance.v_rates_arrears ar ON ar.rates_bill_id = rb.id
          WHERE ra.parcel_id = $1 AND rb.deleted_at IS NULL AND v.status <> 'cancelled'
          ORDER BY rb.period_from DESC, rb.bill_no`, [id]),
      pg.query(
        `SELECT rc.id, rc.receipt_no, ra.account_no, rc.received_on::text AS received_on, rc.currency,
                rc.amount::text AS amount, rc.method, rc.reference, v.status AS voucher_status, v.voucher_no,
                cs.session_no, u.full_name AS taken_by
           FROM finance.rates_receipt rc
           JOIN finance.rates_account ra ON ra.id = rc.rates_account_id
           JOIN finance.voucher v ON v.id = rc.voucher_id
           LEFT JOIN finance.cashier_session cs ON cs.id = rc.cashier_session_id
           LEFT JOIN public.users u ON u.id = rc.created_by
          WHERE ra.parcel_id = $1 AND rc.deleted_at IS NULL AND v.status <> 'cancelled'
          ORDER BY rc.received_on DESC, rc.receipt_no DESC`, [id]),
      pg.query(
        `SELECT e.id, e.event_type, e.status, e.outcome, e.last_error, e.detected_at, e.processed_at, e.attempts
           FROM finance.property_integration_event e WHERE e.parcel_id = $1 ORDER BY e.detected_at DESC`, [id]),
      row.party_id
        ? pg.query(`SELECT id, name, reference, contact_phone, contact_email, address_text, party_type
                      FROM finance.party WHERE id = $1`, [row.party_id])
        : Promise.resolve({ rows: [] }),
      row.party_id && canIdentity
        ? pg.query(`SELECT value FROM finance.party_identity WHERE party_id = $1 AND kind = 'national_id' LIMIT 1`, [row.party_id])
        : Promise.resolve({ rows: [] }),
    ])

    // Balances per currency, from the ledger (the same query the rates statement uses).
    const balances = row.rates_account_id
      ? (await pg.query(
        `SELECT a.currency, sum(a.outstanding_amount)::numeric(18,2)::text AS balance,
                COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.outstanding_amount > 0), 0)::numeric(18,2)::text AS owed,
                COALESCE(-sum(a.outstanding_amount) FILTER (WHERE a.outstanding_amount < 0), 0)::numeric(18,2)::text AS unallocated_credit,
                COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.outstanding_amount > 0 AND a.days_outstanding > 30), 0)::numeric(18,2)::text AS overdue
           FROM finance.v_rates_arrears a WHERE a.rates_account_id = $1
          GROUP BY a.currency ORDER BY a.currency`, [row.rates_account_id])).rows
      : []

    // Records made by the demonstration seeds carry their markers; the panel says so.
    const { rows: [demo] } = await pg.query(
      `SELECT EXISTS (SELECT 1 FROM public.stand_allocation a WHERE a.stand_id = $1 AND a.conditions LIKE '%DEMO%')
           OR EXISTS (SELECT 1 FROM land.stand_offer o WHERE o.parcel_id = $1 AND o.description LIKE '%DEMO%')
           OR EXISTS (SELECT 1 FROM finance.rates_account ra WHERE ra.parcel_id = $1
                       AND (ra.account_no ~ '^(REV|LA-DEMO|DEMO)' OR ra.erp_account_no LIKE 'PRM/%')) AS demo`, [id])
    const { geometry, lng, lat, bbox, in_authority: _inside, ...props } = row
    const party = partyQ.rows[0] ? { ...partyQ.rows[0], ...(identity.rows[0] ? { national_id: identity.rows[0].value } : {}) } : null
    return ok(reply, {
      property: decorate(props),
      geometry, centroid: [Number(lng), Number(lat)], bbox: bbox.map(Number),
      party,
      allocations: allocations.rows,
      accounts: accounts.rows,
      bills: bills.rows,
      receipts: receipts.rows,
      balances,
      events: events.rows,
      purchase: row.offer_price_usd
        ? {
          price_usd: row.offer_price_usd,
          note: 'The purchase price is the Planning offer price. Purchase-price instalments are not billed through the '
            + 'ledger: the Council has not yet approved a land-sales billing rule, so only rates and charges appear in the balance.',
        }
        : null,
      can_see_identity: canIdentity,
      demonstration_data: demo.demo,
      basis: 'Balances are the posted ledger. A receipt awaiting posting is listed and is not in a balance until the accountant posts it.',
    })
  })
}

module.exports = { financePropertyRoutes, landUseClass, STATUS_LABELS }
