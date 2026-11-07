<template>
  <div class="mol-page">
    <!-- Ministry masthead — deliberately distinct chrome: this simulates an
         external government system, not a council screen. -->
    <header class="mol-mast">
      <div class="mol-mast-inner">
        <div class="mol-crest" aria-hidden="true">
          <Landmark :size="22" />
        </div>
        <div class="mol-mast-text">
          <p class="mol-mast-gov">Republic of Zimbabwe</p>
          <h1 class="mol-mast-title">Ministry of Lands — Deeds Registry</h1>
        </div>
        <span class="mol-sim-badge" title="Simulated national deeds registry for demonstration — not the live Ministry system">Simulation</span>
      </div>
    </header>

    <p class="mol-sim-banner" role="note">
      Simulated Ministry of Lands deeds registry for council demos. Data comes from
      <code>/api/lands-registry</code> on this platform — not the live national system.
    </p>

    <main class="mol-main">
      <!-- KPIs -->
      <section class="mol-kpis" aria-label="Registry statistics">
        <div class="mol-kpi">
          <span class="mol-kpi-num">{{ stats?.totalDeeds ?? '—' }}</span>
          <span class="mol-kpi-label">Registered deeds</span>
        </div>
        <div class="mol-kpi">
          <span class="mol-kpi-num">{{ stats?.activeDeeds ?? '—' }}</span>
          <span class="mol-kpi-label">Active</span>
        </div>
        <div class="mol-kpi">
          <span class="mol-kpi-num">{{ stats?.checksThisWeek ?? '—' }}</span>
          <span class="mol-kpi-label">Checks this week</span>
        </div>
        <div class="mol-kpi">
          <span class="mol-kpi-num">{{ stats?.verifiedResidents ?? '—' }}</span>
          <span class="mol-kpi-label">Residents verified</span>
        </div>
      </section>

      <!-- Deed book -->
      <section class="mol-card">
        <div class="mol-card-head">
          <h2 class="mol-card-title">Deed book</h2>
          <div class="mol-filters">
            <input
              v-model="search"
              type="search"
              class="mol-search"
              placeholder="Deed no, holder or stand…"
              @input="debouncedLoadDeeds"
            />
            <select v-model="statusFilter" class="mol-select" @change="loadDeeds" aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="transfer_pending">Transfer pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div v-if="loadingDeeds" class="mol-empty">Loading deed book…</div>
        <div v-else-if="deedsError" class="mol-empty mol-empty--err" role="alert">{{ deedsError }}</div>
        <div v-else-if="!deeds.length" class="mol-empty">No simulated deeds match. Register one below (admin) or clear filters.</div>

        <!-- Card list on mobile, table on desktop -->
        <ul v-else class="mol-deeds">
          <li v-for="d in deeds" :key="d.id" class="mol-deed">
            <div class="mol-deed-top">
              <span class="mol-deed-no">{{ d.deedNumber }}</span>
              <span class="mol-status" :class="`mol-status--${d.status}`">{{ statusLabel(d.status) }}</span>
            </div>
            <p class="mol-deed-holder">{{ d.holderName }}</p>
            <p class="mol-deed-prop">{{ d.propertyDescription || d.standNo || '—' }}</p>
            <p class="mol-deed-meta">
              {{ d.district }} district
              <template v-if="d.hectares"> · {{ d.hectares }} ha</template>
              · registered {{ shortDate(d.registeredAt) }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Incoming verification checks -->
      <section class="mol-card">
        <h2 class="mol-card-title">Incoming verification checks</h2>
        <p class="mol-card-sub">
          Every title-deed lookup made from the council portal lands here, exactly as the
          national registry would log it.
        </p>
        <div v-if="!checks.length" class="mol-empty">No checks yet.</div>
        <ul v-else class="mol-checks">
          <li v-for="c in checks" :key="c.id" class="mol-check">
            <component
              :is="c.holderMatch ? BadgeCheck : c.matched ? AlertTriangle : XCircle"
              :size="17"
              class="mol-check-icon"
              :class="c.holderMatch ? 'ok' : c.matched ? 'warn' : 'bad'"
              aria-hidden="true"
            />
            <div class="mol-check-text">
              <p class="mol-check-line">
                <strong>{{ c.deedNumber }}</strong>
                — {{ c.holderMatch ? 'holder match, residency verified' : c.matched ? `found (${c.resultStatus}), holder mismatch` : 'not found' }}
              </p>
              <p class="mol-check-meta">{{ c.requesterName || c.requesterEmail || 'Unknown requester' }} · {{ timeAgo(c.createdAt) }}</p>
            </div>
          </li>
        </ul>
      </section>

      <!-- Register a deed (admin only) -->
      <section v-if="isAdmin" class="mol-card">
        <h2 class="mol-card-title">Register a deed</h2>
        <p class="mol-card-sub">Add a deed to the simulated registry (e.g. to demo instant citizen verification).</p>
        <form class="mol-form" @submit.prevent="submitDeed">
          <input v-model="form.deedNumber" class="mol-input" placeholder="Deed number, e.g. DT-5001/2026" required />
          <input v-model="form.holderName" class="mol-input" placeholder="Holder full name" required />
          <input v-model="form.holderNationalId" class="mol-input" placeholder="Holder national ID, e.g. 63-1234567-A-63" />
          <input v-model="form.standNo" class="mol-input" placeholder="Stand / lot" />
          <input v-model="form.propertyDescription" class="mol-input mol-input--wide" placeholder="Property description" />
          <button type="submit" class="mol-btn" :disabled="saving">{{ saving ? 'Registering…' : 'Register deed' }}</button>
        </form>
        <p v-if="formError" class="mol-error" role="alert">{{ formError }}</p>
        <p v-if="formOk" class="mol-ok" role="status">{{ formOk }}</p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { AlertTriangle, BadgeCheck, Landmark, XCircle } from 'lucide-vue-next'
import {
  landsRegistryService,
  type RegistryCheck,
  type RegistryDeed,
  type RegistryStats,
} from '../services/residencyService'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const isAdmin = authStore.isAdmin

const stats = ref<RegistryStats | null>(null)
const deeds = ref<RegistryDeed[]>([])
const checks = ref<RegistryCheck[]>([])
const loadingDeeds = ref(false)
const deedsError = ref('')

const search = ref('')
const statusFilter = ref('')

const saving = ref(false)
const formError = ref('')
const formOk = ref('')
const form = reactive({
  deedNumber: '', holderName: '', holderNationalId: '', standNo: '', propertyDescription: '',
})

const statusLabel = (s: string) =>
  ({ active: 'Active', transfer_pending: 'Transfer pending', cancelled: 'Cancelled' } as Record<string, string>)[s] ?? s

const shortDate = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return shortDate(iso)
}

