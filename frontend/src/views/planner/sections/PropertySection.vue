<script setup lang="ts">
// Property lookup inside the planner console. Permits on the stand are live
// via dmApi. The land-register dossier is the existing /property/:standNo route.
import { caseRef, devTypeLabel, wardLabel } from '@/composables/useApplicationPipeline'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { propertyService, type PropertySummary } from '@/services/propertyService'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { ArrowRight, Search } from 'lucide-vue-next'

const shell = usePlannerShell()
const fb = useUiFeedback()
const stand = ref('')
const loading = ref(false)
const summary = ref<PropertySummary | null>(null)
const registerUnavailable = ref(false)
const permits = ref<PermitApplication[]>([])
const searched = ref(false)

async function lookup() {
  const q = stand.value.trim()
  if (!q) return
  loading.value = true
  searched.value = true
  registerUnavailable.value = false
  summary.value = null
  try {
    const res = await dmApi.listPermits({ search: q, limit: 100, offset: 0 })
    permits.value = (res.data || []).filter(p =>
      (p.stand_number || '').toLowerCase() === q.toLowerCase()
      || (p.stand_number || '').toLowerCase().includes(q.toLowerCase())
      || (p.dev_register_no || '').toLowerCase().includes(q.toLowerCase()),
    )
  } catch (err: unknown) {
    permits.value = []
    fb.showToast(fb.parseApiError(err, 'Could not search permits'), 'error')
  }
  try {
    summary.value = await propertyService.getSummary(q)
  } catch {
    summary.value = null
    registerUnavailable.value = true
  } finally {
    loading.value = false
  }
}

// The land register often has no ward or address for a stand the permit
// register already knows. Show what the applications record, and say so.
const fromPermit = computed(() => permits.value.find(p => p.suburb_ward || p.street_address) ?? null)
const wardShown = computed(() => summary.value?.ward || (fromPermit.value?.suburb_ward ? wardLabel(fromPermit.value.suburb_ward) : ''))
const addressShown = computed(() => summary.value?.address || fromPermit.value?.street_address || '')
const fromApplications = computed(() => !!fromPermit.value && (!summary.value?.ward || !summary.value?.address))
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function open(p: PermitApplication) {
  void shell.openCaseForStand(p.id, 'gis')
}
</script>

<template>
  <div class="px">
    <header class="px-head">
      <div>
        <h2>Property</h2>
        <p>Look up a stand, then open any application sitting on it.</p>
      </div>
    </header>

    <form class="px-search" @submit.prevent="lookup">
      <label class="ent-sr-only" for="px-stand">Stand number</label>
      <Search :size="14" aria-hidden="true" />
      <input id="px-stand" v-model="stand" name="stand" type="search"
             placeholder="Stand number or register no" autocomplete="off" />
      <UiButton type="submit" size="sm" :loading="loading">Look up</UiButton>
    </form>

    <UiPanel v-if="searched" flush :title="summary ? `Stand ${summary.stand_number}` : `Stand ${stand.trim()}`">
      <dl v-if="summary || fromPermit" class="px-facts">
        <div><dt>Ward</dt><dd>{{ wardShown || '—' }}</dd></div>
        <div><dt>Address</dt><dd>{{ addressShown || '—' }}</dd></div>
        <div><dt>Area</dt><dd>{{ summary?.area_sqm ? `${summary.area_sqm.toLocaleString()} m²` : '—' }}</dd></div>
      </dl>
      <p v-if="fromApplications" class="px-note">Ward and address as recorded on the applications for this stand.</p>
      <p v-else-if="registerUnavailable" class="px-note">
        Land-register details are not available. Applications below still come from the permit register.
      </p>
      <p v-if="stand.trim()" class="px-file">
        <RouterLink :to="`/property/${encodeURIComponent(stand.trim())}`">Open full property file</RouterLink>
      </p>
      <UiEmptyState v-if="!loading && !permits.length" message="No applications on this stand." />
      <ul v-else class="px-list">
        <li v-for="p in permits" :key="p.id">
          <button type="button" class="px-row" @click="open(p)">
            <span class="px-ref">{{ caseRef(p) }}</span>
            <span class="px-title">{{ p.applicant_name }}<small>{{ devTypeLabel(p.development_type) }} · received {{ fmtDate(p.received_at) }}</small></span>
            <UiStatusBadge :status="p.status" />
            <ArrowRight :size="14" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </UiPanel>
    <UiEmptyState v-else message="Enter a stand number to see its applications." />
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.px { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s4); }
.px-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.px-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.px-search {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: 0 var(--ent-s3); min-height: var(--ent-touch-min);
  background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r);
}
.px-search input {
  flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; color: var(--ent-text);
}
.px-search input:focus { outline: none; }
.px-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ent-s3);
  margin: 0; padding: var(--ent-s4); }
.px-facts dt { font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-3); }
.px-facts dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.px-note, .px-file { margin: 0; padding: 0 var(--ent-s4) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.px-file a { color: var(--ent-accent); }
.px-list { list-style: none; margin: 0; padding: 0; }
.px-row {
  display: grid; grid-template-columns: 8rem minmax(0, 1fr) auto auto; gap: var(--ent-s2);
  align-items: center; width: 100%; min-height: var(--ent-touch-min);
  padding: var(--ent-s2) var(--ent-s4); text-align: left; background: transparent;
  border: 0; border-top: 1px solid var(--ent-line); color: var(--ent-text); font: inherit; cursor: pointer;
}
.px-list li:first-child .px-row { border-top: none; }
.px-row:hover { background: var(--ent-surface-2); }
.px-row:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.px-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); }
.px-title { font-size: var(--ent-fs-sm); display: flex; flex-direction: column; min-width: 0; overflow: hidden; white-space: nowrap; }
.px-title small { font-size: var(--ent-fs-xs); color: var(--ent-text-3); overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 767px) {
  .px { padding: var(--ent-s3); }
  .px-facts { grid-template-columns: 1fr 1fr; }
  .px-search { flex-wrap: wrap; padding: var(--ent-s2); }
  .px-row { grid-template-columns: minmax(0, 1fr) auto; }
}
</style>
