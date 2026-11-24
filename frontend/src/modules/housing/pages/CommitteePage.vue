<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const sittings = ref<any[]>([])
const items = ref<any[]>([])
const waiting = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const sitting = reactive({ minute_ref: '', notes: '' })
const item = reactive({ sitting_id: '', waiting_list_id: '', parcel_id: '', recommendation: 'allocate' })

async function load() {
  try {
    const c: any = await housingApi.committee()
    sittings.value = c.sittings || []
    items.value = c.items || []
    waiting.value = ((await housingApi.waitingList()) as any).entries || []
    if (!item.sitting_id && sittings.value[0]) item.sitting_id = sittings.value[0].id
  } catch { err.value = 'Committee papers could not be read.' }
}
onMounted(load)

async function openSitting() {
  try {
    await housingApi.openSitting(sitting)
    banner.value = 'Sitting opened.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The sitting could not be opened.' }
}
async function recommend() {
  try {
    await housingApi.addCommitteeItem(item.sitting_id, item)
    banner.value = 'Minute recorded.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'The item could not be written.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.committee" class="hsg-card hsg-form" @submit.prevent="openSitting">
      <h2>Open a sitting</h2>
      <label>Minute ref<input v-model="sitting.minute_ref" required placeholder="AC/2026/11" /></label>
      <label class="full">Notes<input v-model="sitting.notes" /></label>
      <button class="hsg-btn" type="submit">Open sitting</button>
    </form>
    <form v-if="desk?.can.committee || desk?.can.recommend" class="hsg-card hsg-form" @submit.prevent="recommend">
      <h2>Recommend, defer or refuse</h2>
      <label>Sitting
        <select v-model="item.sitting_id" required>
          <option v-for="s in sittings" :key="s.id" :value="s.id">{{ s.minute_ref || s.sitting_on }}</option>
        </select>
      </label>
      <label>Applicant
        <select v-model="item.waiting_list_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="w in waiting.filter(x => ['active','interviewed','recommended'].includes(x.status))" :key="w.id" :value="w.id">
            {{ w.list_no }} · {{ w.applicant_name }} · {{ w.status }}
          </option>
        </select>
      </label>
      <label>Stand (optional)<input v-model="item.parcel_id" placeholder="P-0000907" /></label>
      <label>Decision
        <select v-model="item.recommendation">
          <option value="allocate">Allocate</option><option value="defer">Defer</option><option value="refuse">Refuse</option>
        </select>
      </label>
      <button class="hsg-btn" type="submit">Minute the item</button>
    </form>
    <div class="hsg-card">
      <h2>Committee items</h2>
      <table>
        <thead><tr><th>List</th><th>Applicant</th><th>Stand</th><th>Decision</th></tr></thead>
        <tbody>
          <tr v-for="i in items" :key="i.id">
            <td class="mono">{{ i.list_no }}</td><td>{{ i.applicant_name }}</td>
            <td class="mono">{{ i.stand_no || i.parcel_id || '—' }}</td><td>{{ i.recommendation }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
