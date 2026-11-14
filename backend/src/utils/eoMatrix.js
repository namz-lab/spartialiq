/**
 * The Executive Officer for Planning's development matrix for Vungu ("Gweru Rural Master Plan Use Groups"),
 * translated into our plan's own use codes and zone types, plus best-practice PROPOSALS for the zones the
 * EO's matrix does not cover. Pure functions only: scripts/load-eo-matrix.js does the database work.
 *
 * Two kinds of decision come out, and they are never mixed up:
 *   - EO decisions       authority = EO_AUTHORITY      the EO's own cells (data/reference/vungu/eo-matrix.csv)
 *   - PROPOSED           authority = PROPOSED_AUTHORITY best practice, to be agreed with the EO after the MVP
 * Row format is the importer's: zone, group_code, control_type, conditions, notes, authority.
 */

const EO_AUTHORITY = 'EO Planning (Vungu matrix)'
const PROPOSED_AUTHORITY = 'PROPOSED: best practice, for EO review'

const P = 'permitted'
const SC = 'special_consent'
const X = 'prohibited'
const SEVERITY = { [P]: 0, [SC]: 1, [X]: 2 } // higher = more restrictive
const SHORT = { P, SC, X }

/**
 * The EO's use groups -> ours, matched by DESCRIPTION, never by letter (16 letters mean a different use in
 * the two lists). `ours: null` = the EO has a use we lack: it is added with `code`. Each row also records the
 * EO's own letter so the EO can find it.
 */
const USE_MAP = [
  { eo: 'A', name: 'Detached Dwelling House', ours: 'A' },
  { eo: 'A1', name: 'Attached/Semi-Detached Dwelling House', ours: 'A2' },
  { eo: 'A2', name: 'Flats', ours: 'A3' },
  { eo: 'A3', name: 'Cluster House', ours: 'A1' },
  { eo: 'B', name: 'Residential Buildings', ours: 'B' },
  { eo: 'B1', name: 'Residential Buildings (Licensed)', ours: 'B1' },
  { eo: 'B2', name: 'Residential Buildings (Institutional)', ours: 'B2' },
  { eo: 'C', name: 'Schools & Residential Colleges', ours: 'C' },
  { eo: 'C1', name: 'Crèches', ours: null, code: 'C1', category: 'institutional', hilucs: '3_3_CommunityServices' },
  { eo: 'D', name: 'Shops', ours: 'D' },
  { eo: 'D1', name: 'Equipment, Furniture & ICT Showrooms', ours: null, code: 'D2', category: 'commercial', hilucs: '3_1_CommercialServices' },
  { eo: 'D2', name: 'Restaurants', ours: null, code: 'D3', category: 'commercial', hilucs: '3_1_CommercialServices' },
  { eo: 'E', name: 'Offices', ours: 'E' },
  { eo: 'E1', name: 'Corporate Offices', ours: 'E1' },
  { eo: 'E2', name: 'Surgeries & Medical Chambers', ours: 'E2' },
  { eo: 'F', name: 'Wholesale Warehouse', ours: 'G' },
  { eo: 'G', name: 'Storage Warehouse', ours: 'H' },
  { eo: 'H', name: 'Public Buildings', ours: 'I' },
  { eo: 'I', name: 'Places of Public Worship', ours: 'K' },
  { eo: 'K', name: 'Places of Assembly', ours: 'J' },
  { eo: 'K1', name: 'Special Places of Assembly', ours: 'J1' },
  { eo: 'L', name: 'Industrial', ours: 'M', note: 'matched to our "Industrial buildings"; our "General industrial buildings" (L1) has no EO counterpart' },
  { eo: 'L1', name: 'Service Industrial Building', ours: null, code: 'L2', category: 'industrial', hilucs: '2_SecondaryProduction' },
  { eo: 'N', name: 'Agricultural Buildings', ours: 'Q' },
  { eo: 'P', name: 'Petrol Filling Station', ours: 'R' },
  { eo: 'R', name: 'Newspaper Offices', ours: 'T' },
  { eo: 'S', name: 'Special Buildings & Uses', ours: null, code: 'W', category: 'institutional', hilucs: '3_3_CommunityServices' },
  { eo: 'T', name: 'Parking Garage', ours: 'U' },
  { eo: 'T1', name: 'Surface Car Park', ours: null, code: 'U1', category: 'commercial', hilucs: '4_1_TransportNetworks' },
  { eo: 'T2', name: 'Lorry Parking & Rest House', ours: 'S' },
  { eo: 'U', name: 'Funeral Parlour', ours: 'V' },
]

