<script setup lang="ts">
// Shown by the statutory workflow when no case is open. It used to be two empty
// panes telling the officer to go somewhere else; the live files are listed
// here instead, the officer's own first, so a case is one click away.
import { computed, inject, onMounted, ref } from 'vue'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { caseRef, devTypeLabel, wardLabel, normalizeStatus } from '@/composables/useApplicationPipeline'
import { PLANNER_SHELL_KEY } from '@/composables/usePlannerShell'
import { CLOSED_PERMIT_STATUSES } from '@/views/planner/myWork'
import { useAuthStore } from '@/stores/auth'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import { Search, FolderOpen } from 'lucide-vue-next'

const shell = inject(PLANNER_SHELL_KEY, null)
const auth = useAuthStore()
const me = computed(() => (auth.user?.id != null ? String(auth.user.id) : null))

const permits = ref<PermitApplication[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const query = ref('')
const opening = ref<string | null>(null)

onMounted(async () => {
  try {
    permits.value = (await dmApi.listAllPermits())
      .filter(p => !CLOSED_PERMIT_STATUSES.includes(normalizeStatus(p.status)))
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
})

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return permits.value
    .filter(p => !q || [p.dev_register_no, p.tpd_reference, p.stand_number, p.applicant_name, p.suburb_ward]
      .some(v => (v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => {
      const mine = Number(b.assigned_to === me.value) - Number(a.assigned_to === me.value)
      return mine || (a.received_at ?? '').localeCompare(b.received_at ?? '')
    })
})

async function open(p: PermitApplication) {
  if (!shell) return
  opening.value = p.id
  try { await shell.openCaseForStand(p.id) } finally { opening.value = null }
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
</script>

<template>
  <section class="cp" aria-labelledby="cp-title">
    <header class="cp-head">
      <FolderOpen :size="18" aria-hidden="true" />
      <div>
        <h2 id="cp-title">Open a case</h2>
        <p>Live applications, yours first, then oldest first. Applicants lodge through the citizen portal; the clerk registers counter applications.</p>
      </div>
      <label class="cp-search">
        <Search :size="14" aria-hidden="true" />
        <span class="ent-sr-only">Find an application</span>
        <input v-model="query" type="search" name="cp-search" placeholder="Reference, stand, applicant, ward" autofocus />
      </label>
    </header>

    <p v-if="state === 'loading'" class="cp-muted" aria-live="polite">Loading live applications…</p>
    <UiEmptyState v-else-if="state === 'error'" message="Could not load the register. Refresh the page to try again." />
    <UiEmptyState v-else-if="!rows.length" :message="query ? 'No live application matches that search.' : 'There are no live applications.'" />
    <ul v-else class="cp-list">
      <li v-for="p in rows" :key="p.id">
        <button type="button" class="cp-row" :disabled="opening === p.id" @click="open(p)">
          <span class="cp-ref" :class="{ unreg: !p.dev_register_no && !p.tpd_reference }">{{ caseRef(p) }}</span>
          <span class="cp-main">
            <strong>{{ p.applicant_name }}</strong>
            <span>{{ devTypeLabel(p.development_type) }} · Stand {{ p.stand_number || '—' }} · {{ wardLabel(p.suburb_ward) }}</span>
          </span>
          <span class="cp-mine-col"><span v-if="p.assigned_to && p.assigned_to === me" class="cp-mine">Yours</span></span>
          <span class="cp-status"><UiStatusBadge :status="p.status" /></span>
          <span class="cp-date">{{ opening === p.id ? 'Opening…' : fmt(p.received_at) }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cp { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s4) var(--ent-s5) 3.5rem; overflow: hidden; } /* clears the floating Council tools pill */
.cp-head { display: flex; align-items: flex-start; gap: var(--ent-s3); flex-wrap: wrap; color: var(--ent-text-3); }
.cp-head > div { flex: 1; min-width: 16rem; }
.cp-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); }
.cp-head p { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); max-width: 70ch; }
.cp-search { display: inline-flex; align-items: center; gap: var(--ent-s2); height: var(--ent-control-h); padding: 0 var(--ent-s3); width: 22rem; max-width: 100%;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r); background: var(--ent-surface); }
.cp-search:focus-within { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.cp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text); }
.cp-muted { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }

.cp-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); }
.cp-list li + li { border-top: 1px solid var(--ent-line); }
.cp-row { display: grid; grid-template-columns: 11rem minmax(0, 1fr) 3.5rem 10.5rem 7rem; gap: var(--ent-s3); align-items: center; width: 100%;
  padding: var(--ent-s2) var(--ent-s4); min-height: var(--ent-touch-min); background: transparent; border: 0; text-align: left; font: inherit; color: var(--ent-text); cursor: pointer; }
.cp-row:hover { background: var(--ent-surface-2); }
.cp-row:focus-visible { outline: none; box-shadow: inset var(--ent-focus-ring); }
.cp-row:disabled { cursor: progress; opacity: 0.7; }
.cp-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); white-space: nowrap; }
.cp-ref.unreg { font-family: var(--ent-font); font-weight: var(--ent-fw-normal); font-style: italic; color: var(--ent-text-3); }
.cp-main { display: flex; flex-direction: column; min-width: 0; }
.cp-main strong { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-main span { font-size: var(--ent-fs-xs); color: var(--ent-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-mine { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); color: var(--ent-accent); background: var(--ent-accent-soft); padding: 1px var(--ent-s2); border-radius: var(--ent-r-pill); }
.cp-mine-col, .cp-status { display: flex; justify-content: flex-end; }
.cp-date { font-size: var(--ent-fs-xs); color: var(--ent-text-3); text-align: right; font-variant-numeric: tabular-nums; }

@media (max-width: 767px) {
  .cp { padding: var(--ent-s3); }
  .cp-search { width: 100%; }
  .cp-row { grid-template-columns: minmax(0, 1fr) auto; }
  .cp-ref, .cp-date, .cp-mine-col { display: none; }
}
</style>
