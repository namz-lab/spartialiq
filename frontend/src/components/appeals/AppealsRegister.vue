<script setup lang="ts">
// Appeals register — RTCP Act [Ch. 29:12] s.38.
//
// One component, two consoles: the EO planner works appeals here and so does
// the planning clerk, because it is one register and one set of rules. What
// differs between the desks is which sections surround it, not what an appeal
// is.
//
// What the register has to answer, in this order:
//   1. what is outstanding, and is a hearing coming
//   2. was this appeal lodged inside the one-month window (s.38(1)(a); the server computes it
//      from the determination date — never the browser's clock)
//   3. what were the grounds, and what did the Court hold
//
// Lodging is here too. Appeals arrive at the counter on paper at least as often
// as through the portal, and a register that cannot record those is a second
// register kept in a book.

import { computed, ref } from 'vue'
import {
  dmApi,
  type Appeal, type AppealStatus, type AppealDecision, type AppellantType,
  type PermitApplication,
} from '@/services/developmentManagementService'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { fmtDate, isoDay } from '@/utils/dates'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import {
  Scale, RefreshCw, Search, Gavel, CalendarClock, Plus, Loader2,
  AlertTriangle, CheckCircle2, FileText, X,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const fb = useUiFeedback()
const { isMobile } = useBreakpoint()

// ── Vocabulary ────────────────────────────────────────────────────────
type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const STATUS_META: Record<AppealStatus, { label: string; tone: Tone }> = {
  lodged:            { label: 'Lodged',            tone: 'info' },
  acknowledged:      { label: 'Acknowledged',      tone: 'info' },
  hearing_scheduled: { label: 'Hearing scheduled', tone: 'warning' },
  decided:           { label: 'Decided',           tone: 'positive' },
  withdrawn:         { label: 'Withdrawn',         tone: 'neutral' },
}
const STATUSES = Object.keys(STATUS_META) as AppealStatus[]

const DECISION_META: Record<AppealDecision, { label: string; detail: string }> = {
  upheld:    { label: 'Upheld',    detail: 'The appeal succeeds; the determination is set aside.' },
  dismissed: { label: 'Dismissed', detail: 'The appeal fails; the determination stands.' },
  remitted:  { label: 'Remitted',  detail: 'Returned to Council for re-determination.' },
}
const DECISIONS = Object.keys(DECISION_META) as AppealDecision[]

const APPELLANT_TYPES: { value: AppellantType; label: string }[] = [
  { value: 'applicant',   label: 'The applicant' },
  { value: 'objector',    label: 'An objector' },
  { value: 'third_party', label: 'A third party' },
]

// ── Register ──────────────────────────────────────────────────────────
const appeals = ref<Appeal[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    appeals.value = await dmApi.listAppeals()
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Could not load the appeals register.')
  } finally {
    loading.value = false
  }
}
// The register is read against the clock — a hearing set for tomorrow matters
// today — so it re-reads when the section is returned to, not once a session.
const { refreshNow } = useStaleRefresh(refresh)

const search = ref('')
const statusFilter = ref<'' | AppealStatus>('')
const openOnly = ref(false)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return appeals.value.filter(a => {
    if (statusFilter.value && a.status !== statusFilter.value) return false
    if (openOnly.value && (a.status === 'decided' || a.status === 'withdrawn')) return false
    if (!q) return true
    return [a.dev_register_no, a.tpd_reference, a.stand_number, a.applicant_name,
      a.appellant_name, a.grounds, a.suburb_ward]
      .some(v => (v ?? '').toLowerCase().includes(q))
  })
})

const counts = computed(() => ({
  open: appeals.value.filter(a => a.status !== 'decided' && a.status !== 'withdrawn').length,
  hearings: appeals.value.filter(a => a.status === 'hearing_scheduled').length,
  decided: appeals.value.filter(a => a.status === 'decided').length,
  late: appeals.value.filter(a => a.within_window === false).length,
}))

// ── Selection ─────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const selected = computed(() => appeals.value.find(a => a.id === selectedId.value) ?? null)

// Progress form, seeded from the appeal it belongs to so the officer edits
// what is on file rather than an empty form beside it.
const form = ref<{ status: AppealStatus; hearing_date: string; decision: '' | AppealDecision; notes: string }>({
  status: 'acknowledged', hearing_date: '', decision: '', notes: '',
})

function select(a: Appeal) {
  selectedId.value = a.id
  form.value = {
    status: a.status,
    hearing_date: a.hearing_date ? String(a.hearing_date).slice(0, 10) : '',
    decision: a.decision ?? '',
    notes: a.decision_notes ?? '',
  }
}