/** EO column header -> the zone type it becomes. Light and General Industry are one column (see combine). */
const EO_ZONE_MAP = {
  'Zone 1B(iii) Mixed': 'Zone 1B(iii) Mixed',
  'Central Business District': 'Central Business District',
  'Local Shopping Centre': 'Local Shopping Centre',
  'Neighbourhood Shopping': 'Neighbourhood Shopping',
  Markets: 'Markets',
  'High Density Residential': 'High Density Residential',
  'Medium Density': 'Medium Density Residential',
  'Low Density Residential': 'Low Density Residential',
  Flats: 'Flats',
  'Zone 4 Public': 'Zone 4 Public',
  'Light and': 'Light and General Industry',
  'General Industry': 'Light and General Industry',
  Resettlement: 'Resettlement Area',
  Communal: 'Communal',
}
const COMBINED_ZONE = 'Light and General Industry'
const RENAMED_ZONES = [{ from: 'Light Industry', to: COMBINED_ZONE }]

/** Most restrictive of several controls: prohibited beats special consent beats permitted. */
function mostRestrictive(controls) {
  return controls.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a))
}

const q = (eoCode) => USE_MAP.find((u) => u.eo === eoCode)
/** The code the EO's use has in our list. */
const ourCode = (eoCode) => { const u = q(eoCode); return u.ours || u.code }

/**
 * @param {{eo_code,eo_name,eo_zone,control,footnote,raw}[]} eoRows  parsed data/reference/vungu/eo-matrix.csv
 * @returns {{rows: object[], conflicts: object[]}}  importer rows (EO authority) and the combine conflicts
 */
function buildEoRows(eoRows) {
  const unknownUse = eoRows.filter((r) => !q(r.eo_code))
  if (unknownUse.length) throw new Error(`EO use group not in the mapping: ${[...new Set(unknownUse.map((r) => r.eo_code))].join(', ')}`)
  const unknownZone = eoRows.filter((r) => !EO_ZONE_MAP[r.eo_zone])
  if (unknownZone.length) throw new Error(`EO column not in the mapping: ${[...new Set(unknownZone.map((r) => r.eo_zone))].join(', ')}`)

  const rows = []
  const conflicts = []
  const combined = new Map() // eo_code -> [{zone, control, row}]
  for (const r of eoRows) {
    const zone = EO_ZONE_MAP[r.eo_zone]
    const control = SHORT[r.control]
    if (!control) throw new Error(`Unreadable control "${r.control}" for ${r.eo_code} x ${r.eo_zone}`)
    if (zone === COMBINED_ZONE) {
      if (!combined.has(r.eo_code)) combined.set(r.eo_code, [])
      combined.get(r.eo_code).push({ zone: r.eo_zone, control, row: r })
      continue
    }
    const bits = [`EO use ${r.eo_code} "${r.eo_name}", column "${r.eo_zone}"`]
    if (r.footnote) bits.push(`EO footnote ${r.footnote} (footnote text not supplied)`)
    if (/\*/.test(r.raw)) bits.push(`EO cell reads "${r.raw}" (the asterisk is not explained)`)
    rows.push({ zone, group_code: ourCode(r.eo_code), control_type: control, conditions: '', notes: bits.join('; '), authority: EO_AUTHORITY })
  }
  for (const [eoCode, cells] of combined) {
    const controls = cells.map((c) => c.control)
    const chosen = mostRestrictive(controls)
    const disagree = new Set(controls).size > 1
    const u = q(eoCode)
    const bits = [`EO use ${eoCode} "${u.name}"`]
    for (const c of cells) {
      bits.push(`column "${c.zone}": ${c.row.raw}`)
      if (c.row.footnote) bits.push(`EO footnote ${c.row.footnote} (text not supplied)`)
    }
    if (disagree) bits.push('the two columns were combined at the user\'s direction: most restrictive applies; EO to confirm')
    rows.push({ zone: COMBINED_ZONE, group_code: ourCode(eoCode), control_type: chosen, conditions: '', notes: bits.join('; '), authority: EO_AUTHORITY })
    if (disagree) conflicts.push({ eo_code: eoCode, our_code: ourCode(eoCode), use: u.name, light: cells[0].control, general: cells[1].control, chosen })
  }
  return { rows, conflicts }
}

// ── Proposals ────────────────────────────────────────────────────────────────────────────────
// Every one of our uses once the EO's six extra uses are added (32 + 6 = 38).
const ALL_USES = ['A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2', 'C', 'C1', 'D', 'D1', 'D2', 'D3', 'E', 'E1', 'E2', 'F', 'G', 'H', 'I', 'J', 'J1', 'K',
  'L1', 'L2', 'M', 'P', 'Q', 'R', 'S', 'T', 'U', 'U1', 'V', 'W', 'X', 'Z', 'UF']

const spread = (def, over) => Object.fromEntries(ALL_USES.map((c) => [c, over[c] || def]))

