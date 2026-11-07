<script setup lang="ts">
// "Case file at a glance" — a slide-over summary of the active statutory case.
// Reads the shared planner-case context directly (no slots).
import { computed } from 'vue'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { X, MapPin, Printer, CheckCircle2, Circle } from 'lucide-vue-next'

defineEmits<{ close: [] }>()
const { current } = usePlannerCase()
const shell = usePlannerShell()

const steps = computed(() => {
  const c = current.value
  return [
    { label: '1 · Intake',        done: !!c?.permitId },
    { label: '2 · Due diligence', done: !!c?.dueDiligence?.completedAt },
    { label: '3 · Report',        done: !!c?.committeeReport?.resolutionAt },
    { label: '4 · Permit',        done: !!c?.permit?.issueDate },
    { label: '5 · Notices',       done: !!c?.notices?.outcomeLetterSentAt },
  ]
})

interface RecentCase { permitId: string; label: string; openedAt: string }
const recent = computed<RecentCase[]>(() => {
  try { return JSON.parse(localStorage.getItem('planner_recent_cases') || '[]') } catch { return [] }
})

const centroid = computed(() => current.value?.property?.centroid)
function showOnMap() { if (centroid.value) shell.flyTo(centroid.value) }
function printCaseFile() { window.print() }
</script>

<template>
  <aside class="cf-drawer" role="dialog" aria-label="Case file">
    <header class="cf-head">
      <strong>Case file</strong>
      <button class="cf-close" @click="$emit('close')" aria-label="Close"><X :size="14" /></button>
    </header>

    <div v-if="current" class="cf-body">
      <section class="cf-summary">
        <div class="cf-reg">{{ current.registrationNo || 'Unregistered draft' }}</div>
        <div class="cf-meta">{{ current.applicant?.name || '—' }}</div>
        <div class="cf-meta">Stand {{ current.property?.standNo || '—' }} · {{ current.property?.ward || '—' }}</div>
        <button v-if="centroid" class="cf-show-on-map" @click="showOnMap">
          <MapPin :size="12" /> Show on map
        </button>
      </section>

      <section class="cf-steps">
        <div v-for="s in steps" :key="s.label" class="cf-step" :class="{ done: s.done }">
          <component :is="s.done ? CheckCircle2 : Circle" :size="13" />
          <span>{{ s.label }}</span>
        </div>
      </section>

      <button class="cf-print" @click="printCaseFile">
        <Printer :size="12" /> Print case file
      </button>
    </div>
    <div v-else class="cf-empty">No active case. Register or open one from the workflow.</div>

    <section v-if="recent.length" class="cf-recent">
      <header>Recent cases</header>
      <ul>
        <li v-for="r in recent" :key="r.permitId">
          <button @click="shell.openCaseForStand(r.permitId)">{{ r.label }}</button>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.cf-drawer { position:fixed; top:0; right:0; bottom:0; width:20rem; z-index:40;
  background:#fff; border-left:1px solid #e2e8f0; box-shadow:-4px 0 16px rgba(15,23,42,0.08);
  display:flex; flex-direction:column; }
.cf-head { display:flex; align-items:center; padding:0.6rem 0.85rem; border-bottom:1px solid #e2e8f0; }
.cf-head strong { flex:1; font-size:0.85rem; }
.cf-close { background:none; border:none; color:#64748b; cursor:pointer; }
.cf-body { padding:0.85rem; display:flex; flex-direction:column; gap:0.85rem; }
.cf-summary { display:flex; flex-direction:column; gap:0.2rem; }
.cf-reg { font-family:ui-monospace, monospace; font-weight:700; color:#0f172a; }
.cf-meta { font-size:0.75rem; color:#64748b; }
.cf-show-on-map { align-self:flex-start; margin-top:0.4rem; display:inline-flex; align-items:center;
  gap:0.3rem; padding:0.3rem 0.6rem; border:1px solid #e2e8f0; border-radius:0.35rem;
  background:#fff; color:#1d4ed8; font-size:0.72rem; font-weight:600; cursor:pointer; }
.cf-steps { display:flex; flex-direction:column; gap:0.3rem; }
.cf-step { display:flex; align-items:center; gap:0.4rem; font-size:0.75rem; color:#94a3b8; }
.cf-step.done { color:#166534; }
.cf-print { display:inline-flex; align-items:center; justify-content:center; gap:0.3rem;
  padding:0.45rem; border:1px solid #e2e8f0; border-radius:0.35rem; background:#fff;
  color:#475569; font-size:0.72rem; font-weight:600; cursor:pointer; }
.cf-empty { padding:1rem; font-size:0.78rem; color:#94a3b8; }
.cf-recent { border-top:1px solid #e2e8f0; padding:0.6rem 0.85rem; }
.cf-recent header { font-size:0.7rem; font-weight:700; text-transform:uppercase;
  letter-spacing:0.06em; color:#94a3b8; margin-bottom:0.4rem; }
.cf-recent ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.2rem; }
.cf-recent button { width:100%; text-align:left; background:none; border:none; cursor:pointer;
  font-size:0.72rem; color:#1d4ed8; padding:0.2rem 0; }
</style>
