<script setup lang="ts">
// Public reports — the half of the inspector's inbox that does not begin with
// an application.
//
// A permit case arrives with a stand, an owner, a plan and a queue position. A
// complaint arrives as a neighbour at the counter saying "they are building
// over my boundary", often with no stand number and no name they are willing
// to give. It still has to be written down, sent to somebody, visited, and
// answered — and it has to show up in the monthly return, because until now
// this work was in a paper daybook and therefore invisible.
//
// Three acts, in the order they happen:
//   Take a report   — anyone at the counter. Anonymity is honoured at intake.
//   Triage          — severity, who goes, and which permit it is really about.
//   Record a finding— substantiated or not, and what was seen. Inspector only.
//
// Escalation is deliberately NOT a fourth act here. A substantiated report
// becomes an enforcement order, which already has its own desk, its own
// statutory vocabulary and its own compliance clock; duplicating a thin
// version of it here would give an inspector two places to look for the same
// order. The button hands over to Enforcement instead.
import { computed, ref } from 'vue'
import {
  Megaphone, RefreshCw, AlertTriangle, Search, Plus, MapPin, Clock,
  CheckCircle2, XCircle, ShieldAlert, UserX, Phone, FileText, Siren,
} from 'lucide-vue-next'
import {
  complaintsApi, isComplaintOpen,
  COMPLAINT_CATEGORY_LABELS, COMPLAINT_SEVERITY_LABELS, COMPLAINT_STATUS_LABELS,
  type BuildingComplaint, type ComplaintCategory, type ComplaintSeverity,
  type ComplaintSummary, type ComplaintIntake,
} from '@/services/buildingComplaints'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useInspectorWorkload } from '@/composables/useInspectorWorkload'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiKpi from '@/components/ui/UiKpi.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'

const emit = defineEmits<{ 'open-section': [key: 'enforcement'] }>()

const fb = useUiFeedback()
const { refreshWorkload } = useInspectorWorkload()
const ic = useInspectionCase()

const rows = ref<BuildingComplaint[]>([])
const summary = ref<ComplaintSummary>({ open: 0, emergency: 0, awaiting_visit: 0, total: 0 })
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)

type Filter = 'open' | 'emergency' | 'awaiting' | 'all'
const filter = ref<Filter>('open')
const search = ref('')

async function refresh() {
  loading.value = true
  error.value = null
  try {
    // The filter is a server query, so the count on a tile always matches the
    // list beneath it — the same rule the queue on Today follows.
    const res = await complaintsApi.list({
      open: filter.value === 'open' || filter.value === 'emergency' || filter.value === 'awaiting' ? true : undefined,
      severity: filter.value === 'emergency' ? 'emergency' : undefined,
      search: search.value.trim() || undefined,
      limit: 100,
    })
    rows.value = filter.value === 'awaiting'
      ? res.data.filter(c => c.status === 'received' || c.status === 'assigned')
      : res.data
    summary.value = res.summary
    loaded.value = true
  } catch (err: unknown) {
    // Never an empty register: "no complaints" is the one wrong answer here,
    // because it reads as an inspector with nothing outstanding.
    error.value = fb.parseApiError(err, 'The public reports register could not be loaded.')
  } finally {
    loading.value = false
    // Keep the rail's count in step with this page: without it, a report
    // recorded here showed "1 open" on the page beside a rail with no badge.
    void refreshWorkload()
  }
}

const { refreshNow } = useStaleRefresh(refresh)

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void refresh(), 300)
}

function setFilter(f: Filter) {
  if (filter.value === f) return
  filter.value = f
  void refresh()
}

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'emergency', label: 'Emergency' },
  { key: 'awaiting', label: 'Awaiting a visit' },
  { key: 'all', label: 'All' },
]

// ── Intake ──────────────────────────────────────────────────────────────
const intakeOpen = ref(false)
const saving = ref(false)
const blank = (): ComplaintIntake => ({
  category: 'building_without_permit',
  severity: 'routine',
  description: '',
  stand_number: '',
  suburb_ward: '',
  location_note: '',
  reporter_name: '',
  reporter_phone: '',
  anonymous: false,
})
const intake = ref<ComplaintIntake>(blank())