/**
 * Zones with no column in the EO's matrix, set from the usual practice for that kind of land.
 * Farm zones: agriculture and the farm's own buildings permitted, urban uses prohibited, ancillary community
 * and tourism uses by consent (rural zoning as in most national schemes). `large` farms may also process produce.
 */
function farmDecisions(large) {
  return spread(X, {
    A: P, A2: SC, B: SC, B2: SC, C: SC, C1: SC, D1: P, D3: SC, F: SC, H: SC, I: SC, J: SC, K: SC, M: large ? SC : X,
    P: P, Q: P, R: SC, S: large ? SC : X, U1: SC, W: SC, X: SC, Z: P, UF: P,
  })
}
const ARCHETYPES = [
  { zone: 'Model A2', reason: 'farm zone (large)', decisions: farmDecisions(true) },
  { zone: 'Large Scale Commercial Farms', reason: 'farm zone (large)', decisions: farmDecisions(true) },
  { zone: 'Model A1', reason: 'farm zone (small)', decisions: farmDecisions(false) },
  { zone: 'Small Scale Commercial Farms', reason: 'farm zone (small)', decisions: farmDecisions(false) },
  {
    zone: 'Residential Agricultural Plots', reason: 'peri-urban residential plot with a dwelling and small-scale farming',
    decisions: spread(X, { A: P, A1: SC, A2: SC, B: SC, B2: SC, C: SC, C1: SC, D1: P, E2: SC, I: SC, J: SC, K: SC, P: P, Q: P, U1: SC, W: SC, Z: P, UF: P }),
  },
  {
    zone: 'Cemetery', reason: 'burial ground: open space with chapel, offices and planting only',
    decisions: spread(X, { I: SC, K: SC, V: SC, U1: SC, W: P, UF: P }),
  },
]

/**
 * Zones that take the EO's closest column as their base (blend of decisions the EO has already made), with the
 * differences listed. Uses the EO has not decided stay undecided.
 */
const DERIVATIONS = [
  { zone: 'Economic Corridor [Mixed Business]', base: 'Local Shopping Centre', reason: 'mixed-business corridor: the local shopping centre column, with warehousing and service industry by consent',
    over: { H: SC, L2: SC, S: SC, U: SC } },
  { zone: 'Densification Zone [LDR]', base: 'Low Density Residential', reason: 'low-density residential being densified: attached, semi-detached and cluster housing permitted',
    over: { A1: P, A2: P } },
  { zone: 'Densification Zone [MDR]', base: 'Medium Density Residential', reason: 'medium-density residential being densified: attached, semi-detached, cluster housing and flats permitted',
    over: { A1: P, A2: P, A3: P } },
  { zone: 'Mixed Density Residential', base: 'Medium Density Residential',
    reason: 'unclear whether this is the EO\'s "Zone 1B(iii) Mixed"; the medium-density column is the middle of the residential range', over: {} },
  { zone: 'Institutional', base: 'Zone 4 Public', reason: 'institutional land: the EO\'s "Zone 4 Public" column', over: {} },
  { zone: 'Railways Common User Facilities', base: COMBINED_ZONE, reason: 'railway common-user facilities: the industrial column (heavy, transport-related uses)', over: {} },
]

/**
 * @param {object[]} eoRowsOut  buildEoRows().rows
 * @returns {object[]} importer rows, authority PROPOSED
 */
function buildProposedRows(eoRowsOut) {
  const byZone = new Map()
  for (const r of eoRowsOut) {
    if (!byZone.has(r.zone)) byZone.set(r.zone, new Map())
    byZone.get(r.zone).set(r.group_code, r.control_type)
  }
  const out = []
  const add = (zone, code, control, why) => out.push({ zone, group_code: code, control_type: control, conditions: '', notes: `PROPOSED (${why})`, authority: PROPOSED_AUTHORITY })

  for (const a of ARCHETYPES) for (const code of ALL_USES) add(a.zone, code, a.decisions[code], `${a.reason}; international practice, not the EO's decision`)
  for (const d of DERIVATIONS) {
    const base = byZone.get(d.base)
    if (!base) throw new Error(`Derivation of "${d.zone}": EO column "${d.base}" not found`)
    for (const [code, control] of base) {
      const over = d.over[code]
      add(d.zone, code, over || control, over && over !== control ? `${d.reason}; differs from EO "${d.base}" for this use` : `${d.reason}; as EO "${d.base}"`)
    }
    for (const [code, control] of Object.entries(d.over)) if (!base.has(code)) add(d.zone, code, control, `${d.reason}; EO has no decision for this use`)
  }
  return out
}

module.exports = {
  EO_AUTHORITY, PROPOSED_AUTHORITY, USE_MAP, EO_ZONE_MAP, COMBINED_ZONE, RENAMED_ZONES, ALL_USES, ARCHETYPES, DERIVATIONS,
  mostRestrictive, buildEoRows, buildProposedRows,
}
