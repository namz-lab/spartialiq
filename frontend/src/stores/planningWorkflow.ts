import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dmApi } from '@/services/developmentManagementService'

/**
 * Cross-window planning workflow store.
 *
 * NOT the official Building Inspector inspection record. Option A:
 * spatial_planning.stage_inspection is authoritative. Do not use this store
 * for inspector results, occupation, or enforcement.
 *
 * Lifecycle:
 *   draft -> pending_env -> env_cleared -> pending_eo -> eo_approved ->
 *   building_permit_issued -> foundation_insp -> superstructure_insp ->
 *   roofing_insp -> final_insp -> occupation_issued
 *
 * Side exits: env_rejected | eo_rejected | stop_work | violation
 */

export type WorkflowType =
  | 'residential_plot'
  | 'business_plot'
  | 'irrigation_scheme'
  | 'sand_permit'
  | 'resettlement'
  | 'grinding_mill'
  | 'borehole'

export type WorkflowRole =
  | 'planner'
  | 'env_officer'
  | 'eo'
  | 'building_inspector'

export type WorkflowStatus =
  | 'draft'
  | 'pending_env'
  | 'env_cleared'
  | 'env_rejected'
  | 'pending_eo'
  | 'eo_approved'
  | 'eo_rejected'
  | 'building_permit_issued'
  | 'foundation_insp'
  | 'superstructure_insp'
  | 'roofing_insp'
  | 'final_insp'
  | 'occupation_issued'
  | 'stop_work'
  | 'violation'

export interface EnvClearance {
  issued: boolean
  conditions: string
  by: string
  date: string
}

export interface EoApproval {
  approved: boolean
  conditions: string
  by: string
  date: string
}

export interface BuildingInspection {
  stage: string
  passed: boolean
  inspector: string
  date: string
  notes: string
}

export interface WorkflowNotification {
  to: WorkflowRole
  message: string
  date: string
  read: boolean
}

export interface WorkflowHistoryEntry {
  action: string
  by: string
  date: string
  note: string
}

export interface WorkflowItem {
  id: string
  type: WorkflowType
  title: string
  ward: string
  applicant: string
  area_sqm: number
  submittedBy: string
  submittedAt: string
  status: WorkflowStatus
  envClearance: EnvClearance | null
  eoApproval: EoApproval | null
  buildingInspections: BuildingInspection[]
  notifications: WorkflowNotification[]
  history: WorkflowHistoryEntry[]
  // Real centroid from permit_application.location (v_application_summary), and
  // the backend permit UUID for real follow-on calls. Null when not geolocated.
  lng?: number | null
  lat?: number | null
  permitId?: string
}

