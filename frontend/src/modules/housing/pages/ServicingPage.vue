<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const route = useRoute()
const stands = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({
  parcel_id: String(route.query.parcel || ''),
  water: false, sewer: false, road: false, electricity: false, notes: '',
})

async function load() {
  try { stands.value = ((await housingApi.stands({ limit: 200 })) as any).stands || [] }
  catch { err.value = 'Stands could not be read.' }
}
onMounted(load)

async function save() {
  try {
    await housingApi.saveServicing(form.parcel_id, form)
    banner.value = 'Servicing updated. Housing and Planning both read this stand.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'Servicing could not be saved.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.servicing" class="hsg-card hsg-form" @submit.prevent="save">
      <h2>Services on a stand</h2>
      <p class="mute full">Water, sewer, road and electricity as Works and Housing jointly know them. Occupation should wait on water and sewer.</p>
      <label>Parcel<input v-model="form.parcel_id" required list="hsg-stands" /></label>
      <datalist id="hsg-stands">
        <option v-for="s in stands" :key="s.parcel_id" :value="s.parcel_id">{{ s.stand_no }}</option>
      </datalist>
      <label>Water <select v-model="form.water"><option :value="true">Yes</option><option :value="false">No</option></select></label>
      <label>Sewer <select v-model="form.sewer"><option :value="true">Yes</option><option :value="false">No</option></select></label>
      <label>Road <select v-model="form.road"><option :value="true">Yes</option><option :value="false">No</option></select></label>
      <label>Electricity <select v-model="form.electricity"><option :value="true">Yes</option><option :value="false">No</option></select></label>
      <label class="full">Notes<input v-model="form.notes" /></label>
      <button class="hsg-btn" type="submit">Save servicing</button>
    </form>
    <div class="hsg-card">
      <h2>Unserviced stands (sample)</h2>
      <table>
        <thead><tr><th>Stand</th><th>Township</th><th>Water</th><th>Sewer</th><th>Road</th><th>Power</th></tr></thead>
        <tbody>
          <tr v-for="s in stands.filter(x => !(x.water && x.sewer))" :key="s.parcel_id">
            <td class="mono">{{ s.stand_no }}</td><td>{{ s.township_code }}</td>
            <td>{{ s.water ? 'yes' : 'no' }}</td><td>{{ s.sewer ? 'yes' : 'no' }}</td>
            <td>{{ s.road ? 'yes' : 'no' }}</td><td>{{ s.electricity ? 'yes' : 'no' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
