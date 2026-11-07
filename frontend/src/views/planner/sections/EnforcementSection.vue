<script setup lang="ts">
// Enforcement — RTCP Act [Ch. 29:12] ss.27, 32, 34, 35, 38.
//
// The planner's part of enforcement, in the order it happens:
//   1. Contraventions  — substantiated field findings (building_complaint).
//                        Choose the route: invite a s.27 regularisation
//                        application, or take enforcement action.
//   2. Orders          — draft → signed & issued → served. Drafts download as
//                        letterhead PDFs for signature.
//   3. Compliance      — served orders whose period has run out. Record the
//                        outcome; where ignored, recommend council action.
//   4. Prohibition     — s.34 orders, usually following a non-complied order.
//
// Both routes persist as enforcement_order rows (retrospective_consent is the
// server's regularisation vocabulary), tagged with the complaint reference, so
// the route chosen is on the record, not in this browser.
import { computed, onMounted, reactive, ref } from 'vue'
import {
  dmApi, type EnforcementOrder, type ProhibitionOrder,
} from '@/services/developmentManagementService'
import {
  complaintsApi, COMPLAINT_CATEGORY_LABELS, type BuildingComplaint,
} from '@/services/buildingComplaints'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import {
  isOrderOpen, orderKind, complianceDue, needsComplianceReview, breachFor, orderForComplaint,
} from '../enforcementRules'
import { orderDraft, regularisationInvitation, renderDraftPdf } from '../plannerDocuments'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import { Plus, X, RefreshCw, ShieldAlert, Ban, FileDown, ClipboardCheck, Siren } from 'lucide-vue-next'

type Tab = 'contraventions' | 'orders' | 'compliance' | 'prohibition'

const fb = useUiFeedback()
const auth = useAuthStore()
const officer = computed(() => auth.user?.name || auth.user?.email || 'Town Planning Officer')

const tab = ref<Tab>('contraventions')
const orders = ref<EnforcementOrder[]>([])
const prohibitions = ref<ProhibitionOrder[]>([])
const complaints = ref<BuildingComplaint[]>([])
const complaintsError = ref('')
const loading = ref(false)

