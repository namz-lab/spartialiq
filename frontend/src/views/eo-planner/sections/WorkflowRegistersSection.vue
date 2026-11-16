<script setup lang="ts">
// The registers the EO Planning working workflow keeps outside any one case (docs/workflows/eo-planning-working-workflow.md):
//   Referrals: what the council sent to the Department, the Minister and others, and what came back (sections 3 and 4).
//   Directions: the ministerial directions in force (ss.29, 69, 70), which a decision is checked against (step 5).
//   Switches: S1 to S8, the council's written confirmations that open the EO's own lane (section 7). Off until recorded.
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
  eoWorkflowApi, serverMessage, type Referral, type MinisterialDirection, type WorkflowSwitch,
} from '@/services/eoWorkflow'

const auth = useAuthStore()
type Tab = 'referrals' | 'directions' | 'switches'
const tab = ref<Tab>('referrals')
const referrals = ref<Referral[]>([])
const directions = ref<MinisterialDirection[]>([])
const switches = ref<WorkflowSwitch[]>([])
const error = ref<string | null>(null)
const loading = ref(true)
const onlyOpen = ref(true)

// Only the CEO (accounting officer) and an administrator record a council confirmation; the EO reads them.
const canSetSwitches = computed(() => ['accounting_officer', 'admin'].includes(String((auth.user as { role?: string } | null)?.role ?? '')))

async function load() {
  loading.value = true; error.value = null
  try {
    ;[referrals.value, directions.value, switches.value] = await Promise.all([
      eoWorkflowApi.referrals({ open: onlyOpen.value }), eoWorkflowApi.directions(), eoWorkflowApi.switches(),
    ])
  } catch (e) { error.value = serverMessage(e, 'Could not read the registers') } finally { loading.value = false }
}
onMounted(load)

