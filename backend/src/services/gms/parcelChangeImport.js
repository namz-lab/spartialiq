// src/services/gms/parcelChangeImport.js
// ───────────────────────────────────────────────────────────────────────────
// The survey import of an approved plan can carry a STAND-CHANGE PROPOSAL (migrations 229 and 230): the Survey Section has surveyed what an officer
// drew, and importing it also closes the proposal. Used by importGeneralPlan (services/gms/parcelImport.js) when the input names change_request_id;
// an ordinary import never comes here.
//
//   prepare()  validates the surveyed features against the proposal and says what applying it would do. Errors are short codes with detail.
//   apply()    in the import's transaction, after the new parcels are inserted: revises boundaries in place, retires the stands a split or a merge
//              replaces, writes parent -> child lineage, withdraws the retired stands' offers and zone links, and marks the proposal applied.
//
// How a feature is matched to a proposal item: by BOUNDARY AGREEMENT. A sketch is not a survey, so the surveyed boundary need only overlap the item
// by MATCH_IOU (intersection over union, in the survey CRS); every item must match exactly one feature and every feature exactly one item. The report
// carries the measured agreement of each. MATCH_IOU and COVER_TOLERANCE are PROPOSALS for the Survey Section to confirm.
//
// The proposal's parents are being REPLACED, so they do not count as overlaps; every other current STAND does (custodian stands included: an
// ordinary import checks only the council's own). Stands lie inside farms and plots, so those are not compared. A split or merge must cover its parents, and a 'new' (a stand cut from a parent) the parent as it was.
// ───────────────────────────────────────────────────────────────────────────

const { enqueue } = require('./outbox')

const MATCH_IOU = 0.8
// a second candidate this close to the best is an ambiguity, not a choice
const AMBIGUITY_MARGIN = 0.05
const COVER_TOLERANCE = 0.01
const OVERLAP_TOLERANCE_M2 = 0.01
const MIN_COVER_M2 = 0.5

/**
 * @param client  the import's transaction client; gp_in (idx, stand_no, ward_code, g in the survey CRS) exists
 * @param q       (sql, params) => rows
 * @returns {{ errors: object[], ctx?: object, report?: object }}
 */
