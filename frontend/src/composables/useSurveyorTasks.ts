// ─── useSurveyorTasks ────────────────────────────────────────────────
// Real-data layer for the Surveyor Console (/surveyor). Wraps surveyorApi
// (/surveyor/* — backend migration 080) with reactive state plus pure,
// unit-tested derivation helpers. No mock fallbacks.
// ─────────────────────────────────────────────────────────────────────

import { ref, computed, type Ref } from 'vue'
import {
  surveyorApi,
  type SurveyTask, type SurveyTaskDetail, type SurveyTaskStatus,
  type SurveyRecommendation,
} from '@/services/surveyor'

export const TASK_TYPE_LABELS: Record<string, string> = {
  verification: 'Application verification',
  setting_out: 'Stage-1 setting out',
  pegging: 'Pegging',
  layout: 'Layout survey',
  encroachment: 'Encroachment survey',
  beacon_check: 'Beacon check',
  general: 'General survey',
}

export const STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  submitted: 'Submitted',
  accepted: 'Accepted',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

// Open = still needs surveyor action.
const OPEN_STATUSES = new Set<SurveyTaskStatus>(['assigned', 'in_progress', 'returned'])

export function priorityRank(p: string | null | undefined): number {
  switch (p) {
    case 'urgent': return 0
    case 'high':   return 1
    case 'normal': return 2
    default:       return 3
  }
}

// Sort: priority, then nearest due date, then newest.
export function sortTasks(tasks: SurveyTask[]): SurveyTask[] {
  return [...tasks].sort((a, b) => {
    const p = priorityRank(a.priority) - priorityRank(b.priority)
    if (p !== 0) return p
    const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY
    const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export interface SurveyKpis {
  open: number
  inProgress: number
  submitted: number
  urgent: number
  unclaimed: number
}

export function deriveKpis(tasks: SurveyTask[]): SurveyKpis {
  return {
    open: tasks.filter(t => OPEN_STATUSES.has(t.status)).length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    submitted: tasks.filter(t => t.status === 'submitted').length,
    urgent: tasks.filter(t => t.priority === 'urgent' && OPEN_STATUSES.has(t.status)).length,
    unclaimed: tasks.filter(t => t.assigned_to == null && OPEN_STATUSES.has(t.status)).length,
  }
}

export function recommendationLabel(r: SurveyRecommendation | null | undefined): string {
  switch (r) {
    case 'no_objection':       return 'No objection'
    case 'objection':          return 'Objection'
    case 'approve':            return 'Approve'
    case 'approve_conditions': return 'Approve with conditions'
    case 'refuse':             return 'Refuse'
    case 'refer_back':         return 'Refer back'
    default:                   return '—'
  }
}

// ─── Reactive composable ─────────────────────────────────────────────

export function useSurveyorTasks() {
  const tasks = ref<SurveyTask[]>([]) as Ref<SurveyTask[]>
  const loading = ref(false)
  const error = ref<string | null>(null)

  const detail = ref<SurveyTaskDetail | null>(null)
  const detailLoading = ref(false)
  const busy = ref(false)

  async function refresh(params?: { status?: string; ward?: string }) {
    loading.value = true
    error.value = null
    try {
      tasks.value = await surveyorApi.listJobs(params)
    } catch (e: any) {
      error.value = e?.response?.data?.error ?? e?.message ?? 'Failed to load survey tasks'
      tasks.value = []
    } finally {
      loading.value = false
    }
  }

  async function select(id: string) {
    detailLoading.value = true
    error.value = null
    try {
      detail.value = await surveyorApi.getJob(id)
    } catch (e: any) {
      error.value = e?.response?.data?.error ?? e?.message ?? 'Failed to load task'
      detail.value = null
    } finally {
      detailLoading.value = false
    }
  }

  async function reloadDetail() {
    if (detail.value) await select(detail.value.id)
  }

  async function claim(id: string) {
    busy.value = true
    try { await surveyorApi.updateJob(id, { claim: true, status: 'in_progress' }); await refresh(); await reloadDetail() }
    finally { busy.value = false }
  }

  async function setStatus(id: string, status: SurveyTaskStatus) {
    busy.value = true
    try { await surveyorApi.updateJob(id, { status }); await refresh(); await reloadDetail() }
    finally { busy.value = false }
  }

  // Release the task back to the unclaimed pool (clears assigned_to, not just
  // the status — otherwise the task stays owned and never re-enters the queue).
  async function release(id: string) {
    busy.value = true
    try { await surveyorApi.updateJob(id, { status: 'assigned', assigned_to: null }); await refresh(); await reloadDetail() }
    finally { busy.value = false }
  }

  async function submitFinding(id: string, payload: {
    summary: string; recommendation?: SurveyRecommendation; conditions?: string; notes?: string
  }) {
    busy.value = true
    try { await surveyorApi.submitFinding(id, payload); await refresh(); await reloadDetail() }
    finally { busy.value = false }
  }

  async function addCoordinate(id: string, payload: Record<string, unknown>) {
    busy.value = true
    try { await surveyorApi.addCoordinate(id, payload as any); await reloadDetail() }
    finally { busy.value = false }
  }

  async function addBeacon(id: string, payload: Record<string, unknown>) {
    busy.value = true
    try { await surveyorApi.addBeacon(id, payload as any); await reloadDetail() }
    finally { busy.value = false }
  }

  async function addComment(id: string, body: string) {
    busy.value = true
    try { await surveyorApi.addComment(id, { body }); await reloadDetail() }
    finally { busy.value = false }
  }

  const sorted = computed(() => sortTasks(tasks.value))
  const kpis = computed(() => deriveKpis(tasks.value))

  return {
    tasks, sorted, kpis, loading, error,
    detail, detailLoading, busy,
    refresh, select, claim, setStatus, release, submitFinding, addCoordinate, addBeacon, addComment,
  }
}
