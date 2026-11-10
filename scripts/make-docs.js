/**
 * Generates two DOCX documents with natural language narrative bodies
 * PLUS appendices containing all ZimGIS schema tables from the PDF.
 *
 * Typography: Times New Roman 12pt, black only, no colour.
 */

const fs   = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, Header, Footer,
  PageNumber, WidthType, ShadingType, PageBreak, convertInchesToTwip,
} = require('docx')

// ── Typography ────────────────────────────────────────────────────────────
const FONT  = 'Times New Roman'
const MONO  = 'Courier New'
const BLACK = '000000'
const BODY  = 24;  const SMALL = 20;  const H1 = 36;  const H2 = 32
const H3    = 28;  const H4    = 26

const r = (text, opts = {}) => new TextRun({
  text,
  font:    opts.mono ? MONO : FONT,
  size:    opts.size || BODY,
  bold:    opts.bold    || false,
  italics: opts.italic  || false,
  color:   BLACK,
})

const p = (children, opts = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [r(children, opts)],
  spacing:  { after: opts.after ?? 160, line: opts.line ?? 276 },
  alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  indent:    opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
})

const h = (text, level) => new Paragraph({
  heading: [,HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,HeadingLevel.HEADING_4][level],
  children: [r(text, { bold: true, size: [,H1,H2,H3,H4][level] })],
  spacing:  { before: level <= 2 ? 360 : 240, after: 120 },
})

const blank = () => new Paragraph({ children: [], spacing: { after: 80 } })

const divider = () => new Paragraph({
  children: [],
  border:   { bottom: { style: BorderStyle.SINGLE, size: 1, color: BLACK } },
  spacing:  { before: 160, after: 160 },
})

// ── Table helpers ─────────────────────────────────────────────────────────
const CB = {
  top:    { style: BorderStyle.SINGLE, size: 1, color: BLACK },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BLACK },
  left:   { style: BorderStyle.SINGLE, size: 1, color: BLACK },
  right:  { style: BorderStyle.SINGLE, size: 1, color: BLACK },
}

function cell(text, header = false, widthPct) {
  return new TableCell({
    children: [new Paragraph({
      children: [r(text || '', { bold: header, size: SMALL + 2 })],
      spacing: { after: 40 },
    })],
    borders: CB,
    shading: header ? { fill: 'EEEEEE', type: ShadingType.CLEAR, color: 'auto' } : {},
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  })
}

function tbl(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(100 / headers.length))
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: headers.map((h, i) => cell(h, true, w[i])),
          tableHeader: true,
        }),
        ...rows.map(row =>
          new TableRow({
            children: row.map((c, i) => cell(c, false, w[i])),
          })
        ),
      ],
    }),
    new Paragraph({ children: [], spacing: { after: 160 } }),
  ]
}

// ── Title page ────────────────────────────────────────────────────────────
function titlePage(title, subtitle) {
  return [
    p('', { after: 1440 }),
    p([r('REPUBLIC OF ZIMBABWE', { bold: true, size: 26 })], { center: true, after: 80 }),
    p([r('Ministry of Local Government and Public Works', { italic: true, size: 22 })], { center: true, after: 320 }),
    p([r(title, { bold: true, size: H1 + 4 })], { center: true, after: 160 }),
    p([r(subtitle, { size: H3 })], { center: true, after: 480 }),
    divider(),
    p([r('SpartialIQ Planning Portal  |  Version 1.0  |  June 2026', { size: 22 })], { center: true, after: 80 }),
    p([r('Spatial Planning Department Edition', { italic: true, size: 20 })], { center: true, after: 80 }),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function buildDoc(title, subtitle, body) {
  return new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1), bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [r('SpartialIQ Planning Portal', { size: 18, italic: true })],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BLACK } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              r('SpartialIQ  |  Page ', { size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }),
              r(' of ', { size: 18 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18 }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children: [...titlePage(title, subtitle), ...body],
    }],
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// ZimGIS TABLES (from the uploaded PDF) — used in both documents as appendix
// ═══════════════════════════════════════════════════════════════════════════

const zimgisLegalFramework = [
  h('Appendix A: Zimbabwe Spatial Planning Legal Framework', 2),
  p('The following tables reproduce the legal and institutional framework from the Zimbabwe National GIS Normalised Database Schema (v3.0, April 2024) published by the GIS & Spatial Planning Unit of the Ministry of Local Government and Public Works. SpartialIQ\'s database is grounded in this same framework.'),
  blank(),
  h('A.1 Primary Legislation', 3),
  ...tbl(
    ['Act / Instrument', 'Chapter', 'Relevance to GIS Schema'],
    [
      ['Regional, Town & Country Planning Act', 'Ch 29:12 (1976, rev. 2016)', 'Master plans, local plans, zoning schemes, development control, subdivision orders, appeals — core of planning_applications, development_orders, zoning_schemes, master_plans tables'],
      ['Urban Councils Act', 'Ch 29:15 (1996)', 'Building permits, by-laws, council infrastructure, urban boundaries — building_permits, urban_boundaries, local_authorities tables'],
      ['Rural District Councils Act', 'Ch 29:13 (1988)', 'RDC jurisdiction, rural planning, communal land — local_authorities (RDC type), land_parcels (communal tenure)'],
      ['Environmental Management Act', 'Ch 20:27 (2002)', 'EIA requirements for developments, catchment councils, wetlands — eia_records, watersheds, protected_areas tables'],
      ['Housing Standards & Control Act', 'Ch 29:08', 'Building standards, demolition orders — buildings, building_permits, condition_ratings tables'],
      ['Land Survey Act', 'Ch 20:12 (1962)', 'Cadastral survey standards, beacon placement, diagram of subdivision — land_parcels, survey_diagrams; coordinates in EPSG:4326 (WGS84) or Arc 1950'],
      ['Communal Land Act', 'Ch 20:04 (1982)', 'Communal land tenure classification — land_tenure_types seed data, land_parcels.tenure_type_id'],
      ['Land Acquisition Act', 'Ch 20:10 (1992)', 'Compulsory acquisition of land — gazette_records, legal_instruments, land_parcels'],
      ['National Parks & Wildlife Act', 'Ch 20:14 (1975)', 'National parks, safari areas, sanctuaries — national_parks, protected_areas tables'],
      ['Forestry Act', 'Ch 19:05 (1954)', 'State forest reserves, timber management — forest_reserves table'],
      ['Water Act', 'Ch 20:24 (1998)', 'Water rights, catchment councils, ZINWA authority — river_basins, watersheds, dams tables'],
      ['Mines & Minerals Act', 'Ch 21:05 (1961)', 'Mining titles, geological data — geological_units, mineral_types tables'],
      ['Zimbabwe National Geospatial & Space Agency Act', 'SI 97/2019', 'ZINGSA mandate — satellite imagery (ZimSat-1/2), CORS network — data_sources table'],
    ],
    [25, 18, 57],
  ),
  h('A.2 Key Institutions', 3),
  ...tbl(
    ['Institution', 'Acronym', 'GIS Role', 'Relevant Tables'],
    [
      ['Department of Physical Planning', 'DPP', 'Technical evaluation of master plans, local plans, layout plans under Ch 29:12', 'master_plans, local_plans, planning_applications'],
      ['Zimbabwe National Geospatial & Space Agency', 'ZINGSA', 'National mapping authority; ZimSat-1 (Nov 2022); CORS network; cadastral mapping', 'data_sources, elevation_points, contour_lines, land_parcels'],
      ['Department of the Surveyor General (Zimap)', 'Zimap', '1:50,000 topo maps (Clarke 1880); 1:25,000 orthophotos; 1:5,000 settlement maps', 'elevation_points, contour_lines, land_parcels, roads'],
      ['Zimbabwe National Water Authority', 'ZINWA', 'River basin management, dam safety register, catchment delineation', 'river_basins, watersheds, rivers, dams, lakes_reservoirs'],
      ['Zimbabwe Electoral Commission', 'ZEC', 'Official ward boundaries (wards2023.shp), polling areas, voter registration', 'wards, polling_areas, polling_stations, voter_registrations'],
      ['Zimbabwe National Statistics Agency', 'ZIMSTAT', '2022 National Population & Housing Census; population by ward', 'censuses, population_statistics'],
      ['Zimbabwe Parks & Wildlife Management Authority', 'ZPWMA', 'Protected area boundaries, wildlife management', 'national_parks, protected_areas, wildlife_species'],
      ['Zimbabwe National Roads Administration', 'ZINARA', 'Road classification A/B/C/D/E, bridge register, road condition', 'roads, bridges, road_classes'],
      ['Ministry of Health & Child Care', 'MoHCC', 'DHIS2 facility register — hospitals, RHCs, clinics', 'health_facilities, health_facility_services'],
      ['Ministry of Primary & Secondary Education', 'MoPSE', 'School census data — primary, secondary, ECD, vocational', 'education_facilities'],
      ['AGRITEX / Dept Agricultural Tech & Extension', 'AGRITEX', 'Soil surveys, agro-ecological zones, land use mapping', 'soil_types, land_uses, agro_ecological_zones'],
    ],
    [25, 12, 35, 28],
  ),
]

