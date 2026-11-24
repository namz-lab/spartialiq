<script setup lang="ts">
import { inject, onMounted, reactive, ref, type Ref } from 'vue'
import { housingApi } from '../api'
import type { HousingDesk } from '../desks'

const desk = inject<Ref<HousingDesk | null>>('housingDesk')
const announcements = ref<any[]>([])
const schemes = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const form = reactive({ title: '', body: '', scheme_id: '' })

async function load() {
  try {
    announcements.value = ((await housingApi.announcements()) as any).announcements || []
    schemes.value = ((await housingApi.schemes()) as any).schemes || []
  } catch { err.value = 'Notices could not be read.' }
}
onMounted(load)

async function publish() {
  try { await housingApi.publishAnnouncement(form); banner.value = 'Notice published.'; form.title = ''; form.body = ''; await load() }
  catch (e: any) { err.value = e?.response?.data?.message || 'The notice could not be published.' }
}
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner">{{ banner }}</p>
    <form v-if="desk?.can.announce" class="hsg-card hsg-form" @submit.prevent="publish">
      <h2>Public allocation notice</h2>
      <label class="full">Title<input v-model="form.title" required /></label>
      <label>Scheme
        <select v-model="form.scheme_id">
          <option value="">All schemes</option>
          <option v-for="s in schemes" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label class="full">Body<textarea v-model="form.body" rows="6" required /></label>
      <button class="hsg-btn" type="submit">Publish</button>
    </form>
    <div class="hsg-card">
      <article v-for="a in announcements" :key="a.id">
        <h3>{{ a.title }}</h3>
        <p>{{ a.body }}</p>
        <p class="mute">{{ a.published_on }}</p>
      </article>
      <p v-if="!announcements.length" class="mute">No notices yet.</p>
    </div>
  </section>
</template>