async function loadDeeds() {
  loadingDeeds.value = true
  deedsError.value = ''
  try {
    deeds.value = await landsRegistryService.deeds({
      search: search.value.trim() || undefined,
      status: statusFilter.value || undefined,
    })
  } catch {
    deeds.value = []
    deedsError.value = 'Could not load the simulated deed book. Check that the lands-registry API is running.'
  } finally {
    loadingDeeds.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function debouncedLoadDeeds() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadDeeds, 250)
}

async function submitDeed() {
  saving.value = true
  formError.value = ''
  formOk.value = ''
  try {
    await landsRegistryService.addDeed({
      deedNumber: form.deedNumber.trim(),
      holderName: form.holderName.trim(),
      holderNationalId: form.holderNationalId.trim() || undefined,
      standNo: form.standNo.trim() || undefined,
      propertyDescription: form.propertyDescription.trim() || undefined,
    })
    formOk.value = `Deed ${form.deedNumber.trim()} registered.`
    form.deedNumber = ''; form.holderName = ''; form.holderNationalId = ''
    form.standNo = ''; form.propertyDescription = ''
    await Promise.all([loadDeeds(), refreshStats()])
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    formError.value = e.response?.data?.error === 'deed_exists'
      ? 'A deed with that number already exists.'
      : 'Could not register the deed.'
  } finally {
    saving.value = false
  }
}

async function refreshStats() {
  stats.value = await landsRegistryService.stats().catch(() => null)
}

onMounted(async () => {
  await Promise.all([
    refreshStats(),
    loadDeeds(),
    landsRegistryService.checks().then(c => { checks.value = c }).catch(() => {}),
  ])
})
</script>

