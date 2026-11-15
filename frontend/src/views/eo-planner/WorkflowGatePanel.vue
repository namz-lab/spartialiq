<script setup lang="ts">
// What stands between this case and a determination, as the EO Planning working workflow sets it: the lane, the committee's resolution, the
// statutory clock (with the applicant's written extension), the check against ministerial directions (step 5) and the referrals sent out.
// The server decides; this shows what it will ask for and records the EO's steps.
import { ref, watch, computed } from 'vue'
import { eoWorkflowApi, serverMessage, LANE_LABEL, type CaseLane, type Referral } from '@/services/eoWorkflow'

const props = defineProps<{ permitId: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const lane = ref<CaseLane | null>(null)
const referrals = ref<Referral[]>([])
const error = ref<string | null>(null)
const busy = ref<string | null>(null)

const extUntil = ref('')
const extEvidence = ref('')
const refBody = ref('Department of Spatial Planning and Development')
const refQuestion = ref('')
const refTier = ref<'mandatory' | 'precautionary' | 'routine'>('precautionary')
const showExt = ref(false)
const showRef = ref(false)

async function load() {
  error.value = null
  try {
    const [l, r] = await Promise.all([eoWorkflowApi.lane(props.permitId), eoWorkflowApi.referrals({ permit: props.permitId })])
    lane.value = l
    referrals.value = r
  } catch (e) { error.value = serverMessage(e, 'Could not read the workflow position of this case') }
}
watch(() => props.permitId, load, { immediate: true })

async function run(key: string, fn: () => Promise<void>) {
  busy.value = key; error.value = null
  try { await fn(); await load(); emit('changed') } catch (e) { error.value = serverMessage(e, 'Could not record that') } finally { busy.value = null }
}

const checkDirections = () => run('dir', () => eoWorkflowApi.recordDirectionCheck(props.permitId))
const saveExtension = () => run('ext', async () => {
  await eoWorkflowApi.recordExtension(props.permitId, extUntil.value, extEvidence.value.trim())
  showExt.value = false; extUntil.value = ''; extEvidence.value = ''
})
const sendReferral = () => run('ref', async () => {
  await eoWorkflowApi.createReferral({ permit_app_id: props.permitId, kind: 'department', tier: refTier.value, body: refBody.value.trim(), question: refQuestion.value.trim() })
  showRef.value = false; refQuestion.value = ''
})
const noReply = (r: Referral) => run('nr' + r.id, async () => { await eoWorkflowApi.answerReferral(r.id, { no_reply: true, council_action: 'Proceeded without a reply by the reply-by date.' }) })

const fmt = (d: string | null | undefined) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const committeeLine = computed(() => {
  const c = lane.value?.committee
  return c ? `The committee's latest resolution: ${c.outcome.replace(/_/g, ' ')}${c.heard_at ? ', heard ' + fmt(c.heard_at) : ''}.` : 'No committee resolution is recorded.'
})
</script>

<template>
  <section class="eodr-card" data-testid="workflow-gates">
    <header>Before you decide</header>
    <div class="eodr-card-body wg">
      <p v-if="error" class="wg-err" role="alert">{{ error }}</p>
      <template v-if="lane">
        <p class="wg-line"><strong>Lane.</strong> {{ LANE_LABEL[lane.lane] }}.
          <span v-if="!lane.open" class="wg-bad">Closed for the EO's own decision.</span></p>
        <ul v-if="lane.reasons.length" class="wg-list">
          <li v-for="r in lane.reasons" :key="r">{{ r }}</li>
        </ul>

        <p class="wg-line"><strong>Committee.</strong> {{ committeeLine }}
          A decision must match it; without one, only the committee's lane stands until the council's delegation is recorded.</p>

        <p class="wg-line"><strong>Clock.</strong>
          <template v-if="lane.deemed_on">
            Deemed refused after <strong>{{ fmt(lane.deemed_on) }}</strong><template v-if="lane.extension_until"> (the applicant extended it in writing)</template>.
            An approval after that date is refused.
          </template>
          <template v-else>Not acknowledged, so the Act's period has not started.</template>
          <button v-if="lane.deemed_on" class="eodr-btn ghost sm" type="button" @click="showExt = !showExt">Record the applicant's written extension</button>
        </p>
        <div v-if="showExt" class="wg-form">
          <label>New date <input v-model="extUntil" type="date" /></label>
          <label>Where the applicant's letter is filed
            <input v-model="extEvidence" type="text" placeholder="Letter of the applicant dated 3 November, file 12" /></label>
          <button class="eodr-btn ok sm" type="button" :disabled="!extUntil || extEvidence.trim().length < 5 || busy === 'ext'" @click="saveExtension">Record extension</button>
        </div>

        <p class="wg-line"><strong>Ministerial directions.</strong>
          <template v-if="lane.binding_directions.length">
            <span class="wg-bad">A direction applies:</span>
            <template v-for="d in lane.binding_directions" :key="d.id"> {{ d.reference || d.section }}: {{ d.summary }}</template>
          </template>
          <template v-else-if="lane.direction_check_current">Checked {{ fmt(lane.direction_checked_at) }}; none applies.</template>
          <template v-else>
            <span class="wg-bad">Not checked yet</span> (or a direction was recorded since).
            <button class="eodr-btn ghost sm" type="button" :disabled="busy === 'dir'" @click="checkDirections">I have checked: none applies</button>
          </template>
        </p>

        <div class="wg-refs">
          <p class="wg-line"><strong>Referrals.</strong> {{ referrals.length ? '' : 'None sent for this case.' }}
            <button class="eodr-btn ghost sm" type="button" @click="showRef = !showRef">Refer to the Department</button></p>
          <ul v-if="referrals.length" class="wg-list">
            <li v-for="r in referrals" :key="r.id">
              {{ r.body }}, sent {{ fmt(r.sent_on) }}: {{ r.question }}
              <em v-if="r.answered_on"> Answered {{ fmt(r.answered_on) }}: {{ r.advice }}</em>
              <em v-else-if="r.no_reply"> No reply; the council proceeded.</em>
              <template v-else>
                Reply by {{ fmt(r.reply_by) }}<span v-if="r.overdue" class="wg-bad"> (overdue)</span>.
                <button v-if="r.overdue" class="eodr-btn ghost sm" type="button" @click="noReply(r)">Record "no reply"</button>
              </template>
            </li>
          </ul>
          <div v-if="showRef" class="wg-form">
            <label>To <input v-model="refBody" type="text" /></label>
            <label>Why <select v-model="refTier">
              <option value="mandatory">Mandatory (the Act requires it)</option>
              <option value="precautionary">Precautionary</option>
              <option value="routine">Routine</option>
            </select></label>
            <label>The question <textarea v-model="refQuestion" rows="2" placeholder="What the council proposes and what it asks the Department"></textarea></label>
            <button class="eodr-btn ok sm" type="button" :disabled="!refBody.trim() || !refQuestion.trim() || busy === 'ref'" @click="sendReferral">Record referral (reply-by 21 days)</button>
          </div>
        </div>
      </template>
      <p v-else-if="!error" class="eodr-muted">Reading the case…</p>
    </div>
  </section>
</template>

<style scoped>
.wg { display: grid; gap: 0.5rem; font-size: 0.85rem; }
.wg-line { margin: 0; line-height: 1.5; }
.wg-list { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; }
.wg-bad { color: #b3261e; font-weight: 600; }
.wg-err { margin: 0; color: #b3261e; }
.wg-form { display: grid; gap: 0.4rem; padding: 0.5rem; border: 1px solid #d0d5dd; border-radius: 6px; }
.wg-form label { display: grid; gap: 0.15rem; font-size: 0.8rem; }
.wg-form input, .wg-form select, .wg-form textarea { font: inherit; padding: 0.3rem 0.4rem; }
</style>
