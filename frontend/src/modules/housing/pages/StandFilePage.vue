<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { housingApi } from '../api'

const route = useRoute()
const file = ref<any>(null)
const err = ref<string | null>(null)

onMounted(async () => {
  const id = String(route.params.parcelId || '')
  try { file.value = await housingApi.cross(id) }
  catch { err.value = 'That stand file could not be read.' }
})
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <div v-if="file" class="hsg-card">
      <h2>Stand file {{ file.file.stand_no }}</h2>
      <p>{{ file.file.township_code }} · {{ file.file.map_status }} · {{ file.file.allottee_name || 'vacant' }}</p>
      <dl>
        <div><dt>Rates account</dt><dd>{{ file.file.rates_account || 'none' }} ({{ file.file.rates_band || 'unbilled' }})</dd></div>
        <div><dt>Deposit receipt</dt><dd>{{ file.file.deposit_receipt_no || 'unpaid' }}</dd></div>
        <div><dt>Purchase price</dt><dd>{{ file.file.purchase_price || '—' }}</dd></div>
        <div><dt>Water / sewer / road / power</dt><dd>{{ file.file.water ? 'yes' : 'no' }} / {{ file.file.sewer ? 'yes' : 'no' }} / {{ file.file.road ? 'yes' : 'no' }} / {{ file.file.electricity ? 'yes' : 'no' }}</dd></div>
      </dl>
      <h3>Planning files</h3>
      <ul>
        <li v-for="p in file.permits" :key="p.id">{{ p.tpd_reference || p.stand_number }} · {{ p.status }} · {{ p.applicant_name }}</li>
      </ul>
      <p v-if="!file.permits?.length" class="mute">No planning application on this parcel yet.</p>
      <h3>Housing fees at the cash office</h3>
      <ul>
        <li v-for="(f, i) in file.housing_fees" :key="i">{{ f.receipt_no }} · {{ f.fee_kind }} · {{ f.amount }} {{ f.currency }} · {{ f.received_on }}</li>
      </ul>
    </div>
  </section>
</template>
