<script setup lang="ts">
import { inject, ref, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import HousingMap from '../HousingMap.vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const router = useRouter()
const township = ref('HERTS')
const selected = ref<string | null>(null)
const stand = ref<any>(null)

watch(selected, async (id) => {
  if (!id) { stand.value = null; return }
  try { stand.value = await housingApi.stand(id) } catch { stand.value = null }
})
</script>

<template>
  <section class="hsg-main">
    <div class="hsg-map-tools">
      <label>Township
        <select v-model="township">
          <option value="HERTS">Hertfordshire</option>
          <option value="LAYOUT">Layout</option>
        </select>
      </label>
      <p class="mute">Click a stand. Housing, rates and planning files are the same parcel.</p>
    </div>
    <HousingMap :township="township" :selected="selected" @select="(id: string) => selected = id" />
    <aside v-if="stand" class="hsg-file">
      <h2>Stand {{ stand.stand.stand_no }}</h2>
      <p>{{ stand.stand.township_code }} · {{ stand.stand.map_status }} · {{ Number(stand.stand.area_m2).toFixed(0) }} m²</p>
      <p v-if="stand.stand.allottee_name">Allottee {{ stand.stand.allottee_name }}</p>
      <p>Services: water {{ stand.stand.water ? 'yes' : 'no' }} · sewer {{ stand.stand.sewer ? 'yes' : 'no' }} · road {{ stand.stand.road ? 'yes' : 'no' }} · power {{ stand.stand.electricity ? 'yes' : 'no' }}</p>
      <p v-if="stand.cross">Rates {{ stand.cross.rates_account || 'none' }} · {{ stand.cross.rates_band || 'unbilled' }} · deposit {{ stand.cross.deposit_receipt_no || 'unpaid' }} · {{ stand.cross.planning_files }} planning file(s)</p>
      <ul v-if="stand.permits?.length">
        <li v-for="p in stand.permits" :key="p.id">{{ p.tpd_reference || p.stand_number }} · {{ p.status }} · {{ p.applicant_name }}</li>
      </ul>
      <button v-if="desk?.can.allocate" type="button" class="hsg-btn" @click="router.push({ path: '/housing/allocations', query: { parcel: stand.stand.parcel_id } })">Allocate this stand</button>
      <button v-if="desk?.can.servicing" type="button" class="hsg-btn ghost" @click="router.push({ path: '/housing/servicing', query: { parcel: stand.stand.parcel_id } })">Update servicing</button>
      <button type="button" class="link" @click="router.push('/housing/file/' + encodeURIComponent(stand.stand.parcel_id))">Open the full stand file</button>
    </aside>
  </section>
</template>
