<script setup lang="ts">
/**
 * The cash supervisor's board: every drawer, who holds it, and what may be done about it.
 *
 * WHAT A SUPERVISOR CAN DO HERE, AND ONLY HERE
 *   find a session abandoned  — only once the server says it may be (past the threshold, or a past
 *                               business day; decision D29). Freezes the session. Frees nothing.
 *   count an abandoned drawer — with a witness who is neither the cashier nor the supervisor. The
 *                               count follows every rule of a cashier's own; the drawer is freed by
 *                               this count and by nothing else, and somebody else verifies it.
 *   assign cashiers           — never themselves; ending an assignment never touches a session.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 * No "close", "release" or "reset" for an open or suspended session. A cashier who is present
 * cashes up their own drawer. The server refuses all of these whatever this screen offers.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardCheck, ShieldAlert, UserPlus, X } from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { cashApi } from '../../api/cashApi'
import { formatDate, formatDateTime, formatMoney, type Currency } from '../../composables/useMoney'
import { toCents } from '../../composables/cashMath'
import type { CashDesk, CashDrawer, SessionEvent, StaffOption } from '../../models/cashTypes'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinancePromptDialog from '../FinancePromptDialog.vue'
import CashSessionHistory from './CashSessionHistory.vue'

const props = defineProps<{ desk: CashDesk }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const store = useFinanceStore()
const prompt = useFinancePrompt()
const canSupervise = computed(() => store.can('finance.cash.session.supervise'))
const canAssign = computed(() => store.can('finance.cash.assignment.manage'))
const me = computed(() => store.identity?.user_id ?? null)

const drawers = ref<CashDrawer[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<string | null>(null)

const threshold = computed(() => props.desk.policy?.abandon_after_hours)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await cashApi.drawers()
    drawers.value = result.drawers
  } catch (err) {
    error.value = messageOf(err, 'The drawers could not be read.')
  } finally {
    loading.value = false
  }
}

const STATE_LABEL: Record<string, string> = { open: 'Open', suspended: 'Suspended', abandoned: 'Abandoned' }
const STATE_TONE: Record<string, string> = { open: 'tone-info', suspended: '', abandoned: 'tone-negative' }

const summary = computed(() => ({
  free: drawers.value.filter((d) => !d.session_id && d.point_status === 'active').length,
  open: drawers.value.filter((d) => d.session_status === 'open').length,
  suspended: drawers.value.filter((d) => d.session_status === 'suspended').length,
  attention: drawers.value.filter((d) => d.session_status === 'abandoned' || d.may_be_abandoned).length,
}))

// ── Find abandoned ────────────────────────────────────────────────────────────────────────────

async function abandon(d: CashDrawer): Promise<void> {
  if (!d.session_id) return
  const reason = await prompt.ask({
    title: `Find ${d.session_no} abandoned`,
    message: `${d.cashier_name}'s session at ${d.name} has been held ${d.hours_held} hours${d.is_stale ? ' and belongs to an earlier business day' : ''}. `
      + 'Finding it abandoned stops it taking payments. It does not close the session or free the drawer: the drawer is freed only by a count you make with a witness. The cashier is shown your reason.',
    label: 'What you found', kind: 'textarea', minLength: 10, danger: true, submitLabel: 'Find abandoned',
    placeholder: 'For example: cashier left at 16:00 without cashing up; drawer locked, key with the supervisor',
  })
  if (!reason) return
  busy.value = d.cash_point_id
  error.value = null
  notice.value = null
  try {
    const result = await cashApi.abandonSession(d.session_id, reason)
    notice.value = `${d.session_no}: ${result.note}`
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The session could not be found abandoned.')
  } finally {
    busy.value = null
  }
}

// ── The supervised count ──────────────────────────────────────────────────────────────────────

const CURRENCIES: Currency[] = ['USD', 'ZWG']
const counting = ref<string | null>(null)
const witnesses = ref<StaffOption[]>([])
const count = reactive({
  witness_id: '',
  USD: { total: '', explanation: '' },
  ZWG: { total: '', explanation: '' },
})
const needsExplanation = ref(false)

async function startCount(d: CashDrawer): Promise<void> {
  counting.value = d.cash_point_id
  needsExplanation.value = false
  count.witness_id = ''
  for (const c of CURRENCIES) { count[c].total = ''; count[c].explanation = '' }
  if (witnesses.value.length === 0) {
    try {
      witnesses.value = (await cashApi.witnesses()).witnesses
    } catch (err) {
      error.value = messageOf(err, 'The list of possible witnesses could not be read.')
    }
  }
}

/** Neither the cashier whose drawer it is nor the supervisor counting; the server checks again. */
const witnessesFor = (d: CashDrawer) => witnesses.value.filter((w) => w.id !== d.cashier_id && w.id !== me.value)

