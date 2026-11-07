<script setup lang="ts">
/**
 * Statutory registers console — RDC Act gaps A5 / P10 / G11 / C15 / F7.
 * Staff (EO, planner, clerk, admin) manage the registers; citizens request
 * section 109 clearance from the citizen portal.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { registersApi } from '@/services/registersApi'
import {
  ScrollText, CalendarRange, Landmark, FileBadge, Receipt,
  RefreshCw, Plus, Check, X,
} from 'lucide-vue-next'

type Tab = 'bylaws' | 'plans' | 'acquisitions' | 'clearances' | 'expenses'

const TABS: { key: Tab; label: string; uc: string; icon: typeof ScrollText }[] = [
  { key: 'bylaws', label: 'By-laws & tariffs', uc: 'A5', icon: ScrollText },
  { key: 'plans', label: 'Annual district plan', uc: 'P10', icon: CalendarRange },
  { key: 'acquisitions', label: 'Compulsory acquisition', uc: 'G11', icon: Landmark },
  { key: 'clearances', label: 'Rates clearance (s109)', uc: 'C15', icon: FileBadge },
  { key: 'expenses', label: 'Expense recovery', uc: 'F7', icon: Receipt },
]

const route = useRoute()
const router = useRouter()
const tab = ref<Tab>((route.query.tab as Tab) || 'bylaws')
const loading = ref(false)
const error = ref('')
const rows = ref<Record<string, unknown>[]>([])
const flash = ref('')

const form = ref<Record<string, string>>({})

watch(tab, (t) => {
  router.replace({ query: { ...route.query, tab: t } })
  load()
})

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    let res
    if (tab.value === 'bylaws') res = await registersApi.listBylaws()
    else if (tab.value === 'plans') res = await registersApi.listAnnualPlans()
    else if (tab.value === 'acquisitions') res = await registersApi.listAcquisitions()
    else if (tab.value === 'clearances') res = await registersApi.listRatesClearances()
    else res = await registersApi.listExpenseRecoveries()
    rows.value = (res.data?.data || []) as Record<string, unknown>[]
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string } }; message?: string })
      ?.response?.data?.error || (e as Error).message || 'Load failed'
    rows.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.value = {}
  flash.value = ''
}

async function create() {
  error.value = ''
  flash.value = ''
  try {
    if (tab.value === 'bylaws') {
      await registersApi.createBylaw({
        kind: form.value.kind || 'bylaw',
        title: form.value.title,
        reference_no: form.value.reference_no || undefined,
        status: form.value.status || 'draft',
        notes: form.value.notes || undefined,
      })
    } else if (tab.value === 'plans') {
      await registersApi.upsertAnnualPlan({
        plan_year: Number(form.value.plan_year),
        title: form.value.title,
        summary: form.value.summary || undefined,
        status: form.value.status || 'draft',
      })
    } else if (tab.value === 'acquisitions') {
      await registersApi.createAcquisition({
        purpose: form.value.purpose || 'public_benefit',
        stand_number: form.value.stand_number || undefined,
        purpose_detail: form.value.purpose_detail || undefined,
        notes: form.value.notes || undefined,
      })
    } else if (tab.value === 'expenses') {
      await registersApi.createExpenseRecovery({
        description: form.value.description,
        amount_usd: Number(form.value.amount_usd),
        stand_number: form.value.stand_number || undefined,
        notes: form.value.notes || undefined,
      })
    }
    flash.value = 'Saved'
    resetForm()
    await load()
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string } }; message?: string })
      ?.response?.data?.error || (e as Error).message || 'Save failed'
  }
}

async function decideClearance(id: string, decision: 'clear' | 'refuse') {
  error.value = ''
  try {
    await registersApi.decideRatesClearance(id, {
      decision,
      refusal_reason: decision === 'refuse' ? 'Arrears outstanding' : undefined,
      charges_outstanding_usd: decision === 'clear' ? 0 : undefined,
    })
    flash.value = decision === 'clear' ? 'Certificate issued' : 'Refused'
    await load()
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string; message?: string } } })
      ?.response?.data?.message
      || (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      || (e as Error).message || 'Decision failed'
  }
}

async function handoffClearance(id: string) {
  error.value = ''
  const ref = window.prompt('Deeds Registry receipt or cover-note reference')
  if (!ref || !ref.trim()) return
  try {
    await registersApi.handoffRatesClearance(id, ref.trim())
    flash.value = 'Certificate recorded as handed to the Deeds Registry'
    await load()
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      || (e as Error).message || 'Hand-off failed'
  }
}

async function advancePlan(id: string, status: string) {
  try {
    await registersApi.patchAnnualPlan(id, { status })
    await load()
  } catch (e: unknown) {
    error.value = (e as Error).message
  }
}

const tabMeta = computed(() => TABS.find((t) => t.key === tab.value)!)
</script>

<template>
  <div class="sr-root" data-testid="statutory-registers">
    <header class="sr-head">
      <div>
        <p class="sr-eyebrow">Council registers · RDC Act</p>
        <h1>Statutory registers</h1>
        <p class="sr-lede">
          By-laws and tariffs (A5), annual district development plan (P10),
          compulsory acquisition (G11), section 109 rates clearance (C15),
          and expense recovery (F7).
        </p>
      </div>
      <button type="button" class="sr-btn ghost" data-testid="sr-refresh" :disabled="loading" @click="load">
        <RefreshCw :size="16" :class="{ spin: loading }" /> Refresh
      </button>
    </header>

    <nav class="sr-tabs" aria-label="Register sections">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="sr-tab"
        :class="{ active: tab === t.key }"
        :data-testid="`sr-tab-${t.key}`"
        :aria-current="tab === t.key ? 'page' : undefined"
        @click="tab = t.key"
      >
        <component :is="t.icon" :size="15" />
        <span>{{ t.label }}</span>
        <em>{{ t.uc }}</em>
      </button>
    </nav>

    <p v-if="error" class="sr-err" role="alert" data-testid="sr-error">{{ error }}</p>
    <p v-if="flash" class="sr-ok" role="status" data-testid="sr-flash">{{ flash }}</p>

    <!-- Create forms (not for clearances — those come from citizens) -->
    <section v-if="tab !== 'clearances'" class="sr-panel" :aria-label="`Add ${tabMeta.label}`">
      <h2><Plus :size="16" /> Add to {{ tabMeta.label }}</h2>

      <form class="sr-form" data-testid="sr-create-form" @submit.prevent="create">
        <template v-if="tab === 'bylaws'">
          <label>Kind
            <select v-model="form.kind" required data-testid="sr-bylaw-kind">
              <option value="bylaw">By-law</option>
              <option value="tariff">Tariff</option>
              <option value="model_chapter">Model building chapter</option>
              <option value="resolution">Resolution</option>
            </select>
          </label>
          <label>Title <input v-model="form.title" required data-testid="sr-bylaw-title" /></label>
          <label>Reference <input v-model="form.reference_no" data-testid="sr-bylaw-ref" /></label>
        </template>

        <template v-else-if="tab === 'plans'">
          <label>Plan year
            <input v-model="form.plan_year" type="number" :min="2020" :max="2100" required data-testid="sr-plan-year" />
          </label>
          <label>Title <input v-model="form.title" required data-testid="sr-plan-title" /></label>
          <label>Summary <textarea v-model="form.summary" rows="2" data-testid="sr-plan-summary" /></label>
        </template>

        <template v-else-if="tab === 'acquisitions'">
          <label>Purpose
            <select v-model="form.purpose" required data-testid="sr-acq-purpose">
              <option value="public_benefit">Public benefit</option>
              <option value="planning">Planning</option>
              <option value="public_health">Public health</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Stand number <input v-model="form.stand_number" data-testid="sr-acq-stand" /></label>
          <label>Detail <input v-model="form.purpose_detail" data-testid="sr-acq-detail" /></label>
        </template>

        <template v-else-if="tab === 'expenses'">
          <label>Description <input v-model="form.description" required data-testid="sr-exp-desc" /></label>
          <label>Amount (USD)
            <input v-model="form.amount_usd" type="number" step="0.01" min="0" required data-testid="sr-exp-amount" />
          </label>
          <label>Stand number <input v-model="form.stand_number" data-testid="sr-exp-stand" /></label>
        </template>

        <button type="submit" class="sr-btn primary" data-testid="sr-create-submit">Save</button>
      </form>
    </section>

    <section class="sr-panel" aria-label="Register rows">
      <h2>{{ tabMeta.label }} <span class="sr-count">{{ rows.length }}</span></h2>
      <p v-if="!loading && !rows.length" class="sr-empty" data-testid="sr-empty">No entries yet.</p>
      <ul class="sr-list" data-testid="sr-list">
        <li v-for="r in rows" :key="String(r.id)" class="sr-row" :data-testid="`sr-row-${r.id}`">
          <div class="sr-row-main">
            <strong>{{ r.title || r.applicant_name || r.description || r.purpose || r.stand_number || r.id }}</strong>
            <span class="sr-badge">{{ r.status }}</span>
            <span v-if="r.plan_year" class="sr-meta">{{ r.plan_year }}</span>
            <span v-if="r.certificate_no" class="sr-meta mono">{{ r.certificate_no }}</span>
            <span v-if="r.stand_number" class="sr-meta">Stand {{ r.stand_number }}</span>
            <span v-if="r.amount_usd != null" class="sr-meta mono">US$ {{ r.amount_usd }}</span>
          </div>
          <div class="sr-row-actions">
            <template v-if="tab === 'clearances' && r.status === 'requested'">
              <button type="button" class="sr-btn ok" data-testid="sr-clear-ok" @click="decideClearance(String(r.id), 'clear')">
                <Check :size="14" /> Issue s109
              </button>
              <button type="button" class="sr-btn danger" data-testid="sr-clear-refuse" @click="decideClearance(String(r.id), 'refuse')">
                <X :size="14" /> Refuse
              </button>
            </template>
            <template v-if="tab === 'clearances' && r.status === 'cleared' && !r.deeds_handoff_at">
              <button type="button" class="sr-btn primary" data-testid="sr-clear-handoff" @click="handoffClearance(String(r.id))">
                Hand to Deeds Registry
              </button>
            </template>
            <span v-if="tab === 'clearances' && r.deeds_handoff_ref" class="sr-meta mono">{{ r.deeds_handoff_ref }}</span>
            <template v-if="tab === 'plans' && r.status === 'draft'">
              <button type="button" class="sr-btn ok" data-testid="sr-plan-approve" @click="advancePlan(String(r.id), 'council_approved')">
                Council approve
              </button>
            </template>
            <template v-if="tab === 'plans' && r.status === 'council_approved'">
              <button type="button" class="sr-btn primary" data-testid="sr-plan-submit" @click="advancePlan(String(r.id), 'submitted_provincial')">
                Submit provincial
              </button>
            </template>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.sr-root {
  --sr-ink: #1a2332;
  --sr-muted: #5a6578;
  --sr-line: #d8dee8;
  --sr-bg: #f0f3f7;
  --sr-panel: #fff;
  --sr-accent: #0b5f4b;
  min-height: 100vh;
  background:
    radial-gradient(ellipse 80% 50% at 10% -10%, rgba(11, 95, 75, 0.08), transparent),
    var(--sr-bg);
  color: var(--sr-ink);
  padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem;
  font-family: "Source Sans 3", "Segoe UI", sans-serif;
}
.sr-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1.25rem;
}
.sr-eyebrow {
  margin: 0;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sr-accent);
  font-weight: 600;
}
.sr-head h1 {
  margin: 0.2rem 0;
  font-family: "Fraunces", Georgia, serif;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-weight: 600;
}
.sr-lede {
  margin: 0;
  max-width: 52rem;
  color: var(--sr-muted);
  line-height: 1.45;
}
.sr-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.sr-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--sr-line);
  background: var(--sr-panel);
  padding: 0.45rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--sr-ink);
}
.sr-tab em {
  font-style: normal;
  font-size: 0.7rem;
  color: var(--sr-muted);
  border: 1px solid var(--sr-line);
  padding: 0 0.3rem;
  border-radius: 3px;
}
.sr-tab.active {
  border-color: var(--sr-accent);
  background: rgba(11, 95, 75, 0.08);
  color: var(--sr-accent);
  font-weight: 600;
}
.sr-panel {
  background: var(--sr-panel);
  border: 1px solid var(--sr-line);
  border-radius: 8px;
  padding: 1rem 1.15rem;
  margin-bottom: 1rem;
}
.sr-panel h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.sr-count {
  font-size: 0.75rem;
  background: var(--sr-bg);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  color: var(--sr-muted);
}
.sr-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.65rem;
  align-items: end;
}
.sr-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: var(--sr-muted);
}
.sr-form input,
.sr-form select,
.sr-form textarea {
  border: 1px solid var(--sr-line);
  border-radius: 5px;
  padding: 0.4rem 0.5rem;
  font: inherit;
  color: var(--sr-ink);
  background: #fff;
}
.sr-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--sr-line);
  background: #fff;
  border-radius: 5px;
  padding: 0.45rem 0.75rem;
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
}
.sr-btn.primary {
  background: var(--sr-accent);
  border-color: var(--sr-accent);
  color: #fff;
}
.sr-btn.ok {
  background: #e8f5ef;
  border-color: #9dceb8;
  color: #0b5f4b;
}
.sr-btn.danger {
  background: #fdecea;
  border-color: #e8b4b0;
  color: #8b1e1e;
}
.sr-btn.ghost { background: transparent; }
.sr-list { list-style: none; margin: 0; padding: 0; }
.sr-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--sr-line);
}
.sr-row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.sr-badge {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--sr-bg);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
}
.sr-meta { font-size: 0.8rem; color: var(--sr-muted); }
.mono { font-family: ui-monospace, Consolas, monospace; }
.sr-row-actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.sr-err { color: #8b1e1e; background: #fdecea; padding: 0.5rem 0.75rem; border-radius: 5px; }
.sr-ok { color: #0b5f4b; background: #e8f5ef; padding: 0.5rem 0.75rem; border-radius: 5px; }
.sr-empty { color: var(--sr-muted); margin: 0; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
