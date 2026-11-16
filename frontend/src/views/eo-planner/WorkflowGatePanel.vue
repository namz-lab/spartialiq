<script setup lang="ts">
// What stands between this case and a determination, as the EO Planning working workflow sets it: the lane, the committee's resolution, the
// statutory clock (with the applicant's written extension), the check against ministerial directions (step 5) and the referrals sent out.
// The server decides; this shows what it will ask for and records the EO's steps.
import { ref, watch, computed } from 'vue'
import { useEoNav } from '@/eo-planner/useEoNav'
import { eoWorkflowApi, serverMessage, LANE_LABEL, type CaseLane, type Referral, type StatutoryKey } from '@/services/eoWorkflow'

const props = defineProps<{ permitId: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const nav = useEoNav()

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

// The Act's questions (working workflow, section 4): the EO answers yes or no; a decision waits for every answer.
const draft = ref<Record<string, boolean | null>>({})
const CHECK_REFERRAL: Record<string, StatutoryKey> = { road_within_200m: 'road', aviation_olz: 'aviation', neighbouring_authority: 'neighbouring', agricultural_subdivision: 'agriculture' }
const COPY_KEY: Record<string, StatutoryKey> = { surveyor_general: 'surveyor_general', registrar: 'registrar' }

async function load() {
  error.value = null
  try {
    const [l, r] = await Promise.all([eoWorkflowApi.lane(props.permitId), eoWorkflowApi.referrals({ permit: props.permitId })])
    lane.value = l
    referrals.value = r
    draft.value = Object.fromEntries(l.checks.map(c => [c.key, c.answer]))
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
const dirtyChecks = computed(() => (lane.value?.checks ?? []).some(c => draft.value[c.key] !== c.answer && typeof draft.value[c.key] === 'boolean'))
const saveChecks = () => run('chk', async () => {
  const answers = Object.fromEntries(Object.entries(draft.value).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
  await eoWorkflowApi.recordStatutoryChecks(props.permitId, answers)
})
const referTo = (key: StatutoryKey, body: string, section: string) => run('st' + key, async () => {
  await eoWorkflowApi.createReferral({
    permit_app_id: props.permitId, kind: 'statutory', tier: 'mandatory', body: body.charAt(0).toUpperCase() + body.slice(1), statutory_key: key,
    legal_basis: section, question: 'Please comment on this application. The Act gives you one month (' + section + ').',
  })
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

        <p class="wg-line"><strong>Clock.</strong>{{ ' ' }}
          <template v-if="lane.deemed_on">
            Deemed refused after <strong>{{ fmt(lane.deemed_on) }}</strong><template v-if="lane.extension_until"> (the applicant extended it in writing)</template>.
            An approval after that date is refused.
          </template>
          <template v-else>Not acknowledged, so the Act's period has not started.</template>
          <button v-if="lane.deemed_on" class="eodr-btn ghost sm" type="button" @click="showExt = !showExt">Record the applicant's written extension</button>
        </p>
        <ul v-if="lane.milestones" class="wg-list wg-dates" data-testid="milestones">
          <li>Ask the applicant for an extension by <strong>{{ fmt(lane.milestones.ask_extension_by) }}</strong></li>
          <li>Committee to resolve by <strong>{{ fmt(lane.milestones.resolve_by) }}</strong></li>
          <li>Deemed refused after <strong>{{ fmt(lane.milestones.deemed_on) }}</strong></li>
        </ul>
        <div v-if="showExt" class="wg-form">
          <label>New date <input v-model="extUntil" type="date" /></label>
          <label>Where the applicant's letter is filed
            <input v-model="extEvidence" type="text" placeholder="Letter of the applicant dated 3 November, file 12" /></label>
          <button class="eodr-btn ok sm" type="button" :disabled="!extUntil || extEvidence.trim().length < 5 || busy === 'ext'" @click="saveExtension">Record extension</button>
        </div>

        <p class="wg-line"><strong>Ministerial directions.</strong>{{ ' ' }}
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

        <div class="wg-checks" data-testid="statutory-checks">
          <p class="wg-line"><strong>The Act's questions.</strong>
            <span v-if="lane.checks_unanswered.length" class="wg-bad">{{ lane.checks_unanswered.length }} not answered.</span>
            <span v-else>All answered.</span>
            An approval waits for every answer; a refusal does not.</p>
          <ul class="wg-qs">
            <li v-for="c in lane.checks" :key="c.key">
              <span class="wg-q">{{ c.label }} <em>({{ c.section }})</em></span>
              <span class="wg-yn" role="radiogroup" :aria-label="c.label">
                <label><input type="radio" :name="'chk-' + c.key" :checked="draft[c.key] === true" @change="draft[c.key] = true" /> Yes</label>
                <label><input type="radio" :name="'chk-' + c.key" :checked="draft[c.key] === false" @change="draft[c.key] = false" /> No</label>
              </span>
            </li>
          </ul>
          <button v-if="dirtyChecks" class="eodr-btn ok sm" type="button" :disabled="busy === 'chk'" @click="saveChecks">Save answers</button>
          <ul v-if="lane.referrals_waiting.length" class="wg-list">
            <li v-for="w in lane.referrals_waiting" :key="w.key">
              <span class="wg-bad">Referral to {{ w.body }}: {{ w.why }}.</span>
              <button v-if="w.why === 'not sent'" class="eodr-btn sm" type="button" :disabled="busy === 'st' + CHECK_REFERRAL[w.key]"
                      @click="referTo(CHECK_REFERRAL[w.key], w.body, lane.checks.find(c => c.key === w.key)?.section ?? '')">Record the referral</button>
            </li>
          </ul>
        </div>

        <p class="wg-line"><strong>Public notice.</strong>
          <template v-if="!lane.notice_required">Not required for this case.</template>
          <template v-else-if="!lane.notice_missing.length">Required (s.26(3)) and complete.</template>
          <template v-else><span class="wg-bad">Required (s.26(3)) and not complete:</span> {{ lane.notice_missing.join('; ') }}.
            <button class="eodr-btn sm" type="button" @click="nav.go('notification')">Open Public notice</button></template>
        </p>

        <p class="wg-line"><strong>Objections.</strong>
          <template v-if="!lane.objection_problems.length">None outstanding.</template>
          <template v-else><span class="wg-bad">Not yet dealt with:</span> {{ lane.objection_problems.join('; ') }}.
            <button class="eodr-btn sm" type="button" @click="nav.go('notification')">Open Public notice</button></template>
        </p>

        <div v-if="lane.copies_due.length" class="wg-line" data-testid="copies-due">
          <strong>Copies due after the permit is issued.</strong>
          <ul class="wg-list">
            <li v-for="x in lane.copies_due" :key="x.key">
              A copy to {{ x.body }} ({{ x.section }}):
              <template v-if="x.recorded">recorded in the log.</template>
              <template v-else>
                <span class="wg-bad">not yet recorded.</span>
                <button class="eodr-btn sm" type="button" :disabled="busy === 'st' + x.key" @click="referTo(COPY_KEY[x.key], x.body, x.section)">Record that it was sent</button>
              </template>
            </li>
          </ul>
        </div>

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
.eodr-card { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); overflow: hidden; }
.eodr-card > header { padding: var(--ent-s2) var(--ent-s3); background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.eodr-card-body { padding: var(--ent-s3) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.eodr-muted { color: var(--ent-text-3); }
.eodr-btn { display: inline-flex; align-items: center; margin-left: var(--ent-s2); min-height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r); cursor: pointer; background: var(--ent-surface); color: var(--ent-text);
  font-family: var(--ent-font); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-medium); }
.eodr-btn:hover:not(:disabled) { background: var(--ent-surface-2); }
.eodr-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.eodr-btn.ok { background: var(--ent-success); border-color: transparent; color: var(--ent-text-on-accent); margin-left: 0; }
.wg { display: grid; gap: var(--ent-s3); }
.wg-line { margin: 0; line-height: 1.5; }
.wg-dates { color: var(--ent-text-2); }
.wg-qs { list-style: none; margin: 0 0 var(--ent-s2); padding: 0; display: grid; gap: var(--ent-s1); }
.wg-qs li { display: flex; justify-content: space-between; gap: var(--ent-s3); align-items: baseline; border-bottom: 1px solid var(--ent-line); padding: 3px 0; }
.wg-q em { color: var(--ent-text-3); font-style: normal; }
.wg-yn { display: inline-flex; gap: var(--ent-s3); flex-shrink: 0; }
.wg-yn label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
.wg-list { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; }
.wg-bad { color: #b3261e; font-weight: 600; }
.wg-err { margin: 0; color: #b3261e; }
.wg-form { display: grid; gap: 0.4rem; padding: 0.5rem; border: 1px solid #d0d5dd; border-radius: 6px; }
.wg-form label { display: grid; gap: 0.15rem; font-size: 0.8rem; }
.wg-form input, .wg-form select, .wg-form textarea { font: inherit; padding: 0.3rem 0.4rem; }
</style>
