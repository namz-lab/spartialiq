<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const leases = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ parcel_id: '', tenant_name: '', kind: 'council_rental', rent: '', end_on: '', notes: '' })

async function load() {
  try { leases.value = ((await housingApi.leases()) as any).leases || [] }
  catch { err.value = 'Leases could not be read.' }
}
onMounted(load)

async function add() {
  try {
    await housingApi.addLease(form)
    banner.value = 'Lease written.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The lease could not be written.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.lease" class="hsg-card hsg-form" @submit.prevent="add">
      <h2>Council lease or staff housing</h2>
      <label>Parcel<input v-model="form.parcel_id" required /></label>
      <label>Tenant<input v-model="form.tenant_name" required /></label>
      <label>Kind
        <select v-model="form.kind">
          <option value="council_rental">Council rental</option>
          <option value="staff">Staff housing</option>
          <option value="institutional">Institutional</option>
        </select>
      </label>
      <label>Rent USD<input v-model="form.rent" /></label>
      <label>End on<input v-model="form.end_on" type="date" /></label>
      <label class="full">Notes<textarea v-model="form.notes" rows="2" /></label>
      <button class="hsg-btn" type="submit">Write the lease</button>
    </form>
    <div class="hsg-card">
      <h2>Leases</h2>
      <table>
        <thead><tr><th>No.</th><th>Stand</th><th>Tenant</th><th>Kind</th><th>Rent</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="l in leases" :key="l.id">
            <td class="mono">{{ l.lease_no }}</td><td>{{ l.stand_no }}</td><td>{{ l.tenant_name }}</td>
            <td>{{ l.kind }}</td><td class="num">{{ l.rent || '—' }}</td><td>{{ l.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
