<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const waiting = ref<any[]>([])
const interviews = ref<any[]>([])
const dualQ = ref('')
const dual = ref<any>(null)
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ waiting_list_id: '', capacity_ok: true, documents_complete: true, dual_ownership: false, recommendation: 'allocate', notes: '' })

async function load() {
  try {
    waiting.value = ((await housingApi.waitingList()) as any).entries || []
    interviews.value = ((await housingApi.interviews()) as any).interviews || []
  } catch { err.value = 'Research files could not be read.' }
}
onMounted(load)

async function searchDual() {
  try { dual.value = await housingApi.dualOwnership(dualQ.value) }
  catch (e: any) { err.value = e?.response?.data?.message || 'Dual-ownership search failed.' }
}
async function hold() {
  try {
    await housingApi.addInterview(form)
    banner.value = 'Interview recorded.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The interview could not be written.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <div class="hsg-card">
      <h2>Dual-ownership search</h2>
      <p class="mute">Rates accounts and live Housing allocations on the same person. A second stand is not allocated while the first is still live.</p>
      <form class="hsg-form" @submit.prevent="searchDual">
        <label class="full">Name or identity<input v-model="dualQ" minlength="2" required /></label>
        <button class="hsg-btn" type="submit">Search the registers</button>
      </form>
      <p v-if="dual">{{ dual.dual ? 'Live allocation found — do not recommend a second stand.' : 'No live housing allocation on that name.' }}</p>
      <ul>
        <li v-for="m in dual?.matches || []" :key="m.person_id">{{ m.display_name }} · waiting {{ (m.waiting_list || []).length }} · allocations {{ (m.allocations || []).length }}</li>
      </ul>
    </div>
    <form v-if="desk?.can.interview" class="hsg-card hsg-form" @submit.prevent="hold">
      <h2>Capacity interview</h2>
      <label>Waiting-list entry
        <select v-model="form.waiting_list_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="w in waiting.filter(x => ['active','invited','interviewed'].includes(x.status))" :key="w.id" :value="w.id">
            {{ w.list_no }} · {{ w.applicant_name }}
          </option>
        </select>
      </label>
      <label>Recommendation
        <select v-model="form.recommendation">
          <option value="allocate">Recommend to committee</option>
          <option value="defer">Defer</option>
          <option value="disqualify">Disqualify</option>
        </select>
      </label>
      <label class="full">Notes<textarea v-model="form.notes" rows="3" /></label>
      <button class="hsg-btn" type="submit">Record interview</button>
    </form>
    <div class="hsg-card">
      <h2>Interviews held</h2>
      <table>
        <thead><tr><th>List</th><th>Applicant</th><th>Held</th><th>Capacity</th><th>Dual ownership</th><th>Recommendation</th></tr></thead>
        <tbody>
          <tr v-for="i in interviews" :key="i.id">
            <td class="mono">{{ i.list_no }}</td><td>{{ i.applicant_name }}</td>
            <td>{{ i.held_on }}</td><td>{{ i.capacity_ok ? 'yes' : 'no' }}</td>
            <td>{{ i.dual_ownership ? 'found' : 'clear' }}</td><td>{{ i.recommendation || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
