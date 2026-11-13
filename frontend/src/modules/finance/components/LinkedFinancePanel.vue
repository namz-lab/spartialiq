<script setup lang="ts">
/**
 * All the money attached to one existing council record, found by THAT record's id.
 *
 * This is the integration entry point of the finance module, and the only finance surface meant to
 * be mounted outside it. It asks `GET /api/finance/linked/:kind/:id`, which needs nothing but
 * `finance.project.view` — a permission `planner`, `eo` and `env_officer` already hold — so a
 * planner can see what has been spent against the application in front of them without being given
 * the budget console. Giving planning staff the finance console would be giving them the budget.
 *
 * WHAT IT WILL NOT DO
 * It will not guess an identifier. `kind` and `subjectId` must be the record's own id in the
 * register the kind names (`development_application` is `public.development_applications.id`, not a
 * permit application's id). A panel fed the wrong id answers "nothing attached", which reads as a
 * fact about the council's spending rather than a mistake about the id — the one failure this
 * module treats as worse than no trace at all. A host that is not certain of the id should not
 * mount this.
 *
 * COUNTERPARTY IDENTITY is absent, not blank, for a caller without that permission, and the panel
 * says which it is.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { financeApi } from '../api/financeApi'
import { messageOf } from '../stores/finance'
import { formatMoney, formatPercentage, formatDate } from '../composables/useMoney'
import type { FinanceProject, FinanceTransaction } from '../models/types'
import { AlertTriangle, Coins, EyeOff, RefreshCw } from 'lucide-vue-next'
// This is the one finance component mounted outside the finance workspace, so it cannot assume
// the host page has loaded the sheets its `ins-*` and `fin-*` classes come from — mounted in the
// planner's case file it rendered unstyled. Both sheets are entirely class-prefixed (no element
// or reset rules), so loading them on a planning page restyles nothing of the host's, and the
// bundler emits each once however many components import it.
import '@/views/inspector/inspector.css'
import '../pages/finance.css'

const props = withDefaults(defineProps<{
  /** The register the id belongs to, as the finance module names it. */
  kind: 'development_application' | 'planning_project' | 'survey_project' | 'council_asset' | 'service_desk_ticket'
  /** The record's own primary key, in that register. */
  subjectId: string
  /** What the record is called on the host surface, for the headings. */
  recordLabel?: string
  /** How many postings to list. The rest are reachable from the finance console. */
  transactionLimit?: number
}>(), { recordLabel: 'this record', transactionLimit: 10 })

const projects = ref<FinanceProject[]>([])
const transactions = ref<FinanceTransaction[]>([])
const counterpartyVisible = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
/** A 403 is not an error worth a red banner: it means this role may not see project money. */
const refused = ref(false)

async function load(): Promise<void> {
  if (!props.subjectId) return
  loading.value = true
  error.value = null
  refused.value = false
  try {
    const result = await financeApi.financeForLinkedRecord(props.kind, props.subjectId)
    projects.value = result.projects
    transactions.value = result.recent_transactions.slice(0, props.transactionLimit)
    counterpartyVisible.value = result.counterparty_visible
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 403) refused.value = true
    else error.value = messageOf(err, 'The finance attached to this record could not be read.')
    projects.value = []
    transactions.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [props.kind, props.subjectId], load)

/**
 * Totals per currency, never across them. Two projects on one record, one budgeted in USD and one
 * in ZWG, are two figures — adding them would need a Council-approved rate, and there is none.
 */
const byCurrency = computed(() => {
  const groups = new Map<string, { currency: string; allocated: bigint; spent: bigint; projects: number }>()
  for (const p of projects.value) {
    const g = groups.get(p.currency) ?? { currency: p.currency, allocated: 0n, spent: 0n, projects: 0 }
    g.allocated += toCents(p.allocated_total)
    g.spent += toCents(p.actual_spend)
    g.projects += 1
    groups.set(p.currency, g)
  }
  return [...groups.values()].map((g) => ({
    currency: g.currency,
    projects: g.projects,
    allocated: fromCents(g.allocated),
    spent: fromCents(g.spent),
  }))
})

/** Money is summed in minor units as integers; it never passes through a JavaScript number. */
function toCents(decimal: string | null | undefined): bigint {
  if (!decimal) return 0n
  const negative = decimal.trim().startsWith('-')
  const [whole, fraction = ''] = decimal.trim().replace('-', '').split('.')
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2) || '0')
  return negative ? -cents : cents
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}
</script>

