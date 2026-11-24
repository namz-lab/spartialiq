<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const allocations = ref<any[]>([])
const waiting = ref<any[]>([])
const cessions = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ allocation_id: '', kind: 'ordinary', from_name: '', to_name: '', to_waiting_list_id: '', court_ref: '', letters_of_admin: '', spouse_consent: true, notes: '' })

async function load() {
  try {
    allocations.value = ((await housingApi.allocations()) as any).allocations || []
    waiting.value = ((await housingApi.waitingList()) as any).entries || []
    cessions.value = ((await housingApi.cessions()) as any).cessions || []
  } catch { err.value = 'Cessions could not be read.' }
}
onMounted(load)

async function lodge() {
  try {
    await housingApi.lodgeCession(form)
    banner.value = 'Cession lodged.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The cession could not be lodged.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.cession_lodge" class="hsg-card hsg-form" @submit.prevent="lodge">
      <h2>Lodge a cession</h2>
      <p class="mute full">An ordinary cessionary must already be on the waiting list. Deceased estates need letters of administration; court orders need a reference.</p>
      <label>Allocation
        <select v-model="form.allocation_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="a in allocations" :key="a.id" :value="a.id">{{ a.stand_no || a.parcel_id }} · {{ a.allottee_name }}</option>
        </select>
      </label>
      <label>Kind
        <select v-model="form.kind">
          <option value="ordinary">Ordinary</option>
          <option value="deceased_estate">Deceased estate</option>
          <option value="court_order">Court order</option>
        </select>
      </label>
      <label>From<input v-model="form.from_name" required /></label>
      <label>To<input v-model="form.to_name" required /></label>
      <label v-if="form.kind === 'ordinary'">Cessionary on the list
        <select v-model="form.to_waiting_list_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="w in waiting.filter(x => ['active','recommended','interviewed'].includes(x.status))" :key="w.id" :value="w.id">
            {{ w.list_no }} · {{ w.applicant_name }}
          </option>
        </select>
      </label>
      <label v-if="form.kind === 'court_order'">Court reference<input v-model="form.court_ref" /></label>
      <label v-if="form.kind === 'deceased_estate'">Letters of administration<input v-model="form.letters_of_admin" /></label>
      <label class="full">Notes<textarea v-model="form.notes" rows="2" /></label>
      <button class="hsg-btn" type="submit">Lodge</button>
    </form>
    <div class="hsg-card">
      <h2>Cession register</h2>
      <table>
        <thead><tr><th>No.</th><th>Kind</th><th>From → to</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in cessions" :key="c.id">
            <td class="mono">{{ c.cession_no }}</td><td>{{ c.kind }}</td>
            <td>{{ c.from_name }} → {{ c.to_name }}</td><td>{{ c.status }}</td>
            <td>
              <button v-if="desk?.can.cession_decide" type="button" class="link" @click="housingApi.decideCession(c.id,'approved').then(load)">Approve</button>
              <button v-if="desk?.can.cession_decide" type="button" class="link" @click="housingApi.decideCession(c.id,'refused').then(load)">Refuse</button>
              <button v-if="desk?.can.cession_decide" type="button" class="link" @click="housingApi.decideCession(c.id,'completed').then(load)">Complete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
