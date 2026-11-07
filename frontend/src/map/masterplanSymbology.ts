// src/map/masterplanSymbology.ts
// ─────────────────────────────────────────────────────────────────────────
// Statutory master-plan symbology — the single source of truth for every
// cartographic colour the planning maps use. Colours follow the Zimbabwe
// town-planning map-notation schedule (scheme/master-plan colour standard):
// named colours (e.g. "Yellow 2", "Red Brown 1.2") mapped once to hex, then
// applied per feature class (roads, land use, zones, facilities).
//
// vunguBasemapStyle.ts, planning-layers.ts, MapLegend.vue and the Planning
// Studio all read from this module — map paint, legend chips and export
// styling can never drift apart.
// ─────────────────────────────────────────────────────────────────────────

/** Named colours from the statutory map-notation schedule. */
export const MASTERPLAN_COLORS = {
  'Black':            '#202020',
  'Blue 1':           '#4f83c2', // shops / business
  'Blue 2':           '#1f5fa8', // scheme-area boundary
  'Blue 2.2':         '#8fb4dd', // railways
  'Blue-Grey 1':      '#7b8fa3', // omnibus/coach station edge
  'Blue-Grey 1.2':    '#b9c6d3', // offices, banks
  'Blue-Purple 1':    '#5b4ea0', // special (noxious) industry, mineral edge
  'Blue-Purple 1.2':  '#aca4d6', // warehouses, sand/gravel/stone workings
  'Brown 1':          '#8a5a33', // mission-land edge, residential-buildings hatch
  'Brown 1-2':        '#a5754a', // residential institutional
  'Brown 2.2':        '#c19a6b', // local distributor, high-density edging
  'Dark Brown':       '#59381d', // primary distributor
  'Green 1':          '#7fb26a', // public open space
  'Green 2':          '#3e7d3e', // private open space / national-park edge
  'Green 2.2':        '#a8cc96', // national parks, woodlands & plantations
  'Green-Blue 1.2':   '#9ccfca', // aerodromes, airport protection land
  'Green-Brown 2':    '#979a5f', // agricultural buildings, poultry/gardens
  'Green-Brown 2.1':  '#aeb178', // Zone 11 rural
  'Green-Grey 1':     '#8ba68f', // markets
  'Grey 1':           '#8a8a8a', // cemetery edge
  'Grey 1.2':         '#c6c6c6', // cemeteries, public car parks
  'Orange 1':         '#e0913d', // hotels, permanently restricted land
  'Orange 1.1':       '#edad63', // show grounds
  'Red 1':            '#d93a2b', // proposed new streets & widenings
  'Red 2':            '#c04846', // petrol filling stations, public-buildings edge
  'Red 2.2':          '#e5a49e', // public buildings & places of assembly, Zone 5
  'Red Brown 1':      '#9e4a2a', // district distributor
  'Red Brown 1.2':    '#cf9077', // access roads
  'Red-Purple 1':     '#9d4676', // general industry
  'Red-Purple 1.2':   '#cf9cba', // light / service industry
  'Yellow 2':         '#f1dd7c', // dwelling houses (residential)
  'Yellow 2.2':       '#f7ecb5', // omnibus or coach station
  'Yellow-Brown 3':   '#d9b96b', // cultivated farm land
  'Yellow-Green 1':   '#c3d284', // private open space
  'Yellow-Green 1.2': '#dde6ad', // farm land (pasture)
} as const

export type MasterplanColorName = keyof typeof MASTERPLAN_COLORS

/** Look up a statutory named colour. */
export const mpColor = (name: MasterplanColorName): string => MASTERPLAN_COLORS[name]

/** Unused land is uncoloured — the plain paper base shows through. */
export const UNUSED_LAND = '#efeadf'

// ── Roads (statutory road hierarchy) ───────────────────────────────────────
export interface MasterplanRoadClass {
  key: string
  label: string
  colorName: MasterplanColorName
  color: string
}

export const MASTERPLAN_ROADS: MasterplanRoadClass[] = [
  { key: 'national',             label: 'National road',              colorName: 'Black',         color: mpColor('Black') },
  { key: 'primary_distributor',  label: 'Primary distributor',        colorName: 'Dark Brown',    color: mpColor('Dark Brown') },
  { key: 'district_distributor', label: 'District distributor',       colorName: 'Red Brown 1',   color: mpColor('Red Brown 1') },
  { key: 'local_distributor',    label: 'Local distributor',          colorName: 'Brown 2.2',     color: mpColor('Brown 2.2') },
  { key: 'access',               label: 'Access road',                colorName: 'Red Brown 1.2', color: mpColor('Red Brown 1.2') },
  { key: 'proposed',             label: 'Proposed street / widening', colorName: 'Red 1',         color: mpColor('Red 1') },
]

