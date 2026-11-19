<script setup lang="ts">
// The register of persons: the clerk's desk as the council's registrar of record (migration 257).
//
// Every desk can register a person (the cashier, the counter for an application or an objection), at level 0. This is
// where the planning clerk confirms who they are and where they live, and so raises their level:
//   0 Recorded            a name as given
//   1 Identity verified   a copy approved online (Document verification), or the original seen
//   2 Resident/ratepayer  identity verified, and residence proved
//   3 Original sighted    the original identity document handled here, at the counter
// The Registrar-General's answer is shown beside it: an answer that the document is not theirs, or not valid, stops it
// verifying anyone. The second tab is the work list of applicants and objectors still recorded only as text.
import { computed, onMounted, ref, watch } from 'vue'
import { BadgeCheck, Check, Contact, Home, Link2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-vue-next'
import PersonPicker from '@/components/shared/PersonPicker.vue'
import {
  personsApi, LEVELS, VERIFIERS, RESIDENCY_EVIDENCE, RG_FIELD_LABEL, RG_OUTCOME_LABEL, RG_STATUS_LABEL, ID_LABEL,
  type Person, type PersonRecord, type RgStatus, type UnlinkedRecord,
} from '@/services/persons'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canVerify = computed(() => VERIFIERS.includes(auth.user?.role ?? ''))
const tab = ref<'find' | 'unlinked'>('find')

// ── The person open on the desk ─────────────────────────────────────────
const chosen = ref<Person | null>(null)
const record = ref<PersonRecord | null>(null)
const loading = ref(false)
const error = ref('')
async function load(id: string) {
  loading.value = true
  error.value = ''
  try { record.value = await personsApi.get(id) } catch { error.value = 'The person\'s record could not be read.' } finally { loading.value = false }
}
watch(chosen, (p) => { record.value = null; if (p) void load(p.id) })
const person = computed(() => record.value?.person ?? chosen.value)

const reached = (n: number) => {
  const p = person.value
  if (!p) return false
  if (n === 0) return true
  if (n === 1) return !!p.verified_at
  if (n === 2) return !!p.verified_at && p.resident
  return !!p.original_sighted_at
}

// ── Raising a level ─────────────────────────────────────────────────────
const busy = ref<'' | 'original' | 'residency' | 'rg'>('')
const originalHow = ref('National ID card, original')
const residencyEvidence = ref('title_deed')
const residencyHow = ref('')
const actionError = ref('')
async function raise(step: 'original_sighted' | 'residency') {
  if (!person.value) return
  actionError.value = ''
  busy.value = step === 'original_sighted' ? 'original' : 'residency'
  try {
    await personsApi.raise(person.value.id, step === 'original_sighted'
      ? { step, how: originalHow.value.trim() }
      : { step, evidence: residencyEvidence.value, how: residencyHow.value.trim() })
    residencyHow.value = ''
    await load(person.value.id)
  } catch (err: unknown) {
    actionError.value = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'The level could not be raised.'
  } finally {
    busy.value = ''
  }
}

// ── The Registrar-General ───────────────────────────────────────────────
const rgStatus = ref<RgStatus | null>(null)
async function askRg() {
  if (!person.value) return
  actionError.value = ''
  busy.value = 'rg'
  try {
    await personsApi.registrarGeneralCheck(person.value.id)
    await load(person.value.id)
  } catch (err: unknown) {
    actionError.value = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'The Registrar-General could not be asked.'
  } finally {
    busy.value = ''
  }
}
const hasRgDocument = computed(() => (person.value?.identifiers ?? []).some((i) => i.kind === 'national_id' || i.kind === 'passport'))
const latestRg = computed(() => record.value?.registrar_general_checks?.[0] ?? null)

// ── Records not yet linked ──────────────────────────────────────────────
const unlinked = ref<UnlinkedRecord[]>([])
const unlinkedTotal = ref(0)
const unlinkedLoading = ref(false)
const linking = ref<string | null>(null)
const linkTarget = ref<Person | null>(null)
const linkError = ref('')
async function loadUnlinked() {
  unlinkedLoading.value = true
  try {
    const r = await personsApi.unlinked()
    unlinked.value = r.records
    unlinkedTotal.value = r.total
  } catch { unlinked.value = [] } finally { unlinkedLoading.value = false }
}
watch(linkTarget, async (p) => {
  const row = unlinked.value.find((r) => r.record_id === linking.value)
  if (!p || !row) return
  linkError.value = ''
  try {
    if (row.role === 'applicant') await personsApi.linkApplicant(row.record_id, p.id)
    else await personsApi.linkObjector(row.record_id, p.id)
    unlinked.value = unlinked.value.filter((r) => r.record_id !== row.record_id)
    unlinkedTotal.value = Math.max(0, unlinkedTotal.value - 1)
    linking.value = null
  } catch (err: unknown) {
    linkError.value = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'The record could not be linked.'
  } finally {
    linkTarget.value = null
  }
})

onMounted(async () => {
  void loadUnlinked()
  try { rgStatus.value = await personsApi.registrarGeneralStatus() } catch { rgStatus.value = null }
})

const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const EVENT_LABEL: Record<string, string> = {
  registered: 'Registered', identity_verified: 'Identity verified', original_sighted: 'Original identity document seen',
  residency_verified: 'Residence proved', carried_from_account: 'Residence carried from the online account',
}
</script>

<template>
  <div class="prs" data-testid="persons-register">
    <section class="ins-card">
      <header class="ins-card-head">
        <h3><Contact :size="15" aria-hidden="true" /> Register of persons</h3>
        <div class="prs-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'find'" @click="tab = 'find'">Find or register</button>
          <button type="button" role="tab" :aria-selected="tab === 'unlinked'" data-testid="prs-tab-unlinked" @click="tab = 'unlinked'">
            Not yet linked <span class="prs-count">{{ unlinkedTotal }}</span>
          </button>
        </div>
      </header>
      <div class="ins-card-body">
        <ol class="prs-levels" aria-label="The four levels">
          <li v-for="l in LEVELS" :key="l.level"><strong>{{ l.level }} · {{ l.label }}</strong> <span>{{ l.means }}</span></li>
        </ol>
        <p v-if="!canVerify" class="ins-hint">You can find and register people. The planning clerk confirms their identity and residence.</p>
      </div>
    </section>

    <!-- Find or register, and the record -->
    <template v-if="tab === 'find'">
      <section class="ins-card">
        <div class="ins-card-body">
          <PersonPicker v-model="chosen" role="person" />
        </div>
      </section>

      <p v-if="loading" class="ins-hint"><Loader2 :size="14" class="ins-spin" aria-hidden="true" /> Reading the record…</p>
      <p v-if="error" class="prs-error" role="alert">{{ error }}</p>

      <template v-if="person && record">
        <!-- Where they stand -->
        <section class="ins-card" data-testid="prs-ladder">
          <header class="ins-card-head">
            <h3><BadgeCheck :size="15" aria-hidden="true" /> {{ person.display_name }}: level {{ person.assurance_level }}, {{ person.level_label }}</h3>
            <span v-if="person.resident" class="prs-pill ok"><Home :size="12" aria-hidden="true" /> Resident</span>
          </header>
          <div class="ins-card-body">
            <ol class="prs-ladder">
              <li v-for="l in LEVELS" :key="l.level" :class="{ done: reached(l.level) }">
                <Check v-if="reached(l.level)" :size="14" aria-hidden="true" />
                <span v-else class="prs-dot" aria-hidden="true" />
                <span><strong>{{ l.label }}</strong>
                  <template v-if="l.level === 1 && person.verified_at"> · {{ person.identity_method === 'copy_approved' ? 'copy approved online' : 'original seen' }}, {{ when(person.verified_at) }}</template>
                  <template v-if="l.level === 2 && person.resident"> · {{ person.residency_evidence }}</template>
                  <template v-if="l.level === 3 && person.original_sighted_at"> · {{ when(person.original_sighted_at) }}</template>
                </span>
              </li>
            </ol>
            <dl class="ins-dl">
              <div v-for="i in person.identifiers" :key="i.kind"><dt>{{ ID_LABEL[i.kind] }}</dt><dd class="ins-mono">{{ i.value }}</dd></div>
              <div><dt>Date of birth</dt><dd>{{ person.date_of_birth ? new Date(person.date_of_birth).toLocaleDateString('en-GB') : 'Not recorded' }}</dd></div>
              <div><dt>Registered</dt><dd>{{ person.source === 'online' ? 'Online' : person.source === 'counter' ? 'At the counter' : 'From earlier records' }}</dd></div>
            </dl>
          </div>
        </section>

        <!-- The Registrar-General -->
        <section class="ins-card" data-testid="prs-rg">
          <header class="ins-card-head">
            <h3>
              <component :is="latestRg?.blocks ? ShieldAlert : latestRg ? ShieldCheck : ShieldQuestion" :size="15" aria-hidden="true" />
              Registrar-General
            </h3>
            <span v-if="rgStatus?.prototype" class="prs-pill warn">Prototype: fictional register</span>
          </header>
          <div class="ins-card-body">
            <template v-if="latestRg">
              <p :class="{ 'prs-error': latestRg.blocks }"><strong>{{ RG_OUTCOME_LABEL[latestRg.outcome] }}</strong>
                <template v-if="latestRg.document_status"> · document {{ RG_STATUS_LABEL[latestRg.document_status] ?? latestRg.document_status }}</template>
              </p>
              <ul class="prs-fields">
                <li v-for="(v, k) in latestRg.fields" :key="k">{{ k === 'first_names' ? 'First names' : k === 'date_of_birth' ? 'Date of birth' : 'Surname' }}: {{ RG_FIELD_LABEL[v!] }}</li>
              </ul>
              <p v-if="latestRg.blocks" class="prs-error" role="alert">{{ latestRg.blocks }} This document cannot verify their identity.</p>
              <p class="ins-hint">Reference {{ latestRg.rg_reference || '—' }} · {{ when(latestRg.requested_at) }}</p>
            </template>
            <p v-else class="ins-hint">The Registrar-General has not been asked about this person.</p>
            <p v-if="rgStatus && !rgStatus.available" class="ins-hint">{{ rgStatus.label }}</p>
            <button v-else-if="hasRgDocument" type="button" class="prs-btn" :disabled="busy === 'rg'" data-testid="prs-ask-rg" @click="askRg">
              <Loader2 v-if="busy === 'rg'" :size="13" class="ins-spin" aria-hidden="true" />
              <RefreshCw v-else :size="13" aria-hidden="true" /> Ask the Registrar-General
            </button>
            <p v-else class="ins-hint">Record their national ID or passport number to ask.</p>
          </div>
        </section>

        <!-- Raising the level: the registrar's desks only -->
        <section v-if="canVerify && person.kind === 'individual'" class="ins-card" data-testid="prs-raise">
          <header class="ins-card-head"><h3><ShieldCheck :size="15" aria-hidden="true" /> Confirm at the counter</h3></header>
          <div class="ins-card-body prs-raise">
            <div v-if="!person.original_sighted_at" class="prs-step">
              <label class="ins-field full">
                <span class="ins-label">I have the original identity document in my hands (level 3)</span>
                <input v-model="originalHow" class="ins-input" aria-label="Which document was seen" />
              </label>
              <button type="button" class="prs-btn primary" :disabled="busy === 'original' || !hasRgDocument || originalHow.trim().length < 3"
                      data-testid="prs-original" @click="raise('original_sighted')">
                <Loader2 v-if="busy === 'original'" :size="13" class="ins-spin" aria-hidden="true" /> Record it
              </button>
              <p v-if="!hasRgDocument" class="ins-hint">Record their ID or passport number first.</p>
            </div>
            <div v-if="!person.resident" class="prs-step">
              <label class="ins-field">
                <span class="ins-label">Proof of residence seen</span>
                <select v-model="residencyEvidence" class="ins-input" data-testid="prs-evidence">
                  <option v-for="(label, k) in RESIDENCY_EVIDENCE" :key="k" :value="k">{{ label }}</option>
                </select>
              </label>
              <label class="ins-field">
                <span class="ins-label">Its reference or what it shows</span>
                <input v-model="residencyHow" class="ins-input" placeholder="Deed 1234/1998, Stand 1380" data-testid="prs-residency-how" />
              </label>
              <button type="button" class="prs-btn primary" :disabled="busy === 'residency' || residencyHow.trim().length < 3"
                      data-testid="prs-residency" @click="raise('residency')">
                <Loader2 v-if="busy === 'residency'" :size="13" class="ins-spin" aria-hidden="true" /> Record residence
              </button>
            </div>
            <p v-if="person.original_sighted_at && person.resident" class="ins-hint">Nothing more to confirm.</p>
            <p v-if="actionError" class="prs-error" role="alert">{{ actionError }}</p>
          </div>
        </section>

        <!-- History and where they appear -->
        <section class="ins-card">
          <header class="ins-card-head"><h3>History</h3></header>
          <div class="ins-card-body">
            <ul class="prs-history">
              <li v-for="(e, i) in record.history" :key="i">
                <strong>{{ EVENT_LABEL[e.event] ?? e.event }}</strong> · level {{ e.level_after }}
                <span class="ins-hint">{{ when(e.recorded_at) }}{{ e.recorded_role ? ` · ${e.recorded_role.replace(/_/g, ' ')}` : '' }}{{ e.evidence ? ` · ${e.evidence}` : '' }}</span>
              </li>
            </ul>
            <p class="ins-hint">
              On {{ record.applications.length }} application{{ record.applications.length === 1 ? '' : 's' }},
              {{ record.objections.length }} objection{{ record.objections.length === 1 ? '' : 's' }}<template v-if="record.receipts">,
              {{ record.receipts.length }} receipt{{ record.receipts.length === 1 ? '' : 's' }}</template>.
            </p>
          </div>
        </section>
      </template>
    </template>

    <!-- Records not yet linked -->
    <section v-else class="ins-card" data-testid="prs-unlinked">
      <header class="ins-card-head">
        <h3><Link2 :size="15" aria-hidden="true" /> Applicants and objectors recorded only as text</h3>
        <span class="ins-count">{{ unlinkedTotal }}</span>
      </header>
      <div class="ins-card-body">
        <p v-if="unlinkedLoading" class="ins-hint">Reading…</p>
        <p v-else-if="!unlinked.length" class="ins-hint">Every applicant and objector is linked to the register.</p>
        <table v-else class="prs-table">
          <thead><tr><th scope="col">As written</th><th scope="col">As</th><th scope="col">Case</th><th scope="col">ID number given</th><th scope="col"><span class="sr-only">Link</span></th></tr></thead>
          <tbody>
            <template v-for="r in unlinked" :key="r.record_id">
              <tr>
                <td>{{ r.name_as_written }}</td>
                <td>{{ r.role === 'applicant' ? 'Applicant' : 'Objector' }}</td>
                <td class="ins-mono">{{ r.reference || '—' }}</td>
                <td>{{ r.has_id_number ? 'Yes' : 'No' }}</td>
                <td><button type="button" class="prs-btn" @click="linking = linking === r.record_id ? null : r.record_id">{{ linking === r.record_id ? 'Close' : 'Link' }}</button></td>
              </tr>
              <tr v-if="linking === r.record_id">
                <td colspan="5">
                  <PersonPicker v-model="linkTarget" :role="r.role" />
                  <p v-if="linkError" class="prs-error" role="alert">{{ linkError }}</p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.prs { display: grid; gap: var(--ent-s3, 12px); }
.prs-tabs { display: inline-flex; gap: 4px; margin-left: auto; }
.prs-tabs button { font: inherit; font-size: 0.85rem; padding: 4px 10px; border: 1px solid var(--ent-border); border-radius: 999px; background: var(--ent-surface); cursor: pointer; color: inherit; }
.prs-tabs button[aria-selected='true'] { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); }
.prs-tabs button:focus-visible, .prs-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.prs-count { font-variant-numeric: tabular-nums; }
.prs-levels { margin: 0 0 8px; padding-left: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 14px; font-size: 0.85rem; }
.prs-levels span { color: var(--ent-text-muted); }
.prs-ladder { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.prs-ladder li { display: flex; align-items: center; gap: 8px; color: var(--ent-text-muted); }
.prs-ladder li.done { color: inherit; }
.prs-ladder li.done svg { color: var(--ent-success, #137333); }
.prs-dot { width: 14px; height: 14px; border: 1.5px solid var(--ent-border); border-radius: 50%; display: inline-block; }
.prs-pill { display: inline-flex; align-items: center; gap: 3px; font-size: 0.75rem; padding: 1px 8px; border-radius: 999px; border: 1px solid; }
.prs-pill.ok { color: var(--ent-success, #137333); }
.prs-pill.warn { color: var(--ent-warning, #8a5a00); }
.prs-fields { margin: 4px 0 8px; padding-left: 18px; font-size: 0.88rem; }
.prs-raise { display: grid; gap: 14px; }
.prs-step { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px 12px; align-items: end; }
.prs-step .full { grid-column: span 2; }
.prs-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font: inherit; font-size: 0.85rem; cursor: pointer;
  background: var(--ent-surface); border: 1px solid var(--ent-border); border-radius: var(--ent-radius-sm, 6px); color: inherit; justify-self: start;
}
.prs-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.prs-btn.primary { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); }
.prs-error { color: var(--ent-danger); margin: 4px 0; }
.prs-history { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 4px; font-size: 0.88rem; }
.prs-history .ins-hint { margin-left: 6px; }
.prs-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.prs-table th, .prs-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--ent-border); vertical-align: top; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 640px) { .prs-step { grid-template-columns: 1fr; } .prs-step .full { grid-column: auto; } }
</style>