const saving = ref(false)

async function saveProgress() {
  const a = selected.value
  if (!a) return
  if (form.value.status === 'hearing_scheduled' && !form.value.hearing_date) {
    fb.showToast('Set the hearing date before marking a hearing as scheduled.', 'warning')
    return
  }
  if (form.value.status === 'decided' && !form.value.decision) {
    fb.showToast('Record what the Court held before marking the appeal decided.', 'warning')
    return
  }
  saving.value = true
  try {
    const updated = await dmApi.updateAppealStatus(a.id, {
      status: form.value.status,
      hearing_date: form.value.hearing_date || null,
      decision: form.value.decision || null,
      notes: form.value.notes.trim() || null,
    })
    const i = appeals.value.findIndex(x => x.id === a.id)
    if (i >= 0) appeals.value[i] = updated
    select(updated)
    fb.showToast(
      updated.status === 'decided'
        ? `Appeal ${DECISION_META[updated.decision as AppealDecision].label.toLowerCase()} — recorded.`
        : `Appeal marked ${STATUS_META[updated.status].label.toLowerCase()}.`,
      'success',
    )
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not save the appeal.'), 'error')
  } finally {
    saving.value = false
  }
}

// ── Lodging (counter intake) ──────────────────────────────────────────
const lodgeOpen = ref(false)
const lodging = ref(false)
const caseSearch = ref('')
const determinedCases = ref<PermitApplication[]>([])
const casesLoading = ref(false)

const lodgeForm = ref({
  permit_application_id: '',
  appellant_type: 'applicant' as AppellantType,
  appellant_name: '',
  appellant_address: '',
  lodged_at: isoDay(),
  grounds: '',
  document_url: '',
})

/**
 * Only a determined application can be appealed, so the picker offers only
 * those — three status queries rather than the whole register, because the
 * list endpoint filters on one status at a time.
 */
async function loadDeterminedCases() {
  casesLoading.value = true
  try {
    const pages = await Promise.all(
      (['approved', 'approved_with_conditions', 'refused'] as const).map(status =>
        dmApi.listPermits({ status, limit: 200, offset: 0 }).then(r => r.data).catch(() => [])),
    )
    determinedCases.value = pages.flat()
      .sort((a, b) => (b.decision_at ?? b.updated_at).localeCompare(a.decision_at ?? a.updated_at))
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load determined applications.'), 'error')
  } finally {
    casesLoading.value = false
  }
}

function openLodge() {
  lodgeOpen.value = true
  if (!determinedCases.value.length) void loadDeterminedCases()
}

const caseOptions = computed(() => {
  const q = caseSearch.value.trim().toLowerCase()
  const list = q
    ? determinedCases.value.filter(p =>
        [p.dev_register_no, p.tpd_reference, p.stand_number, p.applicant_name, p.suburb_ward]
          .some(v => (v ?? '').toLowerCase().includes(q)))
    : determinedCases.value
  return list.slice(0, 40)
})

function caseLabel(p: PermitApplication): string {
  return [
    p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase(),
    p.stand_number ? `Stand ${p.stand_number}` : null,
    p.applicant_name,
  ].filter(Boolean).join(' · ')
}

async function lodge() {
  const f = lodgeForm.value
  if (!f.permit_application_id) {
    fb.showToast('Choose the determined application being appealed.', 'warning')
    return
  }
  if (f.grounds.trim().length < 20) {
    fb.showToast('State the grounds of appeal — at least a sentence.', 'warning')
    return
  }
  if (!f.appellant_name.trim()) {
    fb.showToast('Record who is appealing.', 'warning')
    return
  }
  lodging.value = true
  try {
    const created = await dmApi.createAppeal(f.permit_application_id, {
      grounds: f.grounds.trim(),
      appellant_name: f.appellant_name.trim(),
      appellant_type: f.appellant_type,
      appellant_address: f.appellant_address.trim() || null,
      lodged_at: f.lodged_at || null,
      document_url: f.document_url.trim() || null,
    })
    appeals.value = [created, ...appeals.value]
    select(created)
    lodgeOpen.value = false
    lodgeForm.value = {
      permit_application_id: '', appellant_type: 'applicant', appellant_name: '',
      appellant_address: '', lodged_at: isoDay(), grounds: '', document_url: '',
    }
    fb.showToast(
      created.within_window === false
        ? `Appeal recorded — lodged ${created.days_after_decision} days after the determination, outside the one-month window.`
        : 'Appeal recorded; the application is now shown as under appeal.',
      created.within_window === false ? 'warning' : 'success',
    )
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not lodge the appeal.'), 'error')
  } finally {
    lodging.value = false
  }
}

