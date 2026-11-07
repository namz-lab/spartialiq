// Due-diligence check lists for the Section 26 workflow. Single source of truth
// shared by Step2DueDiligence.vue (the checklist UI) and useStatutorySteps (the
// stepper's progress model). Keep [key, label] tuples — keys are persisted in
// the case's dueDiligence buckets.

export const FILE_CHECKS = [
  ['existing_use_rights',     'Existing use rights of the stand'],
  ['prior_applications',      'Previous applications, permits, refusals'],
  ['active_enforcement',      'Active enforcement / prohibition orders'],
  ['title_deed_restrictions', 'Title-deed restrictions on the property'],
] as const

export const COMPAT_CHECKS = [
  ['zoning',             'Land-use zoning conformity'],
  ['conflict_of_use',    'Conflict of use (e.g. liquor next to school)'],
  ['multiple_stand_use', 'Multiple stand use within same use group'],
  ['layout_conformity',  'Conformity with approved layout (setback, density)'],
  ['traffic',            'Traffic circulation & access'],
  ['coordinated_dev',    'Coordinated development & services sequencing'],
  ['env_sensitivity',    'Environmental sensitivity (wetlands, water courses)'],
  ['public_health_adj',  'Public-health adjacency'],
] as const

export const STATUTE_CHECKS = [
  ['rtcp',         'RTCP Act [Ch. 29:12] — permit requirements (ss. 24, 26, 32, 34, 38)'],
  // Key kept as 'uca' because it is persisted in saved cases; the label was
  // wrong (Vungu is a rural council, governed by the RDC Act, not the UCA).
  ['uca',          'Rural District Councils Act [Ch. 29:13] — council by-laws'],
  ['health',       'Public Health Act [Ch. 15:17] — sanitation & hygiene'],
  ['by_laws',      'Model Building By-Laws (1977) — construction & sewerage'],
  ['factories',    'Factories & Works Act [Ch. 14:08] — factory plans (s. 9(4))'],
  ['liquor',       'Liquor Act [Ch. 14:12] — licensed premises'],
  // Key kept as 'atm' (persisted). The APP Act was repealed by the EMA in 2002.
  ['atm',          'Environmental Management Act [Ch. 20:27] — EIA certificate for prescribed projects'],
  ['mines',        'Mines & Minerals Act [Ch. 21:05] — mining developments'],
  ['constitution', 'Constitution of Zimbabwe — due process / property rights'],
] as const

export const DD_CHECK_TOTAL = FILE_CHECKS.length + COMPAT_CHECKS.length + STATUTE_CHECKS.length
