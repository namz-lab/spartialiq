<script setup lang="ts">
// CityView-style efficiency / SLA panel: legislated-timeline adherence and
// cycle-time at a glance, computed type-aware from the permit register.
import { computed } from 'vue'
import type { PermitApplication } from '@/services/developmentManagementService'
import { summariseSla } from '@/composables/useApplicationSla'
import { Timer, AlertTriangle, CheckCircle2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ permits: PermitApplication[] }>(), { permits: () => [] })

const s = computed(() => summariseSla(props.permits))
const onTimePct = computed(() =>
  s.value.onTimeRate == null ? null : Math.round(s.value.onTimeRate * 100))
</script>

<template>
  <section class="sla-card">
    <header>
      <Timer :size="13" />
      <strong>Timeline performance</strong>
      <span class="sla-sub">statutory-clock adherence</span>
    </header>

    <div v-if="!s.total" class="sla-empty">No applications on the register yet.</div>

    <template v-else>
      <div class="sla-tiles">
        <div class="sla-tile" :class="onTimePct == null ? '' : (onTimePct >= 80 ? 'good' : onTimePct >= 50 ? 'mid' : 'bad')">
          <span class="sla-val">{{ onTimePct == null ? '—' : onTimePct + '%' }}</span>
          <span class="sla-lbl">On-time decisions</span>
        </div>
        <div class="sla-tile">
          <span class="sla-val">{{ s.avgDaysToDecision ?? '—' }}<i v-if="s.avgDaysToDecision != null">d</i></span>
          <span class="sla-lbl">Avg time to decision</span>
        </div>
        <div class="sla-tile" :class="{ bad: s.overdue > 0 }">
          <span class="sla-val">{{ s.overdue }}</span>
          <span class="sla-lbl"><AlertTriangle :size="10" /> Overdue (open)</span>
        </div>
        <div class="sla-tile" :class="{ mid: s.dueSoon > 0 }">
          <span class="sla-val">{{ s.dueSoon }}</span>
          <span class="sla-lbl">Due within 7 days</span>
        </div>
        <div class="sla-tile good">
          <span class="sla-val">{{ s.onTrack }}</span>
          <span class="sla-lbl"><CheckCircle2 :size="10" /> On track</span>
        </div>
        <div class="sla-tile">
          <span class="sla-val">{{ s.avgOpenAge ?? '—' }}<i v-if="s.avgOpenAge != null">d</i></span>
          <span class="sla-lbl">Avg age of open cases</span>
        </div>
      </div>
      <p class="sla-foot">
        Statutory window is per approval track (30 days routine · 90 days special consent).
        Decision time is measured from receipt to the latest status change.
      </p>
    </template>
  </section>
</template>

<style scoped>
.sla-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden;
  display:flex; flex-direction:column; }
.sla-card > header { display:flex; align-items:center; gap:0.4rem; padding:0.55rem 0.85rem;
  background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:0.78rem; color:#0f172a; }
.sla-sub { font-weight:400; color:#94a3b8; font-size:0.68rem; margin-left:auto; }
.sla-empty { padding:1.5rem; color:#94a3b8; font-size:0.78rem; text-align:center; }
.sla-tiles { display:grid; grid-template-columns:repeat(3, 1fr); gap:0.5rem; padding:0.7rem 0.85rem; }
.sla-tile { background:#f8fafc; border:1px solid #e2e8f0; border-radius:0.4rem; padding:0.55rem 0.6rem;
  display:flex; flex-direction:column; gap:0.15rem; }
.sla-tile.good { background:#f0fdf4; border-color:#bbf7d0; }
.sla-tile.mid  { background:#fffbeb; border-color:#fde68a; }
.sla-tile.bad  { background:#fef2f2; border-color:#fecaca; }
.sla-val { font-size:1.25rem; font-weight:700; color:#0f172a; line-height:1; }
.sla-val i { font-size:0.7rem; font-weight:600; color:#64748b; font-style:normal; margin-left:1px; }
.sla-lbl { display:inline-flex; align-items:center; gap:0.2rem; font-size:0.62rem; color:#64748b; }
.sla-foot { margin:0; padding:0 0.85rem 0.7rem; font-size:0.62rem; color:#94a3b8; line-height:1.4; }
</style>