async function prepare(client, q, { requestId, township_code, source_srid }) {
  const errors = []
  const [req] = await q('SELECT * FROM land.parcel_change_request WHERE id = $1 FOR UPDATE', [requestId])
  if (!req) return { errors: [{ code: 'unknown_change_request', change_request_id: requestId }] }
  if (req.status !== 'accepted') return { errors: [{ code: 'change_request_not_accepted', change_request_id: requestId, status: req.status }] }

  const parents = await q(
    `SELECT p.parcel_id, p.stand_no, p.township_code, p.status
       FROM land.parcel_change_parent cp JOIN land.parcel p ON p.parcel_id = cp.parcel_id WHERE cp.request_id = $1 ORDER BY p.stand_no`, [requestId])
  for (const p of parents) {
    if (p.status !== 'current') errors.push({ code: 'parent_not_current', parcel_id: p.parcel_id, stand_no: p.stand_no })
    if (p.township_code !== township_code) errors.push({ code: 'parent_in_other_township', parcel_id: p.parcel_id, stand_no: p.stand_no, township_code: p.township_code })
  }
  const items = await q('SELECT seq, role, label, parent_parcel_id FROM land.parcel_change_item WHERE request_id = $1 ORDER BY seq', [requestId])
  const features = await q('SELECT idx, stand_no FROM gp_in ORDER BY idx')
  if (errors.length) return { errors }

  // match features to items by boundary agreement (survey CRS, planar)
  const pairs = await q(
    `SELECT it.seq, f.idx,
            ST_Area(ST_Intersection(f.g, ST_Transform(it.geom, $2::int)))
              / NULLIF(ST_Area(ST_Union(f.g, ST_Transform(it.geom, $2::int))), 0) AS iou
       FROM land.parcel_change_item it
       JOIN gp_in f ON f.g IS NOT NULL AND ST_Intersects(f.g, ST_Transform(it.geom, $2::int))
      WHERE it.request_id = $1`, [requestId, source_srid])
  const bySeq = new Map()
  for (const p of pairs) {
    if (Number(p.iou) < MATCH_IOU) continue
    bySeq.set(p.seq, [...(bySeq.get(p.seq) || []), { idx: p.idx, iou: Number(p.iou) }])
  }
  const matches = []
  for (const it of items) {
    const cands = (bySeq.get(it.seq) || []).sort((a, b) => b.iou - a.iou)
    if (!cands.length) { errors.push({ code: 'proposal_item_unmatched', seq: it.seq, label: it.label, needed_iou: MATCH_IOU }); continue }
    if (cands[1] && cands[0].iou - cands[1].iou < AMBIGUITY_MARGIN) {
      errors.push({ code: 'proposal_ambiguous', seq: it.seq, label: it.label, features: cands.map((c) => c.idx) }); continue
    }
    matches.push({ ...it, idx: cands[0].idx, iou: cands[0].iou })
  }
  const used = new Map()
  for (const m of matches) used.set(m.idx, [...(used.get(m.idx) || []), m.seq])
  for (const [idx, seqs] of used) if (seqs.length > 1) errors.push({ code: 'proposal_ambiguous', feature: idx, seqs, note: 'one feature matches more than one proposal item' })
  for (const f of features) if (!used.has(f.idx)) errors.push({ code: 'feature_matches_no_item', feature: f.idx, stand_no: f.stand_no })
  if (errors.length) return { errors }

  const stand = new Map(features.map((f) => [f.idx, f.stand_no]))
  const parentById = new Map(parents.map((p) => [p.parcel_id, p]))
  const retiring = req.kind === 'split' || req.kind === 'merge' ? parents.map((p) => p.parcel_id) : []

  // a revised parcel keeps its stand number; a new parcel's number is free, or was a parent's that is being retired
  for (const m of matches) {
    if (m.role === 'revised') {
      const parent = parentById.get(m.parent_parcel_id)
      if (stand.get(m.idx) !== parent.stand_no) errors.push({ code: 'revised_stand_no_differs', feature: m.idx, stand_no: stand.get(m.idx), expected: parent.stand_no })
    }
  }
  const childNos = matches.filter((m) => m.role === 'child').map((m) => stand.get(m.idx))
  for (const r of await q(
    `SELECT parcel_id, stand_no FROM land.parcel
      WHERE township_code = $1 AND status = 'current' AND stand_no = ANY($2::text[]) AND parcel_id <> ALL($3::text[])`,
    [township_code, childNos, retiring])) {
    errors.push({ code: 'stand_no_exists', stand_no: r.stand_no, parcel_id: r.parcel_id })
  }

  // against the rest of the register
  for (const r of await q(
    `SELECT f.idx, p.parcel_id, p.stand_no, ST_Area(ST_Intersection(f.g, ST_Transform(p.geom_wgs84, $1::int))) AS overlap_m2
       FROM gp_in f
       JOIN land.parcel p ON p.status = 'current' AND p.parcel_kind = 'stand' AND p.geom_wgs84 && ST_Transform(f.g, 4326)
      WHERE f.g IS NOT NULL
        AND p.parcel_id <> ALL($2::text[])
        AND ST_Area(ST_Intersection(f.g, ST_Transform(p.geom_wgs84, $1::int))) > $3`,
    [source_srid, parents.map((p) => p.parcel_id), OVERLAP_TOLERANCE_M2])) {
    errors.push({ code: 'overlaps_register_parcel', feature: r.idx, parcel_id: r.parcel_id, stand_no: r.stand_no, overlap_m2: Number(r.overlap_m2) })
  }

  // a split, merge or new stand must account for what it replaces
  if (req.kind !== 'reshape') {
    const [c] = await q(
      `WITH pa AS (SELECT ST_UnaryUnion(ST_Collect(ST_Transform(p.geom_wgs84, $2::int))) AS g
                     FROM land.parcel_change_parent cp JOIN land.parcel p ON p.parcel_id = cp.parcel_id WHERE cp.request_id = $1),
            fe AS (SELECT ST_UnaryUnion(ST_Collect(g)) AS g FROM gp_in)
       SELECT ST_Area(ST_SymDifference(pa.g, fe.g)) AS mismatch_m2, ST_Area(pa.g) AS parent_m2 FROM pa, fe`, [requestId, source_srid])
    if (Number(c.mismatch_m2) > Math.max(MIN_COVER_M2, COVER_TOLERANCE * Number(c.parent_m2))) {
      errors.push({ code: 'surveyed_boundaries_do_not_match_parents', mismatch_m2: Number(c.mismatch_m2), parent_m2: Number(c.parent_m2), tolerance: COVER_TOLERANCE })
    }
  }
  if (errors.length) return { errors }

  const ctx = {
    request: req, parents, matches, stand, retiring,
    childIdx: matches.filter((m) => m.role === 'child').map((m) => m.idx),
    revisedIdx: matches.filter((m) => m.role === 'revised').map((m) => m.idx),
  }
  const report = {
    change_request_id: requestId,
    kind: req.kind,
    matches: matches.map((m) => ({ seq: m.seq, role: m.role, label: m.label, feature: m.idx, stand_no: stand.get(m.idx), agreement: Math.round(m.iou * 1000) / 1000 })),
    retire: retiring.map((id) => ({ parcel_id: id, stand_no: parentById.get(id).stand_no })),
    revise: matches.filter((m) => m.role === 'revised').map((m) => ({ parcel_id: m.parent_parcel_id, stand_no: parentById.get(m.parent_parcel_id).stand_no })),
    match_threshold: MATCH_IOU,
  }
  return { errors, ctx, report }
}

