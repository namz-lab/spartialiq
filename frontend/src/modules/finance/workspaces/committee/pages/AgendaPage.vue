<script setup lang="ts">
/**
 * Awaiting decision: the committee's agenda, grouped by kind, showing only the kinds this member
 * may decide. Each item opens to the figures behind it, then Approve, or Return / Reject with a
 * written reason.
 *
 * What each decision records follows the endpoint (see DecisionDialog): revisions and releases keep
 * a note, tariffs keep the resolution reference and date, budget lines and projects keep only who
 * approved and when. A project or tariff cannot be sent back from here because the server has no
 * route for it; the page says so instead of offering a button that would fail.
 *
 * A member is not offered Approve on work they submitted themselves (the server refuses it too).
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Gavel, CircleCheck, Undo2, AlertTriangle, CheckCircle2 } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import type { BudgetLinePerformance, BudgetRevision } from '../../../models/types'
import type { RatesTariff } from '../../../models/ratesTypes'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import DecisionDialog from '../components/DecisionDialog.vue'
import ItemFigures from '../components/ItemFigures.vue'
import { committeeDash, KINDS, kindMeta, noteWithResolution, headline, idOf, type DecisionKind } from '../agenda'

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const { state, load } = committeeDash
const me = computed(() => store.identity?.user_id ?? '')

const allowedKinds = computed(() => KINDS.filter((m) => state.data?.[m.kind].allowed ?? store.can(m.permission)))
const filter = computed<DecisionKind | ''>(() => {
  const k = route.query.kind
  return typeof k === 'string' && KINDS.some((m) => m.kind === k) ? k as DecisionKind : ''
})
const shownKinds = computed(() => allowedKinds.value.filter((m) => !filter.value || m.kind === filter.value))
function show(kind: DecisionKind | ''): void { void router.replace({ query: { ...route.query, kind: kind || undefined } }) }

const itemsOf = (k: DecisionKind): unknown[] => state.data?.[k].items ?? []
const errorOf = (k: DecisionKind): string | null => state.data?.[k].error ?? null
/** Why Approve is not offered on this item, if it is not. */
function ownWork(k: DecisionKind, item: unknown): string | null {
  const mine = (id: string | null | undefined) => !!id && id === me.value
  if (k === 'budget' && mine((item as BudgetLinePerformance).submitted_by)) return 'You submitted this line. The decision must come from another member.'
  if (k === 'revision' && mine((item as BudgetRevision).requested_by)) return 'You requested this revision. The decision must come from another member.'
  if (k === 'tariff' && mine((item as RatesTariff).created_by)) return 'You drafted this tariff. The decision must come from another member.'
  return null
}
const SEND_BACK: Partial<Record<DecisionKind, { label: string; title: string }>> = {
  budget: { label: 'Return', title: 'Return this line to the preparer' },
  revision: { label: 'Reject', title: 'Reject this revision' },
  publication: { label: 'Reject', title: 'Refuse this release' },
}
const NO_SEND_BACK: Partial<Record<DecisionKind, string>> = {
  project: 'A project cannot be sent back from here yet. If it should not proceed, leave it undecided and minute the reason; the proposer can change it.',
  tariff: 'A draft tariff cannot be rejected from here yet. If it should not stand, leave it undecided and minute the reason; the drafter can change or discard it.',
}

// ── Acting ──────────────────────────────────────────────────────────────────────────────────────
const approving = ref<{ kind: DecisionKind; item: unknown } | null>(null)
const sending = ref<{ kind: DecisionKind; item: unknown } | null>(null)
const busy = ref(false)
const actError = ref<string | null>(null)
const done = ref<string | null>(null)

const approveConfig = computed(() => {
  const k = approving.value?.kind
  if (k === 'tariff') return { note: 'none', resolution: 'required', date: true } as const
  if (k === 'budget' || k === 'project') return { note: 'none', resolution: 'none', date: false } as const
  return { note: 'required', resolution: 'optional', date: false } as const
})

function open(kind: DecisionKind, item: unknown, how: 'approve' | 'send'): void {
  actError.value = null
  done.value = null
  if (how === 'approve') approving.value = { kind, item }
  else sending.value = { kind, item }
}

async function approve(v: { note: string; resolution: string; date: string }): Promise<void> {
  if (!approving.value || busy.value) return
  const { kind, item } = approving.value
  const id = idOf(kind, item)
  busy.value = true
  actError.value = null
  try {
    if (kind === 'budget') await financeApi.approveBudgetLine(id)
    else if (kind === 'project') await financeApi.approveProject(id)
    else if (kind === 'revision') await financeApi.approveRevision(id, noteWithResolution(v.note, v.resolution))
    else if (kind === 'publication') await financeApi.approvePublication(id, noteWithResolution(v.note, v.resolution))
    else await ratesApi.approveTariff(id, { resolution_reference: v.resolution, ...(v.date ? { resolution_date: v.date } : {}) })
    done.value = `Approved: ${headline(kind, item).title}.`
    approving.value = null
    await load()
  } catch (err) {
    actError.value = messageOf(err, 'The approval could not be recorded.')
  } finally { busy.value = false }
}

