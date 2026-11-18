<script setup lang="ts">
// Roads and Works' engineering referrals: the planning applications circulated to Engineering, and the department's reply.
// Backend src/routes/roads-works-referrals.js, migration 253.
//
// The reply carries three things the law asks of the council and that only Roads and Works can judge:
//   1. the infrastructure-cost test (Regional, Town and Country Planning Act s.26(5)): would the development cause the
//      council additional or premature spending on roads, parking, drainage, sewerage or water; and if so, the condition
//      that makes the applicant meet or share it;
//   2. for a subdivision, its roads (s.41): are the road reserves adequate, the widest one (over 24 m, s.41(3) applies),
//      and the length of new road;
//   3. an access onto a council road, which the council allows as road authority (Roads Act).
// The District Engineer and the Civil Engineering Technician reply; the Foreman reads.
import { computed, onMounted, ref, watch } from 'vue'
import { Info, TriangleAlert, Send, RefreshCw } from 'lucide-vue-next'
import { roadsWorksApi, type CouncilRoad, type EngineeringReferral, type EngineeringResponse } from '@/services/roadsWorks'

const state = ref<'open' | 'answered'>('open')
const list = ref<EngineeringReferral[]>([])
const canReply = ref(false)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const r = await roadsWorksApi.referrals(state.value)
    list.value = r.referrals
    canReply.value = r.can_reply
  } catch { error.value = 'The referrals could not be read. Try again in a moment.' } finally { loading.value = false }
}
onMounted(load)
watch(state, load)

const ref_ = (r: EngineeringReferral) => r.tpd_reference || r.dev_register_no || r.permit_app_id.slice(0, 8).toUpperCase()
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const TYPE: Record<string, string> = { new_building: 'New building', alteration: 'Alteration', extension: 'Extension', change_of_use: 'Change of use', subdivision: 'Subdivision', consolidation: 'Consolidation', rezoning: 'Rezoning', other: 'Other' }
const RESPONSE: Record<string, string> = { no_objection: 'No objection', conditional_approval: 'With conditions', objection: 'Objection', pending: 'Not answered', no_response: 'No response' }

// ── The reply ──────────────────────────────────────────────────────────
const open = ref<EngineeringReferral | null>(null)
const HEADS = [
  ['roads', 'New roads, or improving existing roads'], ['parking', 'Parking'], ['drainage', 'Drainage (stormwater)'],
  ['sewerage', 'Sewerage'], ['water', 'Water supply'],
] as const
type Head = (typeof HEADS)[number][0]
const blank = () => ({
  response_status: '' as EngineeringResponse | '', notes: '',
  cost: { roads: null, parking: null, drainage: null, sewerage: null, water: null } as Record<Head, boolean | null>,
  estimated_cost: '', currency: 'USD' as 'USD' | 'ZWG', condition: '',
  reserves: null as boolean | null, widest: '', length: '',
  accessRoad: null as CouncilRoad | null, accessApproved: null as boolean | null, accessConditions: '',
})
const form = ref(blank())
const busy = ref(false)
const formError = ref<string | null>(null)
const flags = ref<string[]>([])
const isSubdivision = computed(() => !!open.value && ['subdivision', 'consolidation'].includes(open.value.development_type))
const anyCost = computed(() => HEADS.some(([h]) => form.value.cost[h] === true))

function start(r: EngineeringReferral) { open.value = r; form.value = blank(); formError.value = null; flags.value = [] }

const roadQuery = ref('')
const roadHits = ref<CouncilRoad[]>([])
let roadTimer: ReturnType<typeof setTimeout> | null = null
watch(roadQuery, (q) => {
  if (roadTimer) clearTimeout(roadTimer)
  if (q.trim().length < 2) { roadHits.value = []; return }
  roadTimer = setTimeout(async () => { try { roadHits.value = await roadsWorksApi.councilRoads(q.trim()) } catch { roadHits.value = [] } }, 300)
})