<style scoped>
.mol-page { min-height: 100vh; background: #f4f6f5; }

.mol-sim-banner {
  max-width: 64rem;
  margin: 0.75rem auto 0;
  padding: 0.55rem 1rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #713f12;
  background: #fef9c3;
  border: 1px solid #fde047;
  border-radius: 0.5rem;
}
.mol-sim-banner code {
  font-size: 0.72rem;
  background: #fef08a;
  padding: 0 0.25rem;
  border-radius: 0.2rem;
}

/* Masthead */
.mol-mast { background: #14532d; color: #fff; }
.mol-mast-inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 64rem;
  margin: 0 auto;
  padding: 0.85rem 1rem;
}
.mol-crest {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  flex-shrink: 0;
}
.mol-mast-text { min-width: 0; flex: 1; }
.mol-mast-gov { margin: 0; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.75; }
.mol-mast-title { margin: 0; font-size: 1.05rem; font-weight: 700; line-height: 1.25; }
.mol-sim-badge {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  border-radius: 9999px;
  background: #facc15;
  color: #713f12;
}

.mol-main {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* KPIs */
.mol-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
.mol-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.85rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
}
.mol-kpi-num { font-size: 1.35rem; font-weight: 800; color: #14532d; }
.mol-kpi-label { font-size: 0.75rem; color: #64748b; }

/* Cards */
.mol-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1rem; }
.mol-card-head { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.75rem; }
.mol-card-title { margin: 0; font-size: 1rem; font-weight: 700; color: #111827; }
.mol-card-sub { margin: 0.2rem 0 0.75rem; font-size: 0.82rem; color: #64748b; }

.mol-filters { display: flex; gap: 0.5rem; }
.mol-search {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.55rem;
  font-size: 0.88rem;
}
.mol-select {
  min-height: 44px;
  padding: 0 0.5rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.55rem;
  font-size: 0.85rem;
  background: #fff;
}
.mol-search:focus, .mol-select:focus { outline: 2px solid #14532d; outline-offset: 1px; }

.mol-empty { padding: 1.25rem 0; text-align: center; font-size: 0.85rem; color: #94a3b8; }
.mol-empty--err { color: #b91c1c; }

/* Deed list */
.mol-deeds { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mol-deed { padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; }
.mol-deed:last-child { border-bottom: none; }
.mol-deed-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.mol-deed-no { font-family: ui-monospace, monospace; font-size: 0.85rem; font-weight: 700; color: #14532d; }
.mol-status { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 9999px; }
.mol-status--active           { background: #f0fdf4; color: #15803d; }
.mol-status--transfer_pending { background: #fffbeb; color: #b45309; }
.mol-status--cancelled        { background: #fef2f2; color: #b91c1c; }
.mol-deed-holder { margin: 0.25rem 0 0; font-size: 0.92rem; font-weight: 600; color: #111827; }
.mol-deed-prop { margin: 0.1rem 0 0; font-size: 0.82rem; color: #475569; }
.mol-deed-meta { margin: 0.15rem 0 0; font-size: 0.75rem; color: #94a3b8; }

/* Checks */
.mol-checks { list-style: none; margin: 0; padding: 0; }
.mol-check { display: flex; gap: 0.6rem; padding: 0.6rem 0; border-bottom: 1px solid #f1f5f9; }
.mol-check:last-child { border-bottom: none; }
.mol-check-icon { flex-shrink: 0; margin-top: 0.1rem; }
.mol-check-icon.ok   { color: #15803d; }
.mol-check-icon.warn { color: #b45309; }
.mol-check-icon.bad  { color: #b91c1c; }
.mol-check-line { margin: 0; font-size: 0.85rem; color: #111827; }
.mol-check-meta { margin: 0.1rem 0 0; font-size: 0.75rem; color: #94a3b8; }

/* Form */
.mol-form { display: grid; grid-template-columns: 1fr; gap: 0.5rem; }
.mol-input {
  min-height: 44px;
  padding: 0 0.75rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.55rem;
  font-size: 0.88rem;
}
.mol-input:focus { outline: 2px solid #14532d; outline-offset: 1px; }
.mol-btn {
  min-height: 46px;
  border: none;
  border-radius: 0.55rem;
  background: #14532d;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}
.mol-btn:disabled { opacity: 0.5; cursor: default; }
.mol-error { margin: 0.5rem 0 0; font-size: 0.85rem; color: #b91c1c; }
.mol-ok    { margin: 0.5rem 0 0; font-size: 0.85rem; color: #15803d; }

@media (min-width: 768px) {
  .mol-kpis { grid-template-columns: repeat(4, 1fr); }
  .mol-card-head { flex-direction: row; align-items: center; justify-content: space-between; }
  .mol-filters { width: 24rem; }
  .mol-form { grid-template-columns: 1fr 1fr; }
  .mol-input--wide, .mol-btn { grid-column: span 2; }
}
</style>