const zimgisDataSources = [
  h('Appendix B: Spatial Data Sources by Entity Layer', 2),
  p('Each spatial layer in the national GIS schema has a traceable Zimbabwean source. The data_sources table stores the provenance of every imported dataset.'),
  blank(),
  ...tbl(
    ['Entity / Layer', 'Authoritative Source', 'Format / Scale', 'Custodian', 'Notes'],
    [
      ['wards (1,970 polygons)', 'ZEC wards2023.shp', 'Shapefile / EPSG:4326', 'Zimbabwe Electoral Commission', 'Used as primary input for this schema'],
      ['provinces (10)', 'ZIMSTAT / ZEC administrative boundaries', 'Shapefile / 1:250,000', 'ZIMSTAT / Zimap', 'Gazetted under RTCP Act Ch 29:12'],
      ['districts (64)', 'ZIMSTAT / ZEC administrative boundaries', 'Shapefile / 1:250,000', 'ZIMSTAT / Zimap', '64 rural districts + 3 urban districts'],
      ['local_authorities (92)', 'Zimbabwe Urban Councils Act Register', 'Shapefile', 'Local Government Ministry / Zimap', 'RDCs, Municipalities, Town Councils, City Councils'],
      ['land_parcels (cadastral)', 'Deeds Registry (MLLR) + Surveyor General diagrams', '1:5,000 urban; 1:50,000 rural', 'Zimap / ZINGSA', 'Survey diagrams filed under Land Survey Act Ch 20:12'],
      ['roads', 'ZINARA Road Database + OpenStreetMap', '1:50,000 / GPS surveys', 'ZINARA / ZINGSA', 'A/B/C/D/E classification; 5 road classes in Zimbabwe'],
      ['rivers & basins', 'ZINWA Catchment Database (7 basins)', '1:250,000 / HydroSHEDS', 'ZINWA', 'Zambezi, Limpopo, Save, Runde, Gwayi, Mazowe, Mzingwane'],
      ['dams & reservoirs', 'ZINWA Dam Safety Register', 'Point / GPS', 'ZINWA', 'Includes Kariba, Mutirikwi, Mazvikadei, Siya, etc.'],
      ['topography / contours', 'Zimap 1:50,000 topo series (20 m contours)', '1:50,000 / 20 m interval', 'Zimap', '561 quarter-degree sheets; SRTM 30m supplement'],
      ['geological units', 'Zimbabwe Geological Survey 1:250,000', '1:250,000 polygon', 'ZGS', 'Archean craton dominates; Karoo sedimentaries SE'],
      ['soil types', 'AGRITEX Soil Survey + FAO HWSD v2', '1:250,000 polygon', 'AGRITEX / Dept of Lands', '5 Agro-Ecological Regions used in planning'],
      ['land use', 'MLILR Land Use Map + AGRITEX surveys', '1:50,000 polygon', 'Ministry of Lands (MLILR)', 'Communal, A1, A2, commercial, state land categories'],
      ['land cover', 'ESA WorldCover 10m (2021) + ZimSat-1 (2022)', '10 m raster → polygon', 'ZINGSA / ESA Copernicus', 'ZimSat-1 used for drought monitoring & land cover'],
      ['national parks / PAs', 'ZPWMA Protected Area Boundaries', 'Shapefile', 'ZPWMA', 'Hwange, Gonarezhou, Mana Pools, Matobo, etc.'],
      ['health facilities', 'MoHCC DHIS2 Facility Registry', 'Point (GPS) / spreadsheet', 'Ministry of Health', 'Updated annually; unique MoHCC facility codes'],
      ['education facilities', 'MoPSE Annual School Census', 'Point (GPS) / register', 'Ministry of Primary & Secondary Education', 'Unique MoPSE school codes per institution'],
      ['population statistics', 'ZIMSTAT 2022 National Census', 'Tabular (ward level)', 'ZIMSTAT', 'Released 2023; 15 million total population'],
      ['zoning schemes', 'Local Authority Zoning Maps (DPP approval)', '1:5,000 urban plans', 'Department of Physical Planning + LAs', 'Under RTCP Act s.67–75'],
      ['planning applications', 'Local Authority Planning Register', 'Administrative records', 'Local Authority Planning Dept', 'Statutory under RTCP Act Part V'],
    ],
    [18, 22, 14, 16, 30],
  ),
]

