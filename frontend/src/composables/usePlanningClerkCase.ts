// ─── usePlanningClerkCase ───────────────────────────────────────────
// Active Planning Clerk workspace state shared across the Planning
// Clerk Portal sections. Server is SSOT (planning_clerk.* / migration 124);
// localStorage is no longer used.

import {
  ref, computed, provide, inject, onScopeDispose, getCurrentScope,
  type ComputedRef, type InjectionKey, type Ref,
} from 'vue'
import { planningClerkApi } from '@/services/planningClerkApi'

// ── Correspondence log ──────────────────────────────────────────
export type CorrespondenceDirection = 'in' | 'out'
export interface CorrespondenceEntry {
  id: string
  direction: CorrespondenceDirection
  date: string
  permit_application_id: string | null
  ref_no: string
  party: string
  subject: string
  channel: 'letter' | 'email' | 'phone' | 'in_person' | 'fax'
  attached_doc_ref: string
  notes: string
}

// ── Fee receipts register ───────────────────────────────────────
export type FeeKind =
  | 'application' | 'public_notice' | 'plan_scrutiny'
  | 'inspection' | 'occupation' | 'appeal' | 'other'

export interface FeeReceipt {
  id: string
  receipt_no: string
  fee_kind: FeeKind
  permit_application_id: string | null
  payer_name: string
  amount_zwl: number
  paid_at: string
  payment_method: 'cash' | 'ecocash' | 'eft' | 'cheque' | 'card'
  reference: string
  issued_by: string
  notes: string
}

// ── Acknowledgement letters (5-day rule) ────────────────────────
export interface AcknowledgementLetter {
  id: string
  letter_no: string
  permit_application_id: string
  application_register_no: string
  application_received_at: string
  due_by: string
  sent_at: string | null
  recipient: string
  notes: string
}

// ── Permit dispatch register ────────────────────────────────────
export interface PermitDispatch {
  id: string
  permit_application_id: string
  dispatched_at: string
  dispatched_by: string
  delivery_method: 'collected' | 'registered_post' | 'courier' | 'email'
  recipient: string
  proof_of_delivery_ref: string
  notes: string
}

// ── Refusal letters (7-day rule after Council resolution) ──────
export interface RefusalLetter {
  id: string
  letter_no: string
  permit_application_id: string
  council_resolution_date: string
  due_by: string
  sent_at: string | null
  recipient: string
  reasons: string
  notes: string
}

// ── Notice certificate register ─────────────────────────────────
export interface NoticeCertificate {
  id: string
  permit_application_id: string
  newspaper_name: string
  advert_date: string
  certificate_received_at: string
  filed_under_ref: string
  notes: string
}

// ── Abutter notification log ────────────────────────────────────
export interface AbutterNotificationLog {
  id: string
  permit_application_id: string
  abutter_name: string
  abutter_address: string
  notified_at: string
  method: 'registered_post' | 'courier' | 'hand_delivered'
  receipt_ref: string
  notes: string
}

// ── Context ─────────────────────────────────────────────────────
export interface PlanningClerkCaseContext {
  correspondence: Ref<CorrespondenceEntry[]>
  receipts:       Ref<FeeReceipt[]>
  acknowledgements: Ref<AcknowledgementLetter[]>
  dispatches:     Ref<PermitDispatch[]>
  refusals:       Ref<RefusalLetter[]>
  noticeCertificates: Ref<NoticeCertificate[]>
  abutterLog:     Ref<AbutterNotificationLog[]>

  ackOverdue:      ComputedRef<AcknowledgementLetter[]>
  refusalsDue:     ComputedRef<RefusalLetter[]>
  feeTotalsByKind: ComputedRef<Record<FeeKind, number>>

  /** Null when healthy; set when the initial load (or a write) fails. */
  error: Ref<string | null>
  loading: Ref<boolean>
  refresh: () => Promise<void>

  addCorrespondence:  (e: Omit<CorrespondenceEntry, 'id'>) => CorrespondenceEntry
  addReceipt:         (r: Omit<FeeReceipt, 'id'>) => FeeReceipt
  addAcknowledgement: (a: Omit<AcknowledgementLetter, 'id'>) => AcknowledgementLetter
  markAcknowledgementSent: (id: string) => void
  addDispatch:        (d: Omit<PermitDispatch, 'id'>) => PermitDispatch
  addRefusal:         (r: Omit<RefusalLetter, 'id'>) => RefusalLetter
  markRefusalSent:    (id: string) => void
  addNoticeCertificate: (n: Omit<NoticeCertificate, 'id'>) => NoticeCertificate
  addAbutterLog:      (a: Omit<AbutterNotificationLog, 'id'>) => AbutterNotificationLog
}

const CLERK_KEY: InjectionKey<PlanningClerkCaseContext> = Symbol('PlanningClerkCase')

