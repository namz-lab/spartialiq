<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const route = useRoute()
const waiting = ref<any[]>([])
const allocations = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({
  waiting_list_id: '', parcel_id: String(route.query.parcel || ''),
  committee_minute: '', purchase_price: '', deposit_due: '', waiver_reason: '',
})

async function load() {
  try {
    waiting.value = ((await housingApi.waitingList()) as any).entries || []
    allocations.value = ((await housingApi.allocations()) as any).allocations || []
  } catch { err.value = 'Allocations could not be read.' }
}
onMounted(load)

async function allocate() {
  try {
    await housingApi.allocate(form)
    banner.value = 'Stand reserved from the waiting list.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The stand could not be allocated.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.allocate" class="hsg-card hsg-form" @submit.prevent="allocate">
      <h2>Reserve a stand</h2>
      <p class="mute full">Only a recommended name, after six months on the list, unless the committee authorised a written waiver.</p>
      <label>Recommended entry
        <select v-model="form.waiting_list_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="w in waiting.filter(x => x.status === 'recommended')" :key="w.id" :value="w.id">
            {{ w.list_no }} · {{ w.applicant_name }}
          </option>
        </select>
      </label>
      <label>Parcel id<input v-model="form.parcel_id" required placeholder="P-0000907" /></label>
      <label>Committee minute<input v-model="form.committee_minute" /></label>
      <label>Price USD<input v-model="form.purchase_price" /></label>
      <label>Deposit<input v-model="form.deposit_due" /></label>
      <label class="full">Written waiver<input v-model="form.waiver_reason" /></label>
      <button class="hsg-btn" type="submit">Allocate</button>
    </form>
    <div class="hsg-card">
      <h2>Live allocations</h2>
      <table>
        <thead><tr><th>Stand</th><th>Allottee</th><th>List</th><th>Status</th><th>Deposit</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in allocations" :key="a.id">
            <td class="mono">{{ a.stand_no || a.parcel_id }}</td>
            <td>{{ a.allottee_name }}</td><td class="mono">{{ a.list_no }}</td><td>{{ a.status }}</td>
            <td>{{ a.deposit_receipt_id ? 'paid' : (a.deposit_due ? 'owing' : '—') }}</td>
            <td>
              <button v-if="desk?.can.offer" type="button" class="link" @click="housingApi.issueOffer(a.id).then(() => { banner = 'Offer issued.'; load() })">Offer letter</button>
              <button v-if="desk?.can.agreement" type="button" class="link" @click="housingApi.signAgreement({ allocation_id: a.id }).then(() => { banner = 'Agreement signed.'; load() }).catch((e: any) => { err = e?.response?.data?.message })">Agreement of sale</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
