<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const waiting = ref<any[]>([])
const q = ref('')
const status = ref('')
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({
  applicant_name: '', sought: 'stand', density: 'any', preferred_ward: '9',
  household_size: '4', monthly_income: '', employer: '', special_needs: '', resident: true, first_time_seeker: true, notes: '',
})

async function load() {
  err.value = null
  try {
    const params: Record<string, string> = {}
    if (q.value) params.q = q.value
    if (status.value) params.status = status.value
    waiting.value = ((await housingApi.waitingList(params)) as any).entries || []
  } catch { err.value = 'The waiting list could not be read.' }
}
onMounted(load)

async function add() {
  try {
    const r: any = await housingApi.addWaiting({
      ...form, preferred_ward: Number(form.preferred_ward) || null, household_size: Number(form.household_size) || null,
    })
    banner.value = `Waiting-list ${r.entry.list_no} written.`
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The entry could not be written.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.waiting" class="hsg-card hsg-form" @submit.prevent="add">
      <h2>Register on the waiting list</h2>
      <p class="mute full">The only door onto a council stand. First-time seekers, residents, 18+. Renew every year or the entry lapses.</p>
      <label>Applicant<input v-model="form.applicant_name" required /></label>
      <label>Seeking
        <select v-model="form.sought">
          <option value="stand">Stand</option><option value="rental">Rental</option>
          <option value="staff">Staff housing</option><option value="cooperative">Cooperative</option>
          <option value="pay_scheme">Pay scheme</option>
        </select>
      </label>
      <label>Density
        <select v-model="form.density">
          <option value="any">Any</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
      </label>
      <label>Ward<input v-model="form.preferred_ward" type="number" min="1" max="19" /></label>
      <label>Household<input v-model="form.household_size" type="number" min="1" /></label>
      <label>Income USD<input v-model="form.monthly_income" /></label>
      <label>Employer<input v-model="form.employer" /></label>
      <label>Special needs<input v-model="form.special_needs" /></label>
      <label class="full">Notes<textarea v-model="form.notes" rows="2" /></label>
      <button class="hsg-btn" type="submit">Write the entry</button>
    </form>
    <div class="hsg-card">
      <h2>The list</h2>
      <form class="hsg-form" @submit.prevent="load">
        <label>Search<input v-model="q" /></label>
        <label>Status
          <select v-model="status">
            <option value="">Any</option>
            <option value="active">Active</option><option value="invited">Invited</option>
            <option value="interviewed">Interviewed</option><option value="recommended">Recommended</option>
            <option value="allocated">Allocated</option><option value="lapsed">Lapsed</option>
          </select>
        </label>
        <button class="hsg-btn ghost" type="submit">Filter</button>
      </form>
      <table>
        <thead><tr><th>No.</th><th>Applicant</th><th>Seeking</th><th>Ward</th><th>Score</th><th>Status</th><th>Lapses</th><th></th></tr></thead>
        <tbody>
          <tr v-for="w in waiting" :key="w.id">
            <td class="mono">{{ w.list_no }}</td><td>{{ w.applicant_name }}</td>
            <td>{{ w.sought }}</td><td>{{ w.preferred_ward || '—' }}</td>
            <td class="num">{{ w.score ?? '—' }}</td><td>{{ w.status }}</td>
            <td>{{ String(w.lapses_on || '').slice(0,10) }}</td>
            <td>
              <button v-if="desk?.can.waiting" type="button" class="link" @click="housingApi.renew(w.id).then(load)">Renew</button>
              <button v-if="desk?.can.interview" type="button" class="link" @click="housingApi.setWaitingStatus(w.id, 'invited').then(load)">Invite</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