// ── Display helpers ───────────────────────────────────────────────────
function appealRef(a: Appeal): string {
  return `AP-${new Date(a.lodged_at).getFullYear()}-${a.id.slice(0, 4).toUpperCase()}`
}
function caseRef(a: Appeal): string {
  return a.dev_register_no || a.tpd_reference || a.permit_application_id.slice(0, 8).toUpperCase()
}
function windowLabel(a: Appeal): string | null {
  if (a.days_after_decision == null) return null
  return a.within_window
    ? `In time · ${a.days_after_decision} d after determination`
    : `Out of time · ${a.days_after_decision} d after determination`
}
</script>

<template>
  <div class="ins-page ap">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">RTCP Act [Ch. 29:12] s.38</span>
        <h2 class="ins-title"><Scale :size="18" aria-hidden="true" /> Appeals register</h2>
        <p class="ins-lede">
          Appeals to the Administrative Court against a determination. The one-month window (s.38) is
          measured from the determination date on the application, not from when the appeal
          reached this desk.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ap-btn primary" @click="openLodge">
          <Plus :size="14" aria-hidden="true" /> Record an appeal
        </button>
        <button type="button" class="ins-iconbtn" :disabled="loading"
                title="Reload the register" @click="refreshNow">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': loading }" />
          <span class="ent-sr-only">Reload the register</span>
        </button>
      </div>
    </header>

    <div v-if="loadError" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>The register could not be read.</strong>
        <p>{{ loadError }}</p>
      </div>
      <button type="button" class="ap-btn" @click="refreshNow">Try again</button>
    </div>

    <div class="ins-kpis">
      <div class="ap-kpi"><span class="ap-kpi-n">{{ counts.open }}</span><span class="ap-kpi-l">Outstanding</span></div>
      <div class="ap-kpi"><span class="ap-kpi-n">{{ counts.hearings }}</span><span class="ap-kpi-l">Hearings set</span></div>
      <div class="ap-kpi"><span class="ap-kpi-n">{{ counts.decided }}</span><span class="ap-kpi-l">Decided</span></div>
      <div class="ap-kpi" :class="{ warn: counts.late > 0 }">
        <span class="ap-kpi-n">{{ counts.late }}</span><span class="ap-kpi-l">Lodged out of time</span>
      </div>
    </div>

    <div class="ap-tools">
      <label class="ins-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search the appeals register</span>
        <input v-model="search" type="search"
               placeholder="Appellant, register number, stand or grounds" />
      </label>
      <div class="ins-chips" role="group" aria-label="Filter by status">
        <button type="button" class="ins-chip" :aria-pressed="statusFilter === ''"
                @click="statusFilter = ''">All</button>
        <button v-for="s in STATUSES" :key="s" type="button" class="ins-chip"
                :aria-pressed="statusFilter === s" @click="statusFilter = s">
          {{ STATUS_META[s].label }}
        </button>
      </div>
      <label class="ap-check">
        <input v-model="openOnly" type="checkbox" />
        <span>Outstanding only</span>
      </label>
    </div>

    <div class="ins-split">
      <!-- Queue -->
      <section class="ins-card">
        <header class="ins-card-head">
          <h3>Appeals</h3>
          <span class="ins-count">{{ filtered.length }} of {{ appeals.length }}</span>
        </header>

        <p v-if="loading && !appeals.length" class="ap-msg">Reading the register…</p>
        <p v-else-if="!appeals.length" class="ap-msg">
          No appeals have been lodged. An appeal can only be lodged against an application that
          has been determined.
        </p>
        <p v-else-if="!filtered.length" class="ap-msg">Nothing matches this filter.</p>

        <ul v-else class="ins-rows ap-list">
          <li v-for="a in filtered" :key="a.id">
            <button type="button" class="ins-row ap-row"
                    :class="{ on: a.id === selectedId }"
                    :aria-current="a.id === selectedId ? 'true' : undefined"
                    @click="select(a)">
              <span class="ins-row-main">
                <span class="ins-row-title">
                  <span class="ins-mono">{{ appealRef(a) }}</span> · {{ a.appellant_name }}
                </span>
                <span class="ins-row-meta">
                  Application <span class="ins-mono">{{ caseRef(a) }}</span>
                  <template v-if="a.stand_number"> · Stand {{ a.stand_number }}</template>
                  · lodged {{ fmtDate(a.lodged_at) }}
                </span>
              </span>
              <span class="ap-row-tags">
                <span class="ap-pill" :class="`t-${STATUS_META[a.status].tone}`">
                  {{ STATUS_META[a.status].label }}
                </span>
                <span v-if="a.within_window === false" class="ap-pill t-negative">Out of time</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <!-- Detail: inline beside the queue on a desk, a sheet on a phone -->
      <section v-if="!isMobile" class="ins-card ins-sticky">
        <template v-if="selected">
          <header class="ins-card-head">
            <h3><Gavel :size="15" aria-hidden="true" /> {{ appealRef(selected) }}</h3>
            <span class="ap-pill" :class="`t-${STATUS_META[selected.status].tone}`">
              {{ STATUS_META[selected.status].label }}
            </span>
          </header>
          <div class="ins-card-body">
            <div class="ap-detail">
                <dl class="ins-dl">
                  <div><dt>Application</dt><dd class="ins-mono">{{ caseRef(selected) }}</dd></div>
                  <div><dt>Applicant</dt><dd>{{ selected.applicant_name || '—' }}</dd></div>
                  <div><dt>Stand</dt><dd>{{ selected.stand_number || '—' }}</dd></div>
                  <div><dt>Appellant</dt>
                    <dd>{{ selected.appellant_name }}
                      <small>({{ APPELLANT_TYPES.find(t => t.value === selected!.appellant_type)?.label }})</small>
                    </dd></div>
                  <div><dt>Determined</dt><dd>{{ fmtDate(selected.permit_decided_at) }}</dd></div>
                  <div><dt>Lodged</dt><dd>{{ fmtDate(selected.lodged_at) }}</dd></div>
                  <div v-if="selected.hearing_date"><dt>Hearing</dt><dd>{{ fmtDate(selected.hearing_date) }}</dd></div>
                  <div v-if="selected.appellant_address"><dt>Address</dt><dd>{{ selected.appellant_address }}</dd></div>
                </dl>

                <p v-if="windowLabel(selected)" class="ins-banner"
                   :class="selected.within_window ? 't-positive' : 't-warning'">
                  <component :is="selected.within_window ? CheckCircle2 : AlertTriangle" :size="15" aria-hidden="true" />
                  <span>
                    <strong>{{ windowLabel(selected) }}</strong>
                    <template v-if="!selected.within_window">
                      — admissibility is the Court's to decide; the fact is recorded here.
                    </template>
                  </span>
                </p>

                <div class="ap-grounds">
                  <span class="ins-label">Grounds of appeal</span>
                  <p>{{ selected.grounds }}</p>
                  <a v-if="selected.document_url" class="ap-doc" :href="selected.document_url"
                     target="_blank" rel="noopener">
                    <FileText :size="13" aria-hidden="true" /> Lodged document
                  </a>
                </div>

                <form class="ap-form" @submit.prevent="saveProgress">
                  <span class="ins-label">Council record</span>
                  <div class="ins-form">
                    <label class="ins-field">
                      <span class="ins-label">Status</span>
                      <select v-model="form.status" class="ins-input">
                        <option v-for="s in STATUSES" :key="s" :value="s">{{ STATUS_META[s].label }}</option>
                      </select>
                    </label>
                    <label class="ins-field">
                      <span class="ins-label">Hearing date</span>
                      <input v-model="form.hearing_date" type="date" class="ins-input" />
                    </label>
                    <label v-if="form.status === 'decided'" class="ins-field">
                      <span class="ins-label">What the Court held</span>
                      <select v-model="form.decision" class="ins-input">
                        <option value="">— select —</option>
                        <option v-for="d in DECISIONS" :key="d" :value="d">{{ DECISION_META[d].label }}</option>
                      </select>
                    </label>
                    <label class="ins-field full">
                      <span class="ins-label">Notes</span>
                      <textarea v-model="form.notes" rows="3" class="ins-input"
                                placeholder="Directions, hearing outcome, reasons…"></textarea>
                    </label>
                  </div>
                  <p v-if="form.status === 'decided' && form.decision" class="ins-hint">
                    {{ DECISION_META[form.decision].detail }}
                  </p>
                  <div class="ap-form-actions">
                    <button type="submit" class="ap-btn primary" :disabled="saving">
                      <component :is="saving ? Loader2 : CheckCircle2" :size="14" aria-hidden="true"
                                 :class="{ 'ins-spin': saving }" />
                      {{ saving ? 'Saving…' : 'Save' }}
                    </button>
                  </div>
                </form>
            </div>
          </div>
        </template>
        <div v-else class="ap-empty">
          <Gavel :size="22" aria-hidden="true" />
          <p>Select an appeal to read its grounds and record what the Court held.</p>
        </div>
      </section>
    </div>

    <!-- Mobile detail -->
    <UiSheet v-if="isMobile" :open="!!selected" :title="selected ? appealRef(selected) : 'Appeal'"
             :subtitle="selected ? selected.appellant_name : undefined" tall
             @close="selectedId = null" @update:open="v => { if (!v) selectedId = null }">
      <div v-if="selected" class="ap-detail">
        <dl class="ins-dl">
          <div><dt>Application</dt><dd class="ins-mono">{{ caseRef(selected) }}</dd></div>
          <div><dt>Stand</dt><dd>{{ selected.stand_number || '—' }}</dd></div>
          <div><dt>Determined</dt><dd>{{ fmtDate(selected.permit_decided_at) }}</dd></div>
          <div><dt>Lodged</dt><dd>{{ fmtDate(selected.lodged_at) }}</dd></div>
          <div v-if="selected.hearing_date"><dt>Hearing</dt><dd>{{ fmtDate(selected.hearing_date) }}</dd></div>
        </dl>
        <p v-if="windowLabel(selected)" class="ins-banner"
           :class="selected.within_window ? 't-positive' : 't-warning'">
          <component :is="selected.within_window ? CheckCircle2 : AlertTriangle" :size="15" aria-hidden="true" />
          <span><strong>{{ windowLabel(selected) }}</strong></span>
        </p>
        <div class="ap-grounds">
          <span class="ins-label">Grounds of appeal</span>
          <p>{{ selected.grounds }}</p>
        </div>
        <form class="ap-form" @submit.prevent="saveProgress">
          <div class="ins-form">
            <label class="ins-field">
              <span class="ins-label">Status</span>
              <select v-model="form.status" class="ins-input">
                <option v-for="s in STATUSES" :key="s" :value="s">{{ STATUS_META[s].label }}</option>
              </select>
            </label>
            <label class="ins-field">
              <span class="ins-label">Hearing date</span>
              <input v-model="form.hearing_date" type="date" class="ins-input" />
            </label>
            <label v-if="form.status === 'decided'" class="ins-field full">
              <span class="ins-label">What the Court held</span>
              <select v-model="form.decision" class="ins-input">
                <option value="">— select —</option>
                <option v-for="d in DECISIONS" :key="d" :value="d">{{ DECISION_META[d].label }}</option>
              </select>
            </label>
            <label class="ins-field full">
              <span class="ins-label">Notes</span>
              <textarea v-model="form.notes" rows="3" class="ins-input"></textarea>
            </label>
          </div>
          <button type="submit" class="ap-btn primary" :disabled="saving">
            <component :is="saving ? Loader2 : CheckCircle2" :size="14" aria-hidden="true"
                       :class="{ 'ins-spin': saving }" />
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </form>
      </div>
    </UiSheet>

    <!-- Lodge -->
    <UiSheet :open="lodgeOpen" title="Record an appeal"
             subtitle="Against a determined application" width="38rem"
             @close="lodgeOpen = false" @update:open="lodgeOpen = $event">
      <form class="ap-lodge" @submit.prevent="lodge">
        <label class="ins-field full">
          <span class="ins-label">Determined application</span>
          <label class="ins-search">
            <Search :size="14" aria-hidden="true" />
            <span class="ent-sr-only">Search determined applications</span>
            <input v-model="caseSearch" type="search" placeholder="Register number, stand or applicant" />
          </label>
          <select v-model="lodgeForm.permit_application_id" class="ins-input" size="6">
            <option value="">— select the application —</option>
            <option v-for="p in caseOptions" :key="p.id" :value="p.id">{{ caseLabel(p) }}</option>
          </select>
          <p class="ins-hint">
            <template v-if="casesLoading">Loading determined applications…</template>
            <template v-else-if="!determinedCases.length">
              No application has been determined yet, so there is nothing to appeal against.
            </template>
            <template v-else>
              Only approved, conditionally approved and refused applications appear here.
            </template>
          </p>
        </label>

        <div class="ins-form">
          <label class="ins-field">
            <span class="ins-label">Who is appealing</span>
            <select v-model="lodgeForm.appellant_type" class="ins-input">
              <option v-for="t in APPELLANT_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </label>
          <label class="ins-field">
            <span class="ins-label">Appellant name</span>
            <input v-model="lodgeForm.appellant_name" class="ins-input" placeholder="As written on the notice" />
          </label>
          <label class="ins-field">
            <span class="ins-label">Date lodged</span>
            <input v-model="lodgeForm.lodged_at" type="date" class="ins-input" :max="isoDay()" />
          </label>
          <label class="ins-field">
            <span class="ins-label">Address for service</span>
            <input v-model="lodgeForm.appellant_address" class="ins-input" placeholder="Optional" />
          </label>
          <label class="ins-field full">
            <span class="ins-label">Grounds of appeal</span>
            <textarea v-model="lodgeForm.grounds" rows="5" class="ins-input"
                      placeholder="As stated in the notice of appeal."></textarea>
          </label>
          <label class="ins-field full">
            <span class="ins-label">Lodged document (link)</span>
            <input v-model="lodgeForm.document_url" class="ins-input" placeholder="Optional — scan of the notice" />
          </label>
        </div>

        <div class="ap-form-actions">
          <button type="button" class="ap-btn" @click="lodgeOpen = false">
            <X :size="14" aria-hidden="true" /> Cancel
          </button>
          <button type="submit" class="ap-btn primary" :disabled="lodging">
            <component :is="lodging ? Loader2 : CalendarClock" :size="14" aria-hidden="true"
                       :class="{ 'ins-spin': lodging }" />
            {{ lodging ? 'Recording…' : 'Record appeal' }}
          </button>
        </div>
      </form>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ap-kpi { display:flex; flex-direction:column; gap:2px; padding:var(--ent-s3) var(--ent-s4);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.ap-kpi.warn { border-color:var(--ent-tone-warning-line); background:var(--ent-tone-warning-bg); }
.ap-kpi-n { font-size:var(--ent-fs-num); font-weight:var(--ent-fw-bold); line-height:1.1;
  font-variant-numeric:tabular-nums; color:var(--ent-text); }
.ap-kpi-l { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.ap-tools { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.ap-check { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.ap-check input { width:16px; height:16px; accent-color:var(--ent-accent); }

.ap-list { max-height:min(60vh, 34rem); overflow-y:auto; }
.ap-row { width:100%; background:none; border:0; text-align:left; cursor:pointer;
  font-family:var(--ent-font); }
.ap-row:hover { background:var(--ent-surface-2); }
.ap-row:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ap-row.on { background:var(--ent-accent-soft); }
.ap-row-tags { display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0; }

.ap-pill { display:inline-block; padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); white-space:nowrap;
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg);
  border:1px solid var(--ent-tone-neutral-line); }
.ap-pill.t-info { background:var(--ent-tone-info-bg); color:var(--ent-tone-info-fg); border-color:var(--ent-tone-info-line); }
.ap-pill.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); border-color:var(--ent-tone-positive-line); }
.ap-pill.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); border-color:var(--ent-tone-warning-line); }
.ap-pill.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); border-color:var(--ent-tone-negative-line); }