const zimgisTableIndex = [
  h('Appendix C: ZimGIS Complete Table Index (110 Tables, 3NF)', 2),
  p('The following is the complete table index from the Zimbabwe National GIS Normalised Database Schema v3.0. All 110 tables are listed in plural form per 3NF convention. SpartialIQ implements a subset of these tables relevant to the development control workflow, with the spatial layers served directly from the imported GeoPackage.'),
  blank(),
  h('C.1 Lookup Tables (49 tables)', 3),
  ...tbl(
    ['#', 'Table Name', 'Source / Authority'],
    [
      ['1','province_types','RTCP Act / Local Government Ministry'],['2','local_authority_types','Local Government Ministry'],
      ['3','ward_integrity_statuses','ZEC Delimitation Commission'],['4','boundary_change_reasons','ZEC / DPP'],
      ['5','condition_ratings','Engineering standards (ZINARA, ZPWMA)'],['6','road_classes','ZINARA Road Classification System'],
      ['7','road_surface_types','ZINARA'],['8','bridge_types','ZINARA Bridge Register'],
      ['9','stream_orders','ZINWA (Strahler classification)'],['10','water_body_types','ZINWA'],
      ['11','dam_types','ZINWA / ICOLD'],['12','dam_hazard_classes','ZINWA Dam Safety (ICOLD I/II/III)'],
      ['13','land_use_types','MLILR / AGRITEX'],['14','land_tenure_types','Communal Land Act Ch 20:04; Land Acquisition Act Ch 20:10'],
      ['15','land_cover_classes','ESA WorldCover / ZINGSA ZimSat-1'],['16','iucn_categories','IUCN Red List / ZPWMA'],
      ['17','protected_area_types','ZPWMA / National Parks Act Ch 20:14'],['18','forest_types','Forestry Commission / Forestry Act Ch 19:05'],
      ['19','settlement_types','ZIMSTAT Gazetted Places Register'],['20','building_types','Housing Standards Act Ch 29:08 / Urban Councils Act'],
      ['21','roof_materials','Housing Standards Act / Zimap survey'],['22','wall_materials','Housing Standards Act / Zimap survey'],
      ['23','occupancy_statuses','Urban Councils Act / ZIMSTAT Census'],['24','amenity_types','Urban Councils Act / MoHCC / MoPSE'],
      ['25','elevation_point_types','Zimap survey classification'],['26','contour_types','Zimap 1:50,000 specification'],
      ['27','geological_eras','Zimbabwe Geological Survey'],['28','rock_types','Zimbabwe Geological Survey'],
      ['29','soil_texture_classes','AGRITEX / FAO HWSD'],['30','soil_drainage_classes','AGRITEX soil survey standards'],
      ['31','agricultural_suitability_classes','AGRITEX Agro-Ecological Regions I–V'],['32','mineral_types','Zimbabwe Geological Survey / MMCZ'],
      ['33','utility_types','ZESA / ZINWA / TelOne / Econet'],['34','facility_types','MoHCC / MoPSE service classification'],
      ['35','health_service_types','MoHCC DHIS2 service categories'],['36','water_source_types','ZINWA / MoHCC'],
      ['37','organisation_types','Companies Act / Parastatal legislation'],['38','staff_roles','Civil Service Act / Local Government Act'],
      ['39','contact_types','Standard reference'],['40','data_source_types','ZINGSA / ZIMSTAT standards'],
      ['41','audit_action_types','Database standard'],['42','zoning_categories','RTCP Act Ch 29:12 s.67 zoning scheme classifications'],
      ['43','application_types','RTCP Act Ch 29:12 Part V — development types'],['44','plan_statuses','RTCP Act Ch 29:12 — plan lifecycle stages'],
      ['45','permit_statuses','Urban Councils Act Ch 29:15'],['46','eia_statuses','Environmental Management Act Ch 20:27'],
      ['47','condition_types','RTCP Act Ch 29:12 planning conditions typology'],['48','genders','ZIMSTAT 2022 Census classification'],
      ['49','age_groups','ZIMSTAT 2022 Census age bands'],
    ],
    [6, 40, 54],
  ),
  h('C.2 Administrative & Electoral Spatial Tables', 3),
  ...tbl(
    ['#', 'Table Name', 'Geometry', 'Source / Authority'],
    [
      ['50','countries','MULTIPOLYGON','Zimap / ZINGSA national boundary'],
      ['51','provinces','MULTIPOLYGON','ZIMSTAT / ZEC / Zimap 1:250,000'],
      ['52','districts','MULTIPOLYGON','ZIMSTAT / ZEC / Zimap 1:250,000'],
      ['53','local_authorities','MULTIPOLYGON','Ministry of Local Government gazette records'],
      ['54','assemblies','MULTIPOLYGON','ZEC constituency delimitation 2023'],
      ['55','wards','POLYGON','ZEC wards2023.shp — primary source'],
      ['56','urban_boundaries','MULTIPOLYGON','Local authority gazette / DPP'],
      ['57','polling_areas','POINT','ZEC PA_NAME / PA_CODE fields'],
      ['58','polling_stations','POINT','ZEC polling station register'],
      ['59','voter_registrations','None','ZEC REG_VOTERS field + ward register'],
    ],
    [6, 28, 18, 48],
  ),
  h('C.3 Organisation, Demographics & Legal Tables', 3),
  ...tbl(
    ['#', 'Table Name', 'Source / Authority'],
    [
      ['60','organisations','Companies Act / Parastatal Act / NGO register'],
      ['61','contact_details','Organisation / facility registers'],
      ['62','staff_records','Civil Service Commission / LA HR records'],
      ['63','censuses','ZIMSTAT census events'],
      ['64','population_statistics','ZIMSTAT 2022 National Census'],
      ['65','demographic_breakdowns','ZIMSTAT gender × age tables'],
      ['66','gazette_records','Government Gazette (weekly publication)'],
      ['67','legal_instruments','Zimbabwe Law Development Commission'],
    ],
    [6, 35, 59],
  ),
  h('C.4 Planning & Development Control Tables', 3),
  ...tbl(
    ['#', 'Table Name', 'Geometry', 'Source / Authority'],
    [
      ['68','regional_plans','MULTIPOLYGON','DPP Regional Planning Councils (Ch 29:12 Part II)'],
      ['69','master_plans','POLYGON','DPP / Local Authority (Ch 29:12 s.14)'],
      ['70','local_plans','POLYGON','Local Authority (Ch 29:12 s.17)'],
      ['71','layout_plans','POLYGON','Local Authority / Surveyor General (Ch 29:12 Part VI)'],
      ['72','zoning_schemes','None','Local Authority (Ch 29:12 s.67–75)'],
      ['73','zoning_plots','POLYGON','Local Authority zoning map (1:5,000)'],
      ['74','planning_applications','POLYGON','Local Authority Planning Registry (Ch 29:12 Part V)'],
      ['75','development_orders','None','Local Planning Authority decision (Ch 29:12 s.38)'],
      ['76','planning_conditions','None','Attached to development_orders (Ch 29:12)'],
      ['77','appeal_cases','None','Administrative Court (Ch 29:12 Part X)'],
      ['78','building_permits','None','Local Authority (Urban Councils Act Ch 29:15)'],
      ['79','eia_records','None','Environmental Management Agency (Ch 20:27)'],
    ],
    [6, 25, 18, 51],
  ),
  h('C.5 Transport, Hydrology, Land & Conservation Tables', 3),
  ...tbl(
    ['#', 'Table Name', 'Geometry', 'Source / Authority'],
    [
      ['80','roads','LINESTRING','ZINARA Road Database / Zimap / OSM'],
      ['81','bridges','POINT','ZINARA Bridge Register'],
      ['82','river_basins','MULTIPOLYGON','ZINWA (7 major basins)'],
      ['83','watersheds','MULTIPOLYGON','ZINWA catchment delineation'],
      ['84','rivers','MULTILINESTRING','ZINWA / HydroSHEDS v2'],
      ['85','lakes_reservoirs','POLYGON','ZINWA dam register / Zimap'],
      ['86','dams','POINT','ZINWA Dam Safety Register'],
      ['87','land_uses','POLYGON','MLILR / AGRITEX 1:50,000'],
      ['88','land_covers','POLYGON','ESA WorldCover 10m / ZINGSA ZimSat-1'],
      ['89','national_parks','MULTIPOLYGON','ZPWMA (National Parks Act Ch 20:14)'],
      ['90','wildlife_species','None','ZPWMA species register / IUCN'],
      ['91','park_species','None','ZPWMA wildlife surveys'],
      ['92','forest_reserves','MULTIPOLYGON','Forestry Commission (Forestry Act Ch 19:05)'],
      ['93','protected_areas','MULTIPOLYGON','ZPWMA / EMA (EMA Act Ch 20:27)'],
    ],
    [6, 25, 18, 51],
  ),
  h('C.6 Settlement, Cadastral, Infrastructure & Services Tables', 3),
  ...tbl(
    ['#', 'Table Name', 'Geometry', 'Source / Authority'],
    [
      ['94','settlements','POINT','ZIMSTAT gazetted places / Zimap'],
      ['95','land_parcels','POLYGON','Deeds Registry / Zimap (Land Survey Act Ch 20:12)'],
      ['96','buildings','POLYGON','Zimap 1:5,000 / OSM / field survey'],
      ['97','building_amenities','None','ZIMSTAT / MoHCC / MoPSE surveys'],
      ['98','elevation_points','POINT','Zimap trig beacons / SRTM / ZINGSA CORS'],
      ['99','contour_lines','LINESTRING','Zimap 1:50,000 (20 m interval)'],
      ['100','geological_units','MULTIPOLYGON','Zimbabwe Geological Survey 1:250,000'],
      ['101','geological_minerals','None','ZGS / MMCZ mineral deposit database'],
      ['102','soil_types','MULTIPOLYGON','AGRITEX / FAO HWSD v2'],
      ['103','utility_networks','GEOMETRY','ZESA / ZINWA / Telecoms operators'],
      ['104','health_facilities','POINT','MoHCC DHIS2 (unique MoHCC codes)'],
      ['105','health_facility_services','None','MoHCC DHIS2 service inventory'],
      ['106','education_facilities','POINT','MoPSE school census (unique MoPSE codes)'],
      ['107','education_facility_amenities','None','MoPSE / ZIMSTAT survey'],
    ],
    [6, 30, 18, 46],
  ),
  h('C.7 Audit & Data Provenance Tables', 3),
  ...tbl(
    ['#', 'Table Name', 'Geometry', 'Source / Authority'],
    [
      ['108','ward_boundary_audits','POLYGON','ZEC delimitation records'],
      ['109','data_sources','None','ZINGSA / Zimap / ZEC data registry'],
      ['110','table_change_logs','None','PostgreSQL database triggers'],
    ],
    [6, 30, 18, 46],
  ),
]

