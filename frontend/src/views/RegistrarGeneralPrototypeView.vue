<script setup lang="ts">
// PROTOTYPE of a Registrar-General identity verification service (backend migration 258, src/routes/registrar-general-prototype.js),
// as its own console would show it. For demonstrating the design: verify, do not disclose. The register is fictional.
//
//   - How a client asks, and what it is told (the contract).
//   - Try it: ask as a client, with a client key.
//   - Who has asked what (the Registrar-General's audit of the use of the register), with the numbers masked.
import { onMounted, reactive, ref } from 'vue'
import { Fingerprint, Loader2, RefreshCw, Send } from 'lucide-vue-next'
import { rgPrototypeApi, RG_FIELD_LABEL, RG_OUTCOME_LABEL, RG_STATUS_LABEL, type RgAnswer, type RgConsole } from '@/services/persons'

const data = ref<RgConsole | null>(null)
const loadError = ref('')
async function load() {
  loadError.value = ''
  try { data.value = await rgPrototypeApi.console() } catch (err: unknown) {
    loadError.value = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'The console could not be read.'
  }
}
onMounted(load)

// The fictional people, and what each shows. The Registrar-General's own console may list them; a client never sees them.
const SCENARIOS = [
  { type: 'national_id', number: '63-2876543 X 27', surname: 'Phiri', first: 'Bernard', dob: '1979-04-12', shows: 'Everything agrees (Case 1, the extension)' },
  { type: 'national_id', number: '08-2345678 K 08', surname: 'Hlongwane', first: 'Lindiwe', dob: '1985-09-03', shows: 'Everything agrees (Case 2, the tuck shop)' },
  { type: 'national_id', number: '63-3011223 Q 63', surname: 'Khumalo', first: 'J.', dob: '', shows: 'First name given by initial: agrees in part' },
  { type: 'national_id', number: '63-3011223 Q 63', surname: 'Phiri', first: 'Jabulani', dob: '', shows: 'Someone else\'s ID: the surname does not agree' },
  { type: 'national_id', number: '63-2222333 B 27', surname: 'Moyo', first: 'Tendai', dob: '', shows: 'The holder is recorded as deceased' },
  { type: 'national_id', number: '75-1112223 D 75', surname: 'Mutasa', first: 'Farai', dob: '', shows: 'An ID cancelled and replaced' },
  { type: 'passport', number: 'FN777888', surname: 'Ncube', first: 'Sibongile', dob: '', shows: 'A passport reported lost or stolen' },
  { type: 'passport', number: 'FN654321', surname: 'Hlongwane', first: 'Lindiwe', dob: '', shows: 'An expired passport' },
  { type: 'national_id', number: '99-9999999 Z 99', surname: 'Nobody', first: '', dob: '', shows: 'No such document' },
]

const form = reactive({ document_type: 'national_id', document_number: '', surname: '', first_names: '', date_of_birth: '', purpose: 'demonstration', key: 'rg-prototype-vungu-demo-key' })
const asking = ref(false)
const answer = ref<RgAnswer | null>(null)
const askError = ref('')
function use(s: typeof SCENARIOS[number]) {
  Object.assign(form, { document_type: s.type, document_number: s.number, surname: s.surname, first_names: s.first, date_of_birth: s.dob })
  answer.value = null
}
async function ask() {
  asking.value = true
  askError.value = ''
  answer.value = null
  try {
    answer.value = await rgPrototypeApi.ask({
      document_type: form.document_type, document_number: form.document_number, surname: form.surname,
      first_names: form.first_names || undefined, date_of_birth: form.date_of_birth || undefined, purpose: form.purpose,
    }, form.key)
    void load()
  } catch (err: unknown) {
    askError.value = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'The service did not answer.'
  } finally {
    asking.value = false
  }
}
const when = (s: string) => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const FIELD_NAME: Record<string, string> = { surname: 'Surname', first_names: 'First names', date_of_birth: 'Date of birth' }
</script>

<template>
  <div class="rgp">
    <header class="rgp-mast">
      <div class="rgp-inner rgp-mast-row">
        <Fingerprint :size="22" aria-hidden="true" />
        <div>
          <p class="rgp-mast-sub">Registrar-General: identity verification service</p>
          <h1>Population register: verification console</h1>
        </div>
        <span class="rgp-badge">Prototype</span>
      </div>
    </header>
    <p class="rgp-banner rgp-inner" role="note">
      A prototype for demonstration. The register holds <strong>fictional people</strong>. It shows how a council would ask the
      Registrar-General to confirm an identity document: the answer says whether what the council sent <em>agrees</em>, and never
      returns the register's own data.
    </p>

    <main class="rgp-inner rgp-main">
      <section class="rgp-kpis" aria-label="The register">
        <div><strong>{{ data?.register.national_ids ?? '—' }}</strong><span>National IDs</span></div>
        <div><strong>{{ data?.register.passports ?? '—' }}</strong><span>Passports</span></div>
        <div><strong>{{ data?.register.clients ?? '—' }}</strong><span>Client organisations</span></div>
        <div><strong>{{ data ? Object.values(data.outcomes).reduce((a, b) => a + (b ?? 0), 0) : '—' }}</strong><span>Verifications answered</span></div>
      </section>
      <p v-if="loadError" class="rgp-error" role="alert">{{ loadError }}</p>

      <section class="rgp-card">
        <h2>How a client asks</h2>
        <div class="rgp-contract">
          <div>
            <h3>The question</h3>
            <pre>POST /api/rg-prototype/v1/verifications
