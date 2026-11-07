<script setup lang="ts">
// Enforcement — Section 32 stop-work and Section 34 prohibition orders.
//
// Division of powers, enforced by the server: the EO Planner and Planner issue
// and close orders; the building inspector visits the site, records whether the
// owner complied, and escalates with evidence. So this desk shows every order
// with its compliance deadline, records compliance visits, and escalates by
// referral — pre-filled, not a button that only says "not authorised".
import { computed, ref } from 'vue'
import {
  ShieldAlert, RefreshCw, CheckCircle2, Clock, Ban, FileWarning, Search, AlertTriangle,
  ClipboardCheck, Send, MapPin, XCircle,
} from 'lucide-vue-next'
import { dmApi, type EnforcementOrder, type ProhibitionOrder, type PermitApplication } from '@/services/developmentManagementService'
import { officialEnforcementOpen, normalizeEnforcementStatus, type OfficialEnforcementStatus } from '@/inspector/architecture'
import { complianceDeadline } from '@/inspector/caseFile'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useInspectorWorkload } from '@/composables/useInspectorWorkload'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiKpi from '@/components/ui/UiKpi.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import InspectionReferralForm, { type ReferralTarget } from '@/components/inspector/InspectionReferralForm.vue'

const fb = useUiFeedback()
const { refreshWorkload } = useInspectorWorkload()
const ic = useInspectionCase()

const orders = ref<EnforcementOrder[]>([])
const prohibitions = ref<ProhibitionOrder[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const [e, p] = await Promise.all([dmApi.listEnforcement(), dmApi.listProhibitionOrders()])
    orders.value = e
    prohibitions.value = p
    loaded.value = true
  } catch (err: unknown) {
    error.value = fb.parseApiError(err, 'Enforcement records could not be loaded.')
  } finally {
    loading.value = false
    // Keep the rail's count in step with this page, which may just have
    // changed it; otherwise the badge beside it lags until the next re-read.
    void refreshWorkload()
  }
}
// Every deadline on this page is computed against the clock, so a list cached
// since this morning reports the wrong number of days to comply. Re-read it on
// return to the section, or when the phone comes back to the app.
useStaleRefresh(refresh)

type Filter = 'open' | 'overdue' | 'all' | OfficialEnforcementStatus
const filter = ref<Filter>('open')
const search = ref('')

const statusOf = (o: EnforcementOrder) => normalizeEnforcementStatus(o.status) || o.status
const deadlineOf = (o: EnforcementOrder) => complianceDeadline(o.issued_at, o.compliance_period)
const isOverdue = (o: EnforcementOrder) => officialEnforcementOpen(o.status) && (deadlineOf(o)?.daysLeft ?? 1) < 0

const counts = computed(() => ({
  open: orders.value.filter(o => officialEnforcementOpen(o.status)).length,
  overdue: orders.value.filter(isOverdue).length,
  complied: orders.value.filter(o => statusOf(o) === 'complied').length,
  prohibitions: prohibitions.value.filter(p => !p.lifted_at).length,
  all: orders.value.length,
}))

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: 'open', label: 'Open' }, { key: 'overdue', label: 'Past deadline' }, { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' }, { key: 'issued', label: 'Issued' }, { key: 'served', label: 'Served' },
  { key: 'non_complied', label: 'Non-complied' }, { key: 'complied', label: 'Complied' },
  { key: 'appealed', label: 'Appealed' }, { key: 'withdrawn', label: 'Withdrawn' },
]
function countFor(f: Filter) {
  if (f === 'open' || f === 'overdue' || f === 'all') return counts.value[f]
  return orders.value.filter(o => statusOf(o) === f).length
}

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return orders.value
    .filter(o => filter.value === 'all' ? true
      : filter.value === 'open' ? officialEnforcementOpen(o.status)
      : filter.value === 'overdue' ? isOverdue(o)
      : statusOf(o) === filter.value)
    .filter(o => !q || [o.order_reference, o.stand_number, o.owner_name, o.subject_name, o.suburb_ward]
      .some(v => (v || '').toLowerCase().includes(q)))
    // Most urgent first: open orders by days left, then the rest newest first.
    .sort((a, b) => {
      const ao = officialEnforcementOpen(a.status), bo = officialEnforcementOpen(b.status)
      if (ao !== bo) return ao ? -1 : 1
      if (ao) return (deadlineOf(a)?.daysLeft ?? 9e9) - (deadlineOf(b)?.daysLeft ?? 9e9)
      return new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime()
    })
})

