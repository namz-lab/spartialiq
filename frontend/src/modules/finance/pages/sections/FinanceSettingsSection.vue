<script setup lang="ts">
/**
 * Council finance settings — the handful of choices that change how this module conducts itself.
 *
 * EACH ONE IS A COUNCIL DECISION, NOT A PREFERENCE. Whether the available balance shown includes
 * open commitments changes what every screen in this module means by "available"; whether the
 * approver and the publisher must be different people is a governance control. Both are set here
 * and both are stated, in words, wherever the figure they affect appears.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * There is no exchange-rate setting. Converting between USD and ZWG needs a Council-approved rate
 * source and conversion method (decision D4), and the seam for it — finance.exchange_rate_policy —
 * is empty and read by nothing. Adding a rate box here would let one officer invent a consolidated
 * figure for the whole council.
 */
import { computed, onMounted, ref } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatDateTime } from '../../composables/useMoney'
import FinanceGuard from '../../components/FinanceGuard.vue'
import { AlertTriangle, CheckCircle2, RefreshCw, Info, Ban } from 'lucide-vue-next'

const store = useFinanceStore()

const settings = ref<Array<{ key: string; value: unknown; updated_at: string }>>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const canManage = computed(() => store.can('finance.config.manage'))

interface SettingMeta {
  key: string
  label: string
  help: string
  kind: 'boolean' | 'percentage' | 'currency' | 'integer'
  consequence: string
}

const META: SettingMeta[] = [
  {
    key: 'available_balance.include_commitments',
    label: 'Available balance includes open commitments',
    kind: 'boolean',
    help: 'The specification asks the application to state whether commitments are included (§6.3). Both figures are always computed; this chooses which one the screens show by default.',
    consequence: 'Changes what every “available” figure in this module means. The screens say which definition they are using either way.',
  },
  {
    key: 'separation_of_duties.publication',
    label: 'The approver and the publisher must be different people',
    kind: 'boolean',
    help: 'The specification asks for duties to be separated "where practicable" (§2.3). A council with one finance officer must still be able to publish, so this is the Council\'s to set — and it defaults to on.',
    consequence: 'Turning this off lets one person approve a dataset and then release it. Both actors are recorded on every published version regardless.',
  },
  {
    key: 'overspend.warn_execution_percentage',
    label: 'Warn when execution reaches',
    kind: 'percentage',
    help: 'A display threshold for flagging a budget line as nearly exhausted.',
    consequence: 'Advisory only. Nothing is blocked by it.',
  },
  {
    key: 'overspend.flag_execution_percentage',
    label: 'Flag as over budget at',
    kind: 'percentage',
    help: 'A display threshold for flagging a budget line as over its allocation.',
    consequence: 'Advisory only. Nothing is blocked by it.',
  },
  {
    key: 'reporting.default_currency',
    label: 'Default reporting currency',
    kind: 'currency',
    help: 'Shown when no financial year is selected. Each year carries its own reporting currency.',
    consequence: 'Does not convert anything. USD and ZWG are always reported separately.',
  },
  {
    key: 'import.max_rows',
    label: 'Largest import, in rows',
    kind: 'integer',
    help: 'A file longer than this is read only up to the limit, and the officer is told.',
    consequence: 'A full council year is tens of thousands of rows, not millions.',
  },
  {
    key: 'import.max_file_bytes',
    label: 'Largest import, in bytes',
    kind: 'integer',
    help: 'Uploads above this size are refused before anything is read.',
    consequence: 'Protects the service from a file nobody meant to send.',
  },
]

const draft = ref<Record<string, unknown>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    settings.value = await financeApi.settings()
    draft.value = Object.fromEntries(settings.value.map((s) => [s.key, s.value]))
  } catch (err) {
    error.value = messageOf(err, 'The finance settings could not be read.')
  } finally { loading.value = false }
}

onMounted(load)

async function save(meta: SettingMeta): Promise<void> {
  error.value = null; note.value = null
  busy.value = meta.key
  let value = draft.value[meta.key]
  if (meta.kind === 'percentage' || meta.kind === 'integer') value = Number(value)
  try {
    await financeApi.setSetting(meta.key, value)
    note.value = `“${meta.label}” saved. ${meta.consequence}`
    await load()
  } catch (err) {
    error.value = messageOf(err, 'That setting could not be saved.')
    await load()
  } finally { busy.value = null }
}

const updatedAt = (key: string): string => {
  const row = settings.value.find((s) => s.key === key)
  return row ? formatDateTime(row.updated_at) : '—'
}
</script>