async function submitCount(d: CashDrawer): Promise<void> {
  if (!d.session_id || busy.value) return
  if (!count.witness_id) { error.value = 'Name the witness who watched the count.'; return }
  const counts = CURRENCIES.filter((c) => count[c].total.trim() !== '').map((c) => ({
    currency: c, declared_total: count[c].total.trim(),
    ...(count[c].explanation.trim() ? { explanation: count[c].explanation.trim() } : {}),
  }))
  if (counts.some((c) => toCents(c.declared_total) === null)) { error.value = 'A count is an amount such as 412.50.'; return }
  busy.value = d.cash_point_id
  error.value = null
  notice.value = null
  try {
    const result = await cashApi.supervisedClose(d.session_id, count.witness_id, counts)
    notice.value = `${d.session_no}: ${result.note}`
    counting.value = null
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The drawer could not be counted.')
    if (/explained in writing|count has not been declared/.test(error.value)) needsExplanation.value = true
  } finally {
    busy.value = null
  }
}

// ── History ───────────────────────────────────────────────────────────────────────────────────

const historyFor = ref<string | null>(null)
const history = ref<SessionEvent[]>([])

async function toggleHistory(d: CashDrawer): Promise<void> {
  if (historyFor.value === d.cash_point_id) { historyFor.value = null; return }
  if (!d.session_id) return
  historyFor.value = d.cash_point_id
  history.value = []
  try {
    history.value = (await cashApi.sessionEvents(d.session_id)).events
  } catch (err) {
    error.value = messageOf(err, 'The session history could not be read.')
    historyFor.value = null
  }
}

// ── Assignment ────────────────────────────────────────────────────────────────────────────────

const operators = ref<StaffOption[]>([])
const assigning = ref<string | null>(null)
const assignee = ref('')

async function startAssign(d: CashDrawer): Promise<void> {
  assigning.value = d.cash_point_id
  assignee.value = ''
  if (operators.value.length === 0) {
    try {
      operators.value = (await cashApi.assignments({ cash_point_id: d.cash_point_id })).operators
    } catch (err) {
      error.value = messageOf(err, 'The cashiers could not be listed.')
    }
  }
}
const unassigned = (d: CashDrawer) => operators.value.filter((o) => !d.assigned.some((a) => a.user_id === o.id) && o.id !== me.value)

async function assign(d: CashDrawer): Promise<void> {
  if (!assignee.value || busy.value) return
  busy.value = d.cash_point_id
  error.value = null
  notice.value = null
  try {
    await cashApi.assign({ cash_point_id: d.cash_point_id, user_id: assignee.value })
    const who = operators.value.find((o) => o.id === assignee.value)?.name ?? 'The cashier'
    notice.value = `${who} is assigned to ${d.name}.`
    assigning.value = null
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The cashier could not be assigned.')
  } finally {
    busy.value = null
  }
}

async function endAssignment(d: CashDrawer, a: CashDrawer['assigned'][number]): Promise<void> {
  const reason = await prompt.ask({
    title: `End ${a.user_name}'s assignment to ${d.name}`,
    message: d.cashier_id === a.user_id && d.session_id
      ? `${a.user_name} holds this drawer now (${d.session_no}). Ending the assignment does not touch that session: the drawer stays theirs until it is counted.`
      : 'The assignment is ended, not deleted; it stays on the record with your reason.',
    label: 'Reason', kind: 'text', minLength: 5, submitLabel: 'End assignment',
  })
  if (!reason) return
  busy.value = d.cash_point_id
  error.value = null
  try {
    const result = await cashApi.endAssignment(a.id, reason)
    notice.value = result.note
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The assignment could not be ended.')
  } finally {
    busy.value = null
  }
}