function deadlineText(o: EnforcementOrder) {
  const d = deadlineOf(o)
  if (!d) return 'No compliance period recorded'
  const on = d.dueOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (!officialEnforcementOpen(o.status)) return `Deadline was ${on}`
  if (d.daysLeft < 0) return `${-d.daysLeft} days past deadline (${on})`
  if (d.daysLeft === 0) return `Deadline today (${on})`
  return `${d.daysLeft} days to comply (${on})`
}
function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const human = (s: string) => s.replace(/_/g, ' ')

// ── Compliance visit ───────────────────────────────────────────────────
const visitFor = ref<EnforcementOrder | null>(null)
const visitOpen = computed({ get: () => !!visitFor.value, set: v => { if (!v) visitFor.value = null } })
const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const visit = ref({ date: todayIso, complied: null as boolean | null, notes: '' })
const saving = ref(false)

function startVisit(o: EnforcementOrder) {
  visit.value = { date: todayIso, complied: null, notes: '' }
  visitFor.value = o
}

async function saveVisit() {
  const o = visitFor.value
  if (!o || saving.value) return
  if (visit.value.complied === null) { fb.showToast('Record whether the owner complied.', 'warning'); return }
  if (!visit.value.complied && visit.value.notes.trim().length < 10) {
    fb.showToast('Describe what you observed on site.', 'warning'); return
  }
  if (visit.value.date > todayIso) { fb.showToast('A visit cannot be dated in the future.', 'warning'); return }
  saving.value = true
  try {
    await dmApi.createComplianceCheck(o.id, {
      visited_at: visit.value.date,
      complied: visit.value.complied,
      notes: visit.value.notes.trim() || undefined,
    })
    const complied = visit.value.complied
    visitFor.value = null
    if (complied) {
      fb.showToast(`Compliance recorded for ${o.order_reference}. The EO Planner closes the order.`, 'success')
    } else {
      fb.showToast(`Non-compliance recorded for ${o.order_reference}.`, 'success')
      void escalate(o, 'Owner did not comply at the compliance visit.')
    }
    await refresh()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The compliance visit was not recorded.'), 'error')
  } finally {
    saving.value = false
  }
}

// ── Escalation by referral ─────────────────────────────────────────────
const referral = ref<{ permitId: string | null; stand: string; target: ReferralTarget; reason: string; order: EnforcementOrder | null } | null>(null)
const referralOpen = computed({ get: () => !!referral.value, set: v => { if (!v) referral.value = null } })

async function escalate(o: EnforcementOrder, observed = '') {
  // An order row can arrive without permit_application_id at all. `undefined`
  // is not `null`: the referral form takes `string | null`, and an absent
  // column must read as "no permit linked", not as a missing prop.
  const permitId = o.permit_application_id ?? null
  if (permitId && ic.current.value?.permitId !== permitId) {
    try { await ic.loadPermit(permitId) } catch { /* the form still carries the id */ }
  }
  referral.value = {
    permitId, stand: o.stand_number, target: 'eo_review', order: o,
    reason: [
      `Escalation of ${o.order_reference} (${human(o.order_type)}), stand ${o.stand_number}.`,
      deadlineText(o) + '.',
      observed,
      'Request consideration of a Section 34 prohibition order.',
    ].filter(Boolean).join(' '),
  }
}

function newReferral() {
  const p = ic.current.value?.permit as PermitApplication | null | undefined
  referral.value = { permitId: p?.id ?? null, stand: p?.stand_number ?? '', target: 'eo_review', order: null, reason: '' }
}
</script>