<template>
  <div class="fin-section">
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <div class="fin-section-actions">
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <section class="ins-card">
      <div class="ins-card-head"><h3>How this council wants finance figures shown</h3></div>
      <div class="ins-card-body">
        <ul class="fin-settings">
          <li v-for="m in META" :key="m.key" class="fin-setting">
            <div class="fin-setting-text">
              <p class="fin-setting-label">{{ m.label }}</p>
              <p class="fin-setting-help">{{ m.help }}</p>
              <p class="fin-setting-consequence">{{ m.consequence }}</p>
              <p class="fin-sub">Last changed {{ updatedAt(m.key) }}</p>
            </div>
            <div class="fin-setting-control">
              <template v-if="m.kind === 'boolean'">
                <label class="ins-check">
                  <input type="checkbox" :checked="draft[m.key] === true" :disabled="!canManage"
                         @change="draft[m.key] = ($event.target as HTMLInputElement).checked" />
                  {{ draft[m.key] === true ? 'On' : 'Off' }}
                </label>
              </template>
              <template v-else-if="m.kind === 'currency'">
                <select class="ins-input" :value="draft[m.key]" :disabled="!canManage"
                        @change="draft[m.key] = ($event.target as HTMLSelectElement).value">
                  <option value="USD">USD</option>
                  <option value="ZWG">ZWG</option>
                </select>
              </template>
              <template v-else>
                <input class="ins-input" type="number" :min="m.kind === 'percentage' ? 0 : 1"
                       :max="m.kind === 'percentage' ? 1000 : undefined"
                       :value="draft[m.key]" :disabled="!canManage"
                       @input="draft[m.key] = ($event.target as HTMLInputElement).value" />
              </template>
              <button v-if="canManage" type="button" class="fin-btn small"
                      :disabled="busy === m.key" @click="save(m)">
                {{ busy === m.key ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </li>
        </ul>

        <FinanceGuard requires="finance.config.manage" surface="Changing finance settings">
          <span class="sr-only">You may change these settings.</span>
        </FinanceGuard>
      </div>
    </section>

    <section class="ins-card">
      <div class="ins-card-head"><h3>Decisions this module is waiting on</h3></div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">
          <Info :size="14" aria-hidden="true" />
          Each of these is a configurable seam left deliberately empty or inert rather than filled
          with a plausible value. They are recorded in
          <span class="ins-mono">docs/finance/COUNCIL-DECISIONS.md</span>.
        </p>
        <ul class="fin-decisions">
          <li>
            <Ban :size="14" aria-hidden="true" />
            <div>
              <strong>Currency conversion.</strong>
              USD and ZWG are stored and reported separately and are never added together. No
              exchange rate is applied anywhere, and the table that would hold one is empty and read
              by nothing. A combined figure needs a Council-approved rate source and method.
            </div>
          </li>
          <li>
            <Ban :size="14" aria-hidden="true" />
            <div>
              <strong>Approval thresholds and delegated authority.</strong>
              No amount auto-approves. Every revision needs an explicit approval event from someone
              who is not the requester, whatever its size, until the Council records its delegated
              authorities.
            </div>
          </li>
          <li>
            <Ban :size="14" aria-hidden="true" />
            <div>
              <strong>The public disclosure matrix.</strong>
              The public portal exposes no supplier or beneficiary identity at all, and a document
              becomes public only by a publisher's deliberate act. Widening that is a Council
              decision, not a setting.
            </div>
          </li>
          <li>
            <Ban :size="14" aria-hidden="true" />
            <div>
              <strong>Retention, backup and recovery targets.</strong>
              Nothing financial is hard-deleted and no retention job is scheduled. The hosting
              model, backup location, recovery point and recovery time objectives are the Council's
              to approve.
            </div>
          </li>
        </ul>
        <p class="fin-sub">
          This system is not production-approved until Council validation, user acceptance testing
          and a demonstrated backup restoration are complete. It does not assert compliance with any
          statute, regulation or accounting standard.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-section-actions { display: flex; justify-content: flex-end; }
.fin-settings { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-setting {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(10rem, auto);
  gap: var(--ent-s3); align-items: start;
  padding-bottom: var(--ent-s4); border-bottom: 1px solid var(--ent-line);
}
.fin-settings li:last-child { border-bottom: 0; padding-bottom: 0; }
.fin-setting-label { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.fin-setting-help { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh); max-width: 70ch; }
.fin-setting-consequence { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); font-style: italic; max-width: 70ch; }
.fin-setting-control { display: flex; align-items: center; gap: var(--ent-s2); justify-content: flex-end; }
.fin-setting-control .ins-input { max-width: 8rem; }
.fin-sub { margin: var(--ent-s1) 0 0; color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-decisions { margin: var(--ent-s3) 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s3); }
.fin-decisions li { display: flex; align-items: flex-start; gap: var(--ent-s2); font-size: var(--ent-fs-sm); line-height: var(--ent-lh); color: var(--ent-text-2); max-width: 80ch; }
.fin-decisions strong { color: var(--ent-text); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 767px) { .fin-setting { grid-template-columns: 1fr; } .fin-setting-control { justify-content: flex-start; } }
</style>