async function sendBack(reason: string): Promise<void> {
  if (!sending.value || busy.value) return
  const { kind, item } = sending.value
  const id = idOf(kind, item)
  busy.value = true
  actError.value = null
  try {
    if (kind === 'budget') await financeApi.returnBudgetLine(id, reason)
    else if (kind === 'revision') await financeApi.rejectRevision(id, reason)
    else if (kind === 'publication') await financeApi.rejectPublication(id, reason)
    done.value = `${kind === 'budget' ? 'Returned' : 'Rejected'}: ${headline(kind, item).title}.`
    sending.value = null
    await load()
  } catch (err) {
    actError.value = messageOf(err, 'The decision could not be recorded.')
  } finally { busy.value = false }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Gavel :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Awaiting Decision</h2>
      <p>Everything submitted to the committee that you may decide, with the figures to decide on. Every decision is kept on the record with your name.</p>
    </div>
  </section>

  <p v-if="done" class="cw-banner-msg cw-banner-msg--pos" role="status"><CheckCircle2 :size="18" aria-hidden="true" />{{ done }}</p>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load()">Retry</button></p>

  <p v-if="!allowedKinds.length" class="cw-banner-msg cw-banner-msg--warn" role="status">
    Your role does not decide any kind of finance item. Ask the finance access administrator if your duties have changed.
  </p>

  <template v-else>
    <div class="cw-seg cm-seg" role="group" aria-label="Kind of decision">
      <button type="button" :aria-pressed="!filter" @click="show('')">All</button>
      <button v-for="m in allowedKinds" :key="m.kind" type="button" :aria-pressed="filter === m.kind" @click="show(m.kind)">
        {{ m.label }} ({{ itemsOf(m.kind).length }})</button>
    </div>

    <div v-if="!state.data && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

    <template v-else>
    <section v-for="m in shownKinds" :key="m.kind" class="cw-card" :aria-labelledby="`cm-${m.kind}`">
      <div class="cw-card-head"><h3 :id="`cm-${m.kind}`">{{ m.label }}</h3><span class="cw-count-pill">{{ itemsOf(m.kind).length }}</span></div>
      <div class="cw-card-body">
        <p class="cw-hint cm-lead">{{ m.lead }}</p>
        <p v-if="errorOf(m.kind)" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ errorOf(m.kind) }}</p>
        <p v-else-if="!itemsOf(m.kind).length" class="cw-empty">No {{ m.noun }} is waiting for a decision.</p>
        <ul v-else class="cm-items">
          <li v-for="item in itemsOf(m.kind)" :key="idOf(m.kind, item)">
            <details class="cm-item">
              <summary>
                <span class="cm-title">{{ headline(m.kind, item).title }}</span>
                <span class="cw-hint">{{ headline(m.kind, item).meta }}</span>
                <span class="cw-spacer" />
                <span v-if="headline(m.kind, item).figure" class="num cm-fig">{{ headline(m.kind, item).figure }}</span>
              </summary>
              <div class="cm-body">
                <ItemFigures :kind="m.kind" :item="item" />
                <div class="cm-acts">
                  <p v-if="ownWork(m.kind, item)" class="cw-hint">{{ ownWork(m.kind, item) }}</p>
                  <button v-else type="button" class="cw-btn cw-btn--primary" @click="open(m.kind, item, 'approve')">
                    <CircleCheck :size="17" aria-hidden="true" /> Approve</button>
                  <button v-if="SEND_BACK[m.kind]" type="button" class="cw-btn" @click="open(m.kind, item, 'send')">
                    <Undo2 :size="17" aria-hidden="true" /> {{ SEND_BACK[m.kind]?.label }}</button>
                  <p v-else class="cw-hint cm-why">{{ NO_SEND_BACK[m.kind] }}</p>
                </div>
              </div>
            </details>
          </li>
        </ul>
      </div>
    </section>
    </template>
  </template>

  <DecisionDialog v-if="approving" :title="`Approve this ${kindMeta(approving.kind).noun}`" :message="headline(approving.kind, approving.item).title"
    :note="approveConfig.note" :resolution="approveConfig.resolution" :date="approveConfig.date"
    :busy="busy" :error="actError" @submit="approve" @close="approving = null" />
  <ReasonDialog v-if="sending" :title="SEND_BACK[sending.kind]?.title ?? 'Send back'" :message="headline(sending.kind, sending.item).title"
    label="Reason for the decision" :submit-label="SEND_BACK[sending.kind]?.label ?? 'Confirm'" danger
    :busy="busy" :error="actError" @submit="sendBack" @close="sending = null" />
</template>

<style scoped>
.cm-seg { margin-bottom: 16px; flex-wrap: wrap; }
.cm-lead { margin: 0 0 12px; max-width: 75ch; }
.cm-items { list-style: none; margin: 0; padding: 0; }
.cm-items > li + li { border-top: 1px solid var(--cw-line); }
.cm-item > summary { display: flex; align-items: baseline; gap: 12px; padding: 12px 4px; cursor: pointer; flex-wrap: wrap; }
.cm-item > summary:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
.cm-title { font-weight: 600; }
.cm-fig { font-weight: 600; }
.cm-body { padding: 4px 4px 16px 20px; }
.cm-acts { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.cm-why { max-width: 60ch; margin: 0; }
</style>
