<script setup lang="ts">
import { computed, inject, onMounted, ref, type Ref } from 'vue'
import { RouterLink } from 'vue-router'
import { housingApi } from '../api'
import { pagesFor, type HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const overview = ref<any>(null)
const err = ref<string | null>(null)
onMounted(async () => {
  try { overview.value = await housingApi.overview() }
  catch { err.value = 'The housing desk could not be read.' }
})
const k = computed(() => overview.value?.kpis || {})
const q = computed(() => desk?.value?.queues || {})
const tiles = computed(() => pagesFor(desk?.value || null).filter((p) => p.path !== '/housing'))
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <div class="hsg-kpis">
      <article><span>On the waiting list</span><strong>{{ k.waiting ?? q.waiting ?? '—' }}</strong></article>
      <article><span>Recommended</span><strong>{{ q.recommended ?? '—' }}</strong></article>
      <article><span>Vacant HERTS / Layout</span><strong>{{ k.vacant ?? '—' }}</strong></article>
      <article><span>Allocated</span><strong>{{ k.allocated ?? '—' }}</strong></article>
      <article><span>Due for renewal</span><strong>{{ k.due_renewal ?? q.due_renewal ?? '—' }}</strong></article>
      <article><span>Deposits outstanding</span><strong>{{ q.deposits_outstanding ?? '—' }}</strong></article>
      <article><span>Open cessions</span><strong>{{ k.cessions_open ?? q.cessions_lodged ?? '—' }}</strong></article>
      <article><span>Standards orders</span><strong>{{ k.orders_open ?? q.orders_open ?? '—' }}</strong></article>
    </div>
    <div class="hsg-card">
      <h2>Work on this desk</h2>
      <p class="mute">Only the pages this post may use. A clerk cannot allocate; research cannot sign an agreement; legal cannot serve an HSC Act order.</p>
      <div class="hsg-tiles">
        <RouterLink v-for="p in tiles" :key="p.path" :to="p.path">
          <strong>{{ p.label }}</strong>
          <span class="mute">Open this register</span>
        </RouterLink>
      </div>
    </div>
    <div class="hsg-split">
      <div class="hsg-card">
        <h2>Schemes</h2>
        <table>
          <thead><tr><th>Scheme</th><th>Kind</th><th>Vacant</th><th>Taken</th></tr></thead>
          <tbody>
            <tr v-for="s in overview?.schemes || []" :key="s.id">
              <td>{{ s.name }}</td><td>{{ String(s.kind || '').replaceAll('_',' ') }}</td>
              <td class="num">{{ s.vacant }}</td><td class="num">{{ s.taken }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="hsg-card">
        <h2>Demand by ward</h2>
        <ul class="hsg-wards">
          <li v-for="w in overview?.demand_by_ward || []" :key="w.ward"><span>Ward {{ w.ward }}</span><strong>{{ w.n }}</strong></li>
        </ul>
        <p v-if="!(overview?.demand_by_ward || []).length" class="mute">Nobody on the list has named a ward yet.</p>
      </div>
    </div>
  </section>
</template>
