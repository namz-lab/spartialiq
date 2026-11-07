export type ConditionCategory =
  | 'setback' | 'materials' | 'parking' | 'hours' | 'landscaping'
  | 'services' | 'commencement' | 'inspection' | 'custom'

export interface PlanningCondition {
  id: string
  category: ConditionCategory
  text: string
  tests: {
    necessity: boolean; relevance: boolean; enforceability: boolean
    precision: boolean; reasonableness: boolean
  }
}

export interface ConditionTemplate {
  key: ConditionCategory
  label: string
  defaultText: string
}

const TEMPLATES: ConditionTemplate[] = [
  { key: 'setback',      label: 'Building line / setback',
    defaultText: 'A minimum building line of 5 metres shall be maintained from the road reserve and 3 metres from side and rear boundaries.' },
  { key: 'materials',    label: 'Materials',
    defaultText: 'External walls shall be constructed in burnt brick or approved equivalent. Roofing shall be in tiled concrete or galvanised IBR sheeting.' },
  { key: 'parking',      label: 'Parking provision',
    defaultText: 'On-site parking shall be provided at a minimum of 1 bay per 25 square metres of commercial gross floor area.' },
  { key: 'hours',        label: 'Hours of operation',
    defaultText: 'Trading or operating hours shall not exceed 06:00 to 22:00, Monday to Saturday, with no operations on Sunday or public holidays.' },
  { key: 'landscaping',  label: 'Landscaping & screening',
    defaultText: 'A landscaped buffer of not less than 2 metres in width shall be planted and maintained along the road frontage and any boundary adjoining residential land.' },
  { key: 'services',     label: 'Municipal services',
    defaultText: "The development shall be connected to municipal water and sewer reticulation at the developer's cost, to the satisfaction of the Council Engineer." },
  { key: 'commencement', label: 'Time limit for commencement',
    defaultText: 'Substantial commencement of the permitted development shall occur within twelve (12) months from the date of permit issue, failing which the permit shall lapse.' },
  { key: 'inspection',   label: 'Stage inspection',
    defaultText: 'Stage inspections shall be carried out at foundations, damp-proof course, lintel, roof structure, and completion stages, each subject to a 24-hour booking with Council.' },
  { key: 'custom',       label: 'Custom condition', defaultText: '' },
]

function uid(): string {
  return 'cond_' + Math.random().toString(36).slice(2, 10)
}

export function useConditionLibrary() {
  function addFromTemplate(key: ConditionCategory): PlanningCondition {
    const tpl = TEMPLATES.find(t => t.key === key) || TEMPLATES[TEMPLATES.length - 1]
    return {
      id: uid(),
      category: tpl.key,
      text: tpl.defaultText,
      tests: { necessity: false, relevance: false, enforceability: false, precision: false, reasonableness: false },
    }
  }

  function passesAllTests(c: PlanningCondition): boolean {
    const t = c.tests
    return t.necessity && t.relevance && t.enforceability && t.precision && t.reasonableness
  }

  return { templates: TEMPLATES, addFromTemplate, passesAllTests }
}
