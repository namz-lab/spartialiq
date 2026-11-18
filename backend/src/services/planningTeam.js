/**
 * The EO Planning's team at a glance: one read-only summary per desk under the Executive Officer (Planning),
 * in the shape of the unit sections (src/services/unitSections.js) so the screens can share one tile.
 *
 *   clerk                 the counter: fees, acknowledgements, objection periods, decisions to send out
 *   planners              the cases in hand: unassigned, against the three-month clock, objections, replies owed
 *   inspectors            stage inspections, building complaints, enforcement
 *   environmental_health  the health registers: premises certificates, nuisance complaints, follow-ups
 *   gis_survey            survey tasks and the parcel outlines still estimated
 *
 * HONESTY RULE (the same as the unit sections): every desk carries `loaded`. A desk whose registers are empty
 * reports `loaded: false` and a `note`, never a row of zeros; a desk whose query fails reports
 * `unavailable: true` and is logged. A count is a count of what is recorded, nothing is estimated.
 *
 * The rules are the ones the desks already work to: "overdue" is the clerk's determination clock (a running
 * clock past its statutory due date on an application not yet determined), the same rule unitSections uses.
 *
 * `pg` must be request-scoped (src/lib/dbContext.js) so row-level security confines every query to the council.
 */
const FINAL = `('approved', 'approved_with_conditions', 'refused', 'withdrawn')`
const DECIDED = `('approved', 'approved_with_conditions', 'refused')`
/** Past the counter and not yet on the EO's desk: the stages the planners work (the pipeline in useApplicationPipeline.ts). */
const WITH_PLANNERS = `('acknowledged', 'circulation', 'objection_period', 'under_review', 'deferred')`
/** The window the EO console warns in by default (src/eo-planner/useEoPreferences: clockWarningDays). */
const WARNING_DAYS = 14