.ap-detail { display:flex; flex-direction:column; gap:var(--ent-s4); }
.ap-grounds p { margin:var(--ent-s1) 0 0; font-size:var(--ent-fs-sm); color:var(--ent-text-2);
  line-height:var(--ent-lh); white-space:pre-wrap; }
.ap-doc { display:inline-flex; align-items:center; gap:var(--ent-s1); margin-top:var(--ent-s2);
  font-size:var(--ent-fs-xs); color:var(--ent-accent); }

.ap-form { display:flex; flex-direction:column; gap:var(--ent-s3);
  padding-top:var(--ent-s4); border-top:1px solid var(--ent-line); }
.ap-form-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); }
.ap-lodge { display:flex; flex-direction:column; gap:var(--ent-s4); }

.ap-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.ap-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.ap-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ap-btn:disabled { opacity:0.6; cursor:not-allowed; }
.ap-btn.primary { background:var(--ent-accent); border-color:var(--ent-accent);
  color:var(--ent-text-on-accent); }
.ap-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.ap-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.ap-empty { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:var(--ent-s3); padding:var(--ent-s8) var(--ent-s4); color:var(--ent-text-3);
  text-align:center; font-size:var(--ent-fs-sm); }

@media (max-width: 1023px) {
  .ins-split { grid-template-columns: minmax(0, 1fr); }
  .ins-split > .ins-sticky { position:static; }
}
</style>