const zimgisKeyLookups = [
  h('Appendix D: Key ZimGIS Lookup Table Seed Data', 2),
  p('The following lookup tables from the ZimGIS schema are reproduced here with their seed data as defined by Zimbabwe legislation and authoritative standards.'),
  blank(),
  h('D.1 Province Types', 3),
  ...tbl(['Code','Name'],[ ['MET','Metropolitan Province'], ['RUR','Rural Province'] ],[20,80]),
  h('D.2 Local Authority Types', 3),
  p('Authority: Urban Councils Act Ch 29:15 / Rural District Councils Act Ch 29:13'),
  ...tbl(['Code','Name'],[ ['CC','City Council'], ['MUNI','Municipality'], ['TC','Town Council'], ['RDC','Rural District Council'], ['SC','Special Council'] ],[15,85]),
  h('D.3 Ward Integrity Statuses', 3),
  p('Authority: ZEC Delimitation Commission 2022 — wards2023.shp INTEGRITY field'),
  ...tbl(['Code','Name'],[ ['NEW','New ward — created in 2022 ZEC delimitation'], ['MOD','Modified — boundary adjusted in 2022 delimitation'], ['OLD','Unchanged from previous delimitation (pre-2022)'] ],[10,90]),
  h('D.4 Road Classes', 3),
  p('Authority: Zimbabwe National Roads Administration (ZINARA)'),
  ...tbl(['Code','Name'],[ ['A','Primary Road — National Highway (tarmac, inter-city)'], ['B','Secondary Road — Provincial connector (mostly tarmac)'], ['C','Tertiary Road — District connector (may be gravel)'], ['D','Access Road — Community level (gravel / earth)'], ['E','Earth Track — Unclassified, seasonal access'] ],[8,92]),
  h('D.5 Zoning Categories', 3),
  p('Authority: RTCP Act Ch 29:12 s.67–75 zoning scheme regulations'),
  ...tbl(['Code','Name'],[ ['R1','Residential Low Density'], ['R2','Residential Medium Density'], ['R3','Residential High Density'], ['R4','Residential High Density — Flats'], ['C1','Commercial — Retail & Office'], ['C2','Commercial — Service Industry'], ['I1','Industrial — Light Industry'], ['I2','Industrial — Heavy Industry'], ['INST','Institutional (Government, Civic, Religious)'], ['OS','Open Space & Recreation'], ['AGR','Agriculture / Horticulture'], ['CONS','Conservation & Natural Environment'], ['SPZ','Special Purpose Zone'], ['MINE','Mining & Quarrying'] ],[12,88]),
  h('D.6 Application Types', 3),
  p('Authority: RTCP Act Ch 29:12 Part V — Control of Development'),
  ...tbl(['Code','Name'],[ ['NEW_BUILD','New Building / Structure'], ['CHANGE_USE','Change of Use of Land or Building'], ['EXTENSION','Extension / Addition to Existing Building'], ['SUBDIV','Subdivision of Land'], ['CONSOL','Consolidation of Stands'], ['DEMOL','Demolition of Building'], ['ADVERTISE','Advertisement Hoarding'], ['INFORMAL','Formalisation of Informal Structure'], ['MINING','Mining Development'], ['AGRI','Agricultural Development'] ],[15,85]),
  h('D.7 Plan Statuses', 3),
  p('Authority: RTCP Act Ch 29:12 Parts II, IV — plan lifecycle provisions'),
  ...tbl(['Code','Name'],[ ['DRAFT','Draft — under preparation'], ['CONSULT','Public Consultation stage'], ['SUBMITTED','Submitted to Minister / DPP'], ['APPROVED','Approved by Minister'], ['ADOPTED','Adopted by Local Authority'], ['GAZETTED','Gazetted in Government Gazette'], ['UNDER_REVIEW','Under review / revision'], ['SUPERSEDED','Superseded by newer plan'], ['WITHDRAWN','Withdrawn from consideration'] ],[18,82]),
  h('D.8 Land Tenure Types', 3),
  p('Authority: Communal Land Act Ch 20:04; Land Acquisition Act Ch 20:10'),
  ...tbl(['Code','Name'],[ ['COMM','Communal Land (Communal Land Act Ch 20:04)'], ['A1_RESETTL','A1 Resettlement — Village Model Farm'], ['A2_RESETTL','A2 Resettlement — Commercial Farm Model'], ['COMM_FARM','Commercial Farm — freehold'], ['SMALL_FARM','Small-Scale Commercial Farm'], ['URBAN_STAND','Urban Stand / Residential Plot'], ['STATE','State Land (unallocated)'], ['MISSION','Mission / Church Land'], ['MINE_TITLE','Mining Title / Special Grant'] ],[18,82]),
  h('D.9 Dam Hazard Classes', 3),
  p('Authority: ZINWA Dam Safety Programme (ICOLD)'),
  ...tbl(['Code','Name'],[ ['I','High Hazard — failure will certainly cause loss of life downstream'], ['II','Significant Hazard — possible loss of life, major property damage'], ['III','Low Hazard — no probable loss of life, limited property damage'] ],[8,92]),
  h('D.10 Agricultural Suitability Classes', 3),
  p('Authority: AGRITEX Agro-Ecological Regions of Zimbabwe (Vincent & Thomas 1960, updated AGRITEX)'),
  ...tbl(['Code','Name'],[ ['I','Region I — >1,000 mm/yr; Manicaland highlands; specialised/diversified farming'], ['II','Region II — 750–1,000 mm; Mashonaland; intensive crop production'], ['IIa','Region IIa — 700–800 mm; Mashonaland East/West; semi-intensive'], ['III','Region III — 500–750 mm; Midlands; semi-intensive; drought tolerant crops'], ['IV','Region IV — 450–600 mm; Matabeleland; semi-extensive; livestock'], ['V','Region V — <450 mm; Lowveld; extensive livestock; not suitable for rain-fed crops'] ],[8,92]),
]