const roadClass = (key: string): string => MASTERPLAN_ROADS.find(r => r.key === key)!.color

// OSM `fclass` → statutory road class colour (drop-in for the basemap's
// fclass-matched colour expression).
export const OSM_FCLASS_ROAD_COLORS: Record<string, string> = {
  motorway: roadClass('national'), motorway_link: roadClass('national'),
  trunk: roadClass('national'), trunk_link: roadClass('national'),
  primary: roadClass('primary_distributor'), primary_link: roadClass('primary_distributor'),
  secondary: roadClass('district_distributor'), secondary_link: roadClass('district_distributor'),
  tertiary: roadClass('local_distributor'), tertiary_link: roadClass('local_distributor'),
  residential: roadClass('access'), living_street: roadClass('access'),
  unclassified: roadClass('access'), service: roadClass('access'),
  pedestrian: roadClass('access'),
  footway: roadClass('access'), path: roadClass('access'), steps: roadClass('access'),
  bridleway: roadClass('access'), cycleway: roadClass('access'),
  track: roadClass('access'), track_grade1: roadClass('access'),
  track_grade2: roadClass('access'), track_grade3: roadClass('access'),
  track_grade4: roadClass('access'), track_grade5: roadClass('access'),
}
export const OSM_FCLASS_ROAD_FALLBACK = roadClass('access')

/** Statutory road linework is solid colour on paper — casing is a paper halo. */
export const ROAD_CASING_COLOR = '#ffffff'

// ── Land use (statutory land-use categories, keyed by OSM `fclass`) ───────
export const OSM_LANDUSE_COLORS: Record<string, string> = {
  residential:       mpColor('Yellow 2'),         // dwelling houses
  commercial:        mpColor('Blue-Grey 1.2'),    // offices
  retail:            mpColor('Blue 1'),           // shops
  industrial:        mpColor('Red-Purple 1.2'),   // light/service industry
  forest:            mpColor('Green 2.2'),        // woodlands & plantations
  wood:              mpColor('Green 2.2'),
  farmland:          mpColor('Yellow-Brown 3'),   // cultivated farm land
  farmyard:          mpColor('Green-Brown 2'),    // agricultural buildings
  meadow:            mpColor('Yellow-Green 1.2'), // pasture
  grass:             mpColor('Yellow-Green 1.2'),
  park:              mpColor('Green 1'),          // public open space
  recreation_ground: mpColor('Green 1'),
  allotments:        mpColor('Green-Brown 2'),    // market gardens / nurseries
  orchard:           mpColor('Green-Brown 2'),
  vineyard:          mpColor('Green-Brown 2'),
  cemetery:          mpColor('Grey 1.2'),         // cemeteries
  military:          mpColor('Orange 1'),         // permanently restricted
  nature_reserve:    mpColor('Green 2.2'),        // national parks
  scrub:             UNUSED_LAND,                 // unused land — uncoloured
  heath:             UNUSED_LAND,
  quarry:            mpColor('Blue-Purple 1.2'),  // sand/gravel/stone workings
}
export const OSM_LANDUSE_FALLBACK = UNUSED_LAND

// ── Vungu master-plan zoning overlays ──────────────────────────────────────
// Proposed peri-urban zones. Residential densities follow the density scale
// convention on the yellow→brown axis (Zone 1A "appropriate density colour");
// non-residential zones take their scheduled colour directly.
export const MASTERPLAN_PROPOSED_ZONE_COLORS: Record<string, string> = {
  'Low Density Residential':            '#f6ecae',                    // Yellow 2 (light)
  'Medium Density Residential':         mpColor('Yellow 2'),
  'Mixed Density Residential':          '#e6c65f',
  'High Density Residential':           '#d8ab47',                    // edged Brown 2.2
  'Densification Zone [LDR]':           '#efe0b8',
  'Economic Corridor [Mixed Business]': mpColor('Blue 1'),            // Zone 2A business
  'Light Industry':                     mpColor('Red-Purple 1.2'),    // Zone 6
  'Institutional':                      mpColor('Red 2.2'),           // Zone 5 public bldgs
  'Cemetry':                            mpColor('Grey 1.2'),          // cemeteries
  'Residential Agricultural Plots':     mpColor('Yellow-Green 1'),    // Zone 1C
  'Railways Common User Facilities':    mpColor('Blue 2.2'),          // railways
}
export const MASTERPLAN_PROPOSED_ZONE_FALLBACK = UNUSED_LAND