function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { message?: string; error?: string } } }).response
    const msg = r?.data?.message || r?.data?.error
    if (msg) return String(msg)
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// 5 working days for acknowledgements; calendar approximation
export function plusWorkingDays(iso: string, n: number): string {
  const d = new Date(iso)
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) added++
  }
  return d.toISOString()
}

export function plusCalendarDays(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

export function providePlanningClerkCase(): PlanningClerkCaseContext {
  const correspondence = ref<CorrespondenceEntry[]>([])
  const receipts = ref<FeeReceipt[]>([])
  const acknowledgements = ref<AcknowledgementLetter[]>([])
  const dispatches = ref<PermitDispatch[]>([])
  const refusals = ref<RefusalLetter[]>([])
  const noticeCertificates = ref<NoticeCertificate[]>([])
  const abutterLog = ref<AbutterNotificationLog[]>([])
  const error = ref<string | null>(null)
  const loading = ref(true)

  const ackOverdue = computed(() => acknowledgements.value.filter(a =>
    !a.sent_at && new Date(a.due_by).getTime() < Date.now()))

  const refusalsDue = computed(() => refusals.value.filter(r =>
    !r.sent_at && new Date(r.due_by).getTime() < Date.now()))

  const feeTotalsByKind = computed<Record<FeeKind, number>>(() => {
    const acc: Record<FeeKind, number> = {
      application:0, public_notice:0, plan_scrutiny:0, inspection:0,
      occupation:0, appeal:0, other:0,
    }
    for (const r of receipts.value) acc[r.fee_kind] = (acc[r.fee_kind] || 0) + r.amount_zwl
    return acc
  })

  async function refresh() {
    loading.value = true
    try {
      const all = await planningClerkApi.loadAll()
      correspondence.value = all.correspondence
      receipts.value = all.receipts
      acknowledgements.value = all.acknowledgements
      dispatches.value = all.dispatches
      refusals.value = all.refusals
      noticeCertificates.value = all.noticeCertificates
      abutterLog.value = all.abutterLog
      error.value = null
    } catch (err) {
      correspondence.value = []
      receipts.value = []
      acknowledgements.value = []
      dispatches.value = []
      refusals.value = []
      noticeCertificates.value = []
      abutterLog.value = []
      error.value = errMessage(err, 'Could not load Planning Clerk registers from the server.')
    } finally {
      loading.value = false
    }
  }

  void refresh()

  function addCorrespondence(e: Omit<CorrespondenceEntry, 'id'>): CorrespondenceEntry {
    const optimistic: CorrespondenceEntry = { ...e, id: `tmp_${Date.now()}` }
    correspondence.value.unshift(optimistic)
    void planningClerkApi.createCorrespondence(e).then((rec) => {
      const i = correspondence.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) correspondence.value[i] = rec
      else correspondence.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      correspondence.value = correspondence.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save correspondence.')
    })
    return optimistic
  }

  function addReceipt(r: Omit<FeeReceipt, 'id'>): FeeReceipt {
    const optimistic: FeeReceipt = { ...r, id: `tmp_${Date.now()}` }
    receipts.value.unshift(optimistic)
    void planningClerkApi.createFeeReceipt(r).then((rec) => {
      const i = receipts.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) receipts.value[i] = rec
      else receipts.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      receipts.value = receipts.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save fee receipt.')
    })
    return optimistic
  }

  function addAcknowledgement(a: Omit<AcknowledgementLetter, 'id'>): AcknowledgementLetter {
    const optimistic: AcknowledgementLetter = { ...a, id: `tmp_${Date.now()}` }
    acknowledgements.value.unshift(optimistic)
    void planningClerkApi.createAcknowledgement(a).then((rec) => {
      const i = acknowledgements.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) acknowledgements.value[i] = rec
      else acknowledgements.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      acknowledgements.value = acknowledgements.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save acknowledgement.')
    })
    return optimistic
  }

  function markAcknowledgementSent(id: string) {
    const idx = acknowledgements.value.findIndex(a => a.id === id)
    if (idx < 0) return
    const prev = acknowledgements.value[idx]
    acknowledgements.value[idx] = { ...prev, sent_at: new Date().toISOString() }
    void planningClerkApi.markAcknowledgementSent(id).then((rec) => {
      const i = acknowledgements.value.findIndex(a => a.id === id)
      if (i >= 0) acknowledgements.value[i] = rec
      error.value = null
    }).catch((err) => {
      const i = acknowledgements.value.findIndex(a => a.id === id)
      if (i >= 0) acknowledgements.value[i] = prev
      error.value = errMessage(err, 'Could not mark acknowledgement as sent.')
    })
  }

  function addDispatch(d: Omit<PermitDispatch, 'id'>): PermitDispatch {
    const optimistic: PermitDispatch = { ...d, id: `tmp_${Date.now()}` }
    dispatches.value.unshift(optimistic)
    void planningClerkApi.createDispatch(d).then((rec) => {
      const i = dispatches.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) dispatches.value[i] = rec
      else dispatches.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      dispatches.value = dispatches.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save dispatch.')
    })
    return optimistic
  }

  function addRefusal(r: Omit<RefusalLetter, 'id'>): RefusalLetter {
    const optimistic: RefusalLetter = { ...r, id: `tmp_${Date.now()}` }
    refusals.value.unshift(optimistic)
    void planningClerkApi.createRefusal(r).then((rec) => {
      const i = refusals.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) refusals.value[i] = rec
      else refusals.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      refusals.value = refusals.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save refusal letter.')
    })
    return optimistic
  }

  function markRefusalSent(id: string) {
    const idx = refusals.value.findIndex(r => r.id === id)
    if (idx < 0) return
    const prev = refusals.value[idx]
    refusals.value[idx] = { ...prev, sent_at: new Date().toISOString() }
    void planningClerkApi.markRefusalSent(id).then((rec) => {
      const i = refusals.value.findIndex(r => r.id === id)
      if (i >= 0) refusals.value[i] = rec
      error.value = null
    }).catch((err) => {
      const i = refusals.value.findIndex(r => r.id === id)
      if (i >= 0) refusals.value[i] = prev
      error.value = errMessage(err, 'Could not mark refusal as sent.')
    })
  }

  function addNoticeCertificate(n: Omit<NoticeCertificate, 'id'>): NoticeCertificate {
    const optimistic: NoticeCertificate = { ...n, id: `tmp_${Date.now()}` }
    noticeCertificates.value.unshift(optimistic)
    void planningClerkApi.createNoticeCertificate(n).then((rec) => {
      const i = noticeCertificates.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) noticeCertificates.value[i] = rec
      else noticeCertificates.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      noticeCertificates.value = noticeCertificates.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save notice certificate.')
    })
    return optimistic
  }

  function addAbutterLog(a: Omit<AbutterNotificationLog, 'id'>): AbutterNotificationLog {
    const optimistic: AbutterNotificationLog = { ...a, id: `tmp_${Date.now()}` }
    abutterLog.value.unshift(optimistic)
    void planningClerkApi.createAbutterNotification(a).then((rec) => {
      const i = abutterLog.value.findIndex(x => x.id === optimistic.id)
      if (i >= 0) abutterLog.value[i] = rec
      else abutterLog.value.unshift(rec)
      error.value = null
    }).catch((err) => {
      abutterLog.value = abutterLog.value.filter(x => x.id !== optimistic.id)
      error.value = errMessage(err, 'Could not save abutter notification.')
    })
    return optimistic
  }

  const ctx: PlanningClerkCaseContext = {
    correspondence, receipts, acknowledgements, dispatches, refusals,
    noticeCertificates, abutterLog,
    ackOverdue, refusalsDue, feeTotalsByKind,
    error, loading, refresh,
    addCorrespondence, addReceipt,
    addAcknowledgement, markAcknowledgementSent,
    addDispatch,
    addRefusal, markRefusalSent,
    addNoticeCertificate,
    addAbutterLog,
  }
  provide(CLERK_KEY, ctx)

  if (typeof window !== 'undefined' && getCurrentScope()) {
    onScopeDispose(() => { /* no shared timers */ })
  }
  return ctx
}