const zimgisPlanningHierarchy = [
  h('Appendix E: Zimbabwe Planning Department Conceptual Hierarchy', 2),
  p('The Zimbabwe planning department conceptual model follows the administrative hierarchy mandated by the Regional, Town and Country Planning Act [Chapter 29:12]. The central entity is the local_authority (the Local Planning Authority), which exercises development control over its jurisdiction through a zoning scheme.'),
  blank(),
  ...tbl(
    ['Level', 'Entity', 'Legal Basis', 'Role in Planning'],
    [
      ['National','regional_plans','RTCP Act Ch 29:12 Part II','Regional Planning Councils prepare regional plans covering provinces'],
      ['Council','master_plans','RTCP Act Ch 29:12 s.14','Each local authority prepares a Master Plan for its planning area'],
      ['Local Area','local_plans','RTCP Act Ch 29:12 s.17','Detailed land use plans for specific areas within council jurisdiction'],
      ['Parcel','zoning_schemes / zoning_plots','RTCP Act Ch 29:12 s.67–75','Assigns permitted use (zoning category) to every land parcel'],
      ['Application','planning_applications','RTCP Act Ch 29:12 Part V','Any development requires written permission from Local Planning Authority'],
      ['Decision','development_orders','RTCP Act Ch 29:12 s.38','Approval, conditional approval, or refusal of development application'],
      ['Appeal','appeal_cases','RTCP Act Ch 29:12 Part X','Refusals appealed to Administrative Court within 30 days'],
      ['Structure','building_permits','Urban Councils Act Ch 29:15 / Housing Standards Act Ch 29:08','Building plans approved before construction; occupancy certificate on completion'],
      ['Environment','eia_records','Environmental Management Act Ch 20:27','EIA required for developments with significant environmental impact (EMA)'],
    ],
    [12, 22, 22, 44],
  ),
]

