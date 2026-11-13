<script setup lang="ts">
/**
 * A page in the accountant's navigation whose module the backend does not have yet (the asset
 * register, tax and statutory returns). It says so plainly and points at what exists today, rather
 * than drawing figures that nothing produces.
 */
import { useRoute } from 'vue-router'
import { RouterLink } from 'vue-router'
import { Building2, Percent, Construction } from 'lucide-vue-next'

const route = useRoute()
const icon = route.name === 'acc-assets' ? Building2 : Percent
const links = (route.meta.cwSee as { name: string; label: string }[] | undefined) ?? []
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="icon" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ route.meta.cwTitle }}</h2>
      <p>{{ route.meta.cwLead }}</p>
    </div>
  </section>
  <section class="cw-card">
    <div class="cw-card-body nb">
      <Construction :size="44" aria-hidden="true" />
      <h3>Not built yet</h3>
      <p>{{ route.meta.cwWhy }}</p>
      <p v-if="links.length" class="nb-links">
        In the meantime:
        <RouterLink v-for="l in links" :key="l.name" :to="{ name: l.name }" class="cw-link">{{ l.label }}</RouterLink>
      </p>
    </div>
  </section>
</template>

<style scoped>
.nb { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 40px 20px; color: var(--cw-ink-2); }
.nb svg { color: var(--cw-accent); }
.nb h3 { margin: 4px 0 0; color: var(--cw-ink); font-size: 17px; }
.nb p { margin: 0; max-width: 620px; }
.nb-links { display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: center; align-items: center; margin-top: 8px !important; }
</style>