/** Somebody must be able to find the place, or nobody can be sent. */
const hasLocation = computed(() =>
  !!(intake.value.stand_number?.trim() || intake.value.suburb_ward?.trim() || intake.value.location_note?.trim()))
const canSubmit = computed(() => intake.value.description.trim().length >= 10 && hasLocation.value)

function openIntake() {
  intake.value = blank()
  intakeOpen.value = true
}

async function submitIntake() {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  try {
    const created = await complaintsApi.create({
      ...intake.value,
      // An anonymous report carries no contact details, whatever is still
      // sitting in the form fields when the box is ticked.
      reporter_name: intake.value.anonymous ? null : (intake.value.reporter_name?.trim() || null),
      reporter_phone: intake.value.anonymous ? null : (intake.value.reporter_phone?.trim() || null),
      stand_number: intake.value.stand_number?.trim() || null,
      suburb_ward: intake.value.suburb_ward?.trim() || null,
      location_note: intake.value.location_note?.trim() || null,
    })
    intakeOpen.value = false
    fb.showToast(`Report ${created.reference} recorded. Give the reporter that reference.`, 'success')
    await refreshNow()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The report was not recorded. Nothing has been saved.'), 'error')
  } finally {
    saving.value = false
  }
}

// ── One report: triage and finding ──────────────────────────────────────
const openRow = ref<BuildingComplaint | null>(null)
const finding = ref('')
const busy = ref(false)

function inspect(c: BuildingComplaint) {
  openRow.value = c
  finding.value = c.finding || ''
}
const rowOpen = computed({
  get: () => openRow.value !== null,
  set: (v) => { if (!v) openRow.value = null },
})

async function setSeverity(severity: ComplaintSeverity) {
  const c = openRow.value
  if (!c || busy.value || c.severity === severity) return
  busy.value = true
  try {
    openRow.value = await complaintsApi.triage(c.id, { severity })
    await refreshNow()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The severity was not changed.'), 'error')
  } finally {
    busy.value = false
  }
}

async function recordFinding(outcome: 'substantiated' | 'unsubstantiated') {
  const c = openRow.value
  if (!c || busy.value) return
  if (finding.value.trim().length < 20) {
    fb.showToast('Describe what you found in at least 20 characters — this is the council\'s answer to the reporter.', 'warning')
    return
  }
  busy.value = true
  try {
    openRow.value = await complaintsApi.recordFinding(c.id, outcome, finding.value.trim())
    fb.showToast(
      outcome === 'substantiated'
        ? 'Finding recorded. Raise an enforcement order from the Enforcement desk.'
        : 'Finding recorded and the report answered.',
      'success',
    )
    await refreshNow()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The finding was not recorded.'), 'error')
  } finally {
    busy.value = false
  }
}

async function closeReport() {
  const c = openRow.value
  if (!c || busy.value) return
  const ok = await fb.confirmAction(
    `Close ${c.reference}?`,
    'The report is answered and needs no site visit. It stays on the register and in the monthly return, and cannot be reopened from here.',
    { confirmLabel: 'Close report' },
  )
  if (!ok) return
  busy.value = true
  try {
    openRow.value = await complaintsApi.close(c.id, finding.value.trim() || undefined)
    await refreshNow()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The report was not closed.'), 'error')
  } finally {
    busy.value = false
  }
}