<template>
  <div class="ins-page en">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Compliance</span>
        <h2 class="ins-title">Enforcement</h2>
        <p class="ins-lede">Section 32 stop-work and Section 34 prohibition orders. Visit, record compliance, and escalate with evidence. Orders are issued and closed by the EO Planner.</p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" :loading="loading" @click="refresh">
          <template #icon><RefreshCw :size="14" /></template>
          Refresh
        </UiButton>
        <UiButton size="sm" variant="primary" @click="newReferral">
          <template #icon><Send :size="14" /></template>
          Report unauthorised work
        </UiButton>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div><strong>Enforcement records could not be loaded.</strong>
        <p>{{ error }} {{ loaded ? 'Showing the last successful load.' : 'Do not treat any stand as clear.' }}</p></div>
      <UiButton size="sm" @click="refresh">Retry</UiButton>
    </div>

    <div class="ins-kpis">
      <UiKpi clickable :value="loaded ? counts.open : '—'" label="Open orders" tone="info" @activate="filter = 'open'">
        <template #icon><FileWarning :size="17" /></template>
      </UiKpi>
      <UiKpi clickable :value="loaded ? counts.overdue : '—'" label="Past deadline, not closed" :tone="counts.overdue ? 'negative' : 'neutral'" @activate="filter = 'overdue'">
        <template #icon><Clock :size="17" /></template>
      </UiKpi>
      <UiKpi clickable :value="loaded ? counts.complied : '—'" label="Complied" tone="positive" @activate="filter = 'complied'">
        <template #icon><CheckCircle2 :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? counts.prohibitions : '—'" label="Prohibitions in force" :tone="counts.prohibitions ? 'warning' : 'neutral'">
        <template #icon><Ban :size="17" /></template>
      </UiKpi>
    </div>

    <section class="ins-card" aria-labelledby="en-list-h">
      <header class="ins-card-head en-toolbar">
        <h3 id="en-list-h" class="ent-sr-only">Enforcement orders</h3>
        <div class="ins-chips" aria-label="Filter orders">
          <button v-for="f in FILTERS" :key="f.key" type="button" class="ins-chip"
                  :aria-pressed="filter === f.key" @click="filter = f.key">
            {{ f.label }}<span class="ins-chip-n">{{ loaded ? countFor(f.key) : '' }}</span>
          </button>
        </div>
        <label class="ins-search en-search">
          <Search :size="15" aria-hidden="true" />
          <span class="ent-sr-only">Search orders</span>
          <input v-model="search" type="search" placeholder="Reference, stand, owner" />
        </label>
      </header>

      <div v-if="loading && !loaded" class="en-skel" aria-busy="true">
        <span v-for="n in 3" :key="n" class="ins-skel" />
      </div>
      <p v-else-if="loaded && !visible.length" class="en-empty">
        <ShieldAlert :size="20" aria-hidden="true" />
        {{ search ? `No orders match “${search}”.` : filter === 'open' ? 'No open enforcement orders.' : 'No orders in this view.' }}
      </p>

      <ul v-else class="en-list">
        <li v-for="o in visible" :key="o.id" class="en-order" :class="{ overdue: isOverdue(o) }">
          <div class="en-order-top">
            <span class="ins-mono en-ref">{{ o.order_reference }}</span>
            <span class="en-type">{{ human(o.order_type) }}</span>
            <UiStatusBadge :status="statusOf(o)" />
          </div>
          <p class="en-breach">{{ o.breach_description }}</p>
          <p v-if="o.required_action" class="en-req"><strong>Required:</strong> {{ o.required_action }}</p>
          <div class="en-meta">
            <span><MapPin :size="13" aria-hidden="true" /> Stand {{ o.stand_number }}<template v-if="o.suburb_ward"> · {{ o.suburb_ward }}</template></span>
            <span>{{ o.owner_name || o.subject_name }}<template v-if="o.owner_contact"> · {{ o.owner_contact }}</template></span>
            <span>Issued {{ fmt(o.issued_at) }}</span>
            <span class="en-deadline" :class="{ late: isOverdue(o) }"><Clock :size="13" aria-hidden="true" /> {{ deadlineText(o) }}</span>
          </div>
          <div v-if="officialEnforcementOpen(o.status)" class="en-actions">
            <UiButton size="sm" variant="primary" @click="startVisit(o)">
              <template #icon><ClipboardCheck :size="14" /></template>
              Record compliance visit
            </UiButton>
            <UiButton size="sm" @click="escalate(o)">
              <template #icon><Send :size="14" /></template>
              Escalate to EO Planner
            </UiButton>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="prohibitions.length" class="ins-card" aria-labelledby="en-pro-h">
      <header class="ins-card-head">
        <h3 id="en-pro-h"><Ban :size="16" aria-hidden="true" /> Section 34 prohibitions <span class="ins-count">{{ prohibitions.length }}</span></h3>
      </header>
      <ul class="ins-rows">
        <li v-for="p in prohibitions" :key="p.id" class="ins-row">
          <span class="ins-row-main">
            <span class="ins-row-title"><span class="ins-mono">{{ p.order_reference }}</span> · Stand {{ p.stand_number }}</span>
            <span class="ins-row-meta">{{ p.prohibited_activity }} · {{ p.reason }} · issued {{ fmt(p.issued_at) }}</span>
          </span>
          <UiStatusBadge :tone="p.lifted_at ? 'neutral' : 'negative'" :label="p.lifted_at ? `Lifted ${fmt(p.lifted_at)}` : 'In force'" />
        </li>
      </ul>
    </section>

    <UiSheet v-model:open="visitOpen" title="Compliance visit" :subtitle="visitFor ? `${visitFor.order_reference} · Stand ${visitFor.stand_number}` : undefined">
      <form v-if="visitFor" id="en-visit" class="en-form" @submit.prevent="saveVisit">
        <p class="ins-hint"><strong>Required:</strong> {{ visitFor.required_action || visitFor.breach_description }}</p>
        <label class="ins-field">
          <span class="ins-label">Date of visit</span>
          <input v-model="visit.date" class="ins-input" type="date" :max="todayIso" required />
        </label>
        <fieldset class="en-fieldset">
          <legend class="ins-label">Finding</legend>
          <div class="ins-seg" role="radiogroup" aria-label="Finding">
            <button type="button" role="radio" class="t-positive" :aria-checked="visit.complied === true" @click="visit.complied = true">
              <CheckCircle2 :size="15" aria-hidden="true" /> Complied
            </button>
            <button type="button" role="radio" class="t-negative" :aria-checked="visit.complied === false" @click="visit.complied = false">
              <XCircle :size="15" aria-hidden="true" /> Did not comply
            </button>
          </div>
        </fieldset>
        <label class="ins-field">
          <span class="ins-label">{{ visit.complied === false ? 'What you observed' : 'Notes (optional)' }}</span>
          <textarea v-model="visit.notes" class="ins-input" rows="4"
                    placeholder="e.g. Unauthorised extension still standing; work continued since the order was served."></textarea>
        </label>
        <p v-if="visit.complied === false" class="ins-hint">After saving, an escalation to the EO Planner opens pre-filled.</p>
      </form>
      <template #footer>
        <UiButton @click="visitFor = null">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="en-visit" :loading="saving">Record visit</UiButton>
      </template>
    </UiSheet>

    <UiSheet v-model:open="referralOpen" title="Escalate by referral" width="36rem"
             :subtitle="referral?.order ? referral.order.order_reference : 'Unauthorised or non-compliant work'">
      <InspectionReferralForm
        v-if="referral"
        :permit-id="referral.permitId ?? null"
        :stand="referral.stand"
        :initial-target="referral.target"
        :initial-reason="referral.reason"
        :disabled-reason="referral.permitId ? undefined : referral.order
          ? 'This order is not linked to a permit, so a referral cannot attach to a case file. Phone or message the EO Planner with the order reference.'
          : 'Open the permit for this stand first (Case file or Today), then report the work so it attaches to the right case.'"
        @created="referral = null"
      />
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.en-toolbar { align-items: flex-start; }
.en-search { width: min(18rem, 100%); margin-left: auto; }
.en-skel { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s4); }
.en-skel .ins-skel { height: 88px; }
.en-empty { display: flex; align-items: center; gap: var(--ent-s3); margin: 0; padding: var(--ent-s6) var(--ent-s4); color: var(--ent-text-2); font-size: var(--ent-fs-sm); }
.en-empty svg { color: var(--ent-text-3); }

