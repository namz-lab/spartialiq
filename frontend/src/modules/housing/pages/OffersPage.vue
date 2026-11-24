<script setup lang="ts">
import { inject, onMounted, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const offers = ref<any[]>([])
const agreements = ref<any[]>([])
const allocations = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)

async function load() {
  try {
    offers.value = ((await housingApi.offers()) as any).offers || []
    agreements.value = ((await housingApi.agreements()) as any).agreements || []
    allocations.value = ((await housingApi.allocations()) as any).allocations || []
  } catch { err.value = 'Offers could not be read.' }
}
onMounted(load)
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <div class="hsg-card">
      <h2>Offer letters</h2>
      <p class="mute">Thirty days to pay the deposit at the cash office. The agreement of sale will not sign until that receipt is on the allocation.</p>
      <table>
        <thead><tr><th>Offer</th><th>Allottee</th><th>Stand</th><th>Expires</th><th>Accepted</th><th></th></tr></thead>
        <tbody>
          <tr v-for="o in offers" :key="o.id">
            <td class="mono">{{ o.offer_no }}</td><td>{{ o.allottee_name }}</td>
            <td class="mono">{{ o.stand_no || o.parcel_id }}</td>
            <td>{{ o.expires_on }}</td><td>{{ o.accepted_on || '—' }}</td>
            <td>
              <button v-if="desk?.can.offer && !o.accepted_on && !o.declined_on" type="button" class="link" @click="housingApi.acceptOffer(o.id).then(load)">Accept</button>
              <button v-if="desk?.can.offer && !o.accepted_on && !o.declined_on" type="button" class="link" @click="housingApi.declineOffer(o.id).then(load)">Decline</button>
              <button v-if="desk?.can.allocate && !o.withdrawn_on" type="button" class="link" @click="housingApi.withdrawOffer(o.id, 'Withdrawn by Housing').then(load)">Withdraw</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="hsg-card">
      <h2>Agreements of sale</h2>
      <ul>
        <li v-for="g in agreements" :key="g.id">{{ g.agreement_no }} · {{ g.allottee_name }} · stand {{ g.parcel_id }} · signed {{ g.signed_on }}</li>
      </ul>
      <p v-if="!agreements.length" class="mute">None signed yet. Deposit receipts from the cashier unlock this step.</p>
    </div>
    <div class="hsg-card">
      <h2>Deposit clocks</h2>
      <table>
        <thead><tr><th>Stand</th><th>Allottee</th><th>First due</th><th>Balance due</th><th>Receipt</th></tr></thead>
        <tbody>
          <tr v-for="a in allocations" :key="a.id">
            <td class="mono">{{ a.stand_no || a.parcel_id }}</td>
            <td>{{ a.allottee_name }}</td>
            <td>{{ a.first_due_on || '—' }}</td>
            <td>{{ a.balance_due_on || '—' }}</td>
            <td>{{ a.deposit_receipt_id ? 'paid' : 'unpaid' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
