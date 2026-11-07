<script setup lang="ts">
/**
 * Section 73 notices. Staff draft, issue, serve, record the Administrative
 * Court appeal, and act only when the stage is may_act.
 */
import { ref, onMounted } from 'vue'
import api from '@/services/api'

const rows = ref<Record<string, unknown>[]>([])
const error = ref('')
const flash = ref('')
const form = ref({
  stand_number: '',
  condition_class: 'use_restriction',
  proposed_action: 'prohibit_use',
  condition_text: '',
  grounds: '',
  work_description: '',
  wilful: false,
  no_occupier_reason: '',
})

async function load() {
  error.value = ''
  const res = await api.get('/title-notices')
  rows.value = res.data?.data || []
}

onMounted(() => load().catch((e) => { error.value = e.message }))

function errOf(e: unknown) {
  const body = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data
  return body?.message || body?.error || (e as Error).message || 'Request failed'
}

async function create() {
  error.value = ''
  flash.value = ''
  try {
    await api.post('/title-notices', { ...form.value, wilful: form.value.wilful })
    flash.value = 'Draft saved'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function issue(id: string) {
  try { await api.post(`/title-notices/${id}/issue`, {}); flash.value = 'Issued'; await load() }
  catch (e) { error.value = errOf(e) }
}

async function serve(id: string) {
  const party_name = window.prompt('Name of the person served')
  const party_email = window.prompt('Their email, so they can read the notice in the portal') || ''
  const party = window.prompt('Party: owner, occupier, or both', 'both') || 'both'
  if (!party_name) return
  const served_on = new Date().toISOString().slice(0, 10)
  try {
    await api.post(`/title-notices/${id}/service`, {
      party, party_name, party_email, served_on, method: 'registered_post',
    })
    flash.value = 'Service recorded'
    await load()
  } catch (e) { error.value = errOf(e) }
}

async function act(row: Record<string, unknown>) {
  try {
    await api.post(`/title-notices/${row.id}/actions`, { action: row.proposed_action, notes: '' })
    flash.value = 'Action recorded'
    await load()
  } catch (e) { error.value = errOf(e) }
}
</script>

<template>
  <div class="tn">
    <header>
      <p class="eyebrow">Rural District Councils Act · section 73</p>
      <h1>Notices before action</h1>
      <p>Serve the owner and the occupier. Where the condition restricts use, building, or a scheme, wait 28 days. An appeal is to the Administrative Court and is recorded here. The council can act only when the stage is “may act”, and only as the notice said it would.</p>
    </header>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="flash" class="ok">{{ flash }}</p>

    <form class="panel" @submit.prevent="create">
      <h2>Draft a notice</h2>
      <label>Stand <input v-model="form.stand_number" required data-testid="tn-stand" /></label>
      <label>Class
        <select v-model="form.condition_class">
          <option value="use_restriction">Use restriction</option>
          <option value="building_requirements">Building requirements</option>
          <option value="scheme_or_plan">Scheme or plan</option>
          <option value="other">Other condition</option>
        </select>
      </label>
      <label>Proposed action
        <select v-model="form.proposed_action">
          <option value="prohibit_use">Prohibit use</option>
          <option value="execute_work">Do the required work</option>
          <option value="demolish">Demolish</option>
        </select>
      </label>
      <label>Condition <textarea v-model="form.condition_text" required rows="2" /></label>
      <label>Grounds <textarea v-model="form.grounds" required rows="2" /></label>
      <label v-if="form.proposed_action === 'execute_work'">Work <input v-model="form.work_description" /></label>
      <label v-if="form.proposed_action === 'demolish'" class="check">
        <input v-model="form.wilful" type="checkbox" /> The building was wilfully erected in breach
      </label>
      <label>No occupier (reason, if the stand is vacant) <input v-model="form.no_occupier_reason" /></label>
      <button type="submit" data-testid="tn-save">Save draft</button>
    </form>

    <section class="panel">
      <h2>Register <span>{{ rows.length }}</span></h2>
      <p v-if="!rows.length">No notices yet.</p>
      <article v-for="r in rows" :key="String(r.id)" class="row" :data-testid="`tn-row-${r.id}`">
        <div>
          <strong>Stand {{ r.stand_number }}</strong>
          <em>{{ r.stage }}</em>
          <span>{{ r.proposed_action }}</span>
          <p>{{ r.grounds }}</p>
        </div>
        <div class="actions">
          <button v-if="r.status === 'draft'" type="button" @click="issue(String(r.id))">Issue</button>
          <button v-if="r.status === 'issued' && r.stage !== 'actioned'" type="button" @click="serve(String(r.id))">Record service</button>
          <button v-if="r.stage === 'may_act'" type="button" @click="act(r)">Record the action</button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.tn { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem 3rem; font-family: "Source Sans 3", "Segoe UI", sans-serif; color: #1a2332; }
.eyebrow { letter-spacing: 0.08em; text-transform: uppercase; color: #0b5f4b; font-size: 0.75rem; font-weight: 700; }
h1 { margin: 0.2rem 0; }
header p { max-width: 46rem; color: #5a6578; }
.panel { background: #fff; border: 1px solid #d8dee8; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
form { display: grid; gap: 0.6rem; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: #5a6578; }
input, select, textarea { border: 1px solid #d8dee8; border-radius: 5px; padding: 0.4rem 0.5rem; font: inherit; color: #1a2332; }
.check { flex-direction: row; align-items: center; }
button { background: #0b5f4b; color: #fff; border: 0; border-radius: 5px; padding: 0.45rem 0.75rem; cursor: pointer; }
.row { display: flex; justify-content: space-between; gap: 1rem; border-top: 1px solid #d8dee8; padding: 0.7rem 0; }
.row em { font-style: normal; margin-left: 0.4rem; background: #f0f3f7; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
.actions { display: flex; gap: 0.4rem; align-items: flex-start; }
.err { background: #fdecea; color: #8b1e1e; padding: 0.5rem 0.75rem; border-radius: 5px; }
.ok { background: #e8f5ef; color: #0b5f4b; padding: 0.5rem 0.75rem; border-radius: 5px; }
</style>
