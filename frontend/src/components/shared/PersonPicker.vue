<script setup lang="ts">
// Find or register a person (the council's register of persons, migration 256). Used wherever someone is met at the
// counter: the cashier's payer, the clerk's applicant, the objector. Search first; register only when nobody found is
// the person. The server refuses a second record for the same ID and warns on the same phone or name, and this panel
// shows who is already there so the officer can choose them instead.
import { computed, reactive, ref, watch } from 'vue'
import { BadgeCheck, Home, Loader2, Search, ShieldAlert, UserPlus, X } from 'lucide-vue-next'
import {
  personsApi, CHANNEL_LABEL, ID_LABEL, MATCH_LABEL, TITLES, VERIFIERS, RG_OUTCOME_LABEL, RG_STATUS_LABEL, looksLikeNationalId,
  type Channel, type IdentifierKind, type Person, type PersonKind, type RegisterConflict,
} from '@/services/persons'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(defineProps<{
  modelValue: Person | null
  /** Who this person is here, in words: "applicant", "objector", "payer". */
  role?: string
  /** Offer to register someone not found. */
  canRegister?: boolean
}>(), { role: 'person', canRegister: true })
const emit = defineEmits<{ 'update:modelValue': [Person | null] }>()

// Only the registrar's desks record that an identity document was seen (migration 257); every desk may register.
const auth = useAuthStore()
const canVerify = computed(() => VERIFIERS.includes(auth.user?.role ?? ''))
/** What the server said about a registration it made but could not verify (a Registrar-General refusal). */
const notice = ref('')

const uid = `pp-${Math.random().toString(36).slice(2, 8)}`
const q = ref('')
const results = ref<Person[]>([])
const searched = ref(false)
const searching = ref(false)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

async function runSearch() {
  const term = q.value.trim()
  if (term.length < 2) { results.value = []; searched.value = false; return }
  const mine = ++seq
  searching.value = true
  error.value = ''
  try {
    const found = await personsApi.search(term)
    if (mine === seq) { results.value = found; searched.value = true }
  } catch {
    if (mine === seq) error.value = 'The register could not be searched. Try again.'
  } finally {
    if (mine === seq) searching.value = false
  }
}
watch(q, () => { clearTimeout(timer); timer = setTimeout(runSearch, 300) })

function choose(p: Person) {
  notice.value = ''
  emit('update:modelValue', p)
  registering.value = false
  conflict.value = null
}
function clear() {
  emit('update:modelValue', null)
  q.value = ''
  results.value = []
  searched.value = false
}

// ── Registering someone new ─────────────────────────────────────────────
const registering = ref(false)
const saving = ref(false)
const conflict = ref<RegisterConflict | null>(null)
const form = reactive({
  kind: 'individual' as PersonKind, title: '', first_names: '', surname: '', organisation_name: '',
  id_kind: 'national_id' as IdentifierKind, id_value: '', phone: '', email: '', physical_address: '', date_of_birth: '',
  preferred_channel: 'post' as Channel, verified: false, verified_how: 'National ID card, original',
})

function startRegister() {
  const term = q.value.trim()
  Object.assign(form, {
    kind: 'individual', title: '', first_names: '', surname: '', organisation_name: '', id_kind: 'national_id',
    id_value: '', phone: '', email: '', physical_address: '', date_of_birth: '', preferred_channel: 'post', verified: false,
    verified_how: 'National ID card, original',
  })
  // Carry over what was searched for, so it is not typed twice.
  if (looksLikeNationalId(term)) form.id_value = term
  else if (/^[+\d][\d\s()-]{6,}$/.test(term)) form.phone = term
  else if (term) {
    const words = term.split(/\s+/)
    form.surname = words.pop() || ''
    form.first_names = words.join(' ')
  }
  conflict.value = null
  error.value = ''
  registering.value = true
}

const formProblem = computed(() => {
  if (form.kind === 'individual' && form.surname.trim().length < 2) return 'Enter the surname.'
  if (form.kind === 'organisation' && form.organisation_name.trim().length < 2) return 'Enter the organisation\'s name.'
  if (form.id_kind === 'national_id' && form.id_value.trim() && !looksLikeNationalId(form.id_value)) return 'The national ID reads like 63-123456 X 27.'
  if (form.verified && !form.id_value.trim()) return 'Enter the number of the document you saw.'
  if (form.preferred_channel === 'sms' && !form.phone.trim()) return 'Letters by SMS need a phone number.'
  if (form.preferred_channel === 'email' && !form.email.trim()) return 'Letters by email need an email address.'
  return ''
})

