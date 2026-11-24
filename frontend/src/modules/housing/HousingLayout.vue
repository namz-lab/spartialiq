<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import { housingApi } from './api'
import { pagesFor, type HousingDesk } from './desks'
import './housing.css'

const route = useRoute()
const desk = ref<HousingDesk | null>(null)
const loadErr = ref<string | null>(null)

onMounted(async () => {
  try { desk.value = await housingApi.desk() as HousingDesk }
  catch { loadErr.value = 'This housing desk could not be read.' }
})

const nav = computed(() => pagesFor(desk.value))
provide('housingDesk', desk)
</script>

<template>
  <div class="hsg-app">
    <aside class="hsg-side" aria-label="Housing desk">
      <p class="brand">Housing and Estates</p>
      <p class="who">{{ desk?.title || 'Loading desk…' }}</p>
      <RouterLink
        v-for="p in nav"
        :key="p.path"
        :to="p.path"
        :class="{ on: p.path === '/housing' ? route.path === '/housing' : route.path.startsWith(p.path) }"
      >{{ p.label }}</RouterLink>
    </aside>
    <div class="hsg-work">
      <header class="hsg-top">
        <div>
          <span class="hsg-eyebrow">Vungu Rural District Council</span>
          <h1>{{ desk?.title || 'Housing' }}</h1>
          <p>Waiting list, cadastre, cash office and planning files are the same stand and the same person.</p>
        </div>
        <ProfileDropdown />
      </header>
      <p v-if="loadErr" class="hsg-banner neg" role="alert">{{ loadErr }}</p>
      <RouterView />
    </div>
  </div>
</template>
