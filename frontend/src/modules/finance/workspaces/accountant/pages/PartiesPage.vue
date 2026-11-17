<script setup lang="ts">
/**
 * The council's parties: the ledger party register, one type at a time (Suppliers first). A party is
 * named on the journals that raise or settle what it owes or is owed. Adding and editing one needs
 * `finance.ledger.party.manage`. A debtor or ratepayer opens its statement of account.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { Users, Plus, Search, X, AlertTriangle, Pencil } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import CwDialog from '../../shared/CwDialog.vue'
import { useTabKeys } from '../kit/useTabKeys'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import type { LedgerParty, PartyType } from '../../../models/ledgerTypes'

const MANAGE = 'finance.ledger.party.manage'
const TYPES: { key: PartyType; plural: string; singular: string }[] = [
  { key: 'supplier', plural: 'Suppliers', singular: 'supplier' },
  { key: 'debtor', plural: 'Debtors', singular: 'debtor' },
  { key: 'ratepayer', plural: 'Ratepayers', singular: 'ratepayer' },
  { key: 'employee', plural: 'Employees', singular: 'employee' },
  { key: 'other', plural: 'Other', singular: 'party' },
]

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => store.can(MANAGE))

const type = computed<PartyType>(() => {
  const t = route.query.type
  return TYPES.some(x => x.key === t) ? (t as PartyType) : 'supplier'
})
const meta = computed(() => TYPES.find(t => t.key === type.value) as (typeof TYPES)[number])
function setType(t: PartyType): void { void router.replace({ query: { ...route.query, type: t } }) }
const onTabKey = useTabKeys(() => TYPES.map(t => t.key), () => type.value, setType)

const rows = ref<LedgerParty[]>([])
const total = ref(0)
const note = ref<string | null>(null)
const q = ref('')
const loading = ref(true)
const error = ref<string | null>(null)
/** The type the rows on screen were read for: the headings follow it, not the tab. */
const loadedType = ref<PartyType>('supplier')

let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  const asked = type.value
  loading.value = true
  error.value = null
  try {
    const res = await ledgerApi.parties({ party_type: asked, limit: 200, ...(q.value.trim() ? { q: q.value.trim() } : {}) })
    if (seq !== reqId) return
    rows.value = res.parties
    total.value = res.total ?? res.parties.length
    note.value = res.note ?? null
    loadedType.value = asked
  } catch (err) {
    if (seq !== reqId) return
    error.value = messageOf(err, `The ${meta.value.plural.toLowerCase()} could not be read.`)
  } finally {
    if (seq === reqId) loading.value = false
  }
}
onMounted(load)
watch(type, () => { q.value = ''; void load() })

const shown = computed(() => TYPES.find(t => t.key === loadedType.value) as (typeof TYPES)[number])
const hasStatement = (p: LedgerParty): boolean => p.party_type === 'debtor' || p.party_type === 'ratepayer'

const editing = ref<LedgerParty | null>(null)
const creating = ref(false)
const form = reactive({
  party_type: 'supplier' as PartyType, name: '', reference: '', contact_name: '', contact_phone: '', contact_email: '', address_text: '',
  status: 'active' as 'active' | 'inactive',
})
const formError = ref<string | null>(null)
const busy = ref(false)

// The add/edit form is a CwDialog: focus in, Tab kept inside, Esc ignored while saving, focus back
// to the button that opened it.
const opener = ref<HTMLElement | null>(null)
const openerOf = (e?: Event): HTMLElement | null => (e?.currentTarget instanceof HTMLElement ? e.currentTarget : null)
function closeForm(): void { if (!busy.value) creating.value = false }
function openNew(e?: Event): void {
  if (busy.value) return
  opener.value = openerOf(e)
  Object.assign(form, { party_type: type.value, name: '', reference: '', contact_name: '', contact_phone: '', contact_email: '', address_text: '', status: 'active' })
  editing.value = null
  creating.value = true
  formError.value = null
}
function openEdit(p: LedgerParty, e?: Event): void {
  if (busy.value) return
  opener.value = openerOf(e)
  Object.assign(form, {
    party_type: p.party_type, name: p.name, reference: p.reference ?? '', contact_name: p.contact_name ?? '', contact_phone: p.contact_phone ?? '',
    contact_email: p.contact_email ?? '', address_text: p.address_text ?? '', status: p.status,
  })
  editing.value = p
  creating.value = true
  formError.value = null
}
const blank = (v: string) => (v.trim() ? v.trim() : undefined)
const formNoun = computed(() => (TYPES.find(t => t.key === form.party_type)?.singular ?? 'party'))

