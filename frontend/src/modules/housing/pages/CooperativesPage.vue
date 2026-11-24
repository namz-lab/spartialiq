<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const coops = ref<any[]>([])
const schemes = ref<any[]>([])
const member = reactive({ cooperative_id: '', member_name: '', waiting_list_id: '' })
const form = reactive({ name: '', registration_no: '', scheme_id: '', contact_name: '', members_target: '', notes: '' })
const err = ref<string | null>(null)
const banner = ref<string | null>(null)

async function load() {
  try {
    coops.value = ((await housingApi.cooperatives()) as any).cooperatives || []
    schemes.value = ((await housingApi.schemes()) as any).schemes || []
  } catch { err.value = 'Cooperatives could not be read.' }
}
onMounted(load)

async function add() {
  try {
    await housingApi.addCooperative({ ...form, members_target: form.members_target ? Number(form.members_target) : null })
    banner.value = 'Cooperative registered.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'Could not register.' }
}
async function addMember() {
  try {
    await housingApi.addMember(member.cooperative_id, member)
    banner.value = 'Member added.'
    await load()
  } catch (e: any) { err.value = e?.response?.data?.message || 'Member could not be added.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.lease" class="hsg-card hsg-form" @submit.prevent="add">
      <h2>Register a housing cooperative</h2>
      <label>Name<input v-model="form.name" required /></label>
      <label>Registration no.<input v-model="form.registration_no" /></label>
      <label>Scheme
        <select v-model="form.scheme_id">
          <option value="">None</option>
          <option v-for="s in schemes" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>Contact<input v-model="form.contact_name" /></label>
      <label>Members target<input v-model="form.members_target" type="number" /></label>
      <button class="hsg-btn" type="submit">Register</button>
    </form>
    <form v-if="desk?.can.lease" class="hsg-card hsg-form" @submit.prevent="addMember">
      <h2>Add a member</h2>
      <label>Cooperative
        <select v-model="member.cooperative_id" required>
          <option value="" disabled>Choose</option>
          <option v-for="c in coops" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label>Member name<input v-model="member.member_name" required /></label>
      <button class="hsg-btn" type="submit">Add member</button>
    </form>
    <div class="hsg-card">
      <h2>Cooperatives</h2>
      <ul>
        <li v-for="c in coops" :key="c.id">{{ c.name }} · {{ c.members }} members · {{ c.status }} · {{ c.registration_no || 'unregistered' }}</li>
      </ul>
    </div>
  </section>
</template>
