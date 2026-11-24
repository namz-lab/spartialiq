<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const certificates = ref<any[]>([])
const allocations = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ parcel_id: '', allocation_id: '', kind: 'occupation', notes: '' })

async function load() {
  try {
    certificates.value = ((await housingApi.occupation()) as any).certificates || []
    allocations.value = ((await housingApi.allocations()) as any).allocations || []
  } catch { err.value = 'Occupation certificates could not be read.' }
}
onMounted(load)

async function issue() {
  try { await housingApi.addOccupation(form); banner.value = 'Certificate issued.'; await load() }
  catch (e: any) { err.value = e?.response?.data?.message || 'The certificate could not be issued.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.occupation" class="hsg-card hsg-form" @submit.prevent="issue">
      <h2>Occupation certificate</h2>
      <p class="mute full">Issued when the allottee may occupy. Check servicing and any HSC Act order on the stand file first.</p>
      <label>Parcel<input v-model="form.parcel_id" required /></label>
      <label>Allocation
        <select v-model="form.allocation_id">
          <option value="">None</option>
          <option v-for="a in allocations" :key="a.id" :value="a.id">{{ a.stand_no || a.parcel_id }} · {{ a.allottee_name }}</option>
        </select>
      </label>
      <label>Kind
        <select v-model="form.kind">
          <option value="occupation">Occupation</option>
          <option value="temporary">Temporary occupation</option>
        </select>
      </label>
      <label class="full">Notes<textarea v-model="form.notes" rows="2" /></label>
      <button class="hsg-btn" type="submit">Issue</button>
    </form>
    <div class="hsg-card">
      <h2>Certificates</h2>
      <ul>
        <li v-for="o in certificates" :key="o.id">{{ o.certificate_no }} · {{ o.kind }} · {{ o.parcel_id }} · {{ o.issued_on }}</li>
      </ul>
    </div>
  </section>
</template>
