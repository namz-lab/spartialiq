<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const repos = ref<any[]>([])
const allocations = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ allocation_id: '', reason: 'non_payment', notes: '' })

async function load() {
  try {
    repos.value = ((await housingApi.repossessions()) as any).repossessions || []
    allocations.value = ((await housingApi.allocations()) as any).allocations || []
  } catch { err.value = 'Repossessions could not be read.' }
}
onMounted(load)

async function notice() {
  try { await housingApi.noticeRepossession(form); banner.value = 'Repossession notice served.'; await load() }
  catch (e: any) { err.value = e?.response?.data?.message || 'The notice could not be served.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.repossess" class="hsg-card hsg-form" @submit.prevent="notice">
      <h2>Notice of repossession</h2>
      <p class="mute full">Non-payment, failure to develop, or fraud. Completing a repossession returns the waiting-list entry to active and frees the stand.</p>
      <label>Allocation
        <select v-model="form.allocation_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="a in allocations" :key="a.id" :value="a.id">{{ a.stand_no || a.parcel_id }} · {{ a.allottee_name }}</option>
        </select>
      </label>
      <label>Reason
        <select v-model="form.reason">
          <option value="non_payment">Non-payment</option>
          <option value="non_development">Non-development</option>
          <option value="fraud">Fraud</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label class="full">Notes<textarea v-model="form.notes" rows="3" /></label>
      <button class="hsg-btn" type="submit">Serve notice</button>
    </form>
    <div class="hsg-card">
      <h2>Repossessions</h2>
      <ul>
        <li v-for="r in repos" :key="r.id">
          {{ r.allottee_name }} · {{ r.reason }} · {{ r.status }}
          <button v-if="desk?.can.repossess && r.status === 'noticed'" type="button" class="link" @click="housingApi.completeRepossession(r.id).then(() => { banner = 'Stand returned to the pool.'; load() })">Complete</button>
        </li>
      </ul>
    </div>
  </section>
</template>