async function refresh() {
  loading.value = true
  complaintsError.value = ''
  // Started now, awaited below: the field contraventions no longer wait for
  // the orders round trip before their own request goes out.
  const complaintsReq = complaintsApi.list({ open: true, limit: 200 })
  complaintsReq.catch(() => {}) // handled below; avoids an unhandled rejection meanwhile
  try {
    const [e, p] = await Promise.all([
      dmApi.listEnforcement({}),
      dmApi.listProhibitionOrders().catch(() => [] as ProhibitionOrder[]),
    ])
    orders.value = e
    prohibitions.value = p
  } catch (err) {
    fb.showToast(fb.parseApiError(err, 'Could not load enforcement records'), 'error')
  }
  try {
    const r = await complaintsReq
    complaints.value = r.data.filter(c => c.status === 'substantiated' || c.status === 'inspected')
  } catch (err) {
    complaintsError.value = fb.parseApiError(err, 'Could not load field contraventions.')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const subjectOf = (o: EnforcementOrder) => o.subject_name || o.owner_name || '—'
const openOrders = computed(() => orders.value.filter(isOrderOpen))
const closedOrders = computed(() => orders.value.filter(o => !isOrderOpen(o)))
const reviewDue = computed(() => orders.value.filter(o => needsComplianceReview(o)))
const nonComplied = computed(() => orders.value.filter(o => o.status === 'non_complied'))
const awaitingRoute = computed(() => complaints.value.filter(c => !orderForComplaint(c.reference, orders.value)))

// ── Order form (shared by both routes and by s.35 follow-ups) ─────────────
const ORDER_TYPES: { value: EnforcementOrder['order_type']; label: string }[] = [
  { value: 'enforcement_notice', label: 'Enforcement order (s.32)' },
  { value: 'stop_notice', label: 'Stop notice' },
  { value: 'breach_of_condition', label: 'Breach of permit condition' },
  { value: 'reinstatement', label: 'Section 35 notice — removal / reinstatement' },
  { value: 'retrospective_consent', label: 'Regularisation — apply under s.27' },
]
const blankOrder = () => ({
  complaintRef: '', permit_app_id: '' as string,
  stand_number: '', subject_name: '', subject_address: '',
  order_type: 'enforcement_notice' as EnforcementOrder['order_type'],
  breach_description: '', required_action: '', compliance_period: 30,
})
const form = reactive(blankOrder())
const formOpen = ref(false)
const saving = ref(false)

function openForm(seed: Partial<ReturnType<typeof blankOrder>> = {}) {
  Object.assign(form, blankOrder(), seed)
  formOpen.value = true
  tab.value = 'orders'
}

function chooseRoute(c: BuildingComplaint, route: 'regularise' | 'enforce') {
  const breach = `${COMPLAINT_CATEGORY_LABELS[c.category]}. ${c.finding || c.description}`
  openForm({
    complaintRef: c.reference,
    permit_app_id: c.permit_app_id || '',
    stand_number: c.stand_number || '',
    subject_address: [c.stand_number ? `Stand ${c.stand_number}` : '', c.suburb_ward, c.location_note].filter(Boolean).join(', '),
    order_type: route === 'regularise' ? 'retrospective_consent' : 'enforcement_notice',
    breach_description: breach,
    required_action: route === 'regularise'
      ? 'Lodge an application for regularisation under section 27, with plans of the works as built.'
      : '',
  })
}

const formErrors = computed(() => {
  const e: string[] = []
  if (!form.subject_name.trim()) e.push('owner or occupier')
  if (!form.subject_address.trim()) e.push('address for service')
  if (!form.breach_description.trim()) e.push('contravention')
  if (!form.required_action.trim()) e.push('steps required')
  if (!(form.compliance_period > 0)) e.push('compliance period')
  return e
})

async function submitOrder() {
  if (formErrors.value.length) {
    fb.openMessageBox({ kind: 'warn', title: 'Required fields missing', message: `Complete: ${formErrors.value.join(', ')}.` })
    return
  }
  saving.value = true
  try {
    await dmApi.createEnforcement({
      stand_number: form.stand_number.trim() || undefined,
      subject_name: form.subject_name.trim(),
      subject_address: form.subject_address.trim(),
      order_type: form.order_type,
      breach_description: form.complaintRef
        ? breachFor(form.complaintRef, form.breach_description.trim())
        : form.breach_description.trim(),
      required_action: form.required_action.trim(),
      compliance_period: form.compliance_period,
      ...(form.permit_app_id ? { permit_app_id: form.permit_app_id } as Record<string, string> : {}),
    })
    fb.showToast('Draft order saved. Download it for signature.', 'success')
    formOpen.value = false
    await refresh()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not save the order', message: fb.parseApiError(e, 'The server rejected the order.') })
  } finally {
    saving.value = false
  }
}

// ── Documents ─────────────────────────────────────────────────────────────
function downloadOrder(o: EnforcementOrder) {
  const ref = {
    reference: o.order_reference || o.id.slice(0, 8),
    subject: subjectOf(o),
    address: o.subject_address || '—',
    standNo: o.stand_number || '—',
    contravention: o.breach_description,
    requiredAction: o.required_action,
    compliancePeriodDays: o.compliance_period,
  }
  renderDraftPdf(o.order_type === 'retrospective_consent'
    ? regularisationInvitation(ref, o.compliance_period, officer.value)
    : orderDraft(orderKind(o.order_type), ref, officer.value))
}

function downloadProhibition(p: ProhibitionOrder) {
  renderDraftPdf(orderDraft('prohibition', {
    reference: p.order_reference || p.id.slice(0, 8),
    subject: p.subject_name, address: p.subject_address, standNo: p.stand_number || '—',
    contravention: p.prohibited_activity, requiredAction: p.reason, compliancePeriodDays: 0,
  }, officer.value))
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
type OrderStatus = Parameters<typeof dmApi.setEnforcementStatus>[1]
const NEXT: Partial<Record<EnforcementOrder['status'], { to: OrderStatus; label: string; body: string }>> = {
  draft:  { to: 'issued', label: 'Mark signed & issued', body: 'Confirm the order has been signed by the authorised officer.' },
  issued: { to: 'served', label: 'Mark served', body: 'Records today as the date of service. The order takes effect one month later unless appealed.' },
}

async function transition(o: EnforcementOrder, to: OrderStatus, title: string, body: string, notes?: string) {
  const ok = await fb.confirmAction(title, `${o.order_reference || ''} · Stand ${o.stand_number || '—'}. ${body}`,
    { confirmLabel: 'Confirm', danger: to === 'withdrawn' })
  if (!ok) return
  try {
    await dmApi.setEnforcementStatus(o.id, to, notes)
    fb.showToast('Order updated', 'success')
    await refresh()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not update the order', message: fb.parseApiError(e, 'The server rejected the update.') })
  }
}

// ── Compliance review ─────────────────────────────────────────────────────
const RECOMMENDATIONS = [
  'Serve a prohibition order (s.34) and refer for prosecution',
  'Council to carry out the works and recover the cost from the owner (s.35)',
  'Refer to the council legal officer for prosecution',
  'Extend the compliance period — owner has started remedial works',
]
const review = reactive<Record<string, { rec: string; notes: string }>>({})
const reviewOf = (id: string) => (review[id] ??= { rec: RECOMMENDATIONS[0], notes: '' })

async function recordCompliance(o: EnforcementOrder, complied: boolean) {
  if (complied) {
    await transition(o, 'complied', 'Record compliance?', 'The order will be closed as complied with.',
      `Compliance confirmed on review by ${officer.value}.`)
    return
  }
  const r = reviewOf(o.id)
  await transition(o, 'non_complied', 'Record non-compliance and recommendation?',
    `Recommendation to council: ${r.rec}.`,
    `Not complied. Recommendation to council: ${r.rec}.${r.notes ? ` ${r.notes}` : ''} (${officer.value})`)
}

function followUpS35(o: EnforcementOrder) {
  openForm({
    permit_app_id: o.permit_app_id || '',
    stand_number: o.stand_number || '', subject_name: subjectOf(o), subject_address: o.subject_address || '',
    order_type: 'reinstatement',
    breach_description: `Non-compliance with order ${o.order_reference}. ${o.breach_description}`,
    required_action: o.required_action,
  })
}

// ── Prohibition ───────────────────────────────────────────────────────────
const blankProhibition = () => ({
  enforcement_order_id: '', stand_number: '', subject_name: '', subject_address: '',
  prohibited_activity: '', reason: '',
})
const pform = reactive(blankProhibition())
const pformOpen = ref(false)

function openProhibition(o?: EnforcementOrder) {
  Object.assign(pform, blankProhibition(), o ? {
    enforcement_order_id: o.id, stand_number: o.stand_number || '',
    subject_name: subjectOf(o), subject_address: o.subject_address || '',
    reason: `Non-compliance with enforcement order ${o.order_reference}.`,
  } : {})
  pformOpen.value = true
  tab.value = 'prohibition'
}

async function submitProhibition() {
  const missing = (['subject_name', 'subject_address', 'prohibited_activity', 'reason'] as const)
    .filter(k => !pform[k].trim())
  if (missing.length) {
    fb.openMessageBox({ kind: 'warn', title: 'Required fields missing',
      message: 'Owner, address for service, the operations to be discontinued and the reason are all required (s.34).' })
    return
  }
  try {
    await dmApi.createProhibitionOrder({
      enforcement_order_id: pform.enforcement_order_id || null,
      stand_number: pform.stand_number.trim(),
      subject_name: pform.subject_name.trim(),
      subject_address: pform.subject_address.trim(),
      prohibited_activity: pform.prohibited_activity.trim(),
      reason: pform.reason.trim(),
    })
    fb.showToast('Prohibition order recorded. Download it for signature.', 'success')
    pformOpen.value = false
    await refresh()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not record the prohibition order', message: fb.parseApiError(e, 'The server rejected the order.') })
  }
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const typeLabel = (t: string) => ORDER_TYPES.find(x => x.value === t)?.label ?? t.replace(/_/g, ' ')
</script>

<template>
  <div class="en">
    <header class="en-head">
      <div>
        <h2>Enforcement</h2>
        <p>Contraventions, orders for signature, compliance and prohibition · RTCP Act ss.27, 32, 34, 35</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <nav class="en-tabs" role="tablist" aria-label="Enforcement">
      <button role="tab" :aria-selected="tab === 'contraventions'" :class="{ active: tab === 'contraventions' }" @click="tab = 'contraventions'">
        <Siren :size="13" aria-hidden="true" /> Contraventions <span class="en-count">{{ awaitingRoute.length }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'orders'" :class="{ active: tab === 'orders' }" @click="tab = 'orders'">
        <ShieldAlert :size="13" aria-hidden="true" /> Orders <span class="en-count">{{ openOrders.length }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'compliance'" :class="{ active: tab === 'compliance' }" @click="tab = 'compliance'">
        <ClipboardCheck :size="13" aria-hidden="true" /> Compliance review <span class="en-count" :class="{ hot: reviewDue.length }">{{ reviewDue.length }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'prohibition'" :class="{ active: tab === 'prohibition' }" @click="tab = 'prohibition'">
        <Ban :size="13" aria-hidden="true" /> Prohibition <span class="en-count">{{ prohibitions.length }}</span>
      </button>
    </nav>

    <!-- ── Contraventions ───────────────────────────────────────────── -->
    <div v-if="tab === 'contraventions'" class="en-body">
      <p class="en-hint">Findings recorded on site by field officers. For each, choose the route: invite a regularisation application where the development could be permitted, or take enforcement action where it could not.</p>
      <p v-if="complaintsError" class="en-error" role="alert">{{ complaintsError }}</p>
      <p v-else-if="!complaints.length && loading" class="en-hint" role="status">Loading contraventions…</p>
      <UiEmptyState v-else-if="!complaints.length" message="No substantiated contraventions awaiting review."
                    sub="Field officers record findings from the Inspector console." />
      <ul v-else class="en-list">
        <li v-for="c in complaints" :key="c.id" class="en-item" :class="orderForComplaint(c.reference, orders) ? 'closed' : 'active'">
          <div class="en-item-head">
            <span class="en-ref">{{ c.reference }}</span>
            <span class="en-type">{{ COMPLAINT_CATEGORY_LABELS[c.category] }}</span>
            <span class="en-status-slot"><UiStatusBadge :tone="c.severity === 'routine' ? 'neutral' : 'negative'" :label="c.severity" /></span>
          </div>
          <div class="en-item-body">
            <p>Stand {{ c.stand_number || '—' }} · {{ c.suburb_ward || c.location_note || '—' }}</p>
            <p class="en-breach">{{ c.finding || c.description }}</p>
            <p class="en-meta">Inspected {{ fmtDate(c.inspected_at) }}{{ c.inspected_by_name ? ` by ${c.inspected_by_name}` : '' }}</p>
          </div>
          <div class="en-item-actions">
            <template v-if="orderForComplaint(c.reference, orders)">
              <span class="en-route">Route chosen: {{ typeLabel(orderForComplaint(c.reference, orders)!.order_type) }} ({{ orderForComplaint(c.reference, orders)!.order_reference }})</span>
            </template>
            <template v-else>
              <UiButton size="sm" @click="chooseRoute(c, 'regularise')">Invite regularisation (s.27)</UiButton>
              <UiButton size="sm" variant="danger" @click="chooseRoute(c, 'enforce')">Take enforcement action</UiButton>
            </template>
          </div>
        </li>
      </ul>
    </div>

    <!-- ── Orders ───────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'orders'" class="en-body">
      <div class="en-row-actions">
        <UiButton variant="primary" size="sm" @click="formOpen ? (formOpen = false) : openForm()">
          <template #icon><component :is="formOpen ? X : Plus" :size="13" /></template>
          {{ formOpen ? 'Cancel' : 'Draft an order' }}
        </UiButton>
      </div>

      <form v-if="formOpen" class="en-form" @submit.prevent="submitOrder">
        <header>Draft order{{ form.complaintRef ? ` — from ${form.complaintRef}` : '' }}</header>
        <div class="en-form-grid">
          <label class="en-wide">Order
            <select v-model="form.order_type">
              <option v-for="t in ORDER_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </label>
          <label>Stand number<input v-model="form.stand_number" /></label>
          <label>Compliance period (days) *<input v-model.number="form.compliance_period" type="number" min="1" /></label>
          <label>Owner or occupier *<input v-model="form.subject_name" autocomplete="off" /></label>
          <label>Address for service *<input v-model="form.subject_address" /></label>
          <label class="en-wide">Contravention *<textarea v-model="form.breach_description" rows="3" /></label>
          <label class="en-wide">Steps required *<textarea v-model="form.required_action" rows="2"
            placeholder="e.g. cease the unauthorised use; demolish the extension and restore the building line" /></label>
        </div>
        <UiButton type="submit" variant="primary" :loading="saving">Save draft</UiButton>
      </form>

      <UiEmptyState v-if="!openOrders.length" message="No open orders." />
      <ul v-else class="en-list">
        <li v-for="o in openOrders" :key="o.id" class="en-item active">
          <div class="en-item-head">
            <span class="en-ref">{{ o.order_reference }}</span>
            <span class="en-type">{{ typeLabel(o.order_type) }}</span>
            <span class="en-status-slot"><UiStatusBadge :status="o.status" /></span>
          </div>
          <div class="en-item-body">
            <p><strong>{{ subjectOf(o) }}</strong> · Stand {{ o.stand_number || '—' }}</p>
            <p class="en-breach">{{ o.breach_description }}</p>
            <p class="en-required">Required: {{ o.required_action }}</p>
            <p class="en-meta">
              Drafted {{ fmtDate(o.issued_at) }} · {{ o.compliance_period }}-day period
              <template v-if="o.served_at"> · served {{ fmtDate(o.served_at) }} · compliance due {{ fmtDate(complianceDue(o)) }}</template>
            </p>
            <p v-if="o.notes" class="en-meta">{{ o.notes }}</p>
          </div>
          <div class="en-item-actions">
            <UiButton size="sm" @click="downloadOrder(o)">
              <template #icon><FileDown :size="12" /></template>
              Draft for signature
            </UiButton>
            <UiButton v-if="NEXT[o.status]" size="sm" variant="primary"
                      @click="transition(o, NEXT[o.status]!.to, NEXT[o.status]!.label + '?', NEXT[o.status]!.body)">
              {{ NEXT[o.status]!.label }}
            </UiButton>
            <UiButton v-if="o.status === 'served'" size="sm"
                      @click="transition(o, 'appealed', 'Record an appeal?', 'An appeal suspends the order until the Administrative Court decides.')">
              Appeal lodged
            </UiButton>
            <UiButton v-if="o.status === 'non_complied'" size="sm" @click="openProhibition(o)">Draft prohibition order</UiButton>
            <UiButton v-if="o.status === 'non_complied'" size="sm" @click="followUpS35(o)">Draft s.35 notice</UiButton>
            <UiButton size="sm" variant="ghost" @click="transition(o, 'withdrawn', 'Withdraw this order?', 'A withdrawn order cannot be re-served.')">Withdraw</UiButton>
          </div>
        </li>
      </ul>

      <details v-if="closedOrders.length" class="en-closed">
        <summary>Closed orders ({{ closedOrders.length }})</summary>
        <ul class="en-list">
          <li v-for="o in closedOrders" :key="o.id" class="en-item closed">
            <div class="en-item-head">
              <span class="en-ref">{{ o.order_reference }}</span>
              <span class="en-type">{{ typeLabel(o.order_type) }}</span>
              <span class="en-status-slot"><UiStatusBadge :status="o.status" /></span>
            </div>
            <p class="en-meta">{{ subjectOf(o) }} · Stand {{ o.stand_number || '—' }} · {{ fmtDate(o.issued_at) }}</p>
          </li>
        </ul>
      </details>
    </div>

    <!-- ── Compliance review ────────────────────────────────────────── -->
    <div v-else-if="tab === 'compliance'" class="en-body">
      <p class="en-hint">Served orders whose compliance period has run out. Review the field officer's compliance inspection, then record the outcome. Where an order has been ignored, recommend the council's action.</p>
      <UiEmptyState v-if="!reviewDue.length" message="No orders are due for compliance review." />
      <ul v-else class="en-list">
        <li v-for="o in reviewDue" :key="o.id" class="en-item active">
          <div class="en-item-head">
            <span class="en-ref">{{ o.order_reference }}</span>
            <span class="en-type">{{ typeLabel(o.order_type) }}</span>
            <span class="en-status-slot en-overdue">Due {{ fmtDate(complianceDue(o)) }}</span>
          </div>
          <div class="en-item-body">
            <p><strong>{{ subjectOf(o) }}</strong> · Stand {{ o.stand_number || '—' }}</p>
            <p class="en-required">Required: {{ o.required_action }}</p>
          </div>
          <div class="en-form-grid en-review">
            <label class="en-wide">Recommendation to council if not complied
              <select v-model="reviewOf(o.id).rec">
                <option v-for="r in RECOMMENDATIONS" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <label class="en-wide">Inspection findings and notes<textarea v-model="reviewOf(o.id).notes" rows="2" /></label>
          </div>
          <div class="en-item-actions">
            <UiButton size="sm" variant="primary" @click="recordCompliance(o, true)">Complied</UiButton>
            <UiButton size="sm" variant="danger" @click="recordCompliance(o, false)">Not complied — recommend action</UiButton>
          </div>
        </li>
      </ul>

      <template v-if="nonComplied.length">
        <h3 class="en-subhead">Non-complied, awaiting council action ({{ nonComplied.length }})</h3>
        <ul class="en-list">
          <li v-for="o in nonComplied" :key="o.id" class="en-item active">
            <div class="en-item-head">
              <span class="en-ref">{{ o.order_reference }}</span>
              <span class="en-status-slot"><UiStatusBadge :status="o.status" /></span>
            </div>
            <p class="en-meta">{{ subjectOf(o) }} · Stand {{ o.stand_number || '—' }}</p>
            <p v-if="o.notes" class="en-breach">{{ o.notes }}</p>
            <div class="en-item-actions">
              <UiButton size="sm" @click="openProhibition(o)">Draft prohibition order</UiButton>
              <UiButton size="sm" @click="followUpS35(o)">Draft s.35 notice</UiButton>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <!-- ── Prohibition ──────────────────────────────────────────────── -->
    <div v-else class="en-body">
      <div class="en-row-actions">
        <UiButton variant="primary" size="sm" @click="pformOpen ? (pformOpen = false) : openProhibition()">
          <template #icon><component :is="pformOpen ? X : Plus" :size="13" /></template>
          {{ pformOpen ? 'Cancel' : 'Draft a prohibition order' }}
        </UiButton>
      </div>

      <form v-if="pformOpen" class="en-form" @submit.prevent="submitProhibition">
        <header>Prohibition order (s.34)</header>
        <div class="en-form-grid">
          <label class="en-wide">Linked enforcement order
            <select v-model="pform.enforcement_order_id">
              <option value="">None</option>
              <option v-for="o in orders" :key="o.id" :value="o.id">{{ o.order_reference }} · Stand {{ o.stand_number || '—' }}</option>
            </select>
          </label>
          <label>Stand number<input v-model="pform.stand_number" /></label>
          <label>Owner or occupier *<input v-model="pform.subject_name" /></label>
          <label class="en-wide">Address for service *<input v-model="pform.subject_address" /></label>
          <label class="en-wide">Operations to be discontinued *<textarea v-model="pform.prohibited_activity" rows="2"
            placeholder="State precisely what must stop (s.34)" /></label>
          <label class="en-wide">Reason *<textarea v-model="pform.reason" rows="2" /></label>
        </div>
        <UiButton type="submit" variant="primary">Record order</UiButton>
      </form>

      <UiEmptyState v-if="!prohibitions.length" message="No prohibition orders recorded." />
      <ul v-else class="en-list">
        <li v-for="p in prohibitions" :key="p.id" class="en-item" :class="p.lifted_at ? 'closed' : 'active'">
          <div class="en-item-head">
            <span class="en-ref">{{ p.order_reference }}</span>
            <span class="en-status-slot">
              <UiStatusBadge :tone="p.lifted_at ? 'neutral' : 'negative'" :label="p.lifted_at ? 'Lifted' : 'In force'" />
            </span>
          </div>
          <div class="en-item-body">
            <p><strong>{{ p.subject_name }}</strong> · Stand {{ p.stand_number || '—' }}</p>
            <p class="en-breach">{{ p.prohibited_activity }}</p>
            <p class="en-meta">{{ p.reason }} · issued {{ fmtDate(p.issued_at) }}<span v-if="p.lifted_at"> · lifted {{ fmtDate(p.lifted_at) }}</span></p>
          </div>
          <div class="en-item-actions">
            <UiButton size="sm" @click="downloadProhibition(p)">
              <template #icon><FileDown :size="12" /></template>
              Draft for signature
            </UiButton>
          </div>
        </li>
      </ul>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.en { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); height: 100%; min-height: 0; }
.en-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.en-head > div { flex: 1; }
.en-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); }
.en-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }

.en-tabs { display: flex; gap: var(--ent-s1); border-bottom: 1px solid var(--ent-line); overflow-x: auto; overflow-y: hidden; }
.en-tabs button { display: inline-flex; align-items: center; gap: var(--ent-s1); white-space: nowrap;
  min-height: var(--ent-touch-min); padding: var(--ent-s2) var(--ent-s3); font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; margin-bottom: -1px; }
.en-tabs button:hover { color: var(--ent-text); }
.en-tabs button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.en-tabs button.active { color: var(--ent-accent); border-bottom-color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.en-count { font-size: var(--ent-fs-micro); padding: 0 6px; border-radius: var(--ent-r-pill); background: var(--ent-surface-sunken); color: var(--ent-text-2); }
.en-count.hot { background: var(--ent-danger-soft); color: var(--ent-danger); }

.en-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--ent-s2); }
.en-hint { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); max-width: 70ch; }
.en-error { margin: 0; color: var(--ent-danger); font-size: var(--ent-fs-sm); }
.en-row-actions { display: flex; gap: var(--ent-s2); }

.en-form { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); padding: var(--ent-s3); }
.en-form > header { font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); margin-bottom: var(--ent-s2); color: var(--ent-text); }
.en-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s2) var(--ent-s3); margin-bottom: var(--ent-s3); }
.en-form-grid label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.en-form-grid label.en-wide { grid-column: 1 / -1; }
.en-form-grid input, .en-form-grid select, .en-form-grid textarea {
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  padding: var(--ent-s2) var(--ent-s3); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  outline: none; background: var(--ent-surface); }
.en-form-grid input:focus, .en-form-grid select:focus, .en-form-grid textarea:focus { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.en-form-grid textarea { resize: vertical; }
.en-review { margin: var(--ent-s2) 0 0; }

.en-subhead { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text-3); text-transform: uppercase; letter-spacing: 0.05em; }
.en-closed summary { cursor: pointer; font-size: var(--ent-fs-sm); color: var(--ent-text-2); padding: var(--ent-s2) 0; }

