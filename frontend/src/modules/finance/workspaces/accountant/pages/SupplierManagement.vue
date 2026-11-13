<script setup lang="ts">
/**
 * The council's suppliers: the ledger parties of type `supplier`. A supplier is named on the
 * journals that raise or settle what it is owed. Adding and editing one needs
 * `finance.ledger.party.manage`; the server refuses anyone else.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { Truck, Plus, Search, X, AlertTriangle, Pencil } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import type { LedgerParty } from '../../../models/ledgerTypes'

const store = useFinanceStore()
const canManage = computed(() => store.can('finance.ledger.party.manage'))

const rows = ref<LedgerParty[]>([])
const q = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    rows.value = (await ledgerApi.parties({ party_type: 'supplier', limit: 200, ...(q.value.trim() ? { q: q.value.trim() } : {}) })).parties
  } catch (err) {
    error.value = messageOf(err, 'The suppliers could not be read.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const editing = ref<LedgerParty | null>(null)
const creating = ref(false)
const form = reactive({ name: '', reference: '', contact_name: '', contact_phone: '', contact_email: '', address_text: '', status: 'active' as 'active' | 'inactive' })
const formError = ref<string | null>(null)
const busy = ref(false)

function openNew(): void {
  Object.assign(form, { name: '', reference: '', contact_name: '', contact_phone: '', contact_email: '', address_text: '', status: 'active' })
  editing.value = null
  creating.value = true
  formError.value = null
}
function openEdit(p: LedgerParty): void {
  Object.assign(form, {
    name: p.name, reference: p.reference ?? '', contact_name: p.contact_name ?? '', contact_phone: p.contact_phone ?? '',
    contact_email: p.contact_email ?? '', address_text: p.address_text ?? '', status: p.status,
  })
  editing.value = p
  creating.value = true
  formError.value = null
}
const blank = (v: string) => (v.trim() ? v.trim() : undefined)

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
        party_type: 'supplier', name: form.name.trim(), reference: blank(form.reference), contact_name: blank(form.contact_name),
        contact_phone: blank(form.contact_phone), contact_email: blank(form.contact_email), address_text: blank(form.address_text),
      })
    }
    creating.value = false
    await load()
  } catch (err) {
    formError.value = messageOf(err, 'The supplier could not be saved.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Truck :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Supplier Management</h2>
      <p>The suppliers the council buys from, named on the journals that record what it owes them.</p>
    </div>
    <button v-if="canManage" type="button" class="cw-btn cw-btn--primary" @click="openNew"><Plus :size="18" aria-hidden="true" /> New supplier</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card">
    <div class="cw-card-body" style="padding-top: 18px; display: flex; flex-direction: column; gap: 12px">
      <form class="cw-search" role="search" style="max-width: 520px" @submit.prevent="load">
        <Search :size="22" aria-hidden="true" />
        <input v-model="q" class="cw-input" placeholder="Supplier name or reference" aria-label="Search suppliers" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; load()"><X :size="20" /></button>
      </form>
      <div class="cw-table-wrap">
        <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!rows.length" class="cw-empty"><strong>No suppliers.</strong><template v-if="canManage">Add the first with New supplier.</template></p>
        <table v-else class="cw-table">
          <thead><tr><th>Supplier</th><th>Reference</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th><th><span class="sr-only">Edit</span></th></tr></thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id">
              <td><strong>{{ p.name }}</strong><div v-if="p.address_text" class="cw-hint">{{ p.address_text }}</div></td>
              <td>{{ p.reference ?? '—' }}</td><td>{{ p.contact_name ?? '—' }}</td><td>{{ p.contact_phone ?? '—' }}</td><td>{{ p.contact_email ?? '—' }}</td>
              <td><span class="cw-pill" :class="p.status === 'active' ? 'cw-pill--pos' : 'cw-pill--mute'">{{ p.status === 'active' ? 'Active' : 'Inactive' }}</span></td>
              <td><button v-if="canManage" type="button" class="cw-icon-btn" :aria-label="`Edit ${p.name}`" @click="openEdit(p)"><Pencil :size="17" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <div v-if="creating" class="cw-dialog-backdrop" @click.self="creating = false" @keydown.esc="creating = false">
    <form class="cw-dialog" role="dialog" aria-modal="true" :aria-label="editing ? 'Edit supplier' : 'New supplier'" @submit.prevent="save">
      <header><h3>{{ editing ? `Edit ${editing.name}` : 'New supplier' }}</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="creating = false"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <label class="cw-field"><span class="cw-label">Name <span class="req">*</span></span><input v-model="form.name" class="cw-input" required minlength="2" /></label>
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
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="creating = false">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="busy || form.name.trim().length < 2">{{ busy ? 'Saving…' : 'Save' }}</button>
      </footer>
    </form>
  </div>
</template>
