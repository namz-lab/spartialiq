export type Application360Tab =
  | 'overview' | 'gis' | 'assessment' | 'documents' | 'clock'
  | 'referrals' | 'objections' | 'inspections' | 'history'
  | 'committee' | 'decision' | 'conditions' | 'appeals' | 'enforcement' | 'audit'

export const APPLICATION_360_TABS: readonly Application360Tab[] = [
  'overview', 'gis', 'assessment', 'documents', 'clock',
  'referrals', 'objections', 'inspections', 'history',
  'committee', 'decision', 'conditions', 'appeals', 'enforcement', 'audit',
]

export const TAB_LABEL: Record<Application360Tab, string> = {
  overview: 'Overview',
  gis: 'GIS',
  assessment: 'Planning assessment',
  documents: 'Documents',
  clock: 'Statutory clock',
  referrals: 'Referrals',
  objections: 'Objections',
  inspections: 'Site inspections',
  history: 'Planning history',
  committee: 'Committee',
  decision: 'Decision',
  conditions: 'Conditions',
  appeals: 'Appeals',
  enforcement: 'Enforcement',
  audit: 'Audit',
}

export function isApplication360Tab(value: string): value is Application360Tab {
  return (APPLICATION_360_TABS as readonly string[]).includes(value)
}

export function tabForStep(step: 1 | 2 | 3 | 4 | 5): Application360Tab {
  switch (step) {
    case 1: return 'overview'
    case 2: return 'assessment'
    case 3: return 'committee'
    case 4: return 'decision'
    case 5: return 'objections'
  }
}