// v-model on a number input gives a number once typed, a string when cleared
const num = (v: string | number) => (String(v).trim() === '' ? null : Number(v))
async function send() {
  if (!open.value || !form.value.response_status) { formError.value = 'Choose the department\'s reply.'; return }
  busy.value = true
  formError.value = null
  try {
    const res = await roadsWorksApi.reply(open.value.id, {
      response_status: form.value.response_status,
      notes: form.value.notes.trim() || undefined,
      cost: { ...form.value.cost, estimated_cost: num(form.value.estimated_cost), currency: form.value.currency, condition: form.value.condition.trim() || undefined },
      subdivision: isSubdivision.value ? { road_reserves_adequate: form.value.reserves, widest_road_reserve_m: num(form.value.widest), new_road_length_m: num(form.value.length) } : undefined,
      access: form.value.accessRoad || form.value.accessApproved !== null
        ? { road_asset_id: form.value.accessRoad?.id ?? null, approved: form.value.accessApproved, conditions: form.value.accessConditions.trim() || undefined }
        : undefined,
    })
    flags.value = res.flags
    if (!res.flags.length) open.value = null
    await load()
  } catch (e: unknown) {
    formError.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'The reply could not be sent.'
  } finally { busy.value = false }
}
</script>

<template>
  <section class="rf" aria-labelledby="rf-h" data-testid="referrals-panel">
    <header class="rf-head">
      <div>
        <h2 id="rf-h" class="rf-title"><Send :size="18" aria-hidden="true" /> Engineering referrals</h2>
        <p class="rf-sub">Planning applications the planning office has circulated to Engineering. The reply goes back on the case, for the EO's determination.</p>
      </div>
      <div class="rf-tabs" role="group" aria-label="Which referrals">
        <button type="button" :aria-pressed="state === 'open'" @click="state = 'open'">Waiting for a reply</button>
        <button type="button" :aria-pressed="state === 'answered'" @click="state = 'answered'">Answered</button>
        <button type="button" class="rf-icon" :disabled="loading" title="Re-read" @click="load"><RefreshCw :size="14" aria-hidden="true" /><span class="rf-sr">Re-read</span></button>
      </div>
    </header>

    <p v-if="error" class="rf-msg is-error" role="alert"><TriangleAlert :size="16" aria-hidden="true" />{{ error }}</p>
    <p v-else-if="loading && !list.length" class="rf-msg">Reading the referrals…</p>
    <p v-else-if="!list.length" class="rf-msg"><Info :size="16" aria-hidden="true" />{{ state === 'open' ? 'Nothing is waiting for Engineering\'s reply.' : 'No referral has been answered yet.' }}</p>

    <ul v-else class="rf-list">
      <li v-for="r in list" :key="r.id" class="rf-item" :class="{ 'is-blocking': r.blocking, 'is-overdue': r.overdue }">
        <div class="rf-main">
          <strong class="rf-ref">{{ ref_(r) }}</strong> · {{ r.applicant_name }}
          <span class="rf-meta">{{ TYPE[r.development_type] ?? r.development_type }}<template v-if="r.stand_number"> · Stand {{ r.stand_number }}</template><template v-if="r.suburb_ward"> · {{ r.suburb_ward }}</template></span>
          <span v-if="r.description" class="rf-desc">{{ r.description }}</span>
          <span class="rf-tags">
            <span v-if="r.blocking" class="rf-tag is-warn">Blocking: the case cannot be decided without this reply</span>
            <span v-if="r.overdue" class="rf-tag is-bad">Reply overdue (was due {{ day(r.response_due_at) }})</span>
            <span v-else-if="r.response_due_at && !r.response_received_at" class="rf-tag">Reply due {{ day(r.response_due_at) }}</span>
            <span v-if="r.near_state_road" class="rf-tag">Near a State road: the roads minister is consulted too</span>
            <span v-if="r.response_received_at" class="rf-tag">{{ RESPONSE[r.response_status] ?? r.response_status }}, {{ day(r.response_received_at) }}</span>
          </span>
        </div>
        <button v-if="canReply && state === 'open'" type="button" class="rf-btn is-primary" @click="start(r)">Reply</button>
      </li>
    </ul>

    <form v-if="open" class="rf-form" aria-labelledby="rf-form-h" @submit.prevent="send">
      <h3 id="rf-form-h">Reply on {{ ref_(open) }}: {{ TYPE[open.development_type] ?? open.development_type }}, {{ open.applicant_name }}</h3>

      <fieldset class="rf-set">
        <legend>The infrastructure-cost test <span class="rf-law">Regional, Town and Country Planning Act s.26(5)</span></legend>
        <p class="rf-help">Would this development cause the council additional or premature spending on any of these? Answer each.</p>
        <div v-for="[key, label] in HEADS" :key="key" class="rf-yn">
          <span>{{ label }}</span>
          <label><input v-model="form.cost[key]" type="radio" :name="`cost-${key}`" :value="true" /> Yes</label>
          <label><input v-model="form.cost[key]" type="radio" :name="`cost-${key}`" :value="false" /> No</label>
        </div>
        <template v-if="anyCost">
          <div class="rf-grid">
            <label>Estimated cost <input v-model="form.estimated_cost" type="number" min="0" step="0.01" /></label>
            <label>Currency <select v-model="form.currency"><option>USD</option><option>ZWG</option></select></label>
          </div>
          <label class="rf-wide">The condition that makes the applicant meet or share the cost, on or off the site
            <textarea v-model="form.condition" rows="2" placeholder="e.g. The applicant pays US$4 000 towards gravelling the access road before the permit is issued." />
          </label>
        </template>
      </fieldset>

      <fieldset v-if="isSubdivision" class="rf-set">
        <legend>The subdivision's roads <span class="rf-law">s.41</span></legend>
        <div class="rf-yn">
          <span>Are the layout's road reserves adequate?</span>
          <label><input v-model="form.reserves" type="radio" name="reserves" :value="true" /> Yes</label>
          <label><input v-model="form.reserves" type="radio" name="reserves" :value="false" /> No</label>
        </div>
        <div class="rf-grid">
          <label>Widest road reserve (m) <input v-model="form.widest" type="number" min="0" step="0.5" /></label>
          <label>Length of new road (m) <input v-model="form.length" type="number" min="0" step="1" /></label>
        </div>
        <p v-if="Number(form.widest) > 24" class="rf-note">Over 24 m: only 24 m of the reserve passes to the council free of cost; the excess is land for public purposes or is acquired under s.45 (s.41(3)).</p>
      </fieldset>

      <fieldset class="rf-set">
        <legend>Access onto a council road <span class="rf-law">Roads Act: the council is the road authority</span></legend>
        <p v-if="open.near_state_road" class="rf-note">The site is near a State road: access to that road is the roads minister's, through the referral already recorded on the case.</p>
        <label class="rf-wide">Council road (name, code or ward)
          <input v-model="roadQuery" type="search" placeholder="Search the road register" />
        </label>
        <ul v-if="roadHits.length && !form.accessRoad" class="rf-hits">
          <li v-for="h in roadHits" :key="h.id"><button type="button" @click="form.accessRoad = h; roadHits = []">{{ h.name || 'Unnamed road' }} · {{ h.asset_code }}<template v-if="h.council_class"> · {{ h.council_class }}</template><template v-if="h.ward"> · {{ h.ward }}</template></button></li>
        </ul>
        <p v-if="form.accessRoad" class="rf-chosen">{{ form.accessRoad.name || 'Unnamed road' }} · {{ form.accessRoad.asset_code }} <button type="button" class="rf-link" @click="form.accessRoad = null">Change</button></p>
        <div v-if="form.accessRoad" class="rf-yn">
          <span>Is the access allowed?</span>
          <label><input v-model="form.accessApproved" type="radio" name="access" :value="true" /> Yes</label>
          <label><input v-model="form.accessApproved" type="radio" name="access" :value="false" /> No</label>
        </div>
        <label v-if="form.accessRoad" class="rf-wide">Conditions of the access <input v-model="form.accessConditions" type="text" maxlength="4000" placeholder="e.g. A 450 mm culvert under the access, to the council's design" /></label>
      </fieldset>

      <fieldset class="rf-set">
        <legend>The department's reply</legend>
        <div class="rf-yn">
          <label><input v-model="form.response_status" type="radio" name="resp" value="no_objection" /> No objection</label>
          <label><input v-model="form.response_status" type="radio" name="resp" value="conditional_approval" /> No objection, with conditions</label>
          <label><input v-model="form.response_status" type="radio" name="resp" value="objection" /> Objection</label>
        </div>
        <label class="rf-wide">Notes, conditions or reasons <textarea v-model="form.notes" rows="3" /></label>
      </fieldset>

      <p v-if="formError" class="rf-msg is-error" role="alert">{{ formError }}</p>
      <p v-for="f in flags" :key="f" class="rf-msg is-warn" role="status">Sent. {{ f }}</p>
      <div class="rf-actions">
        <button type="button" class="rf-btn" @click="open = null">{{ flags.length ? 'Close' : 'Cancel' }}</button>
        <button v-if="!flags.length" type="submit" class="rf-btn is-primary" :disabled="busy">{{ busy ? 'Sending…' : 'Send the reply' }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.rf { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1.25rem 1.5rem; }
.rf-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; margin-bottom: 1rem; }
.rf-title { display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 1.125rem; font-weight: 600; }
.rf-sub { margin: 0.25rem 0 0; color: var(--ent-text-2); font-size: 0.875rem; max-width: 46rem; }
.rf-tabs { display: flex; gap: 0.25rem; }
.rf-tabs button { padding: 0.375rem 0.75rem; border: 1px solid var(--ent-line); border-radius: 6px; background: var(--ent-surface); color: var(--ent-text-2); font: inherit; font-size: 0.8125rem; cursor: pointer; }
.rf-tabs button[aria-pressed='true'] { background: var(--ent-accent-soft); color: var(--ent-accent); border-color: var(--ent-accent); font-weight: 600; }
.rf-msg { display: flex; gap: 0.5rem; align-items: center; padding: 0.625rem 0.75rem; border-radius: 6px; background: var(--ent-surface-2); color: var(--ent-text-2); font-size: 0.875rem; }
.rf-msg.is-error { background: var(--ent-danger-soft); color: var(--ent-danger); }
.rf-msg.is-warn { background: var(--ent-warning-soft); color: var(--ent-warning); }
.rf-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.rf-item { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; padding: 0.75rem 1rem; border: 1px solid var(--ent-line); border-radius: 6px; }
.rf-item.is-blocking { box-shadow: inset 3px 0 0 var(--ent-warning); }
.rf-item.is-overdue { box-shadow: inset 3px 0 0 var(--ent-danger); }
.rf-ref { font-variant-numeric: tabular-nums; }
.rf-meta, .rf-desc { display: block; font-size: 0.8125rem; color: var(--ent-text-2); }
.rf-tags { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.375rem; }
.rf-tag { font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 999px; background: var(--ent-surface-2); color: var(--ent-text-2); }
.rf-tag.is-warn { background: var(--ent-warning-soft); color: var(--ent-warning); }
.rf-tag.is-bad { background: var(--ent-danger-soft); color: var(--ent-danger); }
.rf-btn { padding: 0.375rem 0.75rem; border: 1px solid var(--ent-line); border-radius: 6px; background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: 0.8125rem; cursor: pointer; white-space: nowrap; }
.rf-btn.is-primary { background: var(--ent-accent); border-color: var(--ent-accent); color: #fff; }
.rf-btn:disabled { opacity: 0.6; }
.rf-form { margin-top: 1rem; padding: 1rem; border: 1px solid var(--ent-line); border-radius: 8px; background: var(--ent-surface-2); display: grid; gap: 0.75rem; }
.rf-form h3 { margin: 0; font-size: 1rem; }
.rf-set { border: 1px solid var(--ent-line); border-radius: 6px; padding: 0.75rem 1rem; background: var(--ent-surface); margin: 0; display: grid; gap: 0.5rem; }
.rf-set legend { font-weight: 600; font-size: 0.875rem; padding: 0 0.25rem; }
.rf-law { font-weight: 400; color: var(--ent-text-3); font-size: 0.75rem; margin-left: 0.375rem; }
.rf-help, .rf-note { margin: 0; font-size: 0.8125rem; color: var(--ent-text-2); }
.rf-note { color: var(--ent-warning); }
.rf-yn { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; align-items: center; font-size: 0.875rem; }
.rf-yn > span { flex: 1 1 16rem; }
.rf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; }
.rf-grid label, .rf-wide { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8125rem; color: var(--ent-text-2); }
.rf-form input[type='number'], .rf-form input[type='text'], .rf-form input[type='search'], .rf-form select, .rf-form textarea { font: inherit; font-size: 0.875rem; padding: 0.375rem 0.5rem; border: 1px solid var(--ent-line); border-radius: 4px; background: var(--ent-surface); color: var(--ent-text); }
.rf-hits { list-style: none; margin: 0; padding: 0; border: 1px solid var(--ent-line); border-radius: 4px; max-height: 12rem; overflow-y: auto; }
.rf-hits button { display: block; width: 100%; text-align: left; padding: 0.375rem 0.5rem; border: 0; background: none; font: inherit; font-size: 0.8125rem; cursor: pointer; }
.rf-hits button:hover { background: var(--ent-surface-2); }
.rf-chosen { margin: 0; font-size: 0.875rem; }
.rf-link { border: 0; background: none; color: var(--ent-accent); font: inherit; cursor: pointer; text-decoration: underline; }
.rf-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
.rf-icon { display: inline-flex; align-items: center; }
.rf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