.en-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.en-item { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); padding: var(--ent-s3); }
.en-item-head { display: flex; align-items: center; gap: var(--ent-s2); margin-bottom: var(--ent-s2); flex-wrap: wrap; }
.en-ref { font-family: var(--ent-font-mono); font-weight: var(--ent-fw-bold); color: var(--ent-text); font-size: var(--ent-fs-sm); }
.en-type { font-size: var(--ent-fs-micro); padding: 1px var(--ent-s2); background: var(--ent-surface-sunken);
  color: var(--ent-text-2); border-radius: var(--ent-r-pill); }
.en-status-slot { margin-left: auto; }
.en-overdue { font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-danger); }
.en-item-body { font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.en-item-body p { margin: 2px 0; }
.en-breach { color: var(--ent-text); }
.en-required { color: var(--ent-text); font-weight: var(--ent-fw-medium); }
.en-meta { color: var(--ent-text-3); font-size: var(--ent-fs-micro); margin: 2px 0; }
.en-route { font-size: var(--ent-fs-xs); color: var(--ent-success); font-weight: var(--ent-fw-semibold); }
.en-item-actions { margin-top: var(--ent-s2); display: flex; gap: var(--ent-s2); flex-wrap: wrap; align-items: center; }

@media (max-width: 767px) {
  .en { padding: var(--ent-s3); }
  .en-form-grid { grid-template-columns: 1fr; }
}
</style>