onMounted(load)
defineExpose({ load })
</script>

<template>
  <div class="cdr">
    <div class="cdr-head">
      <dl class="cdr-summary" aria-label="Drawers at a glance">
        <div><dt>Free</dt><dd>{{ summary.free }}</dd></div>
        <div><dt>Open</dt><dd>{{ summary.open }}</dd></div>
        <div><dt>Suspended</dt><dd>{{ summary.suspended }}</dd></div>
        <div :class="{ 'is-attention': summary.attention }"><dt>Need attention</dt><dd>{{ summary.attention }}</dd></div>
      </dl>
    </div>

    <p v-if="threshold" class="ins-hint cdr-policy">
      A session may be found abandoned after {{ threshold.value }} hours or once its business day has passed.
      <span v-if="threshold.provisional" class="fin-pill cdr-provisional">Provisional — Council decision {{ threshold.decision }} pending</span>
    </p>

    <p v-if="error" class="ins-banner t-negative" role="alert"><AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span></p>
    <p v-if="notice" class="ins-banner t-positive" role="status"><span>{{ notice }}</span></p>

    <div v-if="loading && drawers.length === 0" aria-busy="true"><span class="ins-skel" /><span class="ins-skel" style="margin-top: 8px; width: 70%" /></div>

    <div v-else-if="drawers.length === 0" class="fin-empty" role="status">
      <strong>No cash point has been set up.</strong>
      <p>The counters are entered under Setup by the accountant or the Director of Finance (decision D22).</p>
    </div>

    <ul v-else class="cdr-list">
      <li v-for="d in drawers" :key="d.cash_point_id" class="ins-card cdr-card" :class="d.session_status ? `is-${d.session_status}` : 'is-free'">
        <div class="cdr-row">
          <div class="cdr-point">
            <strong>{{ d.name }}</strong>
            <span class="cdr-meta">{{ d.code }}<template v-if="d.location"> · {{ d.location }}</template><template v-if="d.point_status !== 'active'"> · not in use</template></span>
          </div>

          <div class="cdr-holder">
            <template v-if="d.session_id">
              <span class="cdr-holder-line">
                <span class="fin-pill" :class="STATE_TONE[d.session_status ?? 'open']">{{ STATE_LABEL[d.session_status ?? 'open'] }}</span>
                <strong>{{ d.cashier_name }}</strong>
                <span class="cdr-mono">{{ d.session_no }}</span>
              </span>
              <span class="cdr-meta">
                Opened {{ formatDateTime(d.opened_at) }} · held {{ d.hours_held }} h · {{ d.receipt_count }} receipt{{ d.receipt_count === 1 ? '' : 's' }}
                <template v-if="d.is_stale"> · <strong class="cdr-stale">from {{ formatDate(d.business_date) }}</strong></template>
              </span>
              <span v-if="d.session_status === 'abandoned'" class="cdr-meta">
                Found abandoned by {{ d.abandoned_by_name }} {{ formatDateTime(d.abandoned_at) }}: “{{ d.abandon_reason }}”
              </span>
            </template>
            <span v-else class="cdr-free">Free — no session holds this drawer</span>
          </div>

          <div class="cdr-expected">
            <template v-if="d.session_id">
              <span class="cdr-label">Should hold</span>
              <span v-for="e in d.expected_cash" :key="e.currency" class="cdr-mono">{{ formatMoney(e.amount, e.currency) }}</span>
              <span v-if="d.expected_cash.length === 0" class="cdr-meta">Nothing</span>
            </template>
          </div>

          <div class="cdr-acts">
            <button v-if="d.session_id" type="button" class="fin-btn small" :aria-expanded="historyFor === d.cash_point_id" @click="toggleHistory(d)">
              <component :is="historyFor === d.cash_point_id ? ChevronDown : ChevronRight" :size="13" aria-hidden="true" /> History
            </button>
            <template v-if="canSupervise && d.session_id && d.cashier_id !== me">
              <button
                v-if="d.session_status !== 'abandoned' && d.may_be_abandoned" type="button" class="fin-btn small danger"
                :disabled="busy === d.cash_point_id" @click="abandon(d)"
              ><ShieldAlert :size="13" aria-hidden="true" /> Find abandoned</button>
              <span v-else-if="d.session_status !== 'abandoned'" class="cdr-meta cdr-why">
                The cashier cashes up their own drawer. It can be found abandoned after {{ threshold?.value ?? 12 }} hours.
              </span>
              <button
                v-if="d.session_status === 'abandoned'" type="button" class="fin-btn small primary"
                :disabled="busy === d.cash_point_id" @click="startCount(d)"
              ><ClipboardCheck :size="13" aria-hidden="true" /> Count with a witness</button>
            </template>
          </div>
        </div>

        <!-- The supervised count, inline under its drawer. -->
        <form v-if="counting === d.cash_point_id" class="cdr-count" :aria-label="`Count ${d.name} with a witness`" @submit.prevent="submitCount(d)">
          <p class="cash-lede">
            Count everything in the drawer, including the float, in front of the witness. The count is recorded with both your names,
            the drawer is freed, and somebody who took no part verifies it. A difference is explained in writing and posted, never absorbed.
          </p>
          <div class="cdr-count-grid">
            <label class="ins-field">
              <span class="ins-label">Witness</span>
              <select v-model="count.witness_id" class="ins-input" required>
                <option value="" disabled>Who watched the count</option>
                <option v-for="w in witnessesFor(d)" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
              <span class="ins-hint">Not the cashier and not you. Somebody who may see the cash office.</span>
            </label>
            <div v-for="c in CURRENCIES" :key="c" class="cdr-count-ccy">
              <label class="ins-field">
                <span class="ins-label">{{ c === 'USD' ? 'US$' : 'ZWG' }} counted</span>
                <input v-model="count[c].total" class="ins-input cdr-num" inputmode="decimal" placeholder="Leave blank if none" autocomplete="off" />
              </label>
              <label v-if="needsExplanation && count[c].total.trim() !== ''" class="ins-field">
                <span class="ins-label">Explanation of the {{ c }} difference</span>
                <textarea v-model="count[c].explanation" class="ins-input" rows="2" />
              </label>
            </div>
          </div>
          <div class="cdr-count-foot">
            <button type="button" class="fin-btn" :disabled="busy === d.cash_point_id" @click="counting = null"><X :size="13" aria-hidden="true" /> Cancel</button>
            <button type="submit" class="fin-btn primary" :disabled="busy === d.cash_point_id">{{ busy === d.cash_point_id ? 'Recording…' : 'Record the count' }}</button>
          </div>
        </form>

        <div v-if="historyFor === d.cash_point_id" class="cdr-history">
          <CashSessionHistory :events="history" />
        </div>

        <!-- Assignment -->
        <div class="cdr-assign">
          <span class="cdr-label">Assigned</span>
          <span v-if="d.assigned.length === 0" class="cdr-meta">Nobody</span>
          <span v-for="a in d.assigned" :key="a.id" class="cdr-chip">
            {{ a.user_name }}
            <button v-if="canAssign" type="button" class="cdr-chip-x" :disabled="busy === d.cash_point_id" @click="endAssignment(d, a)">
              <X :size="12" aria-hidden="true" /><span class="sr-only">End {{ a.user_name }}'s assignment</span>
            </button>
          </span>
          <template v-if="canAssign && d.point_status === 'active'">
            <form v-if="assigning === d.cash_point_id" class="cdr-assign-form" @submit.prevent="assign(d)">
              <label class="sr-only" :for="`cdr-assignee-${d.cash_point_id}`">Cashier to assign</label>
              <select :id="`cdr-assignee-${d.cash_point_id}`" v-model="assignee" class="ins-input cdr-assign-select" required>
                <option value="" disabled>Choose a cashier</option>
                <option v-for="o in unassigned(d)" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
              <button type="submit" class="fin-btn small primary" :disabled="!assignee || busy === d.cash_point_id">Assign</button>
              <button type="button" class="fin-btn small" @click="assigning = null">Cancel</button>
            </form>
            <button v-else type="button" class="fin-btn small" @click="startAssign(d)"><UserPlus :size="13" aria-hidden="true" /> Assign</button>
          </template>
        </div>
      </li>
    </ul>

    <FinancePromptDialog :controller="prompt" />
  </div>
