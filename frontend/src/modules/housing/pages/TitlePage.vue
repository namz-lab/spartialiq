<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const allocations = ref<any[]>([])
const titles = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ allocation_id: '', conveyancer: '', notes: '' })

async function load() {
  try {
    allocations.value = ((await housingApi.allocations()) as any).allocations || []
    titles.value = ((await housingApi.title()) as any).requests || []
  } catch { err.value = 'Title files could not be read.' }
}
onMounted(load)

async function lodge() {
  try {
    await housingApi.lodgeTitle(form)
    banner.value = 'Title request lodged. Treasurer clearance is required while rates are owing.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'Title could not be lodged.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.title" class="hsg-card hsg-form" @submit.prevent="lodge">
      <h2>Lodge title with the Deeds office</h2>
      <p class="mute full">Housing will not lodge while the rates account is in arrears. The cash office and revenue officer clear the stand first.</p>
      <label>Allocation
        <select v-model="form.allocation_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="a in allocations" :key="a.id" :value="a.id">{{ a.stand_no || a.parcel_id }} · {{ a.allottee_name }}</option>
        </select>
      </label>
      <label>Conveyancer<input v-model="form.conveyancer" /></label>
      <label class="full">Notes<textarea v-model="form.notes" rows="2" /></label>
      <button class="hsg-btn" type="submit">Lodge</button>
    </form>
    <div class="hsg-card">
      <h2>Title requests</h2>
      <table>
        <thead><tr><th>Allottee</th><th>Stand</th><th>Status</th><th>Deed</th><th></th></tr></thead>
        <tbody>
          <tr v-for="t in titles" :key="t.id">
            <td>{{ t.allottee_name }}</td><td class="mono">{{ t.parcel_id }}</td>
            <td>{{ t.status }}</td><td>{{ t.deed_ref || '—' }}</td>
            <td>
              <button v-if="desk?.can.title" type="button" class="link" @click="housingApi.setTitleStatus(t.id, 'at_deeds').then(load)">At Deeds</button>
              <button v-if="desk?.can.title" type="button" class="link" @click="housingApi.setTitleStatus(t.id, 'issued', t.deed_ref || 'DT').then(load)">Issued</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
