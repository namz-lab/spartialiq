<script setup lang="ts">
// The public map's legend and plan identity: which plan and revision the zones on the map belong to, whether it is in force,
// and what each zone colour means. Colours come from the published zone style, so the legend cannot disagree with the map.
import { computed, onMounted, ref } from 'vue'
import { getPublishedStyle } from '@/services/gisStyles'
import { getPlanIdentity, legendFor, identityLine, standing, type PlanIdentity, type LegendEntry } from '@/services/planLegend'

// the two layers that draw the plan's zones, each with its own published style
const ZONE_LAYERS = ['vungu_proposed_peri_urban_zones', 'vungu_beyond_peri_urban_zones']
const plan = ref<PlanIdentity | null>(null)
const entries = ref<LegendEntry[]>([])
const failed = ref(false)
const line = computed(() => (plan.value ? identityLine(plan.value) : ''))

onMounted(async () => {
  try {
    const { plans } = await getPlanIdentity()
    plan.value = plans[0] ?? null
    entries.value = legendFor(await Promise.all(ZONE_LAYERS.map((l) => getPublishedStyle(l))) as never, plan.value)
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="pl-root" data-testid="plan-legend">
    <h3>Master plan</h3>
    <template v-if="plan">
      <p class="pl-title">{{ plan.title }}</p>
      <p v-if="line" class="pl-line" data-testid="plan-legend-identity">{{ line }}</p>
      <p class="pl-line">{{ plan.authority }}</p>
      <p class="pl-standing" :class="{ prov: plan.provisional }" data-testid="plan-legend-standing">{{ standing(plan) }}</p>
      <ul v-if="entries.length" class="pl-list">
        <li v-for="e in entries" :key="e.label"><span class="pl-sw" :style="{ background: e.fill }" /> {{ e.label }}</li>
      </ul>
    </template>
    <p v-else-if="failed" class="pl-line">The plan details could not be loaded.</p>
    <p v-else class="pl-line">No plan is in force for this area yet.</p>
  </div>
</template>

<style scoped>
.pl-root { max-height: 16rem; overflow: auto; }
h3 { margin: 0 0 0.4rem; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--cp-muted); }
.pl-title { margin: 0; font-size: 0.8rem; font-weight: 600; color: var(--cp-text); }
.pl-line { margin: 0.1rem 0 0; font-size: 0.72rem; color: var(--cp-muted); }
.pl-standing { margin: 0.3rem 0; font-size: 0.72rem; font-weight: 600; color: var(--cp-text-2); }
.pl-standing.prov { color: #b54708; }
.pl-list { list-style: none; margin: 0.4rem 0 0; padding: 0; }
.pl-list li { display: flex; align-items: center; gap: 0.5rem; font-size: 0.74rem; color: var(--cp-text-2); margin-bottom: 0.25rem; }
.pl-sw { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; border: 1px solid var(--cp-border-strong); }
</style>