const zimgisIndexes = [
  h('Appendix F: Recommended PostGIS / PostgreSQL Indexes', 2),
  p('The following indexes are recommended by the ZimGIS schema specification and should be applied after importing spatial data into the SpartialIQ database.'),
  blank(),
  h('F.1 Spatial GiST Indexes', 3),
  ...tbl(
    ['Table', 'GiST Index SQL'],
    [
      ['wards','CREATE INDEX idx_wards_geom ON wards USING GIST(geom);'],
      ['provinces','CREATE INDEX idx_provinces_geom ON provinces USING GIST(geom);'],
      ['districts','CREATE INDEX idx_districts_geom ON districts USING GIST(geom);'],
      ['local_authorities','CREATE INDEX idx_la_geom ON local_authorities USING GIST(geom);'],
      ['assemblies','CREATE INDEX idx_assemblies_geom ON assemblies USING GIST(geom);'],
      ['roads','CREATE INDEX idx_roads_geom ON roads USING GIST(geom);'],
      ['rivers','CREATE INDEX idx_rivers_geom ON rivers USING GIST(geom);'],
      ['river_basins','CREATE INDEX idx_basins_geom ON river_basins USING GIST(geom);'],
      ['watersheds','CREATE INDEX idx_watersheds_geom ON watersheds USING GIST(geom);'],
      ['lakes_reservoirs','CREATE INDEX idx_lakes_geom ON lakes_reservoirs USING GIST(geom);'],
      ['national_parks','CREATE INDEX idx_parks_geom ON national_parks USING GIST(geom);'],
      ['forest_reserves','CREATE INDEX idx_forests_geom ON forest_reserves USING GIST(geom);'],
      ['land_uses','CREATE INDEX idx_lu_geom ON land_uses USING GIST(geom);'],
      ['land_parcels','CREATE INDEX idx_parcels_geom ON land_parcels USING GIST(geom);'],
      ['zoning_plots','CREATE INDEX idx_zplots_geom ON zoning_plots USING GIST(geom);'],
      ['planning_applications','CREATE INDEX idx_apps_geom ON planning_applications USING GIST(geom);'],
      ['buildings','CREATE INDEX idx_bldg_geom ON buildings USING GIST(geom);'],
      ['health_facilities','CREATE INDEX idx_hf_geom ON health_facilities USING GIST(geom);'],
      ['education_facilities','CREATE INDEX idx_ef_geom ON education_facilities USING GIST(geom);'],
      ['soil_types','CREATE INDEX idx_soil_geom ON soil_types USING GIST(geom);'],
      ['geological_units','CREATE INDEX idx_geo_geom ON geological_units USING GIST(geom);'],
    ],
    [25, 75],
  ),
  h('F.2 B-Tree Attribute Indexes', 3),
  ...tbl(
    ['Index', 'Purpose'],
    [
      ["CREATE UNIQUE INDEX ON wards(ward_full_code)",'Quick lookup by ZEC composite ward code'],
      ["CREATE INDEX ON wards(district_id, ward_number)",'Ward lookup within district'],
      ["CREATE INDEX ON polling_areas(pa_code)",'ZEC polling area code lookup'],
      ["CREATE INDEX ON land_parcels(parcel_ref)",'Cadastral parcel reference lookup'],
      ["CREATE INDEX ON land_parcels(stand_number)",'Stand number search'],
      ["CREATE INDEX ON planning_applications(application_ref)",'Application reference lookup'],
      ["CREATE INDEX ON development_orders(order_ref)",'Order reference lookup'],
      ["CREATE INDEX ON building_permits(permit_ref)",'Permit reference lookup'],
      ["CREATE INDEX ON roads(road_number)",'Route number filter (A1, B101)'],
      ["CREATE INDEX ON health_facilities(facility_code)",'MoHCC DHIS2 code lookup'],
      ["CREATE INDEX ON education_facilities(school_code)",'MoPSE code lookup'],
      ["CREATE INDEX ON zoning_plots(scheme_id, zoning_category_id)",'Zoning query by scheme + category'],
      ["CREATE INDEX ON voter_registrations(ward_id, election_id)",'Voter stats per ward per election'],
      ["CREATE INDEX ON population_statistics(entity_type, entity_id)",'Population for any admin unit'],
    ],
    [52, 48],
  ),
]

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT 1 — SCHEMA (narrative + ZimGIS appendices)
// ═══════════════════════════════════════════════════════════════════════════