X-RG-Client-Key: (issued to each client)

{ "document_type": "national_id",
  "document_number": "63-2876543 X 27",
  "surname": "Phiri",
  "first_names": "Bernard",
  "date_of_birth": "1979-04-12",
  "purpose": "verification_at_counter" }</pre>
          </div>
          <div>
            <h3>The answer</h3>
            <pre>{ "reference": "RGV-2026-000123",
  "document_found": true,
  "document_status": "valid",
  "fields": { "surname": "match",
              "first_names": "match",
              "date_of_birth": "match" },
  "outcome": "match" }</pre>
            <p class="rgp-note">Each particular: agrees, agrees in part, does not agree, or not sent. The document's status:
              valid, expired, cancelled, reported lost or stolen, or holder deceased. Never a name, a date or a photograph.</p>
          </div>
        </div>
      </section>

      <section class="rgp-card">
        <h2>Try it</h2>
        <div class="rgp-try">
          <form class="rgp-form" @submit.prevent="ask">
            <label>Document
              <select v-model="form.document_type"><option value="national_id">National ID</option><option value="passport">Passport</option></select>
            </label>
            <label>Number <input v-model="form.document_number" required data-testid="rgp-number" /></label>
            <label>Surname <input v-model="form.surname" required /></label>
            <label>First names <input v-model="form.first_names" /></label>
            <label>Date of birth <input v-model="form.date_of_birth" type="date" /></label>
            <label>Purpose
              <select v-model="form.purpose">
                <option value="demonstration">Demonstration</option>
                <option value="verification_at_counter">Verification at a counter</option>
                <option value="online_verification">Online verification</option>
                <option value="registration">Registration</option>
              </select>
            </label>
            <label class="rgp-wide">Client key <input v-model="form.key" autocomplete="off" /></label>
            <button type="submit" class="rgp-btn" :disabled="asking" data-testid="rgp-ask">
              <Loader2 v-if="asking" :size="14" class="ins-spin" aria-hidden="true" /><Send v-else :size="14" aria-hidden="true" /> Ask
            </button>
          </form>
          <div class="rgp-answer" aria-live="polite" data-testid="rgp-answer">
            <p v-if="askError" class="rgp-error" role="alert">{{ askError }}</p>
            <template v-else-if="answer">
              <!-- A document that is not valid leads: whatever agrees, it cannot prove who someone is. -->
              <p v-if="answer.document_status && answer.document_status !== 'valid'" class="rgp-outcome no_match">
                Document {{ (RG_STATUS_LABEL[answer.document_status] ?? answer.document_status).toLowerCase() }}: it cannot verify anyone
              </p>
              <p class="rgp-outcome" :class="answer.outcome">{{ RG_OUTCOME_LABEL[answer.outcome] }}</p>
              <p v-if="answer.document_status === 'valid'">Document: <strong>Valid</strong></p>
              <ul><li v-for="(v, k) in answer.fields" :key="k">{{ FIELD_NAME[k] }}: {{ RG_FIELD_LABEL[v!] }}</li></ul>
              <p class="rgp-note">Reference {{ answer.reference }}</p>
            </template>
            <p v-else class="rgp-note">Choose a case below, or type one, and ask.</p>
          </div>
        </div>
        <table class="rgp-table">
          <caption>Fictional cases in the prototype register</caption>
          <thead><tr><th scope="col">Document</th><th scope="col">Sent as</th><th scope="col">Shows</th><th scope="col"><span class="rgp-sr">Use</span></th></tr></thead>
          <tbody>
            <tr v-for="s in SCENARIOS" :key="s.number + s.surname">
              <td class="rgp-mono">{{ s.type === 'passport' ? 'Passport' : 'ID' }} {{ s.number }}</td>
              <td>{{ [s.first, s.surname].filter(Boolean).join(' ') }}{{ s.dob ? `, born ${s.dob}` : '' }}</td>
              <td>{{ s.shows }}</td>
              <td><button type="button" class="rgp-btn quiet" @click="use(s)">Use</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="rgp-card">
        <h2>Who has asked <button type="button" class="rgp-btn quiet" aria-label="Read again" @click="load"><RefreshCw :size="13" aria-hidden="true" /></button></h2>
        <p class="rgp-note">Every question is logged on the Registrar-General's side: the client, the purpose and the answer, so the use of the register can be audited.</p>
        <table v-if="data?.recent.length" class="rgp-table">
          <thead><tr><th scope="col">When</th><th scope="col">Client</th><th scope="col">Document</th><th scope="col">Sent</th><th scope="col">Answer</th><th scope="col">Purpose</th><th scope="col">Reference</th></tr></thead>
          <tbody>
            <tr v-for="r in data.recent" :key="r.reference">
              <td>{{ when(r.requested_at) }}</td>
              <td>{{ r.client }}</td>
              <td class="rgp-mono">{{ r.document_type === 'passport' ? 'Passport' : 'ID' }} {{ r.document_number }}</td>
              <td>{{ r.particulars_sent.map((p) => FIELD_NAME[p] ?? p).join(', ') }}</td>
              <td>{{ RG_OUTCOME_LABEL[r.outcome] }}{{ r.document_status && r.document_status !== 'valid' ? ` · ${RG_STATUS_LABEL[r.document_status] ?? r.document_status}` : '' }}</td>
              <td>{{ r.purpose.replace(/_/g, ' ') }}</td>
              <td class="rgp-mono">{{ r.reference }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="rgp-note">Nobody has asked yet.</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rgp { min-height: 100vh; background: #f5f5f4; color: #1c1917; }
.rgp-inner { max-width: 68rem; margin: 0 auto; padding-left: 1rem; padding-right: 1rem; }
.rgp-mast { background: #1e3a5f; color: #fff; }
.rgp-mast-row { display: flex; align-items: center; gap: 0.75rem; padding-top: 0.85rem; padding-bottom: 0.85rem; }
.rgp-mast h1 { margin: 0; font-size: 1.15rem; font-weight: 600; }
.rgp-mast-sub { margin: 0; font-size: 0.75rem; opacity: 0.85; }
.rgp-badge { margin-left: auto; font-size: 0.72rem; font-weight: 600; padding: 2px 10px; border-radius: 999px; background: #fef08a; color: #713f12; }
.rgp-banner { margin-top: 0.75rem; padding-top: 0.55rem; padding-bottom: 0.55rem; font-size: 0.82rem; line-height: 1.5; color: #713f12; background: #fef9c3; border: 1px solid #fde047; border-radius: 0.5rem; }
.rgp-main { display: grid; gap: 1rem; padding-top: 1rem; padding-bottom: 2rem; }
.rgp-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
.rgp-kpis div { background: #fff; border: 1px solid #e7e5e4; border-radius: 0.5rem; padding: 0.75rem 1rem; display: grid; }
.rgp-kpis strong { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
.rgp-kpis span { font-size: 0.8rem; color: #57534e; }
.rgp-card { background: #fff; border: 1px solid #e7e5e4; border-radius: 0.5rem; padding: 1rem 1.25rem; }
.rgp-card h2 { margin: 0 0 0.75rem; font-size: 1rem; display: flex; align-items: center; gap: 0.5rem; }
.rgp-card h3 { margin: 0 0 0.35rem; font-size: 0.85rem; color: #57534e; }
.rgp-contract { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.rgp-contract pre { margin: 0; padding: 0.75rem; background: #f5f5f4; border-radius: 0.4rem; font-size: 0.78rem; overflow-x: auto; }
.rgp-note { font-size: 0.8rem; color: #57534e; margin: 0.4rem 0 0; }
.rgp-try { display: grid; grid-template-columns: 1.3fr 1fr; gap: 1rem; margin-bottom: 1rem; }
.rgp-form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 0.75rem; align-items: end; }
.rgp-form label { display: grid; gap: 3px; font-size: 0.8rem; color: #44403c; }
.rgp-form input, .rgp-form select { font: inherit; font-size: 0.88rem; padding: 6px 8px; border: 1px solid #d6d3d1; border-radius: 0.35rem; background: #fff; }
.rgp-wide { grid-column: 1 / -1; }
.rgp-btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 0.85rem; padding: 7px 14px; border-radius: 0.35rem; border: 1px solid #1e3a5f; background: #1e3a5f; color: #fff; cursor: pointer; justify-self: start; }
.rgp-btn.quiet { background: #fff; color: #1e3a5f; padding: 4px 10px; }
.rgp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.rgp-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
.rgp-answer { border: 1px solid #e7e5e4; border-radius: 0.4rem; padding: 0.75rem 1rem; background: #fafaf9; font-size: 0.88rem; }
.rgp-answer ul { margin: 0.4rem 0; padding-left: 1.1rem; }
.rgp-outcome { font-weight: 600; margin: 0 0 0.4rem; }
.rgp-outcome.match { color: #166534; }
.rgp-outcome.partial { color: #92400e; }
.rgp-outcome.no_match, .rgp-outcome.not_found { color: #b91c1c; }
.rgp-error { color: #b91c1c; }
.rgp-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.rgp-table caption { text-align: left; font-size: 0.8rem; color: #57534e; padding-bottom: 0.35rem; }
.rgp-table th, .rgp-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
.rgp-mono { font-family: ui-monospace, monospace; white-space: nowrap; }
.rgp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 760px) { .rgp-contract, .rgp-try, .rgp-form { grid-template-columns: 1fr; } }
</style>