function today(offsetDays = 0): string {
  const d = new Date(2026, 3, 23)
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function nowIso(offsetDays = 0): string {
  const d = new Date(2026, 3, 23)
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString()
}

// (The hardcoded mock SEED dataset was removed — the board now loads real
// applications from the backend via loadFromBackend(). No synthetic data remains.)

export const usePlanningWorkflowStore = defineStore('planningWorkflow', () => {
  // Real data only — no mock seed. loadFromBackend() populates from dmApi.
  // (The old hardcoded SEED is no longer used.)
  const items = ref<WorkflowItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Best-effort, REAL-sourced mappings from the permit_application vocabulary
  // to this window's workflow lifecycle.
  const PERMIT_TO_WF: Record<string, WorkflowStatus> = {
    approved: 'building_permit_issued',
    approved_with_conditions: 'building_permit_issued',
    conditionally_approved: 'building_permit_issued',
    refused: 'eo_rejected', under_review: 'pending_eo', objection_period: 'pending_eo',
    circulation: 'pending_env', consultation: 'pending_env',
  }
  const TYPE_TO_WF: Record<string, WorkflowType> = {
    new_building: 'residential_plot', alteration: 'residential_plot', extension: 'residential_plot',
    subdivision: 'residential_plot', consolidation: 'residential_plot',
    change_of_use: 'business_plot', rezoning: 'business_plot', other: 'residential_plot',
  }

  async function loadFromBackend() {
    loading.value = true; error.value = null
    try {
      const res = await dmApi.listPermits({ limit: 500, offset: 0 })
      items.value = (res.data ?? []).map((p): WorkflowItem => ({
        id: p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase(),
        type: TYPE_TO_WF[p.development_type] ?? 'residential_plot',
        title: p.description || `${p.development_type} — Stand ${p.stand_number ?? '—'}`,
        ward: p.suburb_ward || '',
        applicant: p.applicant_name || '',
        area_sqm: 0,
        submittedBy: p.applicant_name || '',
        submittedAt: p.received_at || p.created_at,
        status: p.has_occupation_certificate
          ? 'occupation_issued'
          : (PERMIT_TO_WF[p.status] ?? 'draft'),
        envClearance: null,
        eoApproval: null,
        buildingInspections: [],
        notifications: [],
        history: [],
        lng: p.lng ?? null,
        lat: p.lat ?? null,
        permitId: p.id,
      }))
    } catch (e: any) {
      error.value = e?.response?.data?.error ?? e?.message ?? 'Failed to load workflow items'
      items.value = []
    } finally {
      loading.value = false
    }
  }

  function find(id: string): WorkflowItem | undefined {
    return items.value.find(i => i.id === id)
  }
  function pushHistory(item: WorkflowItem, action: string, by: string, note = '') {
    item.history.push({ action, by, date: today(), note })
  }
  function notify(item: WorkflowItem, to: WorkflowRole, message: string) {
    item.notifications.push({ to, message, date: today(), read: false })
  }

  function submitForEnvClearance(id: string, by = 'M. Chikowore') {
    const it = find(id); if (!it) return
    it.status = 'pending_env'
    pushHistory(it, 'Submitted for environmental clearance', by)
    notify(it, 'env_officer', `Environmental clearance requested — ${it.title}`)
  }

  function grantEnvClearance(id: string, conditions: string, by = 'T. Muchokwani') {
    const it = find(id); if (!it) return
    it.envClearance = { issued: true, conditions, by, date: today() }
    it.status = 'env_cleared'
    pushHistory(it, 'Environmental clearance granted', by, conditions)
    notify(it, 'planner', `Env. clearance granted — ${it.title}`)
    notify(it, 'eo', `Environmentally cleared — ready for E.O. review — ${it.title}`)
  }

  function rejectEnvClearance(id: string, reason: string, by = 'T. Muchokwani') {
    const it = find(id); if (!it) return
    it.envClearance = { issued: false, conditions: reason, by, date: today() }
    it.status = 'env_rejected'
    pushHistory(it, 'Environmental clearance REJECTED', by, reason)
    notify(it, 'planner', `Env. clearance rejected — ${it.title}: ${reason}`)
  }

  function submitForEoApproval(id: string, by = 'T. Muchokwani') {
    const it = find(id); if (!it) return
    it.status = 'pending_eo'
    pushHistory(it, 'Submitted for E.O. approval', by)
    notify(it, 'eo', `E.O. approval requested — ${it.title}`)
  }

  function approveByEo(id: string, conditions: string, by = 'S. Maramwidze') {
    const it = find(id); if (!it) return
    it.eoApproval = { approved: true, conditions, by, date: today() }
    it.status = 'eo_approved'
    pushHistory(it, 'E.O. approval granted', by, conditions)
    notify(it, 'planner', `E.O. approved — ready for building permit — ${it.title}`)
  }

  function rejectByEo(id: string, reason: string, by = 'S. Maramwidze') {
    const it = find(id); if (!it) return
    it.eoApproval = { approved: false, conditions: reason, by, date: today() }
    it.status = 'eo_rejected'
    pushHistory(it, 'E.O. approval REJECTED', by, reason)
    notify(it, 'planner', `E.O. rejected — ${it.title}: ${reason}`)
    notify(it, 'env_officer', `E.O. rejected — ${it.title}`)
  }

  function issueBuildingPermit(id: string, by = 'M. Chikowore') {
    const it = find(id); if (!it) return
    it.status = 'building_permit_issued'
    pushHistory(it, 'Building permit issued', by)
    notify(it, 'building_inspector', `Permit issued — foundation inspection due — ${it.title}`)
  }

  function nextStageAfter(stage: string): WorkflowStatus {
    switch (stage) {
      case 'foundation':     return 'superstructure_insp'
      case 'superstructure': return 'roofing_insp'
      case 'roofing':        return 'final_insp'
      case 'final':          return 'final_insp'
      default:               return 'foundation_insp'
    }
  }

  function recordInspection(id: string, stage: string, passed: boolean, notes: string, inspector = 'K. Dube') {
    const it = find(id); if (!it) return
    it.buildingInspections.push({ stage, passed, inspector, date: today(), notes })
    pushHistory(it, `${stage} inspection — ${passed ? 'PASSED' : 'FAILED'}`, inspector, notes)
    if (passed) {
      it.status = nextStageAfter(stage)
      notify(it, 'planner', `${stage} inspection passed — ${it.title}`)
    } else {
      notify(it, 'planner', `${stage} inspection FAILED — ${it.title}`)
      notify(it, 'eo', `${stage} inspection FAILED — ${it.title}`)
    }
  }

  function issueOccupationCertificate(id: string, by = 'K. Dube') {
    const it = find(id); if (!it) return
    it.status = 'occupation_issued'
    pushHistory(it, 'Occupation certificate issued', by)
    notify(it, 'planner', `Occupation certificate issued — ${it.title}`)
    notify(it, 'eo', `Occupation certificate issued — ${it.title}`)
  }

  function issueStopWork(id: string, reason: string, by = 'K. Dube') {
    const it = find(id); if (!it) return
    it.status = 'stop_work'
    pushHistory(it, 'Stop-work order issued', by, reason)
    notify(it, 'planner', `STOP-WORK issued — ${it.title}: ${reason}`)
    notify(it, 'eo', `STOP-WORK issued — ${it.title}`)
    notify(it, 'env_officer', `STOP-WORK issued — ${it.title}`)
  }

  function markNotificationRead(itemId: string, to: WorkflowRole) {
    const it = find(itemId); if (!it) return
    it.notifications.forEach(n => { if (n.to === to) n.read = true })
  }

  function addItem(partial: Partial<WorkflowItem> & { title: string; ward: string; type: WorkflowType }) {
    const id = `VRDC-APP-2026-${String(items.value.length + 1).padStart(3, '0')}`
    const it: WorkflowItem = {
      id,
      type: partial.type,
      title: partial.title,
      ward: partial.ward,
      applicant: partial.applicant ?? 'Unknown',
      area_sqm: partial.area_sqm ?? 0,
      submittedBy: partial.submittedBy ?? 'Planning Officer — M. Chikowore',
      submittedAt: nowIso(),
      status: partial.status ?? 'draft',
      envClearance: null,
      eoApproval: null,
      buildingInspections: [],
      notifications: [],
      history: [{ action: 'Registered', by: partial.submittedBy ?? 'M. Chikowore', date: today(), note: '' }],
    }
    items.value.unshift(it)
    return it
  }

  const pendingEnvClearance = computed(() => items.value.filter(i => i.status === 'pending_env'))
  const pendingEoApproval   = computed(() => items.value.filter(i => i.status === 'env_cleared' || i.status === 'pending_eo'))
  const pendingBuildingPermit = computed(() => items.value.filter(i => i.status === 'eo_approved'))
  const pendingBuildingInspection = computed(() =>
    items.value.filter(i =>
      i.status === 'building_permit_issued' ||
      i.status === 'foundation_insp' ||
      i.status === 'superstructure_insp' ||
      i.status === 'roofing_insp' ||
      i.status === 'final_insp',
    ),
  )
  const stopWorkItems = computed(() => items.value.filter(i => i.status === 'stop_work' || i.status === 'violation'))
  const occupationIssued = computed(() => items.value.filter(i => i.status === 'occupation_issued'))

  function unreadCount(role: WorkflowRole): number {
    let n = 0
    for (const it of items.value) {
      for (const note of it.notifications) {
        if (note.to === role && !note.read) n++
      }
    }
    return n
  }

  function inboxFor(role: WorkflowRole): WorkflowItem[] {
    if (role === 'env_officer')        return pendingEnvClearance.value
    if (role === 'eo')                 return pendingEoApproval.value
    if (role === 'building_inspector') return pendingBuildingInspection.value
    return items.value.filter(i =>
      i.status === 'eo_approved' ||
      i.status === 'eo_rejected' ||
      i.status === 'env_rejected' ||
      i.status === 'stop_work',
    )
  }

  return {
    items,
    loading,
    error,
    loadFromBackend,
    submitForEnvClearance,
    grantEnvClearance,
    rejectEnvClearance,
    submitForEoApproval,
    approveByEo,
    rejectByEo,
    issueBuildingPermit,
    recordInspection,
    issueOccupationCertificate,
    issueStopWork,
    markNotificationRead,
    addItem,
    pendingEnvClearance,
    pendingEoApproval,
    pendingBuildingPermit,
    pendingBuildingInspection,
    stopWorkItems,
    occupationIssued,
    unreadCount,
    inboxFor,
  }
})
