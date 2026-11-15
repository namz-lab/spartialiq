<script setup lang="ts">
/**
 * Proposals to change stand boundaries: my proposals, and (for the Survey Section) the queue to decide.
 * The map belongs to the editor: this panel asks it to draw a proposal with `show`, and tells it when the list changed.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
  parcelChangeApi, describeProblem, errorMessage, KIND_LABEL, STATUS_LABEL,
  type Proposal, type ProposalSummary, type DecideAction,
} from '@/services/parcelChangeService'

const props = defineProps<{ refreshKey?: number; openId?: string | null }>()
const emit = defineEmits<{
  (e: 'show', fc: GeoJSON.FeatureCollection | null): void
  (e: 'changed'): void
}>()

const auth = useAuthStore()
// The Survey Section's roles (GMS.importSurvey): they see the queue and decide. A person never decides their own proposal (the server refuses).
const DECIDER_ROLES = ['gis_head', 'gis_officer', 'gis_data', 'admin']
const canDecide = computed(() => DECIDER_ROLES.includes(String((auth.user as any)?.role ?? '')))

const tab = ref<'mine' | 'queue'>('mine')
const list = ref<ProposalSummary[]>([])
const open = ref<Proposal | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const note = ref('')

async function load() {
  loading.value = true
  error.value = null
  try {
    list.value = tab.value === 'mine'
      ? await parcelChangeApi.list({ mine: true })
      : await parcelChangeApi.list({ status: ['submitted', 'accepted'] })
  } catch (err) {
    error.value = errorMessage(err, 'The proposals could not be loaded.')
  } finally {
    loading.value = false
  }
}

function overlay(p: Proposal): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...p.parents.map((s) => ({ type: 'Feature' as const, geometry: s.geometry, properties: { role: 'parent', label: s.stand_no } })),
      ...p.items.map((i) => ({ type: 'Feature' as const, geometry: i.geometry, properties: { role: i.role, label: i.label ?? `#${i.seq}` } })),
    ],
  }
}

async function select(id: string) {
  error.value = null
  note.value = ''
  try {
    open.value = await parcelChangeApi.get(id)
    emit('show', overlay(open.value))
  } catch (err) {
    error.value = errorMessage(err, 'The proposal could not be opened.')
  }
}

function close() {
  open.value = null
  emit('show', null)
}

async function run(fn: () => Promise<Proposal>) {
  busy.value = true
  error.value = null
  try {
    open.value = await fn()
    emit('show', overlay(open.value))
    emit('changed')
    await load()
  } catch (err) {
    error.value = errorMessage(err, 'That did not work.')
  } finally {
    busy.value = false
  }
}

const submit = () => open.value && run(() => parcelChangeApi.submit(open.value!.id))
const withdraw = () => open.value && run(() => parcelChangeApi.withdraw(open.value!.id))
const decide = (action: DecideAction) => open.value && run(() => parcelChangeApi.decide(open.value!.id, action, note.value.trim() || undefined))

const editable = computed(() => open.value && ['draft', 'returned'].includes(open.value.status))
const withdrawable = computed(() => open.value && !['applied', 'withdrawn', 'rejected'].includes(open.value.status))
const decidable = computed(() => canDecide.value && open.value?.status === 'submitted')
const needsNote = computed(() => !note.value.trim())

onMounted(load)
watch(tab, () => { close(); load() })
watch(() => props.refreshKey, load)
watch(() => props.openId, (id) => { if (id) select(id) })
</script>

<template>
  <section class="scp" aria-label="Proposals to change stand boundaries">
    <header class="scp__head">
      <h3>Boundary proposals</h3>
      <div v-if="canDecide" class="scp__tabs" role="tablist">
        <button role="tab" :aria-selected="tab === 'mine'" :class="{ on: tab === 'mine' }" @click="tab = 'mine'">Mine</button>
        <button role="tab" :aria-selected="tab === 'queue'" :class="{ on: tab === 'queue' }" @click="tab = 'queue'">Survey queue</button>
      </div>
    </header>

    <p v-if="error" class="scp__error" role="alert">{{ error }}</p>

    <template v-if="!open">
      <p v-if="loading" class="scp__muted">Loading…</p>
      <p v-else-if="!list.length" class="scp__muted">
        {{ tab === 'mine' ? 'You have no proposals. Select a stand and choose Split, New stand or Edit boundary, or choose Merge for several stands.' : 'Nothing is waiting for the Survey Section.' }}
      </p>
      <ul v-else class="scp__list">
        <li v-for="p in list" :key="p.id">
          <button class="scp__row" @click="select(p.id)">
            <span class="scp__kind">{{ KIND_LABEL[p.kind] }}</span>
            <span class="scp__stands">{{ (p.stands ?? []).join(', ') }}</span>
            <span class="scp__status" :data-status="p.status">{{ STATUS_LABEL[p.status] }}</span>
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <button class="scp__back" @click="close">← All proposals</button>
      <h4>{{ KIND_LABEL[open.kind] }}: stand {{ open.parents.map((s) => s.stand_no).join(', ') }}</h4>
      <p class="scp__status" :data-status="open.status">{{ STATUS_LABEL[open.status] }}</p>
      <p v-if="open.reason">{{ open.reason }}</p>
      <p v-if="open.decision_note" class="scp__note"><strong>Survey Section:</strong> {{ open.decision_note }}</p>

      <ul v-if="open.problems.length" class="scp__problems" aria-label="Problems with this proposal">
        <li v-for="(pr, i) in open.problems" :key="i">{{ describeProblem(pr) }}</li>
      </ul>
      <p v-else-if="editable" class="scp__ok">No problems found. A drawing is not a survey: the Survey Section checks the surveyed boundaries.</p>

      <div class="scp__actions">
        <button v-if="editable" class="scp__btn scp__btn--primary" :disabled="busy || open.problems.length > 0" @click="submit">Send to the Survey Section</button>
        <button v-if="withdrawable && open.requested_by === (auth.user as any)?.id" class="scp__btn" :disabled="busy" @click="withdraw">Withdraw</button>
      </div>

      <div v-if="decidable" class="scp__decide">
        <label for="scp-note">Note (required to return or reject)</label>
        <textarea id="scp-note" v-model="note" rows="2" />
        <div class="scp__actions">
          <button class="scp__btn scp__btn--primary" :disabled="busy" @click="decide('accept')">Accept</button>
          <button class="scp__btn" :disabled="busy || needsNote" @click="decide('return')">Return</button>
          <button class="scp__btn scp__btn--danger" :disabled="busy || needsNote" @click="decide('reject')">Reject</button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.scp { font-size: 0.875rem; display: flex; flex-direction: column; gap: 0.5rem; }
.scp__head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.scp__head h3 { margin: 0; font-size: 0.95rem; }
.scp__tabs { display: flex; gap: 0.25rem; }
.scp__tabs button { border: 1px solid #d0d5dd; background: #fff; border-radius: 6px; padding: 0.2rem 0.6rem; cursor: pointer; }
.scp__tabs button.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
.scp__muted { color: #667085; margin: 0; }
.scp__error { color: #b42318; margin: 0; }
.scp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.scp__row { width: 100%; display: grid; grid-template-columns: 7rem 1fr; gap: 0.1rem 0.5rem; text-align: left; padding: 0.4rem 0.5rem; border: 1px solid #e4e7ec; border-radius: 6px; background: #fff; cursor: pointer; }
.scp__kind { font-weight: 600; }
.scp__stands { color: #475467; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scp__status { grid-column: 1 / -1; font-size: 0.78rem; color: #475467; margin: 0; }
.scp__status[data-status='accepted'], .scp__status[data-status='applied'] { color: #067647; }
.scp__status[data-status='returned'], .scp__status[data-status='rejected'] { color: #b42318; }
.scp__back { align-self: flex-start; background: none; border: 0; color: #1a73e8; cursor: pointer; padding: 0; }
.scp h4 { margin: 0; font-size: 0.9rem; }
.scp__problems { margin: 0; padding-left: 1.1rem; color: #b42318; }
.scp__ok { color: #067647; margin: 0; }
.scp__note { background: #f2f4f7; border-radius: 6px; padding: 0.4rem 0.5rem; margin: 0; }
.scp__actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.scp__btn { border: 1px solid #d0d5dd; background: #fff; border-radius: 6px; padding: 0.3rem 0.7rem; cursor: pointer; }
.scp__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.scp__btn--primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
.scp__btn--danger { color: #b42318; border-color: #fda29b; }
.scp__decide { display: flex; flex-direction: column; gap: 0.3rem; border-top: 1px solid #e4e7ec; padding-top: 0.5rem; }
.scp__decide textarea { width: 100%; border: 1px solid #d0d5dd; border-radius: 6px; padding: 0.3rem 0.5rem; font: inherit; }
</style>
