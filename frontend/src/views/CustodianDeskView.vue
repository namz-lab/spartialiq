<script setup lang="ts">
/**
 * Council side of the custodian boundary.
 * X4 Surveyor-General submissions go out by courier until that office has an API.
 * X7 Deeds notices come in by hand or CSV. Actioning a sale writes transfer lineage (X9).
 * G10 an estate layout needs the Minister before stands on it can be allocated.
 */
import { ref, onMounted } from 'vue'
import api from '@/services/api'

const tab = ref<'sg' | 'deeds' | 'estate'>('sg')
const rows = ref<Record<string, unknown>[]>([])
const lineage = ref<Record<string, unknown>[]>([])
const error = ref('')
const flash = ref('')
const sg = ref({ title: '', plan_type: 'diagram', stand_number: '' })
const deeds = ref({
  notice_kind: 'sale', stand_number: '', deed_number: '',
  transferor_name: '', transferee_name: '', child_stand_number: '',
})
const estate = ref({ title: '', area_scope: '' })

function errOf(e: unknown) {
  const body = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data
  return body?.message || body?.error || (e as Error).message || 'Request failed'
}

async function load() {
  error.value = ''
  if (tab.value === 'sg') {
    rows.value = (await api.get('/custodian/sg-submissions')).data?.data || []
  } else if (tab.value === 'deeds') {
    rows.value = (await api.get('/custodian/deeds-notices')).data?.data || []
    lineage.value = (await api.get('/custodian/lineage')).data?.data || []
  } else {
    rows.value = (await api.get('/registers/estate-approvals')).data?.data || []
  }
}

onMounted(() => load().catch((e) => { error.value = errOf(e) }))

async function pick(next: 'sg' | 'deeds' | 'estate') {
  tab.value = next
  await load()
}