export function usePlanningClerkCase(): PlanningClerkCaseContext {
  const ctx = inject(CLERK_KEY)
  if (!ctx) throw new Error('usePlanningClerkCase() called outside <PlanningClerkPortalView> tree')
  return ctx
}

export function useOrProvidePlanningClerkCase(): PlanningClerkCaseContext {
  const existing = inject(CLERK_KEY, null)
  if (existing) return existing
  return providePlanningClerkCase()
}

// ── Static reference: required-doc checklist at receipt ────────
export interface ReceiptChecklistItem { key: string; label: string }
export const RECEIPT_CHECKLIST: ReceiptChecklistItem[] = [
  { key:'signature_applicant',  label:'Applicant signature on TPD form' },
  { key:'signature_owner',      label:'Owner signature (if applicant ≠ owner)' },
  { key:'agent_authority',      label:'Agent authority letter (if filed by agent)' },
  { key:'company_resolution',   label:'Company resolution (if applicant is a company)' },
  { key:'title_deed',           label:'Title deed (extract or certified copy)' },
  { key:'bondholder_consent',   label:'Bondholder consent (if property is bonded)' },
  { key:'lessee_consent',       label:'Lessee consent (if property is leased)' },
  { key:'building_plans_5',     label:'Building plans — 5 copies' },
  { key:'fee_paid',             label:'Application fee paid (receipt attached)' },
  { key:'mining_restoration',   label:'Mining restoration programme (if mining)' },
  { key:'industrial_disclosure',label:'Industrial processes disclosure (if industrial)' },
]