const schemaBody = [
  h('Introduction', 1),
  p('The SpartialIQ planning portal stores all of its data in a PostgreSQL database running the PostGIS spatial extension. Every table in that database exists because a real planning task required it. This document explains each part of the database in plain language, starting with the people who use the system and working through the entire lifecycle of a development application, from the moment a citizen submits a request to the day they receive a certificate of occupation.'),
  p('The database follows third normal form throughout. In practical terms this means that every piece of information is stored in exactly one place, and every table is focused on one thing. When you read about a payment, for example, the payment record holds only payment information. The citizen\'s name and address are not repeated inside the payment record. Instead, a link connects the payment back to the user record, where that information already lives. This prevents contradictions, reduces storage waste, and makes the system easier to maintain.'),
  blank(),

  h('The People: Users, Roles, and Sessions', 2),
  p('Everything in SpartialIQ begins with the people who use it. The users table holds one record for every person who has an account, whether they are a citizen applying for planning permission or a town planner reviewing applications. Each user has an email address that must be unique across the entire system, a password stored in bcrypt-hashed form so that even a database administrator cannot read it, and a role that determines what parts of the system they can access.'),
  p('There are eleven roles in the system. At one end of the scale, an unregistered public visitor can browse the map but cannot submit anything. A registered citizen can apply for planning permission, track their application, pay fees, and upload documents. Moving into the council staff side, a planning clerk handles intake and receipting. A town planning officer reviews applications and writes recommendations. The executive officer makes final decisions. The environmental health officer handles environmental reviews. The building inspector conducts site inspections. The surveyor handles survey-related reviews. The GIS officer manages the spatial data layers. The IT administrator manages the system itself but cannot access planning records. This role structure mirrors exactly how Zimbabwe councils are organised under the Urban Councils Act and Rural District Councils Act.'),
  p('When a citizen or staff member first joins the system, the process differs by role. Citizens register themselves through the public registration form. Staff members receive an invitation from an administrator. The invites table stores these invitations with a unique token, a target email address, a pre-assigned role, and a seven-day expiry window. When the staff member clicks their invite link and sets a password, the invite is marked as used and their user account is created.'),
  p('When anyone logs in, they receive two tokens. The access token is a short-lived JSON Web Token valid for twelve hours. The refresh token is stored in the user_sessions table, hashed for security, and lasts fourteen days. When the access token expires, the client presents the refresh token to receive a new one without forcing the user to log in again.'),
  blank(),

  h('Knowing Your Applicant: Identity Verification and Documents', 2),
  p('Before a citizen can progress an application to certain stages, the council needs to know who they are. The kyc_verifications table holds one record per citizen, containing their identity document type, document number, and full name as it appears on that document. A council administrator reviews this submission and either approves or rejects it. Once approved, the citizen is considered a verified applicant for the purposes of the planning process.'),
  p('The citizen_documents table holds the actual uploaded files: a national identity card, a passport, a driver\'s licence, proof of residence, a title deed, a company registration certificate, a tax clearance certificate, or other supporting documents. Each uploaded file is stored on the server\'s filesystem, and the database record points to its location. The record also holds the file\'s SHA-256 fingerprint, which prevents the same file from being uploaded twice. The system can optionally extract information from the document automatically, and a staff member can manually verify or reject the document.'),
  blank(),

  h('The Heart of the System: Development Applications', 2),
  p('A development application is what happens when a citizen wants to build something, change a land use, subdivide a stand, or carry out any other form of development that requires council permission under the Regional, Town and Country Planning Act. The development_applications table is the central table of the entire system. Almost everything else connects to it.'),
  p('Each application gets a unique reference number in the format DEV-NNNNNN. The record holds who submitted it, all the information from the application form, the eligibility analysis that the system ran against the zoning scheme, the fee schedule, the current status, and the date it was submitted.'),
  p('Every change to an application generates records in two related tables. The application_status_history table records every status transition: who changed it, what the old status was, what the new status is, and why. This is the complete audit trail that the RTCP Act requires. The application_timeline table records a broader set of events in human-readable form.'),
  p('The application moves through a defined sequence of statuses: submitted, under_review, env_review, survey_review, pending_decision, approved, building_permit_issued, and then through nine inspection stages until occupation_issued.'),
  blank(),

  h('The Statutory Record: Permit Applications and Consultations', 2),
  p('When a planning clerk receives a citizen application, they create a parallel statutory record in the spatial_planning schema. This is the permit_application table, representing the council\'s official development register entry under the RTCP Act. It carries a formal TPD reference number, holds the stand number and physical address, and tracks the decision with the name of the deciding officer and the date.'),
  p('The statutory process requires the council to consult certain bodies before making a decision. Each consultation is recorded in the application_consultation table, which tracks which body was contacted, when they were given to respond, and what they said. Members of the public can also object. Each objection is recorded in the application_objection table. The planner must consider every objection and record whether it was sustained or overruled.'),
  blank(),

  h('Building Inspections: Nine Stages from Foundation to Occupation', 2),
  p('Once a development order has been issued and building plans approved, construction can begin under inspection oversight. The Development Management Handbook requires building inspectors to visit the site at nine defined stages: setting out, foundation trenches, foundation brickwork to floor level, brickwork to window level, brickwork to wall plate, roof trusses, drainage and sewerage, the final inspection, and the certificate of occupation.'),
  p('Each stage is tracked in the inspection_bookings table. A booking begins in a pending_payment state because an inspection fee must be paid first. Once the fee is confirmed, the booking moves to waitlisted, then scheduled when an inspector sets a date, then to passed or failed when the inspector completes it. Every state change is permanently recorded in the inspection_status_events table. Photographs uploaded as evidence are stored in the inspection_photos table, which captures the storage location, file fingerprint, caption, and GPS coordinates from the photo\'s EXIF data.'),
  blank(),

  h('Building Plan Review', 2),
  p('Before construction begins, the citizen submits building plans for review. The server runs an automatic compliance check and produces findings stored in the plan_review_findings table at three severity levels: informational, warning, or error. Each finding carries a stable code, the finding text, a reference to the relevant standard section, and a bounding box showing where in the document the issue was found. A staff member then issues a final decision, either approving the plans or returning them for correction.'),
  blank(),

  h('Payments: Fees in Zimbabwe Dollars and US Dollars', 2),
  p('The payments table records every fee transaction. It holds the purpose of the payment, the amount in both US dollars and Zimbabwe Gold, the exchange rate that was used to calculate the conversion, and a reference to the exchange rate record that proves where that rate came from. Exchange rates come from the exchange_rates table, populated from the Reserve Bank of Zimbabwe\'s official interbank rate. The system supports five payment methods: manual (for development), Paynow, EcoCash, OneMoney, and Stripe.'),
  p('When a provider confirms a payment, it sends an automated notification. The raw webhook data is stored in the payment_webhooks table. The payment record is updated to paid status, a receipt number is issued, and follow-on effects are triggered — for inspection fee payments, the connected inspection booking automatically advances to the waitlist. Every change to a payment\'s status is also recorded in the payment_audit table.'),
  blank(),

  h('Notifications, Security, and the Spatial Map', 2),
  p('All email and SMS notifications flow through the notifications_outbox table using the outbox pattern: records are inserted when an event occurs, and a separate worker delivers them asynchronously, ensuring no notifications are lost. Cross-department staff notifications flow through the workflow_notifications table and appear as a badge in each staff member\'s portal.'),
  p('Every authenticated data-changing action is recorded in the security_audit_log table, capturing the user, role, IP address, endpoint, and response code. The map is powered by twenty-four spatial data layers imported from the zimbabwe.gpkg GeoPackage, served as binary MapBox Vector Tiles via PostGIS\'s ST_AsMVT function, and rendered in the browser by MapLibre GL.'),
  blank(),

  divider(),
  ...zimgisLegalFramework,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisDataSources,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisTableIndex,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisKeyLookups,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisPlanningHierarchy,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisIndexes,
]

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT 2 — INTEGRATION REPORT (narrative + ZimGIS appendices)
// ═══════════════════════════════════════════════════════════════════════════

