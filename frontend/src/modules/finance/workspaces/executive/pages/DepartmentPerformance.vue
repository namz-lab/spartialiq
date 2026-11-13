<script setup lang="ts">
/** Each department's spending budget, what it has spent and its utilisation, per currency. */
import { computed } from 'vue'
import { Building2 } from 'lucide-vue-next'
import { formatMoney } from '../../../composables/useMoney'
import { pctText } from '../../shared/useDashboard'
import { executiveDash } from '../dashboard'

const rows = computed(() => executiveDash.state.data?.departments ?? [])
const currencies = computed(() => [...new Set(rows.value.map((r) => r.currency))])
const shortName = (n: string) => n.replace(/\s*\(demo\)\s*$/i, '')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Building2 :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Department Performance</h2><p>Each department's approved spending budget against what it has spent.</p></div>
  </section>
  <p v-if="executiveDash.state.loading && !rows.length" class="cw-card cw-card-body"><span class="cw-skel" /></p>
  <p v-else-if="!rows.length" class="cw-empty">No approved spending lines in this year.</p>
  <section v-for="c in currencies" :key="c" class="cw-card">
    <div class="cw-card-head"><h3>{{ c }}</h3></div>
    <div class="cw-card-body">
      <ul class="dx-bars dp-bars">
        <li v-for="x in rows.filter((r) => r.currency === c)" :key="x.code">
          <span><strong>{{ shortName(x.name) }}</strong><br><small class="cw-hint">{{ formatMoney(x.actual, c) }} of {{ formatMoney(x.budget, c) }}</small></span>
          <span class="dx-track"><span class="dx-fill" :class="{ 'is-over': Number(x.utilisation ?? 0) > 100 }" :style="{ width: `${Math.min(100, Number(x.utilisation ?? 0))}%` }" /></span>
          <strong>{{ pctText(x.utilisation) }}</strong>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.dp-bars li { grid-template-columns: minmax(180px, 1.2fr) minmax(0, 2fr) 60px; }
@media (max-width: 760px) { .dp-bars li { grid-template-columns: minmax(0, 1fr) 60px; } }
</style>
