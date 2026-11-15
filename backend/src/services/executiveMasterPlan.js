/**
 * What the Chief Executive reads about the master plan (GET /api/executive/master-plan): the plan's standing, how far its adoption has got, its zones,
 * how much of the register it covers, how it is working in development applications, and the facilities and land features held beside it.
 *
 * Read-only, and honest about what is missing: nothing is computed that the registers do not hold, a count that is zero is a zero, and a plan that is
 * not yet in force says so (`in_force`). The adoption record is the one the plan workbench keeps (migration 232); the decisions affirmed for testing
 * (scripts/affirm-decisions-for-testing.js) are reported as such, never as the council's decisions.
 *
 * `db` is anything with query(sql, params) -> { rows }: the request-scoped pool, so row-level security confines it to the caller's council.
 */
const PLAN_TITLE_LIKE = '%'
const AFFIRMED_LABEL = '%affirmed for testing%'

async function read(db) {
  const q = async (sql, params = []) => (await db.query(sql, params)).rows

  // the plan that stands for the council now: the governing plan, else the latest non-template plan (a draft first plan is shown, marked not in force)
  const [plan] = await q(
    `SELECT i.id, i.title, i.version, i.status, i.revision_label, i.revision_date, i.map_scale, i.gazette_ref, i.effective_from,
            i.council_adopted_on, i.council_resolution_ref, i.ministerial_approval_no, i.ministerial_approved_on, i.ministerial_approved_by,
            a.authority_name, plan_governs(i.id) AS governs, plan_is_provisional(i.status) AS provisional
       FROM plan_instrument i LEFT JOIN local_authorities a ON a.id = i.authority_id
      WHERE NOT i.is_template AND i.status <> 'superseded' AND i.title LIKE $1
      ORDER BY plan_governs(i.id) DESC, i.version DESC, i.created_at DESC LIMIT 1`, [PLAN_TITLE_LIKE])
  if (!plan) return { as_of: new Date().toISOString(), plan: null }

  // adoption: the signatory roles of the authority, each signed on the plan as it is now or not
  const roles = await q(
    `SELECT r.code, r.label,
            (SELECT s.signer_name FROM plan_signoff s WHERE s.plan_instrument_id = $1 AND s.signatory_role = r.code AND s.content_hash = plan_content_hash($1)
              ORDER BY s.signed_at DESC LIMIT 1) AS signed_by,
            EXISTS (SELECT 1 FROM plan_signoff s WHERE s.plan_instrument_id = $1 AND s.signatory_role = r.code) AS signed_before
       FROM plan_signatory_role r JOIN plan_instrument i ON i.authority_id = r.authority_id WHERE i.id = $1 ORDER BY r.display_order`, [plan.id])
  const order = ['unknown', 'draft', 'public_notice', 'approved', 'gazetted']
  const reached = (st) => order.indexOf(plan.status) >= order.indexOf(st)
  const steps = [
    { code: 'public_notice', label: 'Public notice', done: reached('public_notice') },
    { code: 'council_adoption', label: 'Adopted by the Full Council', done: Boolean(plan.council_adopted_on), detail: plan.council_resolution_ref },
    ...roles.map((r) => ({ code: `signature:${r.code}`, label: r.label, done: Boolean(r.signed_by), stale: !r.signed_by && r.signed_before, detail: r.signed_by })),
    { code: 'approved', label: 'Approved', done: reached('approved') },
    { code: 'ministerial_approval', label: 'Approved by the Minister', done: Boolean(plan.ministerial_approval_no), detail: plan.ministerial_approval_no },
    { code: 'gazetted', label: 'Gazetted and in force', done: plan.status === 'gazetted', detail: plan.gazette_ref },
  ]

  // decisions taken as affirmed for testing: reported plainly as that
  const [aff] = await q(
    `SELECT count(*) FILTER (WHERE authority LIKE $2)::int AS cells,
            count(*) FILTER (WHERE authority LIKE 'PROPOSED%')::int AS proposed,
            count(*)::int AS decided
       FROM zone_land_use_controls WHERE plan_instrument_id = $1 AND deleted_at IS NULL`, [plan.id, AFFIRMED_LABEL])
  const [{ uses_in_plan: usesInPlan }] = await q('SELECT count(*)::int AS uses_in_plan FROM land_use_groups WHERE plan_instrument_id = $1 AND is_active', [plan.id])

  // the zones: area, the parcels they govern, and what the plan decides for each of the plan's uses
  const zones = await q(
    `WITH zt AS (
        SELECT t.id, t.code,
               count(*) FILTER (WHERE c.control_type = 'permitted')::int AS permitted,
               count(*) FILTER (WHERE c.control_type = 'special_consent')::int AS special_consent,
               count(*) FILTER (WHERE c.control_type = 'prohibited')::int AS prohibited
          FROM plan_zone_type t LEFT JOIN zone_land_use_controls c ON c.plan_zone_type_id = t.id AND c.deleted_at IS NULL
         WHERE t.plan_instrument_id = $1 GROUP BY t.id, t.code),
      z AS (
        SELECT z.plan_zone_type_id AS tid, z.zone, count(*)::int AS polygons, round(sum(z.area_ha)::numeric, 1) AS hectares,
               ST_XMin(ST_Extent(z.geom)) AS west, ST_YMin(ST_Extent(z.geom)) AS south, ST_XMax(ST_Extent(z.geom)) AS east, ST_YMax(ST_Extent(z.geom)) AS north,
               array_agg(z.id) AS ids
          FROM spatial_planning.zone z WHERE z.plan_instrument_id = $1 AND z.is_active GROUP BY z.plan_zone_type_id, z.zone),
      p AS (SELECT pz.plan_zone_type_id AS tid, count(DISTINCT pz.parcel_id)::int AS parcels FROM parcel_zoning pz
             WHERE pz.plan_instrument_id = $1 AND pz.is_governing GROUP BY pz.plan_zone_type_id)
     SELECT z.zone, z.polygons, z.hectares, z.west, z.south, z.east, z.north, COALESCE(p.parcels, 0) AS parcels,
            COALESCE(zt.permitted, 0) AS permitted, COALESCE(zt.special_consent, 0) AS special_consent, COALESCE(zt.prohibited, 0) AS prohibited
       FROM z LEFT JOIN zt ON zt.id = z.tid LEFT JOIN p ON p.tid = z.tid ORDER BY z.hectares DESC`, [plan.id])
  const totalHa = zones.reduce((a, r) => a + Number(r.hectares || 0), 0)

  // how much of the register the plan covers
  const [cov] = await q(
    `SELECT (SELECT count(*) FROM land.parcel WHERE status = 'current')::int AS parcels,
            (SELECT count(DISTINCT pz.parcel_id) FROM parcel_zoning pz JOIN land.parcel l ON l.parcel_id = pz.parcel_id AND l.status = 'current'
              WHERE pz.parcel_layer = 'land.parcel' AND pz.is_governing AND pz.plan_instrument_id = $1)::int AS zoned`, [plan.id])

  // how the plan is working in applications
  const [apps] = await q(
    `SELECT count(*)::int AS lodged_under_plan,
            count(*) FILTER (WHERE status IN ('approved', 'approved_with_conditions', 'refused'))::int AS decided,
            count(*) FILTER (WHERE status IN ('registered', 'acknowledged', 'under_review'))::int AS in_progress
       FROM spatial_planning.permit_application WHERE plan_instrument_id = $1`, [plan.id])
  const [ev] = await q(
    `SELECT count(*) FILTER (WHERE e.event_type = 'plan_departure')::int AS departures,
            count(*) FILTER (WHERE e.event_type = 'rules_acknowledged')::int AS proposed_rule_accepted,
            count(*) FILTER (WHERE e.event_type = 'plan_note')::int AS decided_without_the_plan
       FROM spatial_planning.permit_event e JOIN spatial_planning.permit_application a ON a.id = e.permit_app_id
      WHERE e.event_type IN ('plan_departure', 'rules_acknowledged', 'plan_note')`)

  // what is held beside the plan
  const facilities = await q('SELECT kind, count(*)::int AS n FROM public.vungu_facilities GROUP BY kind ORDER BY n DESC')
  const features = await q('SELECT kind, count(*)::int AS n FROM public.vungu_land_features GROUP BY kind ORDER BY n DESC')
  const [farms] = await q('SELECT count(*)::int AS targeted, count(parcel_id)::int AS linked FROM admin.targeted_farm')
  const [retained] = await q('SELECT count(*)::int AS n FROM admin.retained_zone')
  const [rail] = await q('SELECT count(*)::int AS n FROM public.vungu_railway')

  return {
    as_of: new Date().toISOString(),
    plan: {
      id: plan.id, title: plan.title, version: plan.version, status: plan.status, authority: plan.authority_name,
      revision_label: plan.revision_label, revision_date: plan.revision_date, map_scale: plan.map_scale,
      gazette_ref: plan.gazette_ref, effective_from: plan.effective_from,
      in_force: plan.status === 'gazetted' && plan.governs === true, provisional: plan.provisional,
    },
    adoption: { formal: roles.length > 0, steps, done: steps.filter((s) => s.done).length, of: steps.length },
    decisions: {
      uses_in_plan: usesInPlan, decided: aff.decided, proposed: aff.proposed, affirmed_for_testing: aff.cells,
      // a plan whose pending decisions have only been affirmed for testing is not a plan the council has decided
      tested_on_affirmation: aff.cells > 0,
    },
    zones: zones.map((z) => ({
      zone: z.zone, polygons: z.polygons, hectares: Number(z.hectares), share_pct: totalHa ? Math.round((1000 * Number(z.hectares)) / totalHa) / 10 : 0,
      parcels: z.parcels, permitted: z.permitted, special_consent: z.special_consent, prohibited: z.prohibited,
      not_decided: Math.max(0, usesInPlan - z.permitted - z.special_consent - z.prohibited),
      bbox: [Number(z.west), Number(z.south), Number(z.east), Number(z.north)],
    })),
    total_hectares: Math.round(totalHa),
    coverage: { parcels: cov.parcels, zoned: cov.zoned, unzoned: cov.parcels - cov.zoned },
    applications: { ...apps, ...ev },
    held: { facilities, land_features: features, targeted_farms: farms, retained_zones: retained.n, railway_lines: rail.n },
  }
}

module.exports = { read }