async function save(): Promise<void> {
  if (form.name.trim().length < 2 || busy.value) return
  busy.value = true
  formError.value = null
  try {
    if (editing.value) {
      await ledgerApi.updateParty(editing.value.id, {
        name: form.name.trim(), contact_name: form.contact_name.trim() || null, contact_phone: form.contact_phone.trim() || null,
        contact_email: form.contact_email.trim() || null, address_text: form.address_text.trim() || null, status: form.status,
      })
    } else {
      await ledgerApi.createParty({
        party_type: form.party_type, name: form.name.trim(), reference: blank(form.reference), contact_name: blank(form.contact_name),
        contact_phone: blank(form.contact_phone), contact_email: blank(form.contact_email), address_text: blank(form.address_text),
      })
    }
    creating.value = false
    // A party made under another type is shown under that type.
    if (!editing.value && form.party_type !== type.value) setType(form.party_type)
    else await load()
  } catch (err) {
    formError.value = messageOf(err, `The ${formNoun.value} could not be saved.`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Users :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Parties</h2>
      <p>The suppliers, debtors, ratepayers and others the council deals with, named on the journals that record what is owed.</p>
    </div>
    <button v-if="canManage" type="button" class="cw-btn cw-btn--primary" @click="openNew"><Plus :size="18" aria-hidden="true" /> New {{ meta.singular }}</button>
  </section>
  <p v-if="!canManage" class="cw-hint">{{ store.whyUnavailable(MANAGE) }}</p>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

  <section class="cw-card">
    <div class="cw-card-body" style="padding-top: 18px; display: flex; flex-direction: column; gap: 12px">
      <div class="cw-seg" role="tablist" aria-label="Party type" @keydown="onTabKey">
        <button v-for="t in TYPES" :key="t.key" type="button" role="tab" :id="`pt-tab-${t.key}`" aria-controls="pt-panel" :aria-selected="t.key === type ? 'true' : 'false'"
          :tabindex="t.key === type ? 0 : -1" @click="setType(t.key)">{{ t.plural }}</button>
      </div>
      <form class="cw-search" role="search" style="max-width: 520px" @submit.prevent="load">
        <Search :size="22" aria-hidden="true" />
        <label class="sr-only" for="pt-search">Search {{ meta.plural.toLowerCase() }}</label>
        <input id="pt-search" v-model="q" class="cw-input" :placeholder="`${meta.plural.replace(/s$/, '')} name or reference`" :aria-label="`Search ${meta.plural.toLowerCase()}`" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; load()"><X :size="20" aria-hidden="true" /></button>
      </form>
      <div id="pt-panel" class="cw-table-wrap" role="tabpanel" :aria-labelledby="`pt-tab-${type}`">
        <div v-if="loading" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="error && !rows.length" class="cw-hint">Nothing is shown until the list can be read.</p>
        <p v-else-if="!rows.length" class="cw-empty"><strong>No {{ shown.plural.toLowerCase() }}.</strong>
          <template v-if="note">{{ note }} </template>
          <template v-if="canManage">Add the first with New {{ shown.singular }}.</template></p>
        <table v-else class="cw-table">
          <caption class="sr-only">{{ shown.plural }}</caption>
          <thead><tr><th>{{ shown.singular.charAt(0).toUpperCase() + shown.singular.slice(1) }}</th><th>Reference</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id">
              <td>
                <RouterLink v-if="hasStatement(p)" class="cw-link" :to="{ name: 'acc-debtor', params: { partyId: p.id } }"><strong>{{ p.name }}</strong></RouterLink>
                <RouterLink v-else-if="p.party_type === 'supplier'" class="cw-link" :to="{ name: 'acc-creditor', params: { partyId: p.id } }"><strong>{{ p.name }}</strong></RouterLink>
                <strong v-else>{{ p.name }}</strong>
                <div v-if="p.address_text" class="cw-hint">{{ p.address_text }}</div></td>
              <td>{{ p.reference ?? '—' }}</td><td>{{ p.contact_name ?? '—' }}</td><td>{{ p.contact_phone ?? '—' }}</td><td>{{ p.contact_email ?? '—' }}</td>
              <td><span class="cw-pill" :class="p.status === 'active' ? 'cw-pill--pos' : 'cw-pill--mute'">{{ p.status === 'active' ? 'Active' : 'Inactive' }}</span></td>
              <td><button v-if="canManage" type="button" class="cw-icon-btn" :aria-label="`Edit ${p.name}`" @click="openEdit(p, $event)"><Pencil :size="17" aria-hidden="true" /></button></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!loading && total > rows.length" class="cw-hint">Showing the first {{ rows.length }} of {{ total }}. Search by name or reference to narrow the list.</p>
      </div>
    </div>
  </section>

  <CwDialog v-if="creating" :title="editing ? `Edit ${editing.name}` : `New ${formNoun}`" :busy="busy" :opener="opener" form @close="closeForm" @submit="save">
    <template #header><button type="button" class="cw-icon-btn" aria-label="Close" :aria-disabled="busy || undefined" @click="closeForm"><X :size="20" aria-hidden="true" /></button></template>
        <label v-if="!editing" class="cw-field"><span class="cw-label">Type</span>
          <select v-model="form.party_type" class="cw-select"><option v-for="t in TYPES" :key="t.key" :value="t.key">{{ t.plural.replace(/s$/, '') }}</option></select></label>
        <label class="cw-field"><span class="cw-label">Name <span class="req">*</span></span><input v-model="form.name" class="cw-input" required minlength="2" aria-describedby="pt-name-hint" /><span id="pt-name-hint" class="cw-hint">At least 2 characters; Save is available once the name has them.</span></label>
        <label v-if="!editing" class="cw-field"><span class="cw-label">Reference</span><input v-model="form.reference" class="cw-input" placeholder="The council's account number for them" /></label>
        <label class="cw-field"><span class="cw-label">Contact person</span><input v-model="form.contact_name" class="cw-input" /></label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
          <label class="cw-field"><span class="cw-label">Phone</span><input v-model="form.contact_phone" class="cw-input" /></label>
          <label class="cw-field"><span class="cw-label">Email</span><input v-model="form.contact_email" type="email" class="cw-input" /></label>
        </div>
        <label class="cw-field"><span class="cw-label">Address</span><input v-model="form.address_text" class="cw-input" /></label>
        <label v-if="editing" class="cw-field"><span class="cw-label">Status</span>
          <select v-model="form.status" class="cw-select"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ formError }}</p>
    <template #footer>
      <button type="button" class="cw-btn" :aria-disabled="busy || undefined" @click="closeForm">Cancel</button>
      <button type="submit" class="cw-btn cw-btn--primary" :disabled="form.name.trim().length < 2" :aria-disabled="busy || undefined">{{ busy ? 'Saving…' : 'Save' }}</button>
    </template>
  </CwDialog>
</template>
