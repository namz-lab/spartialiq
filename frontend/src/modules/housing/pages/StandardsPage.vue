<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const orders = ref<any[]>([])
const overcrowding = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const order = reactive({ parcel_id: '', kind: 'repair', reason: '', comply_by: '', notes: '' })
const crowd = reactive({ parcel_id: '', occupants: '8', rooms: '2', notes: '' })

async function load() {
  try {
    orders.value = ((await housingApi.orders()) as any).orders || []
    overcrowding.value = ((await housingApi.overcrowding()) as any).notices || []
  } catch { err.value = 'Standards files could not be read.' }
}
onMounted(load)

async function serve() {
  try { await housingApi.addOrder(order); banner.value = 'Order served.'; await load() }
  catch (e: any) { err.value = e?.response?.data?.message || 'The order could not be served.' }
}
async function notice() {
  try { await housingApi.addOvercrowding({ ...crowd, occupants: Number(crowd.occupants), rooms: Number(crowd.rooms) }); banner.value = 'Overcrowding notice on file.'; await load() }
  catch (e: any) { err.value = e?.response?.data?.message || 'The notice could not be written.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.standards" class="hsg-card hsg-form" @submit.prevent="serve">
      <h2>Housing Standards Control Act order</h2>
      <label>Parcel<input v-model="order.parcel_id" required /></label>
      <label>Kind
        <select v-model="order.kind">
          <option value="repair">Repair</option><option value="demolition">Demolition</option>
          <option value="closure">Closure</option><option value="clearance">Clearance</option>
        </select>
      </label>
      <label>Comply by<input v-model="order.comply_by" type="date" /></label>
      <label class="full">Reason<input v-model="order.reason" required /></label>
      <button class="hsg-btn" type="submit">Serve</button>
    </form>
    <form v-if="desk?.can.standards" class="hsg-card hsg-form" @submit.prevent="notice">
      <h2>Overcrowding notice</h2>
      <label>Parcel<input v-model="crowd.parcel_id" required /></label>
      <label>Occupants<input v-model="crowd.occupants" type="number" min="1" /></label>
      <label>Rooms<input v-model="crowd.rooms" type="number" min="1" /></label>
      <button class="hsg-btn" type="submit">Notice</button>
    </form>
    <div class="hsg-card">
      <h2>Open orders</h2>
      <ul>
        <li v-for="o in orders" :key="o.id">{{ o.order_no }} · {{ o.kind }} · stand {{ o.stand_no }} · {{ o.status }} · {{ o.reason }}</li>
      </ul>
      <h3>Overcrowding</h3>
      <ul><li v-for="n in overcrowding" :key="n.id">{{ n.parcel_id }} · {{ n.occupants }} occupants · {{ n.status }}</li></ul>
    </div>
  </section>
</template>
