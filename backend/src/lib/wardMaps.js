/**
 * Ward maps from the spatial engine, shared by the Chief Executive's routes (all measures) and the unit
 * dashboards (a unit's own measures). One implementation, so the colours, classes and honesty fields are
 * the same wherever a map is drawn.
 *
 * The values are computed by spatial_engine.refresh() (migration 215); this only reads them and says,
 * with every map, how the colours were decided and what they stand on:
 *   - `classes` carries the method and the breaks, so the legend and the paint cannot disagree.
 *   - `ward_register` carries linked/basis/instrument_ref. While decision D11 is open the basis is 'interim'
 *     and the screen must say the wards are provisional.
 *   - `run` carries when the numbers were computed and how many facts could not be placed in a ward.
 *   - An unlinked ward register returns NO features and a reason: a blank grey district reads as "nothing
 *     here", which is the misreading the council's own spatial rules exist to prevent.
 *
 * `pg` must be request-scoped (src/lib/dbContext.js) so row-level security confines every query to the
 * caller's council; the system plane is not used.
 */
const { classify, rankWards } = require('./spatialClassify')

const MEASURE_KEY = /^[a-z][a-z0-9_]{2,60}$/
const num = (v) => (v === null || v === undefined ? null : Number(v))

function createWardMaps(pg) {
  const wardRegister = async () => {
    const { rows: [r] } = await pg.query(`
      SELECT count(*)::int AS wards,
             CASE WHEN count(DISTINCT basis) = 1 THEN min(basis) WHEN count(*) = 0 THEN NULL ELSE 'mixed' END AS basis,
             CASE WHEN count(DISTINCT instrument_ref) = 1 THEN min(instrument_ref) END AS instrument_ref
        FROM spatial_engine.v_authority_ward`)
    return { linked: r.wards > 0, wards: r.wards, basis: r.basis, instrument_ref: r.instrument_ref }
  }

  const lastRun = async () => {
    const { rows } = await pg.query(`
      SELECT id, status, started_at, finished_at, ward_register_basis, wards, detail
        FROM spatial_engine.run WHERE status = 'completed' AND authority_id = app.authority_id()
       ORDER BY started_at DESC LIMIT 1`)
    return rows[0] ?? null
  }

  /** The maps index. `unitKey` limits it to one unit's measures; null is every measure (the Chief Executive). */
  async function index(unitKey = null) {
    const [register, run, measures] = await Promise.all([
      wardRegister(),
      lastRun(),
      pg.query(`
        SELECT measure_key, label, description, unit, kind, direction, ramp, owner_dept, unit_key, source_note
          FROM spatial_engine.measure
         WHERE enabled AND ($1::text IS NULL OR unit_key = $1)
         ORDER BY sort_order, measure_key`, [unitKey]),
    ])
    return {
      ward_register: register,
      run: run && { id: run.id, computed_at: run.finished_at, wards: run.wards, ward_register_basis: run.ward_register_basis },
      measures: measures.rows,
    }
  }

  /**
   * One measure as GeoJSON over the council's wards. Returns { status: 400|404 } for a bad or unknown key, or
   * for a key outside `unitKey`'s own measures (a unit head cannot read another unit's measure).
   */
  async function map(key, unitKey = null) {
    if (!MEASURE_KEY.test(key)) return { status: 400, error: 'bad_measure', message: 'Not a measure key.' }

    const { rows: [m] } = await pg.query(
      `SELECT measure_key, label, description, unit, kind, direction, classes, break_method, fixed_breaks, ramp,
              min_denominator, owner_dept, unit_key, source_note, register_key
         FROM spatial_engine.measure
        WHERE measure_key = $1 AND enabled AND ($2::text IS NULL OR unit_key = $2)`, [key, unitKey])
    if (!m) return { status: 404, error: 'not_found', message: 'No such measure.' }

    const register = await wardRegister()
    // If the measure counts a register the council has said is incomplete, the map must say so.
    let completeness = null
    if (m.register_key) {
      const { rows: [rs] } = await pg.query(
        'SELECT register, complete, expected_count, note, source FROM spatial_engine.register_status WHERE register = $1', [m.register_key])
      if (rs && !rs.complete) completeness = { register: rs.register, complete: false, expected_count: rs.expected_count, note: rs.note, source: rs.source }
    }
    const measure = {
      key: m.measure_key, label: m.label, description: m.description, unit: m.unit, kind: m.kind,
      direction: m.direction, ramp: m.ramp, owner_dept: m.owner_dept, unit_key: m.unit_key, source_note: m.source_note,
      min_denominator: num(m.min_denominator),
      incomplete_register: completeness,
    }
    if (!register.linked) {
      return { data: { measure, ward_register: register, reason: 'ward_register_empty', features: [], classes: null, run: null } }
    }

    const { rows } = await pg.query(`
      SELECT w.ward_code, w.name,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(w.geom, 0.001))::json AS geometry,
             v.value, v.numerator, v.denominator, v.reliability, v.computed_at
        FROM spatial_engine.v_authority_ward w
        LEFT JOIN spatial_engine.ward_value v
               ON v.ward_code = w.ward_code AND v.measure_key = $1 AND v.period = 'current' AND v.authority_id = w.authority_id
       ORDER BY w.ward_code`, [key])

    const computed = rows.some((r) => r.reliability !== null)
    const wards = rows.map((r) => ({
      ward_code: r.ward_code, name: r.name, geometry: r.geometry,
      value: num(r.value), numerator: num(r.numerator), denominator: num(r.denominator),
      reliability: r.reliability ?? 'no_data',
    }))

    // Breaks come from the wards that have a reliable value; the rest are drawn "no data".
    const classes = classify(
      wards.filter((w) => w.reliability === 'ok' && w.value !== null).map((w) => w.value),
      { method: m.break_method, classes: m.classes, fixed: m.fixed_breaks ? m.fixed_breaks.map(Number) : null },
    )
    const ranks = rankWards(wards, m.direction)
    const classIndex = (v) => (v === null || classes.breaks.length === 0 ? null : classes.breaks.filter((b) => v >= b).length)

    const run = await lastRun()
    const features = wards.map((w) => ({
      type: 'Feature',
      geometry: w.geometry,
      properties: {
        ward_code: w.ward_code, name: w.name, value: w.reliability === 'ok' ? w.value : null,
        raw_value: w.value, numerator: w.numerator, denominator: w.denominator, reliability: w.reliability,
        rank: ranks.get(w.ward_code) ?? null,
        class_index: w.reliability === 'ok' ? classIndex(w.value) : null,
      },
    }))

    return {
      data: {
        measure,
        ward_register: register,
        reason: computed ? null : 'not_computed',
        classes,
        ranked: features.filter((f) => f.properties.rank !== null).length,
        run: run && {
          computed_at: run.finished_at,
          unlocated: run.detail?.[key]?.unlocated ?? null,
          facts: run.detail?.[key]?.facts ?? null,
        },
        type: 'FeatureCollection',
        features,
      },
    }
  }

  /**
   * One ward across every measure, grouped by owning unit: its value, rank and reliability for each. The Chief
   * Executive's drill-down from a ward to every unit's picture of it. Returns { status: 404 } for a ward that is
   * not one of the council's current wards.
   */
  async function wardProfile(wardCode) {
    const { rows: [ward] } = await pg.query(
      'SELECT ward_code, name, basis, area_km2 FROM spatial_engine.v_authority_ward WHERE ward_code = $1', [wardCode])
    if (!ward) return { status: 404, error: 'not_found', message: 'No such ward.' }

    const [{ rows: measures }, { rows: values }, run] = await Promise.all([
      pg.query(`SELECT measure_key, label, unit, kind, direction, unit_key, owner_dept FROM spatial_engine.measure
                 WHERE enabled ORDER BY sort_order, measure_key`),
      pg.query(`SELECT measure_key, ward_code, value, numerator, denominator, reliability
                  FROM spatial_engine.ward_value WHERE period = 'current' AND authority_id = app.authority_id()`),
      lastRun(),
    ])
    const byMeasure = new Map()
    for (const v of values) {
      if (!byMeasure.has(v.measure_key)) byMeasure.set(v.measure_key, [])
      byMeasure.get(v.measure_key).push({ ward_code: v.ward_code, value: num(v.value), numerator: num(v.numerator), denominator: num(v.denominator), reliability: v.reliability })
    }

    const entries = measures.map((m) => {
      const all = byMeasure.get(m.measure_key) ?? []
      const mine = all.find((w) => w.ward_code === wardCode)
      const ranks = rankWards(all, m.direction)
      return {
        measure_key: m.measure_key, label: m.label, unit: m.unit, kind: m.kind, direction: m.direction,
        unit_key: m.unit_key, owner_dept: m.owner_dept,
        value: mine && mine.reliability === 'ok' ? mine.value : null,
        raw_value: mine?.value ?? null,
        numerator: mine?.numerator ?? null, denominator: mine?.denominator ?? null,
        reliability: mine?.reliability ?? 'no_data',
        rank: ranks.get(wardCode) ?? null,
        ranked: [...ranks.values()].filter((r) => r !== null).length,
      }
    })

    const units = {}
    for (const e of entries) {
      const k = e.unit_key ?? 'other'
      ;(units[k] ??= []).push(e)
    }
    return {
      data: {
        ward: { ward_code: ward.ward_code, name: ward.name, basis: ward.basis, area_km2: num(ward.area_km2) },
        computed_at: run?.finished_at ?? null,
        units,
      },
    }
  }

  /**
   * Every ward as one row and every figure as a column, with a total: the table beside the map. A map answers "where"; a table answers "how many, and how does
   * this ward compare", and it can be exported and printed (the council's own officials asked for exactly this).
   *
   * Columns: the engine's measures for `unitKey` (null: every measure), then, for the Chief Executive and the planning unit, register COUNTS per ward
   * (stands, farm parcels, parcels under a zone of the plan, schools, health facilities, mines, registered voters). Rules:
   *   - a figure that is missing is null ("not recorded"), never zero; a measure's reliability says why a ward has none;
   *   - a measure is a rate or density, so it has no total (null); a count's total is the register's own total, and `not_in_a_ward` is what the wards
   *     do not account for, so the rows plus that line always add up to the total;
   *   - the wards are provisional while decision D11 is open (`ward_register.basis`), and the table carries that, like the map.
   */
  async function table(unitKey = null) {
    const [register, run, idx] = await Promise.all([wardRegister(), lastRun(), index(unitKey)])
    const measures = idx.measures.map((m) => ({ key: m.measure_key, label: m.label, unit: m.unit, kind: m.kind, owner_dept: m.owner_dept }))
    if (!register.linked) return { data: { ward_register: register, run: idx.run, measures, counts: [], rows: [], totals: null, not_in_a_ward: null, reason: 'ward_register_empty' } }

    const { rows: wards } = await pg.query('SELECT ward_code, name, area_km2 FROM spatial_engine.v_authority_ward ORDER BY ward_code')
    const keys = measures.map((m) => m.key)
    const { rows: values } = keys.length ? await pg.query(
      `SELECT measure_key, ward_code, value, numerator, denominator, reliability FROM spatial_engine.ward_value
        WHERE period = 'current' AND authority_id = app.authority_id() AND measure_key = ANY($1)`, [keys]) : { rows: [] }
    const valueOf = new Map(values.map((v) => [`${v.measure_key}|${v.ward_code}`, v]))

    // register counts: for the chief executive and the planning unit only (the other units read their own measures)
    const withCounts = unitKey === null || unitKey === 'planning'
    const COUNTS = [
      { key: 'stands', label: 'Stands' }, { key: 'farms', label: 'Farm parcels' }, { key: 'zoned', label: 'Parcels under a zone of the plan' },
      { key: 'schools', label: 'Schools' }, { key: 'health', label: 'Health facilities' }, { key: 'mines', label: 'Mines' }, { key: 'voters', label: 'Registered voters (2023)' },
    ]
    const counts = new Map()   // ward_code -> { key: n }
    let totals = null
    if (withCounts) {
      const { rows } = await pg.query(`
        WITH w AS (SELECT ward_code, geom FROM spatial_engine.v_authority_ward),
        p AS (
          SELECT g.ward_code, p.parcel_kind, p.parcel_id,
                 EXISTS (SELECT 1 FROM public.parcel_zoning pz WHERE pz.parcel_layer = 'land.parcel' AND pz.parcel_id = p.parcel_id AND pz.is_governing) AS zoned
            FROM land.parcel p
            LEFT JOIN LATERAL (SELECT w.ward_code FROM w WHERE ST_Intersects(w.geom, ST_PointOnSurface(p.geom_wgs84)) ORDER BY w.ward_code LIMIT 1) g ON true
           WHERE p.status = 'current'),
        f AS (
          SELECT g.ward_code, f.kind FROM public.vungu_facilities f
            LEFT JOIN LATERAL (SELECT w.ward_code FROM w WHERE ST_Intersects(w.geom, f.geom) ORDER BY w.ward_code LIMIT 1) g ON true
           WHERE f.kind IN ('school', 'health_facility')),
        m AS (
          SELECT g.ward_code FROM public.vungu_land_features l
            LEFT JOIN LATERAL (SELECT w.ward_code FROM w WHERE ST_Intersects(w.geom, ST_PointOnSurface(l.geom)) ORDER BY w.ward_code LIMIT 1) g ON true
           WHERE l.kind = 'mine'),
        v AS (SELECT ward_code, sum(voters)::int AS voters FROM admin.polling_area GROUP BY ward_code)
        SELECT 'stands' AS k, ward_code, count(*)::int AS n FROM p WHERE parcel_kind = 'stand' GROUP BY ward_code
        UNION ALL SELECT 'farms', ward_code, count(*)::int FROM p WHERE parcel_kind = 'farm' GROUP BY ward_code
        UNION ALL SELECT 'zoned', ward_code, count(*)::int FROM p WHERE zoned GROUP BY ward_code
        UNION ALL SELECT 'schools', ward_code, count(*)::int FROM f WHERE kind = 'school' GROUP BY ward_code
        UNION ALL SELECT 'health', ward_code, count(*)::int FROM f WHERE kind = 'health_facility' GROUP BY ward_code
        UNION ALL SELECT 'mines', ward_code, count(*)::int FROM m GROUP BY ward_code
        UNION ALL SELECT 'voters', v.ward_code, v.voters FROM v`)
      totals = Object.fromEntries(COUNTS.map((c) => [c.key, 0]))
      for (const r of rows) {
        totals[r.k] += r.n
        if (r.ward_code) {
          if (!counts.has(r.ward_code)) counts.set(r.ward_code, {})
          counts.get(r.ward_code)[r.k] = r.n
        }
      }
    }

    const tableRows = wards.map((w) => {
      const own = counts.get(w.ward_code) ?? {}
      return {
        ward_code: w.ward_code, name: w.name, area_km2: num(w.area_km2),
        measures: Object.fromEntries(keys.map((k) => {
          const v = valueOf.get(`${k}|${w.ward_code}`)
          return [k, { value: v && v.reliability === 'ok' ? num(v.value) : null, reliability: v?.reliability ?? 'no_data' }]
        })),
        // a ward with no row for a count has none counted in it: 0 for a register that was read, which is a real zero
        counts: withCounts ? Object.fromEntries(COUNTS.map((c) => [c.key, own[c.key] ?? 0])) : {},
      }
    })
    const notInAWard = withCounts
      ? Object.fromEntries(COUNTS.map((c) => [c.key, totals[c.key] - tableRows.reduce((a, r) => a + r.counts[c.key], 0)]))
      : null
    return {
      data: {
        ward_register: register, run: idx.run, measures, counts: withCounts ? COUNTS : [], rows: tableRows,
        totals, not_in_a_ward: notInAWard, reason: null,
      },
    }
  }

  return { wardRegister, lastRun, index, map, wardProfile, table }
}

module.exports = { createWardMaps, MEASURE_KEY }
