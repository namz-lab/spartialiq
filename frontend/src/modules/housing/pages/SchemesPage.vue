<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { housingApi } from '../api'

const schemes = ref<any[]>([])
const err = ref<string | null>(null)
onMounted(async () => {
  try { schemes.value = ((await housingApi.schemes()) as any).schemes || [] }
  catch { err.value = 'Schemes could not be read.' }
})
</script>

<template>
  <section class="hsg-main">
    <p v-if="err" class="hsg-banner neg">{{ err }}</p>
    <div class="hsg-card">
      <h2>Housing schemes</h2>
      <p class="mute">Each scheme is a township on the cadastre. Vacant stands are allocated only from the waiting list.</p>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Township</th><th>Status</th><th>Target</th><th>Opened</th></tr></thead>
        <tbody>
          <tr v-for="s in schemes" :key="s.id">
            <td class="mono">{{ s.code }}</td><td>{{ s.name }}</td>
            <td>{{ String(s.kind || '').replaceAll('_',' ') }}</td>
            <td>{{ s.township_code }}</td><td>{{ s.status }}</td>
            <td class="num">{{ s.target_stands || '—' }}</td>
            <td>{{ s.opened_on || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