// Beyond peri-urban land tenure — Zone 11 rural family (agricultural scale).
export const MASTERPLAN_SETTLEMENT_COLORS: Record<string, string> = {
  'Communal':          mpColor('Green-Brown 2.1'), // Zone 11 rural
  'FLSCF':             mpColor('Yellow-Brown 3'),  // cultivated farm land
  'FLSCF_A2':          mpColor('Brown 2.2'),
  'FLSCF_SSCF_A1':     mpColor('Green-Brown 2'),
  'Resettlement Area': mpColor('Yellow-Green 1.2'),
  'SSCF':              mpColor('Brown 1-2'),
}
export const MASTERPLAN_SETTLEMENT_FALLBACK = UNUSED_LAND

// ── Planning Studio lot use types → statutory land-use colours ────────────
// Public buildings & places of assembly (school, clinic, worship, community)
// all take Red 2.2 per the schedule — the specific use is denoted by letters.
export const LOT_USE_COLORS: Record<string, string> = {
  single_residential: mpColor('Yellow 2'),         // dwelling houses
  duplex:             '#e6c65f',                   // residential buildings (Yellow 2 + Brown 1 hatch)
  townhouse:          '#d8ab47',
  mixed_use:          '#9fb4d8',                   // Zone 1D residential/business (Blue 1 hatching)
  open_space:         mpColor('Green 1'),          // public open space
  school:             mpColor('Red 2.2'),
  health:             mpColor('Red 2.2'),
  community_centre:   mpColor('Red 2.2'),
  place_of_worship:   mpColor('Red 2.2'),
  commercial:         mpColor('Blue 1'),           // shops
  recreation:         mpColor('Yellow-Green 1'),   // private open space / sports grounds
}
export const LOT_USE_FALLBACK = UNUSED_LAND

// Letter designations for public buildings & utilities (shown in Black).
export const FACILITY_LETTERS: Record<string, string> = {
  school: 'P.S.',
  health: 'C.',
  community_centre: 'L.A.',
  place_of_worship: 'W.',
}

// ── Zoning table (Zones 1A–11) — reference + legend data ──────────────────
export interface MasterplanZone { zone: string; designation: string; color: string; note?: string }

export const MASTERPLAN_ZONES: MasterplanZone[] = [
  { zone: '1A', designation: 'Residential',                    color: mpColor('Yellow 2'),        note: 'Appropriate density colour' },
  { zone: '1B', designation: 'Residential buildings',          color: '#e6c65f',                  note: 'Density colour, Brown 1 hatching' },
  { zone: '1C', designation: 'Residential / agricultural',     color: mpColor('Yellow-Green 1') },
  { zone: '1D', designation: 'Residential / business',         color: '#9fb4d8',                  note: 'Density colour, Blue 1 hatching' },
  { zone: '2A', designation: 'Business (shops)',               color: mpColor('Blue 1') },
  { zone: '2B', designation: 'Business (petrol / service)',    color: mpColor('Blue 1'),          note: 'Red-Purple 1 hatching' },
  { zone: '3',  designation: 'Business (offices)',             color: mpColor('Blue-Grey 1.2') },
  { zone: '4',  designation: 'Wholesale warehouses',           color: mpColor('Blue-Purple 1.2') },
  { zone: '5',  designation: 'Education, rec. & public bldgs', color: mpColor('Red 2.2'),         note: 'Edged and hatched Red 2' },
  { zone: '6',  designation: 'Light industrial',               color: mpColor('Red-Purple 1.2') },
  { zone: '7',  designation: 'Service industrial',             color: mpColor('Red-Purple 1.2'),  note: 'Edged Red-Purple 1' },
  { zone: '8',  designation: 'Industrial',                     color: mpColor('Red-Purple 1') },
  { zone: '9',  designation: 'Special industrial',             color: mpColor('Blue-Purple 1') },
  { zone: '10', designation: 'Surface mineral workings',       color: mpColor('Blue-Purple 1.2'), note: 'Edged Blue-Purple 1' },
  { zone: '11', designation: 'Rural zone',                     color: mpColor('Green-Brown 2.1') },
]

// ── Boundaries ─────────────────────────────────────────────────────────────
export const SCHEME_BOUNDARY_COLOR = mpColor('Blue 2')         // inner edge, Blue 2
export const LOCAL_AUTHORITY_BOUNDARY_COLOR = mpColor('Black') // black dot-and-dash
/** MapLibre dasharray approximating a dot-and-dash line. */
export const DOT_DASH: number[] = [0.8, 1.6, 3.2, 1.6]