</template>

<style scoped>
.cdr { display: flex; flex-direction: column; gap: var(--ent-s3); }
.cdr-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s3); flex-wrap: wrap; }
.cdr-summary {
  display: flex; flex-wrap: wrap; margin: 0; overflow: hidden;
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface);
}
.cdr-summary div { display: flex; flex-direction: column; gap: 2px; padding: var(--ent-s2) var(--ent-s4); border-right: 1px solid var(--ent-line); }
.cdr-summary div:last-child { border-right: 0; }
.cdr-summary dt { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ent-text-3); }
.cdr-summary dd { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums; color: var(--ent-text); }
.cdr-summary .is-attention dd { color: var(--ent-danger); }
.cdr-policy { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; margin: 0; }
.cdr-provisional { background: var(--ent-tone-warning-bg); }

.cdr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s3); }
.cdr-card { overflow: hidden; }
.cdr-card.is-free { border-left: 3px solid var(--ent-line); }
.cdr-card.is-open { border-left: 3px solid var(--ent-accent); }
.cdr-card.is-suspended { border-left: 3px solid var(--ent-text-3); }
.cdr-card.is-abandoned { border-left: 3px solid var(--ent-danger); }

.cdr-row {
  display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(14rem, 2fr) minmax(7rem, auto) auto;
  gap: var(--ent-s3) var(--ent-s4); align-items: start; padding: var(--ent-s3) var(--ent-s4);
}
.cdr-point, .cdr-holder, .cdr-expected { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cdr-point strong { font-size: var(--ent-fs-sm); color: var(--ent-text); }
.cdr-holder-line { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; font-size: var(--ent-fs-sm); }
.cdr-meta { font-size: var(--ent-fs-xs); color: var(--ent-text-3); line-height: var(--ent-lh); }
.cdr-free { font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.cdr-stale { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.cdr-label { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ent-text-3); }
.cdr-mono { font-family: var(--ent-font-mono); font-size: var(--ent-fs-sm); font-variant-numeric: tabular-nums; }
.cdr-acts { display: flex; align-items: center; justify-content: flex-end; gap: var(--ent-s2); flex-wrap: wrap; }
.cdr-why { max-width: 15rem; }

.cdr-count, .cdr-history {
  display: flex; flex-direction: column; gap: var(--ent-s3);
  padding: var(--ent-s4); border-top: 1px solid var(--ent-line); background: var(--ent-surface-2);
}
.cdr-count-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--ent-s3); }
.cdr-count-ccy { display: flex; flex-direction: column; gap: var(--ent-s2); }
.cdr-num { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.cdr-count-foot { display: flex; justify-content: flex-end; gap: var(--ent-s2); }

.cdr-assign {
  display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap;
  padding: var(--ent-s2) var(--ent-s4); border-top: 1px solid var(--ent-line);
}
.cdr-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px var(--ent-s2);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-pill); font-size: var(--ent-fs-xs); color: var(--ent-text);
}
.cdr-chip-x { display: inline-grid; place-items: center; border: 0; background: none; padding: 0; color: var(--ent-text-3); cursor: pointer; }
.cdr-chip-x:hover { color: var(--ent-danger); }
.cdr-chip-x:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; border-radius: 50%; }
.cdr-assign-form { display: inline-flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.cdr-assign-select { min-width: 12rem; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 900px) {
  .cdr-row { grid-template-columns: minmax(0, 1fr); }
  .cdr-acts { justify-content: flex-start; }
}
</style>
