<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Home, ListOrdered } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { housingApi } from './api'

const auth = useAuthStore()
const router = useRouter()
const mine = ref<{ waiting_list: any[]; allocations: any[]; leases: any[] } | null>(null)
const err = ref<string | null>(null)
const ok = ref<string | null>(null)
const form = reactive({ applicant_name: auth.user?.name || '', sought: 'stand', density: 'any', preferred_ward: '', household_size: '4', notes: '' })

async function load() {
  try { mine.value = await housingApi.me() as any } catch { err.value = 'Your housing file could not be read.' }
}
onMounted(load)

async function join() {
  err.value = null; ok.value = null
  try {
    const r = await housingApi.joinWaitingList({
      ...form, preferred_ward: form.preferred_ward ? Number(form.preferred_ward) : null,
      household_size: form.household_size ? Number(form.household_size) : null,
    }) as any
    ok.value = `You are on the waiting list as ${r.entry.list_no}. Renew this number every year.`
    await load()
  } catch (e: any) {
    err.value = e?.response?.data?.message || 'The application could not be taken.'
  }
}
</script>

<template>
  <main class="hsg-cit">
    <header>
      <button type="button" class="hsg-back" @click="router.push('/citizen')">Back to citizen services</button>
      <h1><Home :size="22" /> Housing waiting list</h1>
      <p>Vungu allocates residential stands from this list, in turn, against vacant parcels on the cadastre. A stand is never given to someone who is not on it.</p>
    </header>
    <p v-if="err" class="hsg-alert" role="alert">{{ err }}</p>
    <p v-if="ok" class="hsg-ok" role="status">{{ ok }}</p>
    <section class="hsg-card">
      <h2><ListOrdered :size="16" /> Join the list</h2>
      <form class="hsg-form" @submit.prevent="join">
        <label>Your name<input v-model="form.applicant_name" required /></label>
        <label>Seeking
          <select v-model="form.sought">
            <option value="stand">A residential stand</option>
            <option value="rental">Council rental</option>
            <option value="cooperative">Housing cooperative</option>
            <option value="pay_scheme">Pay scheme</option>
          </select>
        </label>
        <label>Density
          <select v-model="form.density">
            <option value="any">Any</option><option value="low">Low</option>
            <option value="medium">Medium</option><option value="high">High</option>
          </select>
        </label>
        <label>Preferred ward<input v-model="form.preferred_ward" type="number" min="1" max="19" /></label>
        <label>Household size<input v-model="form.household_size" type="number" min="1" max="20" /></label>
        <label class="full">Notes<textarea v-model="form.notes" rows="3" /></label>
        <button type="submit" class="hsg-btn">Submit</button>
      </form>
    </section>
    <section v-if="mine" class="hsg-card">
      <h2>Your file</h2>
      <p v-if="!mine.waiting_list.length && !mine.allocations.length">Nothing is on file yet.</p>
      <ul>
        <li v-for="w in mine.waiting_list" :key="w.id">{{ w.list_no }} · {{ w.status }} · registered {{ String(w.registered_on).slice(0,10) }}</li>
        <li v-for="a in mine.allocations" :key="a.id">Stand {{ a.parcel_id }} · {{ a.status }}</li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.hsg-cit { max-width: 40rem; margin: 2rem auto; padding: 0 1.25rem 3rem; color: #2c241c; }
.hsg-cit h1 { display: flex; gap: .5rem; align-items: center; font-family: Cambria, serif; }
.hsg-back { background: none; border: 0; color: #8c2f0d; cursor: pointer; padding: 0; margin-bottom: .75rem; }
.hsg-card { background: #fffaf3; border: 1px solid #e4d9cc; border-radius: 1rem; padding: 1.25rem; margin-top: 1rem; }
.hsg-form { display: grid; gap: .75rem; }
.hsg-form label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; }
.hsg-form input, .hsg-form select, .hsg-form textarea { padding: .45rem .6rem; border: 1px solid #d7cbbd; border-radius: .4rem; }
.hsg-form .full { grid-column: 1 / -1; }
.hsg-btn { background: #8c2f0d; color: #fffaf3; border: 0; border-radius: .5rem; padding: .6rem 1rem; cursor: pointer; }
.hsg-alert { color: #8c2f0d; } .hsg-ok { color: #2f6f4e; }
@media (min-width: 40rem) { .hsg-form { grid-template-columns: 1fr 1fr; } }
</style>
