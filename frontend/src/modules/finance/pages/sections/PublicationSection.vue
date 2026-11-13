<script setup lang="ts">
/**
 * Publication — what the public sees, who approved it, and when it was released.
 *
 * A FINANCE ROW IS PUBLIC EXACTLY WHILE A LIVE PUBLICATION COVERS ITS YEAR AND DATASET. Not
 * because of a flag on the record, and not because of a filter in the public route: the
 * row-level-security policies in the database require the publication row, so withdrawing it takes
 * the data off the portal in the same instant without touching a single financial record. The
 * withdraw button says so, because a publisher should know that is what they are doing.
 *
 * SEPARATION OF DUTIES is visible here rather than merely enforced. A publisher sees no Approve
 * button; a committee member sees no Publish button; and where a council has turned the
 * person-level rule off, that is stated rather than silently assumed.
 *
 * THE PREVIEW IS COUNTS AND TOTALS, NOT ROWS. Someone about to put council figures in front of
 * residents should be able to see what they are releasing, per currency, and whether the import
 * behind it reconciled.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatMoney, formatDate, formatDateTime } from '../../composables/useMoney'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import type { Publication, PublicationDataset } from '../../models/types'
import FinanceGuard from '../../components/FinanceGuard.vue'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import {
  AlertTriangle, CheckCircle2, RefreshCw, Globe2, Check, X, Eye, Info, Undo2, Plus, ShieldAlert,
} from 'lucide-vue-next'

const store = useFinanceStore()
/** A workspace page shows only some datasets (Budget Publications, Financial Statements); the console shows all. */
const props = defineProps<{ datasets?: PublicationDataset[] }>()
const prompt = useFinancePrompt()
const route = useRoute()