async function register(confirmNew = false) {
  if (formProblem.value) { error.value = formProblem.value; return }
  saving.value = true
  error.value = ''
  try {
    const result = await personsApi.register({
      kind: form.kind,
      title: form.kind === 'individual' ? form.title || null : null,
      first_names: form.kind === 'individual' ? form.first_names.trim() || null : null,
      surname: form.kind === 'individual' ? form.surname.trim() : null,
      organisation_name: form.kind === 'organisation' ? form.organisation_name.trim() : null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      physical_address: form.physical_address.trim() || null,
      date_of_birth: form.kind === 'individual' ? form.date_of_birth || null : null,
      preferred_channel: form.preferred_channel,
      identifiers: form.id_value.trim() ? [{ kind: form.id_kind, value: form.id_value.trim() }] : [],
      verified: canVerify.value && form.verified,
      verified_how: canVerify.value && form.verified ? form.verified_how.trim() : null,
      confirm_new: confirmNew,
    })
    if ('person' in result) {
      choose(result.person)
      notice.value = result.warning || ''
    } else conflict.value = result
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    error.value = msg || 'The person could not be registered.'
  } finally {
    saving.value = false
  }
}

const levelTone = (p: Person) => (p.assurance_level >= 1 ? 'ok' : 'warn')
const rgLine = (p: Person) => {
  const c = p.registrar_general
  if (!c || c.outcome === 'unavailable') return ''
  const status = c.document_status && c.document_status !== 'valid' ? `; document ${RG_STATUS_LABEL[c.document_status] ?? c.document_status}` : ''
  return `Registrar-General: ${RG_OUTCOME_LABEL[c.outcome]}${status}`
}
const idShown = (p: Person) => p.identifiers.find((i) => i.kind === 'national_id') || p.identifiers[0]
const appears = (p: Person) => {
  const a = p.appears_as
  const parts = [
    a.applications ? `${a.applications} application${a.applications === 1 ? '' : 's'}` : '',
    a.objections ? `${a.objections} objection${a.objections === 1 ? '' : 's'}` : '',
    a.receipts ? `${a.receipts} receipt${a.receipts === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Not yet on any record'
}
</script>

<template>
  <div class="pp" :data-testid="'person-picker'">
    <!-- Chosen -->
    <div v-if="modelValue" class="pp-chosen" data-testid="pp-chosen">
      <div class="pp-chosen-main">
        <strong>{{ modelValue.display_name }}</strong>
        <span class="pp-badge" :class="levelTone(modelValue)" data-testid="pp-level">
          <BadgeCheck v-if="modelValue.assurance_level >= 1" :size="12" aria-hidden="true" />
          Level {{ modelValue.assurance_level }} · {{ modelValue.level_label }}
        </span>
        <span v-if="modelValue.resident" class="pp-badge ok"><Home :size="12" aria-hidden="true" /> Resident</span>
      </div>
      <p v-if="rgLine(modelValue)" class="pp-meta" :class="{ 'pp-alert': modelValue.registrar_general?.blocks }" data-testid="pp-rg">
        <ShieldAlert v-if="modelValue.registrar_general?.blocks" :size="12" aria-hidden="true" /> {{ rgLine(modelValue) }}
      </p>
      <p v-if="notice" class="pp-error" role="alert">{{ notice }}</p>
      <p class="pp-meta">
        <span v-if="idShown(modelValue)">{{ ID_LABEL[idShown(modelValue)!.kind] }} {{ idShown(modelValue)!.value }}</span>
        <span v-if="modelValue.phone">{{ modelValue.phone }}</span>
        <span v-if="modelValue.physical_address">{{ modelValue.physical_address }}</span>
        <span>Letters: {{ CHANNEL_LABEL[modelValue.preferred_channel] }}</span>
      </p>
      <p class="pp-meta">{{ appears(modelValue) }}</p>
      <button type="button" class="pp-btn" @click="clear">
        <X :size="13" aria-hidden="true" /> Choose someone else
      </button>
    </div>

    <!-- Search -->
    <template v-else-if="!registering">
      <label class="ins-field full" :for="`${uid}-q`">
        <span class="ins-label">Find the {{ role }} in the register</span>
        <span class="pp-search">
          <Search :size="14" aria-hidden="true" class="pp-search-icon" />
          <input :id="`${uid}-q`" v-model="q" class="ins-input" autocomplete="off"
                 placeholder="Name, phone or ID number" data-testid="pp-search" />
          <Loader2 v-if="searching" :size="14" class="ins-spin pp-search-busy" aria-label="Searching" />
        </span>
      </label>
      <p v-if="error" class="pp-error" role="alert">{{ error }}</p>
      <ul v-if="results.length" class="pp-results" :aria-label="`People found for ${q}`">
        <li v-for="p in results" :key="p.id">
          <button type="button" class="pp-result" data-testid="pp-result" @click="choose(p)">
            <span class="pp-result-name">{{ p.display_name }}</span>
            <span class="pp-meta">
              <span v-if="p.match">{{ MATCH_LABEL[p.match] }}</span>
              <span v-if="idShown(p)">{{ idShown(p)!.value }}</span>
              <span v-if="p.phone">{{ p.phone }}</span>
              <span>Level {{ p.assurance_level }} · {{ p.level_label }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="searched && !searching" class="pp-meta" data-testid="pp-none">Nobody in the register matches "{{ q }}".</p>
      <button v-if="canRegister && searched" type="button" class="pp-btn" data-testid="pp-register" @click="startRegister">
        <UserPlus :size="13" aria-hidden="true" />
        {{ results.length ? 'None of these: register a new person' : 'Register a new person' }}
      </button>
    </template>

    <!-- Register -->
    <form v-else class="pp-form" data-testid="pp-form" @submit.prevent="register(false)">
      <fieldset class="pp-kind full">
        <legend class="ins-label">Registering</legend>
        <label><input v-model="form.kind" type="radio" value="individual" /> An individual</label>
        <label><input v-model="form.kind" type="radio" value="organisation" /> An organisation</label>
      </fieldset>
      <template v-if="form.kind === 'individual'">
        <label class="ins-field">
          <span class="ins-label">Title</span>
          <select v-model="form.title" class="ins-input">
            <option value="">—</option>
            <option v-for="t in TITLES" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="ins-field">
          <span class="ins-label">First names</span>
          <input v-model="form.first_names" class="ins-input" autocomplete="off" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Surname</span>
          <input v-model="form.surname" class="ins-input" autocomplete="off" required data-testid="pp-surname" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Date of birth</span>
          <input v-model="form.date_of_birth" class="ins-input" type="date" :max="new Date().toISOString().slice(0, 10)" data-testid="pp-dob" />
        </label>
      </template>
      <label v-else class="ins-field full">
        <span class="ins-label">Organisation's name</span>
        <input v-model="form.organisation_name" class="ins-input" autocomplete="off" required />
      </label>
      <label class="ins-field">
        <span class="ins-label">Identity document</span>
        <select v-model="form.id_kind" class="ins-input">
          <option value="national_id">National ID</option>
          <option value="passport">Passport</option>
          <option value="company_registration">Company registration</option>
        </select>
      </label>
      <label class="ins-field">
        <span class="ins-label">Its number</span>
        <input v-model="form.id_value" class="ins-input" autocomplete="off"
               :placeholder="form.id_kind === 'national_id' ? '63-123456 X 27' : ''" data-testid="pp-id" />
      </label>
      <label class="ins-field">
        <span class="ins-label">Phone</span>
        <input v-model="form.phone" class="ins-input" type="tel" autocomplete="off" />
      </label>
      <label class="ins-field">
        <span class="ins-label">Email</span>
        <input v-model="form.email" class="ins-input" type="email" autocomplete="off" />
      </label>
      <label class="ins-field full">
        <span class="ins-label">Address</span>
        <input v-model="form.physical_address" class="ins-input" autocomplete="off" placeholder="Stand, village or street" />
      </label>
      <label class="ins-field">
        <span class="ins-label">Letters and notices by</span>
        <select v-model="form.preferred_channel" class="ins-input">
          <option v-for="(label, c) in CHANNEL_LABEL" :key="c" :value="c">{{ label }}</option>
        </select>
      </label>
      <div v-if="canVerify && form.kind === 'individual'" class="ins-field">
        <label class="pp-check">
          <input v-model="form.verified" type="checkbox" data-testid="pp-verified" /> I have the original identity document in my hands
        </label>
        <input v-if="form.verified" v-model="form.verified_how" class="ins-input" aria-label="Which document was seen" />
      </div>
      <p v-else class="ins-hint pp-hint" data-testid="pp-verify-note">
        The person is registered as recorded (level 0). The planning clerk confirms their identity when they bring the original.
      </p>

      <div v-if="conflict" class="pp-conflict full" role="alert" data-testid="pp-conflict">
        <p>{{ conflict.message }}</p>
        <ul class="pp-results">
          <li v-for="p in conflict.persons" :key="p.id">
            <button type="button" class="pp-result" @click="choose(p)">
              <span class="pp-result-name">{{ p.display_name }}</span>
              <span class="pp-meta">
                <span v-if="p.match">{{ MATCH_LABEL[p.match] }}</span>
                <span v-if="p.phone">{{ p.phone }}</span>
                <span>{{ appears(p) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <button v-if="conflict.error === 'possible_duplicate'" type="button" class="pp-btn"
                :disabled="saving" data-testid="pp-confirm-new" @click="register(true)">
          None of them: register as a new person
        </button>
      </div>
      <p v-if="error" class="pp-error full" role="alert">{{ error }}</p>
      <div class="pp-actions full">
        <button type="button" class="pp-btn" @click="registering = false">Back to the search</button>
        <button type="submit" class="pp-btn primary" :disabled="saving" data-testid="pp-save">
          <Loader2 v-if="saving" :size="13" class="ins-spin" aria-hidden="true" />
          <UserPlus v-else :size="13" aria-hidden="true" /> Register
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.pp { display: grid; gap: var(--ent-s2, 8px); }
.pp-search { position: relative; display: flex; align-items: center; }
.pp-search .ins-input { width: 100%; padding-left: 28px; }
.pp-search-icon { position: absolute; left: 9px; color: var(--ent-text-muted); pointer-events: none; }
.pp-search-busy { position: absolute; right: 9px; color: var(--ent-text-muted); }
.pp-results { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.pp-result {
  width: 100%; text-align: left; display: grid; gap: 2px; padding: 8px 10px; cursor: pointer;
  background: var(--ent-surface); border: 1px solid var(--ent-border); border-radius: var(--ent-radius-sm, 6px); color: inherit; font: inherit;
}
.pp-result:hover { background: var(--ent-surface-2); }
.pp-result:focus-visible, .pp-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.pp-result-name { font-weight: 600; }
.pp-meta { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.82rem; color: var(--ent-text-muted); }
.pp-chosen {
  display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--ent-border); border-radius: var(--ent-radius-sm, 6px);
  background: var(--ent-surface-2);
}
.pp-chosen-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pp-chosen .pp-btn { justify-self: start; }
.pp-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 0.75rem; padding: 1px 7px; border-radius: 999px; border: 1px solid; }
.pp-badge.ok { color: var(--ent-success, #137333); border-color: var(--ent-tone-positive-line, currentColor); background: var(--ent-tone-positive-bg, transparent); }
.pp-badge.warn { color: var(--ent-warning, #8a5a00); border-color: var(--ent-tone-warning-line, currentColor); background: var(--ent-tone-warning-bg, transparent); }
.pp-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font: inherit; font-size: 0.85rem; cursor: pointer;
  background: var(--ent-surface); border: 1px solid var(--ent-border); border-radius: var(--ent-radius-sm, 6px); color: inherit;
}
.pp-btn:hover:not(:disabled) { background: var(--ent-surface-2); }
.pp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.pp-btn.primary { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); }
.pp-btn.primary:hover:not(:disabled) { background: var(--ent-accent-hover); }
.pp-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.pp-form .full { grid-column: 1 / -1; }
.pp-kind { border: 0; padding: 0; margin: 0; display: flex; gap: 16px; align-items: center; }
.pp-kind legend { margin-bottom: 4px; }
.pp-check { display: inline-flex; align-items: center; gap: 6px; margin-top: 20px; }
.pp-conflict { padding: 10px; border: 1px solid var(--ent-tone-warning-line, var(--ent-border)); border-radius: var(--ent-radius-sm, 6px); background: var(--ent-tone-warning-bg, transparent); display: grid; gap: 8px; }
.pp-conflict p { margin: 0; }
.pp-error { margin: 0; color: var(--ent-danger); font-size: 0.85rem; }
.pp-alert { color: var(--ent-danger); align-items: center; }
.pp-hint { margin: 20px 0 0; font-size: 0.82rem; }
.pp-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 560px) { .pp-form { grid-template-columns: 1fr; } }
</style>