.en-list { list-style: none; margin: 0; padding: 0; }
.en-order { padding: var(--ent-s4); border-top: 1px solid var(--ent-line); }
.en-order:first-child { border-top: 0; }
.en-order.overdue { box-shadow: inset 3px 0 0 var(--ent-danger); }
.en-order-top { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.en-ref { font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.en-type { font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); letter-spacing: 0.03em; text-transform: uppercase; color: var(--ent-text-2); margin-right: auto; }
.en-breach { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-base); color: var(--ent-text); line-height: var(--ent-lh); }
.en-req { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.en-req strong { color: var(--ent-text); font-weight: var(--ent-fw-semibold); }
.en-meta { display: flex; flex-wrap: wrap; gap: var(--ent-s1) var(--ent-s4); margin-top: var(--ent-s3); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.en-meta span { display: inline-flex; align-items: center; gap: var(--ent-s1); }
.en-deadline { font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.en-deadline.late { color: var(--ent-danger); }
.en-actions { display: flex; flex-wrap: wrap; gap: var(--ent-s2); margin-top: var(--ent-s3); }

.en-form { display: flex; flex-direction: column; gap: var(--ent-s4); }
.en-fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }

@media (max-width: 767px) {
  .en-search { width: 100%; margin-left: 0; }
  .en-actions > * { flex: 1; }
}
</style>