const reportBody = [
  h('Introduction', 1),
  p('SpartialIQ is a multi-council digital planning portal for Zimbabwe that replaces paper-based development control with a connected digital workflow. A citizen can submit a development application, pay fees, upload building plans, book and track site inspections, receive notifications at every stage, and ultimately obtain a certificate of occupation, all through a single web application. This document explains in plain language how the different parts of the system are built and how they talk to each other.'),
  blank(),

  h('The Three Tiers', 2),
  p('SpartialIQ is built in three tiers. The first tier runs inside the user\'s web browser: a Vue 3 application that draws the interface, handles navigation, manages the user\'s session, and communicates with the server. The second tier is the application server, a Node.js process using the Fastify framework, which receives requests from the browser, applies business rules, reads and writes the database, and sends back responses. The third tier is the database, a PostgreSQL server with the PostGIS spatial extension.'),
  p('In development the browser runs on port 5174 and the server on port 3000. The browser\'s build tool forwards all requests beginning with /api/ to port 3000. In production, a web server such as NGINX sits in front of both, serves the built browser application as static files, and proxies API requests to the Node.js process.'),
  blank(),

  h('How the Map Works: The Vector Tile Pipeline', 2),
  p('The map is the most technically distinctive part of SpartialIQ. It shows twenty-four spatial data layers covering administrative boundaries, roads, land use, hydrology, buildings, and points of interest across Zimbabwe, served using MapBox Vector Tiles, the standard format for modern interactive web maps.'),
  p('The reason MVT is used rather than the more familiar GeoJSON format is performance. A GeoJSON file containing all of Zimbabwe\'s roads or buildings would be enormous and would overwhelm the browser. MVT divides the world into a grid of tiles at each zoom level. The map requests only the tiles covering the current viewport at the current zoom. A user viewing the whole country needs far less data than one who has zoomed into a suburb.'),
  p('Tiles are generated on demand by the PostGIS database. When the browser requests a tile, the server executes a SQL query using PostGIS\'s ST_AsMVT function. This function clips the relevant geographic features to the tile boundary, simplifies them to an appropriate level of detail, packages them in compact binary Protocol Buffer format, and returns the result. The server compresses this with gzip and sends it to the browser. MapLibre GL on the browser decodes the binary tile on the GPU and draws it to a WebGL canvas, achieving smooth rendering even with hundreds of thousands of features.'),
  p('The server maintains a memory cache of up to four thousand recently served tiles, with tiles expiring after twenty-four hours. Below zoom level twelve, the roads layer shows only national highways, trunk roads, primary roads, and secondary roads, reducing tile payload by approximately ninety percent at country-level zoom.'),
  blank(),

  h('How the Map Appears in the Browser', 2),
  p('On the browser side, a module called vunguBasemap.ts initialises the map by asking the server for the catalogue of available layers, then registering a tile source and visual layer for each one. The style module vunguBasemapStyle.ts is the single source of truth for how every feature looks on the map. The same colour values drive both the map layer colours and the filter chip swatches in the interface, ensuring the map and the UI are always in sync.'),
  p('When a user clicks on a map feature, the browser calls a separate server endpoint that returns that single feature as a GeoJSON object with all its attributes. This is displayed as a popup overlay. The popup approach avoids embedding attribute data inside tiles, which would increase tile sizes, and instead fetches attribute data on demand only when the user wants to see it.'),
  blank(),

  h('How Users Are Authenticated', 2),
  p('Citizens register themselves through a public form. Staff members receive an invitation from an administrator containing a unique one-time token. When the staff member follows the link and sets a password, their account is created with the pre-assigned role. When anyone logs in, the server issues two tokens: a twelve-hour access token included with every subsequent request, and a fourteen-day refresh token that can be exchanged for a new access token when the first expires.'),
  p('Every route checks the access token before doing anything. Routes requiring specific roles also check that the user\'s role permits the action. In the browser, the router directs each user to their role-specific portal on login. Before accessing any part of the system, every user must select which of Zimbabwe\'s ten councils they are working with. This selection is stored locally and controls which council\'s data is displayed throughout the session.'),
  blank(),

  h('How an Application Moves Through the System', 2),
  p('A citizen selects their land parcel on the map, fills in the application form, and submits. The server creates a development application record and immediately sends the citizen a confirmation email with their reference number. The application appears in the planning clerk\'s queue, who receipts it, changes the status to under review, and creates a statutory permit record with a formal TPD reference number.'),
  p('The planner circulates the application to statutory bodies for consultation, each tracked with its deadline and response. After the objection period and consultations, the planner prepares a recommendation and the executive officer makes the final decision. An approval generates a development order, the application status moves to approved, and the citizen is notified.'),
  p('The citizen uploads building plans, which the server checks automatically for compliance. A staff member reviews the findings and either approves or returns them. Construction then proceeds stage by stage, with the citizen paying an inspection fee for each stage, an inspector scheduling and visiting the site, recording the result, and uploading photographs, until the final inspection passes and the certificate of occupation is issued.'),
  blank(),

  h('How Payments Work Across Two Currencies', 2),
  p('Every payment is expressed in both US dollars and Zimbabwe Gold. When a citizen initiates a payment, the server fetches the current exchange rate from the Reserve Bank of Zimbabwe\'s official interbank rate register and locks it permanently against the payment record. The system supports Paynow (covering EcoCash, OneMoney, Visa, Mastercard, ZimSwitch), direct EcoCash and OneMoney via USSD, and Stripe for international card payments.'),
  p('When a provider confirms a payment, it sends a cryptographically signed notification to the server. The server verifies the signature, marks the payment as paid, issues a receipt number, and triggers follow-on effects — for inspection fees, the inspection booking automatically advances to the waitlist and the citizen receives a confirmation email.'),
  blank(),

  h('How Notifications Reach Citizens and Staff', 2),
  p('All email and SMS notifications go through an outbox table. When an event occurs, a record is inserted with the message content and intended recipient. A separate worker process reads undelivered messages and sends them through the configured gateway, retrying on failure. This ensures no notification is lost even during temporary gateway failures. Internal staff notifications appear as a badge in each staff member\'s portal header, driven by a separate workflow notifications table that can target a specific role, a specific user, or all staff.'),
  blank(),

  h('The Middleware That Protects Every Request', 2),
  p('Every request passes through a security header middleware that sets frame-busting, MIME-sniffing prevention, and content security policy instructions. A CORS middleware checks that requests come from permitted origins. A rate limiter allows one hundred requests per minute generally and ten per minute on authentication endpoints, making automated password guessing impractical. An HTTP caching layer reduces database load for repeated read requests. After every response, an audit logging middleware records the transaction permanently to the security_audit_log table, capturing the user, role, IP address, endpoint, and response code for compliance traceability.'),
  blank(),

  h('Where Files Are Stored', 2),
  p('Three categories of files are stored on the server\'s filesystem. Citizen documents such as identity cards and title deeds are stored per citizen with a maximum of twelve megabytes per file. Building plans in PDF, DWG, or DXF format are stored per application with a maximum of sixty megabytes. Inspection photographs are stored per booking with a maximum of ten megabytes. Every upload is fingerprinted with SHA-256, and duplicate files are rejected automatically.'),
  blank(),

  h('Conclusion', 2),
  p('SpartialIQ integrates an interactive mapping system, a structured planning workflow, a dual-currency payment system, a document management system, and a real-time notification service into a single coherent platform. The PostGIS vector tile pipeline delivers smooth map rendering at national scale. JWT authentication and role-based access control enforce Zimbabwe council organisational hierarchy. The outbox notification pattern ensures reliable citizen communication. Comprehensive audit logging meets RTCP Act traceability requirements. Every part of the system was designed around the actual work that council staff and citizens need to do, grounded in the legal framework that governs development control in Zimbabwe.'),
  blank(),

  divider(),
  ...zimgisLegalFramework,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisDataSources,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisTableIndex,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisKeyLookups,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisPlanningHierarchy,
  new Paragraph({ children: [new PageBreak()] }),
  ...zimgisIndexes,
]

// ── Write files ───────────────────────────────────────────────────────────
async function main() {
  const docsDir = path.join(__dirname, '..', 'docs')

  console.log('Building SCHEMA.docx ...')
  const sb = await Packer.toBuffer(buildDoc(
    'Database Schema — How the Data Is Organised',
    'A plain-language explanation with complete ZimGIS reference tables',
    schemaBody,
  ))
  fs.writeFileSync(path.join(docsDir, 'SCHEMA.docx'), sb)
  console.log('  → docs/SCHEMA.docx  (' + Math.round(sb.length / 1024) + ' KB)')

  console.log('Building INTEGRATION_REPORT.docx ...')
  const rb = await Packer.toBuffer(buildDoc(
    'System Integration Report',
    'How every part of the system connects, with complete ZimGIS reference tables',
    reportBody,
  ))
  fs.writeFileSync(path.join(docsDir, 'INTEGRATION_REPORT.docx'), rb)
  console.log('  → docs/INTEGRATION_REPORT.docx  (' + Math.round(rb.length / 1024) + ' KB)')

  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