/** Open the permit this report is about, so the rest of the console follows it. */
async function openCase(c: BuildingComplaint) {
  if (!c.permit_app_id) return
  try {
    await ic.loadPermit(c.permit_app_id)
    fb.showToast('Case opened. The console now follows this permit.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'That permit could not be opened.'), 'error')
  }
}

// ── Presentation ────────────────────────────────────────────────────────
const SEVERITY_TONE: Record<ComplaintSeverity, 'negative' | 'warning' | 'neutral'> = {
  emergency: 'negative', urgent: 'warning', routine: 'neutral',
}

function statusTone(c: BuildingComplaint): 'positive' | 'negative' | 'warning' | 'info' | 'neutral' {
  if (c.status === 'substantiated') return 'negative'     // the complaint was right
  if (c.status === 'unsubstantiated') return 'positive'   // nothing wrong on site
  if (c.status === 'closed') return 'neutral'
  if (c.status === 'inspected') return 'info'
  return 'warning'                                        // still owed a visit
}

function where(c: BuildingComplaint): string {
  const parts = [
    c.stand_number ? `Stand ${c.stand_number}` : null,
    c.suburb_ward,
    c.location_note,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Location not recorded'
}

/** How long the council has been sitting on an unanswered report. */
function waiting(c: BuildingComplaint): string {
  const days = Math.floor((Date.now() - new Date(c.received_at).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) return ''
  if (days <= 0) return 'received today'
  return `${days} day${days === 1 ? '' : 's'} since received`
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const CATEGORY_OPTIONS = Object.entries(COMPLAINT_CATEGORY_LABELS) as Array<[ComplaintCategory, string]>
const SEVERITY_OPTIONS = Object.entries(COMPLAINT_SEVERITY_LABELS) as Array<[ComplaintSeverity, string]>
</script>

<template>
  <div class="ins-page bc">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Compliance</span>
        <h2 class="ins-title">Public reports</h2>
        <p class="ins-lede">
          Reports of unauthorised or dangerous building work, from the counter, the telephone
          and the ward. Each one is answered on the record, whether or not it turns out to be founded.
        </p>
      </div>
      <div class="ins-actions">
        <button class="ins-iconbtn" type="button" :disabled="loading"
                :aria-label="loading ? 'Refreshing reports' : 'Refresh reports'" @click="refreshNow">
          <RefreshCw :size="15" :class="{ 'ins-spin': loading }" aria-hidden="true" />
        </button>
        <UiButton variant="primary" @click="openIntake">
          <template #icon><Plus :size="15" aria-hidden="true" /></template>
          Take a report
        </UiButton>
      </div>
    </header>

    <div class="ins-kpis">
      <UiKpi :value="summary.open" label="Open reports"
             :tone="summary.open ? 'warning' : 'neutral'" />
      <UiKpi :value="summary.emergency" label="Emergency"
             :tone="summary.emergency ? 'negative' : 'neutral'" />
      <UiKpi :value="summary.awaiting_visit" label="Awaiting a visit"
             :tone="summary.awaiting_visit ? 'info' : 'neutral'" />
      <UiKpi :value="summary.total" label="On the register" />
    </div>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>The register could not be read.</strong>
        <p>{{ error }} This is not an empty register — do not treat it as no outstanding work.</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refreshNow">Retry</UiButton>
    </div>

    <div class="bc-controls">
      <div class="ins-chips" role="group" aria-label="Filter reports">
        <button v-for="f in FILTERS" :key="f.key" type="button" class="ins-chip"
                :aria-pressed="filter === f.key" @click="setFilter(f.key)">{{ f.label }}</button>
      </div>
      <label class="ins-search">
        <Search :size="15" aria-hidden="true" />
        <input v-model="search" type="search" placeholder="Reference, stand, ward or words in the report"
               aria-label="Search public reports" @input="onSearch" />
      </label>
    </div>

    <section class="ins-card" aria-labelledby="bc-list-h">
      <header class="ins-card-head">
        <h3 id="bc-list-h">
          <Megaphone :size="16" aria-hidden="true" /> Register
          <span class="ins-count">{{ rows.length }}</span>
        </h3>
      </header>

      <div v-if="loading && !loaded" class="ins-card-body bc-skeleton" aria-hidden="true">
        <span v-for="n in 4" :key="n" class="ins-skel" :style="{ width: `${90 - n * 8}%` }" />
      </div>

      <div v-else-if="!rows.length && !error" class="ins-card-body bc-empty">
        <Megaphone :size="26" aria-hidden="true" />
        <h4>{{ filter === 'all' ? 'No reports on the register' : 'Nothing outstanding under this filter' }}</h4>
        <p>
          {{ filter === 'all'
            ? 'When someone reports building work at the counter or by telephone, record it here so it reaches an inspector and appears in the monthly return.'
            : 'Widen the filter to All to see answered and closed reports.' }}
        </p>
      </div>

      <ul v-else class="ins-rows">
        <li v-for="c in rows" :key="c.id" class="ins-row bc-row"
            :class="{ 'is-emergency': c.severity === 'emergency' && isComplaintOpen(c) }">
          <div class="ins-row-main">
            <span class="ins-row-title">
              <span class="ins-mono">{{ c.reference }}</span>
              · {{ COMPLAINT_CATEGORY_LABELS[c.category] }}
            </span>
            <span class="ins-row-meta">
              <MapPin :size="12" aria-hidden="true" /> {{ where(c) }}
            </span>
            <p class="bc-desc">{{ c.description }}</p>
            <span class="ins-row-meta bc-when">
              <Clock :size="12" aria-hidden="true" />
              {{ fmt(c.received_at) }}<template v-if="isComplaintOpen(c)"> · {{ waiting(c) }}</template>
              <template v-if="c.anonymous"> · <UserX :size="12" aria-hidden="true" /> anonymous</template>
            </span>
          </div>
          <div class="bc-badges">
            <UiStatusBadge v-if="c.severity !== 'routine'" :tone="SEVERITY_TONE[c.severity]"
                           :label="c.severity === 'emergency' ? 'Emergency' : 'Urgent'" />
            <UiStatusBadge :tone="statusTone(c)" :label="COMPLAINT_STATUS_LABELS[c.status]" />
          </div>
          <UiButton size="sm" @click="inspect(c)">Open</UiButton>
        </li>
      </ul>
    </section>

    <!-- ── Take a report ────────────────────────────────────────────── -->
    <UiSheet v-model:open="intakeOpen" title="Take a report"
             subtitle="Recorded against the council, not against you">
      <div class="ins-form">
        <label class="ins-field">
          <span class="ins-label">What is being reported</span>
          <select v-model="intake.category" class="ins-input">
            <option v-for="[value, label] in CATEGORY_OPTIONS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>

        <label class="ins-field">
          <span class="ins-label">Severity</span>
          <select v-model="intake.severity" class="ins-input">
            <option v-for="[value, label] in SEVERITY_OPTIONS" :key="value" :value="value">{{ label }}</option>
          </select>
          <p class="ins-hint">Emergency is for danger to life — a structure liable to collapse, an open excavation on a footpath.</p>
        </label>

        <label class="ins-field full">
          <span class="ins-label">What the reporter says</span>
          <textarea v-model="intake.description" class="ins-input" rows="4"
                    placeholder="In their words: what is being built, since when, and what the problem is."></textarea>
        </label>

        <label class="ins-field">
          <span class="ins-label">Stand number <span class="bc-opt">if known</span></span>
          <input v-model="intake.stand_number" class="ins-input" placeholder="e.g. Somabula 412" />
        </label>

        <label class="ins-field">
          <span class="ins-label">Ward or suburb</span>
          <input v-model="intake.suburb_ward" class="ins-input" placeholder="e.g. Ward 12" />
        </label>

        <label class="ins-field full">
          <span class="ins-label">How to find it</span>
          <textarea v-model="intake.location_note" class="ins-input" rows="2"
                    placeholder="Directions for where there is no stand number — the usual case in a communal ward."></textarea>
          <p class="ins-hint" :class="{ 'bc-need': !hasLocation }">
            A stand number, a ward, or directions — at least one, or nobody can be sent to look.
          </p>
        </label>

        <label class="ins-check bc-anon full" :class="{ on: intake.anonymous }">
          <input v-model="intake.anonymous" type="checkbox" />
          <span>
            <strong>The reporter wishes to stay anonymous</strong>
            <small>
              No name or number is stored. People report a neighbour and then have to live beside
              them — the council keeps that promise in the record itself, not only in what is shown.
            </small>
          </span>
        </label>

        <template v-if="!intake.anonymous">
          <label class="ins-field">
            <span class="ins-label">Reporter's name <span class="bc-opt">optional</span></span>
            <input v-model="intake.reporter_name" class="ins-input" autocomplete="off" />
          </label>
          <label class="ins-field">
            <span class="ins-label">Telephone <span class="bc-opt">optional</span></span>
            <input v-model="intake.reporter_phone" class="ins-input" type="tel" autocomplete="off" />
          </label>
        </template>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="intakeOpen = false">Cancel</UiButton>
        <UiButton variant="primary" :loading="saving" :disabled="!canSubmit" @click="submitIntake">
          <template #icon><FileText :size="15" aria-hidden="true" /></template>
          Record the report
        </UiButton>
      </template>
    </UiSheet>

    <!-- ── One report ───────────────────────────────────────────────── -->
    <UiSheet v-model:open="rowOpen" :title="openRow?.reference || 'Report'"
             :subtitle="openRow ? COMPLAINT_CATEGORY_LABELS[openRow.category] : undefined">
      <div v-if="openRow" class="bc-detail">
        <div v-if="openRow.severity === 'emergency' && isComplaintOpen(openRow)"
             class="ins-banner t-negative" role="status">
          <Siren :size="16" aria-hidden="true" />
          <div>
            <strong>Reported as a danger to life.</strong>
            <p>Attend before routine work. If the structure is occupied, a prohibition on occupation is the immediate step, not a compliance period.</p>
          </div>
        </div>

        <dl class="ins-dl">
          <div><dt>Status</dt><dd>{{ COMPLAINT_STATUS_LABELS[openRow.status] }}</dd></div>
          <div><dt>Received</dt><dd>{{ fmt(openRow.received_at) }}</dd></div>
          <div><dt>Taken by</dt><dd>{{ openRow.received_by_name || '—' }}</dd></div>
          <div><dt>Where</dt><dd>{{ where(openRow) }}</dd></div>
          <div>
            <dt>Reporter</dt>
            <dd v-if="openRow.anonymous"><UserX :size="13" aria-hidden="true" /> Anonymous</dd>
            <dd v-else>
              {{ openRow.reporter_name || 'Not given' }}
              <span v-if="openRow.reporter_phone" class="bc-phone">
                <Phone :size="12" aria-hidden="true" /> {{ openRow.reporter_phone }}
              </span>
            </dd>
          </div>
          <div v-if="openRow.inspected_at">
            <dt>Visited</dt><dd>{{ fmt(openRow.inspected_at) }} · {{ openRow.inspected_by_name || '—' }}</dd>
          </div>
        </dl>

        <section class="bc-quote" aria-labelledby="bc-quote-h">
          <h4 id="bc-quote-h" class="bc-quote-h">What the reporter said</h4>
          <p>{{ openRow.description }}</p>
        </section>

        <div v-if="isComplaintOpen(openRow)" class="ins-field">
          <span class="ins-label">Severity</span>
          <div class="ins-seg" role="radiogroup" aria-label="Severity">
            <button v-for="[value, label] in SEVERITY_OPTIONS" :key="value" type="button" role="radio"
                    :aria-checked="openRow.severity === value" :disabled="busy"
                    @click="setSeverity(value)">{{ label.split(' —')[0] }}</button>
          </div>
        </div>

        <label v-if="isComplaintOpen(openRow)" class="ins-field">
          <span class="ins-label">What you found on site</span>
          <textarea v-model="finding" class="ins-input" rows="4"
                    placeholder="What is actually there, measured where it matters, and whether the report is borne out."></textarea>
          <p class="ins-hint">This is the council's answer to the reporter and to any appeal. Write it for someone who was not there.</p>
        </label>

        <div v-else class="ins-banner t-positive">
          <CheckCircle2 :size="16" aria-hidden="true" />
          <div>
            <strong>Answered {{ fmt(openRow.closed_at || openRow.inspected_at) }}.</strong>
            <p>{{ openRow.finding || 'No finding was recorded.' }}</p>
          </div>
        </div>

        <UiButton v-if="openRow.permit_app_id" variant="ghost" @click="openCase(openRow)">
          <template #icon><FileText :size="15" aria-hidden="true" /></template>
          Open the permit this is about
        </UiButton>
      </div>

      <template #footer>
        <template v-if="openRow && isComplaintOpen(openRow)">
          <UiButton variant="ghost" :loading="busy" @click="closeReport">Close without a visit</UiButton>
          <UiButton :loading="busy" @click="recordFinding('unsubstantiated')">
            <template #icon><XCircle :size="15" aria-hidden="true" /></template>
            Not borne out
          </UiButton>
          <UiButton variant="danger" :loading="busy" @click="recordFinding('substantiated')">
            <template #icon><ShieldAlert :size="15" aria-hidden="true" /></template>
            Substantiated
          </UiButton>
        </template>
        <UiButton v-else-if="openRow?.status === 'substantiated'" variant="primary"
                  @click="rowOpen = false; emit('open-section', 'enforcement')">
          <template #icon><ShieldAlert :size="15" aria-hidden="true" /></template>
          Go to Enforcement
        </UiButton>
        <UiButton v-else variant="ghost" @click="rowOpen = false">Close</UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.bc-controls { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.bc-controls .ins-search { flex: 1; min-width: 16rem; }

.bc-skeleton { display: flex; flex-direction: column; gap: var(--ent-s3); }

.bc-empty { display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s8) var(--ent-s5); text-align: center; color: var(--ent-text-3); }
.bc-empty h4 { margin: 0; font-size: var(--ent-fs-md); color: var(--ent-text); }
.bc-empty p { margin: 0; font-size: var(--ent-fs-sm); max-width: 48ch; line-height: var(--ent-lh); }

.bc-row { align-items: flex-start; }
/* A report of danger to life is marked on the row, not only in a badge — the
   inspector scanning the register should not have to read to find it. */
.bc-row.is-emergency { box-shadow: inset 3px 0 0 var(--ent-danger); }
.bc-row .ins-row-meta { display: inline-flex; align-items: center; gap: var(--ent-s1); white-space: normal; }
.bc-desc { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  line-height: var(--ent-lh); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; }
.bc-when { margin-top: var(--ent-s1); }
.bc-badges { display: flex; flex-direction: column; align-items: flex-end; gap: var(--ent-s1); flex-shrink: 0; }

.bc-opt { font-weight: var(--ent-fw-normal); color: var(--ent-text-3); }
.bc-need { color: var(--ent-warning); }
.bc-anon { grid-column: 1 / -1; }

.bc-detail { display: flex; flex-direction: column; gap: var(--ent-s4); }
.bc-phone { display: inline-flex; align-items: center; gap: var(--ent-s1); margin-left: var(--ent-s2); color: var(--ent-text-2); }
.bc-detail dd { display: flex; align-items: center; gap: var(--ent-s1); flex-wrap: wrap; }

/* The reporter's own words, kept distinct from the council's record of them —
   an inspector must never mistake a complaint for a finding. The distinction is
   carried by a caption rather than a rule down the side: a label survives
   high-contrast mode and is read aloud, where a border is silent. */
.bc-quote { padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-surface-2); border-radius: var(--ent-r); }
.bc-quote-h { margin: 0 0 var(--ent-s1); font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--ent-text-3); }
.bc-quote p { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text); line-height: var(--ent-lh); }

@media (max-width: 767px) {
  .bc-row { flex-wrap: wrap; }
  .bc-badges { flex-direction: row; align-items: center; }
  .bc-controls .ins-search { min-width: 0; width: 100%; }
}
</style>