function createPlanningTeam(pg, log) {
  const one = async (sql, params) => (await pg.query(sql, params)).rows[0]

  async function guarded(name, fn) {
    try {
      return await fn()
    } catch (err) {
      log.warn({ err: err.message, desk: name }, 'planning team desk unavailable')
      return { loaded: false, unavailable: true, note: 'This desk could not be read just now.' }
    }
  }

  const readers = {
    clerk: async () => {
      const a = await one(`
        SELECT count(*)::int AS applications,
               count(*) FILTER (WHERE received_at >= date_trunc('month', now())::date)::int AS received_this_month,
               count(*) FILTER (WHERE acknowledged_at IS NULL AND fee_paid_at IS NULL AND status NOT IN ${FINAL})::int AS awaiting_fee,
               count(*) FILTER (WHERE acknowledged_at IS NULL AND fee_paid_at IS NOT NULL AND status NOT IN ${FINAL})::int AS to_acknowledge,
               count(*) FILTER (WHERE status IN ${DECIDED} AND NOT EXISTS (
                                  SELECT 1 FROM spatial_planning.clerk_dispatch d
                                   WHERE d.permit_application_id = pa.id AND d.voided_at IS NULL))::int AS decisions_to_send
          FROM spatial_planning.permit_application pa`)
      const n = await one(`
        SELECT count(*) FILTER (WHERE NOT COALESCE(objection_period_closed, false)
                                  AND objection_period_end >= current_date)::int AS objection_periods_running,
               count(*) FILTER (WHERE NOT COALESCE(objection_period_closed, false)
                                  AND objection_period_end < current_date)::int AS objection_periods_to_close
          FROM spatial_planning.public_notice`)
      const loaded = a.applications > 0
      return { loaded, ...(loaded ? {} : { note: 'No development applications are on the register yet.' }), ...a, ...n }
    },

    planners: async () => {
      const p = await one(`
        SELECT count(*) FILTER (WHERE status IN ${WITH_PLANNERS})::int AS in_hand,
               count(*) FILTER (WHERE status IN ${WITH_PLANNERS} AND assigned_to IS NULL)::int AS unassigned,
               count(*) FILTER (WHERE statutory_due_date IS NOT NULL AND COALESCE(clock_state, 'running') = 'running'
                                  AND status NOT IN ${FINAL}
                                  AND statutory_due_date >= current_date
                                  AND statutory_due_date < current_date + $1::int)::int AS due_soon,
               count(*) FILTER (WHERE statutory_due_date IS NOT NULL AND COALESCE(clock_state, 'running') = 'running'
                                  AND status NOT IN ${FINAL}
                                  AND statutory_due_date < current_date)::int AS overdue,
               count(*) FILTER (WHERE status = 'awaiting_eo_decision')::int AS with_the_eo,
               count(*)::int AS applications
          FROM spatial_planning.permit_application`, [WARNING_DAYS])
      const o = await one(`
        SELECT (SELECT count(*) FROM spatial_planning.application_objection o
                  JOIN spatial_planning.permit_application pa ON pa.id = o.permit_app_id AND pa.status NOT IN ${FINAL}
                 WHERE o.considered_at IS NULL)::int AS objections_to_consider,
               (SELECT count(*) FROM spatial_planning.application_consultation
                 WHERE response_received_at IS NULL AND response_due_at < current_date)::int AS replies_overdue,
               (SELECT count(*) FROM spatial_planning.case_referral
                 WHERE deleted_at IS NULL AND answered_on IS NULL AND reply_by < current_date)::int AS referrals_overdue`)
      const loaded = p.applications > 0
      const { applications: _a, ...rest } = p
      return { loaded, ...(loaded ? {} : { note: 'No development applications are on the register yet.' }), ...rest, ...o }
    },

    inspectors: async () => {
      const s = await one(`
        SELECT count(*)::int AS inspections,
               count(*) FILTER (WHERE inspected_at IS NULL)::int AS booked,
               count(*) FILTER (WHERE inspected_at IS NULL AND inspector_id IS NULL)::int AS without_inspector,
               count(*) FILTER (WHERE inspected_at IS NULL AND scheduled_at < now())::int AS past_their_date,
               count(*) FILTER (WHERE inspected_at >= date_trunc('month', now()))::int AS done_this_month
          FROM spatial_planning.stage_inspection`)
      const c = await one(`
        SELECT (SELECT count(*) FROM spatial_planning.building_complaint
                 WHERE status IN ('received', 'assigned', 'inspected'))::int AS complaints_open,
               (SELECT count(*) FROM spatial_planning.building_complaint WHERE status = 'received')::int AS complaints_unassigned,
               (SELECT count(*) FROM spatial_planning.enforcement_order
                 WHERE status IN ('issued', 'served', 'non_complied'))::int AS enforcement_open`)
      const loaded = s.inspections + c.complaints_open + c.enforcement_open > 0
      const { inspections: _i, ...rest } = s
      return { loaded, ...(loaded ? {} : { note: 'No inspections, complaints or enforcement orders are recorded yet.' }), ...rest, ...c }
    },

    environmental_health: async () => {
      const h = await one(`
        SELECT (SELECT count(*) FROM spatial_planning.health_premises WHERE deleted_at IS NULL)::int AS premises,
               (SELECT count(*) FROM spatial_planning.health_premises
                 WHERE deleted_at IS NULL AND fitness_certificate_expiry IS NOT NULL
                   AND fitness_certificate_expiry < current_date)::int AS certificates_expired,
               (SELECT count(*) FROM spatial_planning.health_premises
                 WHERE deleted_at IS NULL AND fitness_certificate_expiry >= current_date
                   AND fitness_certificate_expiry < current_date + 60)::int AS certificates_due,
               (SELECT count(*) FROM spatial_planning.health_nuisance_complaint
                 WHERE status IN ('open', 'investigating'))::int AS nuisance_open,
               (SELECT count(*) FROM spatial_planning.health_premises_inspection
                 WHERE follow_up_date < current_date AND notice_id IS NULL)::int AS follow_ups_past`)
      const loaded = h.premises + h.nuisance_open > 0
      return { loaded, ...(loaded ? {} : { note: 'No health premises or nuisance complaints are registered yet.' }), ...h }
    },

    gis_survey: async () => {
      const t = await one(`
        SELECT count(*)::int AS tasks,
               count(*) FILTER (WHERE status IN ('assigned', 'in_progress'))::int AS tasks_open,
               count(*) FILTER (WHERE status IN ('assigned', 'in_progress') AND due_date < current_date)::int AS tasks_overdue,
               count(*) FILTER (WHERE status = 'submitted')::int AS awaiting_review,
               count(*) FILTER (WHERE status = 'returned')::int AS returned
          FROM spatial_planning.survey_task`)
      const l = await one(`
        SELECT count(*)::int AS parcels,
               count(*) FILTER (WHERE accuracy_basis = 'estimated')::int AS outlines_estimated
          FROM land.parcel WHERE status = 'current'`)
      const loaded = t.tasks + l.parcels > 0
      const { tasks: _t, ...rest } = t
      return { loaded, ...(loaded ? {} : { note: 'No survey tasks or parcels are recorded yet.' }), ...rest, ...l }
    },
  }

  /** Every desk; a desk whose queries fail is `unavailable` and the others still come back. */
  async function read() {
    const names = Object.keys(readers)
    const desks = await Promise.all(names.map((n) => guarded(n, readers[n])))
    return Object.fromEntries(names.map((n, i) => [n, desks[i]]))
  }

  return { read, names: Object.keys(readers), WARNING_DAYS }
}

module.exports = { createPlanningTeam, WARNING_DAYS }