<template>
  <section class="lfp" aria-labelledby="lfp-head">
    <header class="lfp-head">
      <h3 id="lfp-head">
        <Coins :size="15" aria-hidden="true" /> Council money attached to {{ recordLabel }}
      </h3>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </header>

    <p v-if="loading && projects.length === 0" class="lfp-note" role="status">Reading the finance record…</p>

    <div v-else-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>

    <p v-else-if="refused" class="lfp-note">
      Project finance is not open to your role. The figures exist; reading them needs the
      “View projects” finance permission, which is granted by a system administrator.
    </p>

    <div v-else-if="projects.length === 0" class="lfp-empty">
      <strong>No council project is attached to {{ recordLabel }}.</strong>
      <p>
        That means no finance project cites this record — not that nothing was spent. Spending
        recorded without a link to this record is in the finance console, under Projects.
      </p>
    </div>

    <template v-else>
      <dl class="fin-figures">
        <div v-for="c in byCurrency" :key="c.currency" class="fin-figure">
          <dt>{{ c.currency }}</dt>
          <dd>
            {{ formatMoney(c.spent, c.currency as 'USD' | 'ZWG', { bare: true }) }}
            <span class="fin-figure-note">
              spent of {{ formatMoney(c.allocated, c.currency as 'USD' | 'ZWG', { bare: true }) }}
              allocated · {{ c.projects }} project(s)
            </span>
          </dd>
        </div>
      </dl>
      <p v-if="byCurrency.length > 1" class="fin-ccy-note">
        Two currencies, two figures. They are not added together and no rate is applied.
      </p>

      <div class="fin-table-wrap">
        <table class="fin-table">
          <caption>Projects citing this record</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th><th scope="col">Project</th><th scope="col">Status</th>
              <th scope="col" class="ccy">Ccy</th><th scope="col" class="num">Allocated</th>
              <th scope="col" class="num">Spent</th><th scope="col" class="num">Execution</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in projects" :key="p.project_id">
              <td class="ins-mono">{{ p.reference }}</td>
              <td>{{ p.name }}</td>
              <td><span class="fin-pill">{{ p.status.replace(/_/g, ' ') }}</span></td>
              <td class="ccy">{{ p.currency }}</td>
              <td class="num">{{ formatMoney(p.allocated_total, p.currency, { bare: true }) }}</td>
              <td class="num emphasis">{{ formatMoney(p.actual_spend, p.currency, { bare: true }) }}</td>
              <td class="num" :class="{ 'undefined-value': p.execution_percentage === null }">
                {{ formatPercentage(p.execution_percentage) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="transactions.length">
        <h4 class="lfp-sub">Most recent postings</h4>
        <p v-if="!counterpartyVisible" class="fin-ccy-note" style="margin-top: 0">
          <EyeOff :size="14" aria-hidden="true" />
          Supplier and beneficiary identities are absent rather than blank: showing them needs the
          “View counterparty identity” permission, which your role does not hold.
        </p>
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Date</th><th scope="col">Account</th><th scope="col">Description</th>
                <th scope="col" class="ccy">Ccy</th><th scope="col" class="num">Amount</th>
                <th v-if="counterpartyVisible" scope="col">Counterparty</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in transactions" :key="t.id">
                <td>{{ formatDate(t.txn_date) }}</td>
                <td class="ins-mono">{{ t.account_code }}<br /><small class="lfp-dim">{{ t.account_name }}</small></td>
                <td>{{ t.description ?? '—' }}</td>
                <td class="ccy">{{ t.currency }}</td>
                <td class="num">{{ formatMoney(t.amount, t.currency, { bare: true }) }}</td>
                <td v-if="counterpartyVisible">{{ t.counterparty_name ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.lfp {
  display: flex; flex-direction: column; gap: var(--ent-s3);
  padding: var(--ent-s4); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md); background: var(--ent-surface);
}
.lfp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s3); flex-wrap: wrap; }
.lfp-head h3 {
  display: inline-flex; align-items: center; gap: var(--ent-s2); margin: 0;
  font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.lfp-sub { margin: var(--ent-s3) 0 var(--ent-s2); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.lfp-note { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh); max-width: 70ch; }
.lfp-dim { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.lfp-empty {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s4); border: 1px dashed var(--ent-line-strong);
  border-radius: var(--ent-r-sm); background: var(--ent-surface-2);
  font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh);
}
.lfp-empty strong { color: var(--ent-text); font-weight: var(--ent-fw-semibold); }
.lfp-empty p { margin: 0; max-width: 70ch; }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
</style>
