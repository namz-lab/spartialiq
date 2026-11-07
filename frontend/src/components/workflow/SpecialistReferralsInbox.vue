<script setup lang="ts">
// Specialist referral inbox — GIS Officer and Building Inspector close the
// technical-circulation loop using the shared ConsultationResponsePanel.
// The planner raises a free-text body_name; we match on needles.

import { ref, computed, onMounted } from 'vue'
import {
  dmApi, type PermitApplication, type Consultation,
} from '@/services/developmentManagementService'
import {
  isPermitInCirculation, matchesReferralDepartment, statusLabel, normalizeStatus,
} from '@/composables/useApplicationPipeline'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import ConsultationResponsePanel from '@/components/workflow/ConsultationResponsePanel.vue'
import { Send, Search, RefreshCw } from 'lucide-vue-next'

const props = defineProps<{
  departmentNeedles: readonly string[]
  heading: string
  emptyNextStep: string
}>()

const fb = useUiFeedback()

interface Row {
  permit: PermitApplication
  consultations: Consultation[]
}

const rows = ref<Row[]>([])
const loading = ref(false)
const search = ref('')
const selectedId = ref<string | null>(null)

async function refresh() {
  loading.value = true
  try {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    const inCirc = (Array.isArray(r?.data) ? r.data : [])
      // Referrals and planner site-inspection requests are raised at any stage
      // before determination, not only during formal circulation.
      .filter(p => isPermitInCirculation(p.status)
        || ['acknowledged', 'objection_period', 'awaiting_eo_decision', 'deferred'].includes(normalizeStatus(p.status)))
    const found: Row[] = []
    for (const p of inCirc.slice(0, 40)) {
      try {
        const list = await dmApi.listConsultations(p.id)
        const mine = list.filter(c => matchesReferralDepartment(c, props.departmentNeedles))
        if (mine.length) found.push({ permit: p, consultations: mine })
      } catch { /* skip a permit whose referrals cannot be loaded */ }
    }
    rows.value = found
    if (selectedId.value && !found.some(x => x.permit.id === selectedId.value)) {
      selectedId.value = found[0]?.permit.id ?? null
    } else if (!selectedId.value && found.length) {
      selectedId.value = found[0].permit.id
    }
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load referrals'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const filteredRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(({ permit: p }) =>
    (p.dev_register_no || '').toLowerCase().includes(needle)
    || (p.applicant_name || '').toLowerCase().includes(needle)
    || (p.stand_number || '').toLowerCase().includes(needle))
})

const selected = computed(() =>
  rows.value.find(r => r.permit.id === selectedId.value) ?? null)

function pendingCount(row: Row): number {
  return row.consultations.filter(c => {
    const s = c.response_status ?? c.outcome
    return !s || s === 'pending'
  }).length
}

async function onResponded(saved: Consultation) {
  const row = rows.value.find(r => r.permit.id === selectedId.value)
  if (!row) return
  row.consultations = row.consultations.map(c => c.id === saved.id ? saved : c)
}
</script>

<template>
  <div class="sri">
    <header class="sri-head">
      <Send :size="14" aria-hidden="true" />
      <h2>{{ heading }}</h2>
    </header>

    <div class="sri-body">
      <aside class="sri-picker">
        <header>
          <Search :size="12" aria-hidden="true" />
          <input v-model="search" placeholder="Search by register, applicant, stand…" />
          <button class="sri-refresh" type="button" :disabled="loading" @click="refresh">
            <RefreshCw :size="12" :class="{ spin: loading }" aria-hidden="true" />
            <span class="ent-sr-only">Refresh referrals</span>
          </button>
        </header>
        <div v-if="!filteredRows.length" class="sri-empty">
          {{ loading ? 'Loading…' : emptyNextStep }}
        </div>
        <ul v-else class="sri-list">
          <li
            v-for="row in filteredRows"
            :key="row.permit.id"
            :class="{ active: selectedId === row.permit.id }"
            @click="selectedId = row.permit.id"
          >
            <span class="sri-id">{{ row.permit.dev_register_no || row.permit.id.slice(0, 12) }}</span>
            <span class="sri-app">{{ row.permit.applicant_name }}</span>
            <span class="sri-stand">Stand {{ row.permit.stand_number }} · {{ row.permit.suburb_ward }}</span>
            <span class="sri-meta">
              {{ statusLabel(row.permit.status) }}
              · {{ pendingCount(row) }} open
            </span>
          </li>
        </ul>
      </aside>

      <section v-if="selected" class="sri-detail">
        <p class="sri-file">
          {{ selected.permit.dev_register_no || selected.permit.id.slice(0, 12) }}
          · {{ selected.permit.applicant_name }}
          · Stand {{ selected.permit.stand_number }}
        </p>
        <ConsultationResponsePanel
          v-for="c in selected.consultations"
          :key="c.id"
          :consultation="c"
          @responded="onResponded"
        />
      </section>
      <section v-else class="sri-detail sri-empty">
        Select a file to record this desk's finding.
      </section>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.sri { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.85rem; }
.sri-head { display: flex; align-items: center; gap: 0.4rem; }
.sri-head h2 { margin: 0; font-size: 1rem; font-weight: 600; }

.sri-body { display: grid; grid-template-columns: minmax(16rem, 22rem) 1fr; gap: 0.75rem; min-height: 22rem; }
.sri-picker, .sri-detail {
  background: var(--ent-surface, #fff);
  border: 1px solid var(--ent-border, #e2e8f0);
  border-radius: 0.5rem;
}
.sri-picker { display: flex; flex-direction: column; min-height: 0; }
.sri-picker > header {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--ent-border, #e2e8f0);
}
.sri-picker input {
  flex: 1; border: 0; background: transparent; font: inherit; font-size: 0.8rem;
  color: var(--ent-text, #0f172a);
}
.sri-picker input:focus { outline: none; }
.sri-refresh {
  border: 0; background: transparent; cursor: pointer; color: var(--ent-text-muted, #64748b);
}
.sri-empty {
  padding: 1.5rem; color: var(--ent-text-muted, #64748b); font-size: 0.8rem; line-height: 1.45;
}
.sri-list { list-style: none; margin: 0; padding: 0; overflow: auto; }
.sri-list li {
  display: flex; flex-direction: column; gap: 0.15rem;
  padding: 0.55rem 0.75rem; cursor: pointer; border-top: 1px solid #f1f5f9;
}
.sri-list li.active { background: var(--ent-accent-soft, #e8f0fe); }
.sri-id { font-size: 0.72rem; font-weight: 600; color: var(--ent-text, #0f172a); }
.sri-app { font-size: 0.78rem; color: var(--ent-text, #0f172a); }
.sri-stand, .sri-meta { font-size: 0.68rem; color: var(--ent-text-muted, #64748b); }

.sri-detail { padding: 0.85rem; display: flex; flex-direction: column; gap: 0.75rem; }
.sri-file { margin: 0; font-size: 0.8rem; color: var(--ent-text-muted, #64748b); }

.spin { animation: sri-spin 0.8s linear infinite; }
@keyframes sri-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}

@media (max-width: 767px) {
  .sri-body { grid-template-columns: 1fr; }
}
</style>