const publications = ref<Publication[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const preview = ref<Awaited<ReturnType<typeof financeApi.publicationPreview>> | null>(null)

const DATASETS: Array<{ id: PublicationDataset; label: string; help: string }> = [
  { id: 'budget', label: 'Budget', help: 'The approved and revised budget. Lines must also be marked published.' },
  { id: 'revenue', label: 'Revenue', help: 'Posted revenue transactions, without counterparty identity.' },
  { id: 'expenditure', label: 'Expenditure', help: 'Posted expenditure transactions, without supplier identity.' },
  { id: 'projects', label: 'Projects', help: 'Approved projects and their financial performance.' },
  { id: 'documents', label: 'Documents', help: 'Only documents a publisher has classified public.' },
  { id: 'reports', label: 'Reports', help: 'Published financial statements and reports.' },
]

const requestForm = ref<{ dataset: PublicationDataset; period: string; asAt: string; notes: string }>({
  dataset: props.datasets?.[0] ?? 'budget', period: '', asAt: '', notes: '',
})
const showRequest = ref(false)

const yearId = computed(() => store.selectedYearId)
const canReview = computed(() => store.can('finance.publication.review'))
const canApprove = computed(() => store.can('finance.publication.approve'))
const canPublish = computed(() => store.can('finance.publication.publish'))
const canWithdraw = computed(() => store.can('finance.publication.withdraw'))
const me = computed(() => store.identity?.user_id ?? null)

const stateTone: Record<string, string> = {
  pending: 'tone-info', approved: 'tone-warning', published: 'tone-positive',
  withdrawn: '', rejected: 'tone-negative',
}

async function load(): Promise<void> {
  if (!yearId.value) { publications.value = []; return }
  loading.value = true
  error.value = null
  try {
    const all = await financeApi.publications({ financial_year_id: yearId.value })
    publications.value = props.datasets?.length ? all.filter((p) => props.datasets!.includes(p.dataset)) : all
  } catch (err) {
    error.value = messageOf(err, 'The publication queue could not be read.')
  } finally { loading.value = false }
}

onMounted(load)
watch(yearId, load)

async function request(): Promise<void> {
  if (!yearId.value) return
  error.value = null; note.value = null
  busy.value = 'request'
  try {
    const p = await financeApi.requestPublication({
      financial_year_id: yearId.value,
      dataset: requestForm.value.dataset,
      reporting_period_label: requestForm.value.period.trim() || undefined,
      data_as_at: requestForm.value.asAt || undefined,
      notes: requestForm.value.notes.trim() || undefined,
    })
    note.value = `Version ${p.version} of the ${p.dataset} dataset requested. It is pending review; creating it is not approving it.`
    showRequest.value = false
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The release could not be requested.')
  } finally { busy.value = null }
}

async function look(p: Publication): Promise<void> {
  error.value = null
  try { preview.value = await financeApi.publicationPreview(p.id) } catch (err) {
    error.value = messageOf(err, 'The preview could not be built.')
  }
}

async function act(p: Publication, action: 'approve' | 'reject' | 'publish' | 'withdraw' | 'mark'): Promise<void> {
  error.value = null; note.value = null
  busy.value = p.id
  try {
    if (action === 'approve') {
      const decision = await prompt.ask({
        title: 'Approve for release',
        message: 'Publishing it is a separate act, by someone else.',
        label: 'A note for the record (optional)',
        kind: 'textarea',
        submitLabel: 'Approve',
      })
      if (decision === null) return
      await financeApi.approvePublication(p.id, decision || undefined)
      note.value = 'Approved for release. Publishing it is a separate act, by someone else.'
    } else if (action === 'reject') {
      const reason = await prompt.ask({
        title: 'Refuse this release',
        message: 'The request stays on the record with your reason.',
        label: 'Why is this release refused?',
        kind: 'textarea',
        minLength: 5,
        submitLabel: 'Refuse it',
        danger: true,
      })
      if (!reason) return
      await financeApi.rejectPublication(p.id, reason)
      note.value = 'Release refused. The request stays on the record with your reason.'
    } else if (action === 'publish') {
      const result = await financeApi.publish(p.id)
      note.value = result.effect
    } else if (action === 'withdraw') {
      const reason = await prompt.ask({
        title: 'Withdraw from the public portal',
        message: 'Withdrawing takes this data off the public portal immediately. No financial record is changed.',
        label: 'Reason (it is kept on the record)',
        kind: 'textarea',
        minLength: 10,
        submitLabel: 'Withdraw',
        danger: true,
      })
      if (!reason) return
      const result = await financeApi.withdrawPublication(p.id, reason)
      note.value = result.effect
    } else {
      const result = await financeApi.markBudgetLinesPublished(p.id)
      note.value = result.marked > 0
        ? `${result.marked} approved budget line(s) marked published. They are now on the public portal.`
        : (result.note ?? 'No approved budget line was waiting to be marked.')
    }
    await load()
    if (preview.value?.publication.id === p.id) await look(p)
  } catch (err) {
    error.value = messageOf(err, 'That could not be done.')
  } finally { busy.value = null }
}

/** Would this person be blocked by the person-level separation rule on their own approval? */
const wouldSelfPublish = (p: Publication): boolean =>
  canPublish.value && p.state === 'approved' && me.value !== null && p.approved_by_name !== null
  && store.identity?.permissions.includes('finance.publication.approve') === true

const live = computed(() => publications.value.filter((p) => p.state === 'published'))
const history = computed(() => publications.value.filter((p) => p.state === 'withdrawn' || p.state === 'rejected'))

/**
 * THE QUEUE IS TWO QUEUES, AND THEY BELONG TO DIFFERENT PEOPLE.
 *
 * It used to be one list of everything pending or approved, headed "Awaiting a decision". Half of
 * it was the committee's work — requests waiting to be approved — and half was the publisher's —
 * releases approved and waiting to go out. A publisher reading "awaiting a decision" against four
 * rows, two of which it cannot touch, is being told nothing useful about its own job, which is the
 * whole of its nine permissions. They are now separate bands, each headed with whose work it is,
 * and the viewer's own band comes first. A `?state=` link, which is how a work queue arrives here,
 * puts that band first instead.
 */
const awaitingPublication = computed(() => publications.value.filter((p) => p.state === 'approved'))
const awaitingApproval = computed(() => publications.value.filter((p) => p.state === 'pending'))

// Computed, not read once: a queue link can arrive while this section is already on screen.
const linkedState = computed(() => (typeof route.query.state === 'string' ? route.query.state : ''))

const queueBands = computed(() => {
  const approvedBand = {
    id: 'approved',
    title: canPublish.value ? 'Approved and awaiting your publication' : 'Approved and awaiting the publisher',
    help: canPublish.value
      ? 'Someone else approved these for release. Publishing one puts its dataset on the public portal in the same instant; withdrawing it takes it off again without changing a financial record.'
      : 'These are approved. Releasing them is a separate duty, held by a publisher — approving a dataset and putting it in front of residents are not the same act.',
    rows: awaitingPublication.value,
  }
  const pendingBand = {
    id: 'pending',
    title: canApprove.value ? 'Requested and awaiting your approval' : 'Requested and awaiting the committee',
    help: canApprove.value
      ? 'A request to put a dataset in front of residents. Approving it is not publishing it; that is a separate act by the publisher.'
      : 'These have been requested. Approving a release is reserved to the roles holding that permission.',
    rows: awaitingApproval.value,
  }
  const mineFirst = linkedState.value === 'approved'
    || (linkedState.value !== 'pending' && canPublish.value)
  return (mineFirst ? [approvedBand, pendingBand] : [pendingBand, approvedBand])
    .filter((band) => band.rows.length > 0)
})
</script>

<template>
  <div class="fin-section">
    <FinancePromptDialog :controller="prompt" />
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <p class="fin-ccy-note">
      <Info :size="14" aria-hidden="true" />
      A finance row reaches the public portal only while a live publication covers its year and
      dataset — the database requires it, not a filter in the public pages. Withdrawing a release
      takes the data down at once and changes no financial record.
    </p>

    <div class="fin-bar">
      <button v-if="canReview" type="button" class="fin-btn primary" @click="showRequest = !showRequest">
        <Plus :size="14" aria-hidden="true" /> Request a release
      </button>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <FinanceGuard v-if="showRequest" requires="finance.publication.review" surface="Requesting a release">
      <form class="ins-card" @submit.prevent="request">
        <div class="ins-card-head"><h3>Request a release — {{ store.selectedYear?.label }}</h3></div>
        <div class="ins-card-body">
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="pub-ds">Dataset</label>
              <select id="pub-ds" v-model="requestForm.dataset" class="ins-input">
                <option v-for="d in DATASETS" :key="d.id" :value="d.id">{{ d.label }}</option>
              </select>
              <p class="ins-hint">{{ DATASETS.find((d) => d.id === requestForm.dataset)?.help }}</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pub-period">Reporting period, in words</label>
              <input id="pub-period" v-model="requestForm.period" class="ins-input" maxlength="120"
                     placeholder="e.g. 2031 full year, or Q1 2031" />
              <p class="ins-hint">Shown beside every published figure, so nothing is quoted out of context.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="pub-asat">Data as at</label>
              <input id="pub-asat" v-model="requestForm.asAt" class="ins-input" type="date" />
              <p class="ins-hint">The cut-off the figures reflect. The public portal shows it.</p>
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="pub-notes">Notes for the reviewer</label>
              <textarea id="pub-notes" v-model="requestForm.notes" class="ins-input" rows="2" maxlength="2000"></textarea>
            </div>
          </div>
        </div>
        <div class="ins-card-foot">
          <button type="button" class="fin-btn" @click="showRequest = false">Cancel</button>
          <button type="submit" class="fin-btn primary" :disabled="busy === 'request'">
            {{ busy === 'request' ? 'Requesting…' : 'Request' }}
          </button>
        </div>
      </form>
    </FinanceGuard>

    <div v-if="!yearId" class="fin-empty">
      <strong>No financial year is selected.</strong>
      <p>Choose a reporting period above.</p>
    </div>

    <template v-else>
      <!-- Live -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h3><Globe2 :size="15" aria-hidden="true" /> Live on the public portal <span class="ins-count">{{ live.length }}</span></h3>
        </div>
        <div class="ins-card-body">
          <div v-if="live.length === 0" class="fin-empty">
            <strong>Nothing is published for {{ store.selectedYear?.label }}.</strong>
            <p>
              The public portal shows no figures for this year. A release is requested, reviewed and
              approved, and then published by someone other than the approver.
            </p>
          </div>
          <div v-else class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Dataset</th><th scope="col" class="num">Version</th>
                  <th scope="col">Period</th><th scope="col">Data as at</th>
                  <th scope="col">Approved by</th><th scope="col">Published by</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in live" :key="p.id">
                  <td class="emphasis">{{ p.dataset }}</td>
                  <td class="num">{{ p.version }}</td>
                  <td>{{ p.reporting_period_label ?? '—' }}</td>
                  <td>{{ formatDate(p.data_as_at) }}</td>
                  <td>{{ p.approved_by_name ?? '—' }}<br /><small class="fin-sub">{{ formatDateTime(p.approved_at) }}</small></td>
                  <td>{{ p.published_by_name ?? '—' }}<br /><small class="fin-sub">{{ formatDateTime(p.published_at) }}</small></td>
                  <td>
                    <div class="fin-row-actions">
                      <button type="button" class="fin-btn small" @click="look(p)">
                        <Eye :size="12" aria-hidden="true" /> What it shows
                      </button>
                      <button v-if="p.dataset === 'budget' && canPublish" type="button" class="fin-btn small"
                              :disabled="busy === p.id" @click="act(p, 'mark')">
                        Mark approved lines published
                      </button>
                      <button v-if="canWithdraw" type="button" class="fin-btn small danger"
                              :disabled="busy === p.id" @click="act(p, 'withdraw')">
                        <Undo2 :size="12" aria-hidden="true" /> Withdraw
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Queue, split by whose work it is -->
      <section v-for="band in queueBands" :key="band.id" class="ins-card">
        <div class="ins-card-head">
          <h3>{{ band.title }} <span class="ins-count">{{ band.rows.length }}</span></h3>
        </div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">{{ band.help }}</p>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Dataset</th><th scope="col" class="num">Version</th>
                  <th scope="col">State</th><th scope="col">Period</th>
                  <th scope="col">From the import</th><th scope="col">Requested</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in band.rows" :key="p.id">
                  <td class="emphasis">{{ p.dataset }}</td>
                  <td class="num">{{ p.version }}</td>
                  <td><span class="fin-pill" :class="stateTone[p.state]">{{ p.state }}</span></td>
                  <td>{{ p.reporting_period_label ?? '—' }}</td>
                  <td>
                    <template v-if="p.import_filename">
                      {{ p.import_filename }}<br />
                      <span class="fin-pill" :class="p.import_reconciliation_status === 'matched' ? 'tone-positive' : 'tone-warning'">
                        {{ (p.import_reconciliation_status ?? '').replace(/_/g, ' ') }}
                      </span>
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td>{{ formatDateTime(p.created_at ?? p.reviewed_at) }}</td>
                  <td>
                    <div class="fin-row-actions">
                      <button type="button" class="fin-btn small" @click="look(p)">
                        <Eye :size="12" aria-hidden="true" /> Preview
                      </button>
                      <template v-if="p.state === 'pending'">
                        <button v-if="canApprove" type="button" class="fin-btn small primary"
                                :disabled="busy === p.id" @click="act(p, 'approve')">
                          <Check :size="12" aria-hidden="true" /> Approve
                        </button>
                        <button v-if="canApprove" type="button" class="fin-btn small danger"
                                :disabled="busy === p.id" @click="act(p, 'reject')">
                          <X :size="12" aria-hidden="true" /> Refuse
                        </button>
                        <span v-if="!canApprove" class="fin-hint-inline">
                          Approving a release is reserved to the roles holding that permission.
                        </span>
                      </template>
                      <template v-else-if="p.state === 'approved'">
                        <button v-if="canPublish" type="button" class="fin-btn small primary"
                                :disabled="busy === p.id" @click="act(p, 'publish')">
                          <Globe2 :size="12" aria-hidden="true" /> Publish
                        </button>
                        <span v-else class="fin-hint-inline">
                          Approved. Publishing it is a separate duty, held by a publisher.
                        </span>
                      </template>
                    </div>
                    <p v-if="p.state === 'approved' && wouldSelfPublish(p)" class="fin-fault">
                      <ShieldAlert :size="12" aria-hidden="true" />
                      If you approved this release you cannot also publish it.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Preview -->
      <section v-if="preview" class="ins-card">
        <div class="ins-card-head">
          <h3>
            What version {{ preview.publication.version }} of “{{ preview.publication.dataset }}” shows
          </h3>
          <button type="button" class="ins-iconbtn" @click="preview = null">
            <X :size="16" aria-hidden="true" /><span class="sr-only">Close</span>
          </button>
        </div>
        <div class="ins-card-body">
          <p v-if="preview.warning" class="ins-banner t-warning">
            <AlertTriangle :size="15" aria-hidden="true" /><span>{{ preview.warning }}</span>
          </p>

          <div v-if="preview.summary.length" class="fin-table-wrap">
            <table class="fin-table">
              <caption>Per currency. Nothing is combined across currencies.</caption>
              <thead>
                <tr><th v-for="key in Object.keys(preview.summary[0])" :key="key" scope="col"
                        :class="{ num: typeof preview.summary[0][key] === 'string' && /^-?\d/.test(String(preview.summary[0][key])) }">
                  {{ key.replace(/_/g, ' ') }}
                </th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in preview.summary" :key="i">
                  <td v-for="key in Object.keys(row)" :key="key"
                      :class="{ num: typeof row[key] === 'string' && /^-?\d+(\.\d+)?$/.test(String(row[key])) }">
                    {{ key === 'currency' ? row[key]
                       : typeof row[key] === 'string' && /^-?\d+(\.\d+)?$/.test(String(row[key]))
                         ? formatMoney(String(row[key]), null, { bare: true })
                         : (row[key] ?? '—') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="fin-sub">This release would show nothing yet.</p>

          <div v-if="preview.withheld_from_public.length" class="fin-ccy-note">
            <strong>Kept from the public:</strong>
            {{ preview.withheld_from_public.join(', ') }}.
            {{ preview.note }}
          </div>
        </div>
      </section>

      <!-- History -->
      <section v-if="history.length" class="ins-card">
        <div class="ins-card-head">
          <h3>Withdrawn and refused <span class="ins-count">{{ history.length }}</span></h3>
        </div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">
            Prior versions stay on the record. A dataset that was once public and is no longer is a
            fact about what the council published and when.
          </p>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr><th scope="col">Dataset</th><th scope="col" class="num">Version</th><th scope="col">State</th>
                    <th scope="col">Reason</th><th scope="col">By</th><th scope="col">When</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in history" :key="p.id">
                  <td>{{ p.dataset }}</td>
                  <td class="num">{{ p.version }}</td>
                  <td><span class="fin-pill" :class="stateTone[p.state]">{{ p.state === 'rejected' ? 'refused' : p.state }}</span></td>
                  <td>{{ p.withdraw_reason ?? p.decision_note ?? '—' }}</td>
                  <td>{{ p.withdrawn_by_name ?? p.reviewed_by_name ?? '—' }}</td>
                  <td>{{ formatDateTime(p.withdrawn_at ?? p.reviewed_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-row-actions { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-hint-inline { font-size: var(--ent-fs-micro); color: var(--ent-text-3); max-width: 24ch; line-height: 1.3; }
.fin-fault { margin: 4px 0 0; display: flex; align-items: center; gap: 4px; font-size: var(--ent-fs-micro); color: var(--ent-warning); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
