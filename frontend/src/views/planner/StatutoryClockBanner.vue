<script setup lang="ts">
// Section 26 statutory-clock banner. Matches the Stitch "Statutory
// Workflow" amber banner: a clock icon, the days-remaining headline, and a
// status badge whose colour tracks the warning level. Data is live from
// useStatutoryClock (three-month determination clock, s.26(7)).

import { computed } from 'vue'
import { useStatutoryClock } from '@/composables/useStatutoryClock'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { AlertTriangle, AlertOctagon, Clock, CheckCircle2 } from 'lucide-vue-next'

const { current } = usePlannerCase()
const ackRef = computed(() => current.value?.acknowledgedDate ?? null)
const { state } = useStatutoryClock(ackRef)

const level = computed(() => state.value.warningLevel)

const headline = computed(() => {
  if (state.value.phase === 'pre_ack') return 'Awaiting acknowledgement'
  if (state.value.phase === 'deemed_refused') return 'Deemed refused'
  if (state.value.phase === 'completed') return 'Permit issued'
  return `${state.value.daysRemaining} days remaining`
})
const statusLabel = computed(() => {
  if (state.value.phase === 'deemed_refused') return 'Deemed refused'
  if (state.value.phase === 'completed') return 'Issued'
  if (level.value === 'critical') return 'Critical'
  if (level.value === 'urgent') return 'Urgent'
  if (level.value === 'caution') return 'Amber status'
  return 'On track'
})
</script>

<template>
  <div v-if="current" class="cb" :class="'lvl-' + level">
    <div class="cb-left">
      <span class="cb-icon">
        <AlertOctagon v-if="level === 'critical'" :size="20" />
        <AlertTriangle v-else-if="level === 'urgent' || level === 'caution'" :size="20" />
        <CheckCircle2 v-else-if="state.phase === 'completed'" :size="20" />
        <Clock v-else :size="20" />
      </span>
      <div>
        <p class="cb-label">Section 26 case management</p>
        <div class="cb-headline-row">
          <span class="cb-headline">{{ headline }}</span>
          <span class="cb-caption">(three-month statutory clock)</span>
        </div>
      </div>
    </div>
    <span class="cb-badge">{{ statusLabel }}</span>
  </div>
</template>

<style scoped>
.cb { display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-shrink:0;
  padding:0.75rem 1.5rem; border-bottom:1px solid var(--cb-border); background:var(--cb-bg); color:var(--cb-text); }
.cb-left { display:flex; align-items:center; gap:0.85rem; }
.cb-icon { display:inline-flex; color:var(--cb-icon); }
.cb-label { margin:0; font-size:0.72rem; font-weight:700; letter-spacing:0.01em; color:var(--cb-text); }
.cb-headline-row { display:flex; align-items:baseline; gap:0.5rem; margin-top:0.15rem; flex-wrap:wrap; }
.cb-headline { font-size:1.05rem; font-weight:700; letter-spacing:-0.01em; color:var(--cb-strong); }
.cb-caption { font-size:0.7rem; color:var(--cb-icon); }
.cb-badge { flex-shrink:0; padding:0.25rem 0.6rem; border-radius:var(--sw-radius-sm, 8px);
  background:var(--cb-badge); color:var(--cb-strong); border:1px solid var(--cb-border);
  font-size:0.64rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; }

/* Level palettes — aliased to the enterprise SSOT (src/styles/enterprise.css). */
.cb { --cb-bg:var(--ent-accent-soft); --cb-border:var(--ent-accent-line); --cb-text:var(--ent-accent); --cb-strong:var(--ent-accent); --cb-icon:var(--ent-accent); --cb-badge:var(--ent-accent-soft); }
.cb.lvl-caution { --cb-bg:var(--ent-warning-soft); --cb-border:var(--ent-tone-warning-line); --cb-text:var(--ent-warning); --cb-strong:var(--ent-warning); --cb-icon:var(--ent-warning); --cb-badge:var(--ent-warning-soft); }
.cb.lvl-urgent  { --cb-bg:var(--ent-warning-soft); --cb-border:var(--ent-tone-warning-line); --cb-text:var(--ent-warning); --cb-strong:var(--ent-warning); --cb-icon:var(--ent-warning); --cb-badge:var(--ent-warning-soft); }
.cb.lvl-critical{ --cb-bg:var(--ent-danger-soft); --cb-border:var(--ent-tone-negative-line); --cb-text:var(--ent-danger); --cb-strong:var(--ent-danger); --cb-icon:var(--ent-danger); --cb-badge:var(--ent-danger-soft); }
</style>
