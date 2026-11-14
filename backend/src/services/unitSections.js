/**
 * The unit sections: one read-only summary per Executive Arm area, shared by the Chief Executive's overview
 * (GET /api/executive/overview) and the unit dashboards (GET /api/units/:key), so the two can never disagree.
 *
 * HONESTY RULE (unchanged): every section carries `loaded`. A register that is empty reports `loaded: false`
 * and a `note`, never a row of zeros; a section whose query fails reports `unavailable: true` and is logged.
 * Human resources has no tables in the system, so it is always `loaded: false`.
 *
 * `pg` must be request-scoped (src/lib/dbContext.js) so row-level security confines every query to the council.
 */
const FINAL_PERMIT = `('approved', 'approved_with_conditions', 'refused', 'withdrawn')`

function createUnitSections(pg, log) {
  const one = async (sql) => (await pg.query(sql)).rows[0]

  async function guarded(name, fn) {
    try {
      return await fn()
    } catch (err) {
      log.warn({ err: err.message, section: name }, 'unit section unavailable')
      return { loaded: false, unavailable: true, note: 'This section could not be read just now.' }
    }
  }

  const readers = {
    planning: async () => {
      // "Overdue" is the clerk's rule (planning-clerk.js, the determination clock): a running clock
      // on an application not yet determined, past its statutory due date.
      const p = await one(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE received_at >= date_trunc('month', now())::date)::int AS received_this_month,
               count(*) FILTER (WHERE status NOT IN ${FINAL_PERMIT})::int AS in_progress,
               count(*) FILTER (WHERE statutory_due_date IS NOT NULL AND statutory_due_date < current_date
                                  AND COALESCE(clock_state, 'running') = 'running'
                                  AND status NOT IN ${FINAL_PERMIT})::int AS overdue,
               count(*) FILTER (WHERE status = 'awaiting_eo_decision')::int AS awaiting_decision,
               count(*) FILTER (WHERE status IN ('approved', 'approved_with_conditions')
                                  AND decision_at >= date_trunc('year', now()))::int AS approved_this_year,
               count(*) FILTER (WHERE status = 'refused'
                                  AND decision_at >= date_trunc('year', now()))::int AS refused_this_year
          FROM spatial_planning.permit_application`)
      const m = await one(`
        SELECT count(*) FILTER (WHERE status = 'scheduled' AND meeting_date::date >= current_date)::int AS upcoming_meetings
          FROM spatial_planning.committee_meeting WHERE deleted_at IS NULL`)
      const e = await one(`
        SELECT (SELECT count(*) FROM spatial_planning.enforcement_order
                 WHERE status IN ('issued', 'served', 'non_complied'))::int AS open_enforcement_orders,
               (SELECT count(*) FROM spatial_planning.building_complaint
                 WHERE status IN ('received', 'assigned', 'inspected'))::int AS open_building_complaints`)
      const loaded = p.total > 0
      return { loaded, ...(loaded ? {} : { note: 'No development applications are on the register yet.' }), ...p, ...m, ...e }
    },

    land: async () => {
      const l = await one(`
        SELECT (SELECT count(*) FROM land.parcel WHERE status = 'current')::int AS parcels,
               (SELECT count(DISTINCT a.parcel_id) FROM revenue_link.account_link a
                  JOIN land.parcel p ON p.parcel_id = a.parcel_id AND p.status = 'current')::int AS parcels_with_account,
               (SELECT count(*) FROM land.parcel WHERE status = 'current' AND accuracy_basis = 'estimated')::int AS estimated_boundaries`)
      // No arrears figure, by design (decision D13): the integration carries status bands, not amounts, and
      // an outstanding-revenue figure must not be approximated from them.
      const loaded = l.parcels > 0
      return { loaded, ...(loaded ? {} : { note: 'The parcel register is empty.' }), ...l }
    },

    engineering: async () => {
      const g = await one(`
        SELECT (SELECT count(*) FROM council_ops.road_asset WHERE status = 'active')::int AS roads,
               (SELECT COALESCE(round(sum(length_m) FILTER (WHERE status = 'active') / 1000.0, 1), 0)
                  FROM council_ops.road_asset)::float AS road_km,
               (SELECT count(*) FROM council_ops.wash_asset)::int AS water_points,
               (SELECT count(*) FROM council_ops.wash_asset WHERE operational = 'working')::int AS water_points_working,
               (SELECT count(*) FROM council_ops.council_asset)::int AS council_assets,
               (SELECT count(*) FROM finance.fixed_asset)::int AS fixed_assets,
               (SELECT count(*) FROM finance.v_project_performance WHERE status = 'in_progress')::int AS projects_in_progress`)
      const loaded = g.roads + g.water_points + g.council_assets + g.fixed_assets > 0
      return { loaded, ...(loaded ? {} : { note: 'The road, water and asset registers have not been loaded yet.' }), ...g }
    },

    social_services: async () => {
      const s = await one(`
        SELECT (SELECT count(*) FROM spatial_planning.health_premises WHERE deleted_at IS NULL)::int AS premises,
               (SELECT count(*) FROM spatial_planning.health_premises
                 WHERE deleted_at IS NULL AND fitness_certificate_expiry IS NOT NULL
                   AND fitness_certificate_expiry < current_date + 60)::int AS certificates_due_or_expired,
               (SELECT count(*) FROM spatial_planning.health_nuisance_complaint
                 WHERE status IN ('open', 'investigating'))::int AS open_nuisance_complaints`)
      const loaded = s.premises > 0
      return { loaded, ...(loaded ? {} : { note: 'No health premises are registered yet.' }), ...s }
    },

    audit: async () => {
      const a = await one(`
        SELECT (SELECT count(*) FROM finance.audit_engagement WHERE status IN ('not_started', 'in_progress'))::int AS engagements_open,
               (SELECT count(*) FROM finance.audit_engagement)::int AS engagements,
               (SELECT count(*) FROM finance.audit_finding WHERE status = 'open')::int AS findings_open,
               (SELECT count(*) FROM finance.audit_finding WHERE status = 'open' AND risk = 'high')::int AS findings_high_risk,
               (SELECT count(*) FROM finance.audit_finding WHERE status = 'open' AND due_date < current_date)::int AS actions_overdue`)
      const loaded = a.engagements > 0
      return { loaded, ...(loaded ? {} : { note: 'No audit engagements are recorded yet.' }), ...a }
    },

    hr: async () => ({ loaded: false, note: 'Staff and payroll are not yet in the system.' }),
  }

  /** One named section, or `unavailable` if its queries fail. */
  const read = (name) => guarded(name, readers[name])

  return { read, names: Object.keys(readers) }
}

module.exports = { createUnitSections }