async function addSg() {
  try {
    await api.post('/custodian/sg-submissions', sg.value)
    flash.value = 'Submission drafted. Send the diagram by courier, then mark it sent.'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function markSent(id: string) {
  const sg_reference = window.prompt('Surveyor-General reference, if you have it already') || undefined
  try {
    await api.patch(`/custodian/sg-submissions/${id}`, { status: 'sent', sg_reference })
    flash.value = 'Marked sent by courier'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function addDeeds() {
  try {
    await api.post('/custodian/deeds-notices', deeds.value)
    flash.value = 'Notice received'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function actionDeeds(row: Record<string, unknown>) {
  const child = window.prompt('New stand or parcel identifier after the transfer', String(row.child_stand_number || ''))
  if (!child) return
  try {
    await api.patch(`/custodian/deeds-notices/${row.id}`, { status: 'actioned', child_stand_number: child })
    flash.value = 'Notice actioned and lineage recorded'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function cancelDeeds(id: string) {
  try {
    await api.patch(`/custodian/deeds-notices/${id}`, { status: 'cancelled' })
    flash.value = 'Notice cancelled'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function addEstate() {
  try {
    await api.post('/registers/estate-approvals', estate.value)
    flash.value = 'Layout recorded. Advertise it, then record the Minister’s approval.'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function advanceEstate(id: string, status: string) {
  const body: Record<string, string> = { status }
  if (status === 'approved') {
    const minister_ref = window.prompt('Minister’s approval reference')
    if (!minister_ref) return
    body.minister_ref = minister_ref
  }
  try {
    await api.patch(`/registers/estate-approvals/${id}`, body)
    flash.value = 'Layout updated'
    await load()
  } catch (e) { error.value = errOf(e) }
}
</script>

<template>
  <div class="cd">
    <header>
      <p class="eyebrow">Custodian boundary</p>
      <h1>Surveyor-General, Deeds Registry, and estate approval</h1>
      <p>These offices do not expose an API to the council. Record what left the building and what came back, so the register stays honest.</p>
    </header>
    <nav>
      <button type="button" :class="{ on: tab === 'sg' }" @click="pick('sg')">Surveyor-General (X4)</button>
      <button type="button" :class="{ on: tab === 'deeds' }" @click="pick('deeds')">Deeds notices (X7 / X9)</button>
      <button type="button" :class="{ on: tab === 'estate' }" @click="pick('estate')">Estate approval (G10)</button>
    </nav>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="flash" class="ok">{{ flash }}</p>

    <form v-if="tab === 'sg'" class="panel" @submit.prevent="addSg">
      <label>Title <input v-model="sg.title" required data-testid="cd-sg-title" /></label>
      <label>Plan type
        <select v-model="sg.plan_type">
          <option value="diagram">Diagram</option>
          <option value="general_plan">General plan</option>
          <option value="layout">Layout</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Stand <input v-model="sg.stand_number" /></label>
      <button type="submit">Save draft</button>
    </form>

    <form v-else-if="tab === 'deeds'" class="panel" @submit.prevent="addDeeds">
      <label>Kind
        <select v-model="deeds.notice_kind">
          <option value="sale">Sale</option>
          <option value="subdivision_lease">Subdivision lease</option>
          <option value="cancellation">Cancellation</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Stand <input v-model="deeds.stand_number" required /></label>
      <label>Deed number <input v-model="deeds.deed_number" /></label>
      <label>From <input v-model="deeds.transferor_name" /></label>
      <label>To <input v-model="deeds.transferee_name" /></label>
      <label>New stand after transfer <input v-model="deeds.child_stand_number" /></label>
      <button type="submit">Record notice</button>
    </form>

    <form v-else class="panel" @submit.prevent="addEstate">
      <label>Layout title <input v-model="estate.title" required /></label>
      <label>Area <input v-model="estate.area_scope" /></label>
      <button type="submit">Save layout</button>
    </form>

    <section class="panel">
      <article v-for="r in rows" :key="String(r.id)" class="row">
        <div>
          <strong>{{ r.title || r.notice_kind || r.stand_number }}</strong>
          <em>{{ r.status }}</em>
          <span v-if="r.stand_number">Stand {{ r.stand_number }}</span>
          <span v-if="r.sg_reference">SG {{ r.sg_reference }}</span>
          <span v-if="r.minister_ref">Minister {{ r.minister_ref }}</span>
        </div>
        <div class="actions">
          <button v-if="tab === 'sg' && r.status === 'draft'" type="button" @click="markSent(String(r.id))">Mark sent by courier</button>
          <button v-if="tab === 'deeds' && r.status === 'received'" type="button" @click="actionDeeds(r)">Action and keep lineage</button>
          <button v-if="tab === 'deeds' && r.status !== 'cancelled'" type="button" @click="cancelDeeds(String(r.id))">Cancel</button>
          <button v-if="tab === 'estate' && r.status === 'draft'" type="button" @click="advanceEstate(String(r.id), 'advertised')">Advertise (21 days)</button>
          <button v-if="tab === 'estate' && r.status === 'advertised'" type="button" @click="advanceEstate(String(r.id), 'awaiting_minister')">Send to Minister</button>
          <button v-if="tab === 'estate' && r.status === 'awaiting_minister'" type="button" @click="advanceEstate(String(r.id), 'approved')">Record approval</button>
        </div>
      </article>
      <p v-if="!rows.length">Nothing recorded yet.</p>
    </section>

    <section v-if="tab === 'deeds'" class="panel">
      <h2>Parcel lineage</h2>
      <p v-if="!lineage.length">No transfer or subdivision lineage yet.</p>
      <p v-for="l in lineage" :key="String(l.id)">{{ l.action }}: {{ l.parent_stand }} → {{ l.child_stand }}</p>
    </section>
  </div>
</template>

<style scoped>
.cd { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem 3rem; font-family: "Source Sans 3", "Segoe UI", sans-serif; color: #1a2332; }
.eyebrow { letter-spacing: 0.08em; text-transform: uppercase; color: #0b5f4b; font-size: 0.75rem; font-weight: 700; }
header p { max-width: 46rem; color: #5a6578; }
nav { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 1rem 0; }
nav button, form button, .actions button { background: #fff; border: 1px solid #d8dee8; border-radius: 5px; padding: 0.4rem 0.7rem; cursor: pointer; }
nav button.on, form button { background: #0b5f4b; color: #fff; border-color: #0b5f4b; }
.panel { background: #fff; border: 1px solid #d8dee8; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.6rem; align-items: end; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: #5a6578; }
input, select { border: 1px solid #d8dee8; border-radius: 5px; padding: 0.4rem 0.5rem; font: inherit; }
.row { display: flex; justify-content: space-between; gap: 1rem; border-top: 1px solid #d8dee8; padding: 0.7rem 0; }
.row em { font-style: normal; margin-left: 0.4rem; background: #f0f3f7; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
.actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.err { background: #fdecea; color: #8b1e1e; padding: 0.5rem 0.75rem; border-radius: 5px; }
.ok { background: #e8f5ef; color: #0b5f4b; padding: 0.5rem 0.75rem; border-radius: 5px; }
</style>