/**
 * Apply the proposal inside the import's transaction. `created` are the new parcels the import just inserted (parcel_id, stand_no, area_m2, ward_code, sg_ref).
 */
async function apply(client, q, ctx, { gp, crs, sg_ref, source_srid, township_code, user, created }) {
  const { request, parents, matches, stand, retiring } = ctx
  const parentById = new Map(parents.map((p) => [p.parcel_id, p]))
  const createdByNo = new Map(created.map((c) => [c.stand_no, c]))
  const childParcels = matches.filter((m) => m.role === 'child').map((m) => ({ item: m, parcel: createdByNo.get(stand.get(m.idx)) }))

  // revised boundaries: in place, the parcel keeps its id; what it was is kept in land.parcel_event
  for (const m of matches.filter((x) => x.role === 'revised')) {
    const [before] = await q(
      `SELECT origin, stand_no, township_code, parcel_kind, source_srid, area_m2, accuracy_basis, sg_ref, source, custodian_dept, geom_source
         FROM land.parcel WHERE parcel_id = $1`, [m.parent_parcel_id])
    const { geom_source: oldGeom, ...details } = before
    await q(`INSERT INTO land.parcel_event (parcel_id, event, general_plan_id, performed_by, details, previous_geom, previous_srid)
             VALUES ($1, 'boundary_revised', $2, $3, $4::jsonb, $5, $6)`,
      [m.parent_parcel_id, gp.import_id, user?.id ?? null, JSON.stringify({ ...details, change_request_id: request.id, kind: request.kind, agreement: m.iou }), oldGeom, before.source_srid])
    await q(`
      UPDATE land.parcel p
         SET source_srid = $2, geom_source = i.g, geom_wgs84 = ST_Multi(ST_Transform(i.g, 4326)), transform_method = $3, transform_accuracy_m = $4,
             area_m2 = round(ST_Area(i.g)::numeric, 2), sg_ref = $5, general_plan_id = $6, origin = 'custodian', accuracy_class = 'A',
             accuracy_basis = 'general_plan', source = 'Survey Section approved general plan ' || $5, custodian_dept = 'Survey Section'
        FROM gp_in i WHERE i.idx = $7 AND p.parcel_id = $1`,
      [m.parent_parcel_id, source_srid, crs.transform_method, crs.accuracy_m, sg_ref, gp.import_id, m.idx])
  }

  // retired stands (a split or a merge): kept, with their history; never reused
  const childIds = childParcels.map((c) => c.parcel.parcel_id)
  for (const id of retiring) {
    const [before] = await q('SELECT origin, stand_no, township_code, parcel_kind, source_srid, area_m2, sg_ref, source, geom_source FROM land.parcel WHERE parcel_id = $1', [id])
    const { geom_source: oldGeom, ...details } = before
    await q(`INSERT INTO land.parcel_event (parcel_id, event, general_plan_id, performed_by, details, previous_geom, previous_srid)
             VALUES ($1, 'retired', $2, $3, $4::jsonb, $5, $6)`,
      [id, gp.import_id, user?.id ?? null, JSON.stringify({ ...details, change_request_id: request.id, kind: request.kind, replaced_by: childIds }), oldGeom, before.source_srid])
    await q(`UPDATE land.parcel SET status = 'retired', valid_to = CURRENT_DATE WHERE parcel_id = $1`, [id])
    await q(`DELETE FROM public.parcel_zoning WHERE parcel_layer = 'land.parcel' AND parcel_id = $1`, [id])
    await q(`UPDATE land.stand_offer SET status = 'withdrawn', updated_at = now() WHERE parcel_id = $1 AND status <> 'allocated'`, [id])
    await enqueue(client, 'ParcelRetired', {
      parcel_id: id, stand_no: parentById.get(id).stand_no, replaced_by: childIds, sg_ref, kind: request.kind,
    }, `ParcelRetired:${id}:${sg_ref}`)
  }

  // lineage: parent -> child (a split or a stand cut from a parent is a subdivision; a merge is a consolidation)
  const lineageEvent = request.kind === 'merge' ? 'consolidation' : 'subdivision'
  if (request.kind !== 'reshape') {
    for (const p of parents) {
      for (const c of childIds) {
        await q(`INSERT INTO land.parcel_lineage (parent_id, child_id, event, event_date) VALUES ($1, $2, $3, CURRENT_DATE) ON CONFLICT DO NOTHING`, [p.parcel_id, c, lineageEvent])
      }
    }
  }
  for (const m of matches.filter((x) => x.role === 'revised')) {
    const p = (await q('SELECT parcel_id, stand_no, area_m2, ward_code, sg_ref FROM land.parcel WHERE parcel_id = $1', [m.parent_parcel_id]))[0]
    await enqueue(client, 'ParcelBoundaryRevised', {
      parcel_id: p.parcel_id, stand_no: p.stand_no, area_m2: Number(p.area_m2), ward_code: p.ward_code, sg_ref: p.sg_ref,
    }, `ParcelBoundaryRevised:${p.parcel_id}:${p.sg_ref}`)
  }

  // the proposal is applied; each item records the parcel it became; the survey task is closed
  for (const m of matches) {
    const parcelId = m.role === 'revised' ? m.parent_parcel_id : childParcels.find((c) => c.item.seq === m.seq).parcel.parcel_id
    await q('UPDATE land.parcel_change_item SET matched_parcel_id = $3 WHERE request_id = $1 AND seq = $2', [request.id, m.seq, parcelId])
  }
  await q(`UPDATE land.parcel_change_request SET status = 'applied', general_plan_id = $2, applied_at = now(), applied_by = $3 WHERE id = $1`,
    [request.id, gp.import_id, user?.id ?? null])
  if (request.survey_task_id) {
    await q(`UPDATE spatial_planning.survey_task SET status = 'accepted', updated_at = now() WHERE id = $1 AND status IN ('assigned', 'in_progress', 'submitted')`, [request.survey_task_id])
  }
  return { retired: retiring, revised: matches.filter((m) => m.role === 'revised').map((m) => m.parent_parcel_id), created: childIds }
}

module.exports = { prepare, apply, MATCH_IOU, COVER_TOLERANCE }