const fmt = (d: string | null | undefined) => (d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// ── a topic referral (not tied to a case: a local plan, a layout, a revision) ──
const showRef = ref(false)
const ref1 = ref({ body: 'Department of Spatial Planning and Development', tier: 'mandatory' as Referral['tier'], topic: '', legal_basis: '', question: '' })
async function sendReferral() {
  error.value = null
  try {
    await eoWorkflowApi.createReferral({ kind: 'department', tier: ref1.value.tier, body: ref1.value.body.trim(), topic: ref1.value.topic.trim(),
      legal_basis: ref1.value.legal_basis.trim() || undefined, question: ref1.value.question.trim() })
    showRef.value = false; ref1.value.topic = ''; ref1.value.question = ''; await load()
  } catch (e) { error.value = serverMessage(e, 'Could not record the referral') }
}
const answering = ref<string | null>(null)
const advice = ref('')
async function saveAdvice(r: Referral) {
  error.value = null
  try { await eoWorkflowApi.answerReferral(r.id, { advice: advice.value.trim() }); answering.value = null; advice.value = ''; await load() } catch (e) { error.value = serverMessage(e, 'Could not record the reply') }
}
async function noReply(r: Referral) {
  error.value = null
  try { await eoWorkflowApi.answerReferral(r.id, { no_reply: true, council_action: 'Proceeded without a reply by the reply-by date.' }); await load() } catch (e) { error.value = serverMessage(e, 'Could not record that') }
}

// ── directions ──
const showDir = ref(false)
const dir = ref({ reference: '', section: 's29' as MinisterialDirection['section'], received_on: '', summary: '', refers_to_minister: false, restricts: false })
async function addDirection() {
  error.value = null
  try { await eoWorkflowApi.createDirection({ ...dir.value, reference: dir.value.reference.trim() || undefined }); showDir.value = false; dir.value.summary = ''; await load() } catch (e) { error.value = serverMessage(e, 'Could not record the direction') }
}
async function endDirection(d: MinisterialDirection) {
  error.value = null
  try { await eoWorkflowApi.endDirection(d.id); await load() } catch (e) { error.value = serverMessage(e, 'Could not end the direction') }
}

// ── switches ──
const evidence = ref<Record<string, string>>({})
async function setSwitch(s: WorkflowSwitch, on: boolean) {
  error.value = null
  try { await eoWorkflowApi.setSwitch(s.key, on, on ? (evidence.value[s.key] ?? '').trim() : null); await load() } catch (e) { error.value = serverMessage(e, 'Could not change the switch') }
}
</script>

<template>
  <div class="wr" data-testid="workflow-registers">
    <div class="wr-tabs" role="tablist" aria-label="Registers">
      <button v-for="t in (['referrals', 'directions', 'switches'] as Tab[])" :key="t" role="tab" :aria-selected="tab === t"
              :class="{ on: tab === t }" @click="tab = t">
        {{ t === 'referrals' ? 'Referral log' : t === 'directions' ? 'Ministerial directions' : 'Switches' }}
      </button>
    </div>
    <p v-if="error" class="wr-err" role="alert">{{ error }}</p>
    <p v-if="loading" class="wr-muted">Reading the registers…</p>

    <!-- Referral log -->
    <section v-else-if="tab === 'referrals'">
      <div class="wr-bar">
        <label><input v-model="onlyOpen" type="checkbox" @change="load" /> Open only (no reply recorded yet)</label>
        <button class="wr-btn" type="button" @click="showRef = !showRef">Refer a matter to the Department</button>
      </div>
      <div v-if="showRef" class="wr-form">
        <label>To <input v-model="ref1.body" type="text" /></label>
        <label>Why <select v-model="ref1.tier">
          <option value="mandatory">Mandatory (the Act requires it)</option>
          <option value="precautionary">Precautionary</option>
          <option value="routine">Routine</option>
        </select></label>
        <label>The matter <input v-model="ref1.topic" type="text" placeholder="e.g. Layout for the Vungu growth point (s.43)" /></label>
        <label>Legal basis <input v-model="ref1.legal_basis" type="text" placeholder="e.g. RTCP Act s.43" /></label>
        <label>The question <textarea v-model="ref1.question" rows="2"></textarea></label>
        <button class="wr-btn ok" type="button" :disabled="!ref1.topic.trim() || !ref1.question.trim()" @click="sendReferral">Record referral (reply-by 21 days)</button>
      </div>
      <p v-if="!referrals.length" class="wr-muted">Nothing {{ onlyOpen ? 'awaiting a reply' : 'recorded' }}.</p>
      <table v-else class="wr-table">
        <thead><tr><th>Sent</th><th>To</th><th>Matter</th><th>Reply by</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in referrals" :key="r.id">
            <td>{{ fmt(r.sent_on) }}</td>
            <td>{{ r.body }}<br /><span class="wr-muted">{{ r.tier }}</span></td>
            <td>{{ r.topic || r.question }}<br /><span class="wr-muted">{{ r.legal_basis }}</span></td>
            <td :class="{ bad: r.overdue }">{{ fmt(r.reply_by) }}<template v-if="r.overdue"> (overdue)</template></td>
            <td>
              <template v-if="r.answered_on">Answered {{ fmt(r.answered_on) }}: {{ r.advice }}</template>
              <template v-else-if="r.no_reply">No reply. {{ r.council_action }}</template>
              <template v-else>Awaiting reply</template>
            </td>
            <td>
              <template v-if="!r.answered_on && !r.no_reply">
                <button class="wr-btn" type="button" @click="answering = answering === r.id ? null : r.id">Record reply</button>
                <button class="wr-btn" type="button" @click="noReply(r)">No reply</button>
                <div v-if="answering === r.id" class="wr-form">
                  <textarea v-model="advice" rows="2" placeholder="The advice received"></textarea>
                  <button class="wr-btn ok" type="button" :disabled="!advice.trim()" @click="saveAdvice(r)">Save</button>
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Directions -->
    <section v-else-if="tab === 'directions'">
      <div class="wr-bar">
        <span class="wr-muted">While a direction that refers cases to the Minister, or restricts them, is in force, decisions it covers are stopped.</span>
        <button class="wr-btn" type="button" @click="showDir = !showDir">Record a direction</button>
      </div>
      <div v-if="showDir" class="wr-form">
        <label>Reference <input v-model="dir.reference" type="text" /></label>
        <label>Under <select v-model="dir.section">
          <option value="s29">s.29 (call-in, reference to the Minister)</option>
          <option value="s69">s.69 (directions and guides)</option>
          <option value="s70">s.70 (default powers)</option>
          <option value="other">Other</option>
        </select></label>
        <label>Received on <input v-model="dir.received_on" type="date" /></label>
        <label>What it says <textarea v-model="dir.summary" rows="2"></textarea></label>
        <label><input v-model="dir.refers_to_minister" type="checkbox" /> It refers cases to the Minister</label>
        <label><input v-model="dir.restricts" type="checkbox" /> It restricts permits for a type of development</label>
        <button class="wr-btn ok" type="button" :disabled="!dir.received_on || !dir.summary.trim()" @click="addDirection">Record direction</button>
      </div>
      <p v-if="!directions.length" class="wr-muted">No directions recorded.</p>
      <table v-else class="wr-table">
        <thead><tr><th>Received</th><th>Reference</th><th>What it says</th><th>Effect</th><th></th></tr></thead>
        <tbody>
          <tr v-for="d in directions" :key="d.id">
            <td>{{ fmt(d.received_on) }}</td>
            <td>{{ d.reference || d.section }}</td>
            <td>{{ d.summary }}</td>
            <td>{{ d.in_force ? 'In force' : 'Ended ' + fmt(d.ended_on) }}<template v-if="d.refers_to_minister">; refers to the Minister</template><template v-if="d.restricts">; restricts</template></td>
            <td><button v-if="d.in_force" class="wr-btn" type="button" @click="endDirection(d)">End</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Switches -->
    <section v-else>
      <p class="wr-muted">Off until the written confirmation is recorded. {{ canSetSwitches ? '' : 'The CEO or an administrator records these; you can read them.' }}</p>
      <table class="wr-table">
        <thead><tr><th></th><th>What the council has confirmed</th><th>State</th><th v-if="canSetSwitches"></th></tr></thead>
        <tbody>
          <tr v-for="s in switches" :key="s.key">
            <td><strong>{{ s.key }}</strong></td>
            <td>{{ s.label }}</td>
            <td>
              <strong :class="s.is_on ? 'ok' : 'bad'">{{ s.is_on ? 'On' : 'Off' }}</strong>
              <template v-if="s.is_on"><br /><span class="wr-muted">{{ s.evidence }} ({{ fmt(s.confirmed_at) }}, {{ s.confirmed_by }})</span></template>
            </td>
            <td v-if="canSetSwitches">
              <template v-if="!s.is_on">
                <input v-model="evidence[s.key]" type="text" placeholder="The resolution, instrument or letter, and its date" aria-label="Written confirmation" />
                <button class="wr-btn ok" type="button" :disabled="(evidence[s.key] ?? '').trim().length < 5" @click="setSwitch(s, true)">Turn on</button>
              </template>
              <button v-else class="wr-btn" type="button" @click="setSwitch(s, false)">Turn off</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.wr { display: grid; gap: 0.75rem; padding: 1rem; font-size: 0.875rem; }
.wr-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid #d0d5dd; }
.wr-tabs button { background: none; border: 0; padding: 0.5rem 0.9rem; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
.wr-tabs button.on { border-bottom-color: #1a73e8; font-weight: 600; }
.wr-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
.wr-form { display: grid; gap: 0.4rem; padding: 0.6rem; border: 1px solid #d0d5dd; border-radius: 6px; margin-bottom: 0.6rem; }
.wr-form label { display: grid; gap: 0.15rem; }
.wr-form input[type='text'], .wr-form input[type='date'], .wr-form select, .wr-form textarea { font: inherit; padding: 0.3rem 0.4rem; }
.wr-table { width: 100%; border-collapse: collapse; }
.wr-table th, .wr-table td { text-align: left; vertical-align: top; padding: 0.45rem 0.6rem; border-bottom: 1px solid #e4e7ec; }
.wr-btn { font: inherit; padding: 0.25rem 0.6rem; margin-right: 0.3rem; cursor: pointer; border: 1px solid #98a2b3; background: #fff; border-radius: 4px; }
.wr-btn.ok { border-color: #1a73e8; color: #1a73e8; }
.wr-btn:disabled { opacity: 0.5; cursor: default; }
.wr-muted { color: #667085; }
.wr-err, .bad { color: #b3261e; }
.ok { color: #1b6e3c; }
</style>
