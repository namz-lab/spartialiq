<script setup lang="ts">
/**
 * Statements: find a rates account and print its statement for the ratepayer.
 *
 * `/finance/revenue/statements` searches the accounts (`GET /finance/rates/accounts`);
 * `/finance/revenue/statements/:id` shows one statement (`GET /finance/rates/accounts/:id`) with
 * Print. Printing teleports the same document to <body> as `.cw-print-root`, which portal.css
 * prints on its own.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ScrollText, Printer, Search, AlertTriangle, ArrowLeft } from 'lucide-vue-next'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf } from '../../../stores/finance'
import type { RatesAccount, RatesStatement } from '../../../models/ratesTypes'
import StatementDocument from '../components/StatementDocument.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => (typeof route.params.id === 'string' && route.params.id ? route.params.id : null))

const statement = ref<RatesStatement | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const today = new Date().toISOString().slice(0, 10)

async function loadStatement(accountId: string): Promise<void> {
  loading.value = true
  error.value = null
  statement.value = null
  try {
    statement.value = await ratesApi.statement(accountId)
  } catch (err) {
    error.value = messageOf(err, 'The statement could not be read.')
  } finally {
    loading.value = false
  }
}
watch(id, (v) => { if (v) void loadStatement(v) }, { immediate: true })

// ── Finding an account ──────────────────────────────────────────────────────────────────────
const q = ref('')
const found = ref<RatesAccount[]>([])
const searching = ref(false)
const searched = ref(false)
async function search(): Promise<void> {
  const text = q.value.trim()
  if (text.length < 2) { found.value = []; searched.value = false; return }
  searching.value = true
  error.value = null
  try {
    found.value = (await ratesApi.accounts({ q: text, limit: 20 })).accounts
    searched.value = true
  } catch (err) {
    error.value = messageOf(err, 'The accounts could not be searched.')
  } finally {
    searching.value = false
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => { clearTimeout(timer); timer = setTimeout(search, 300) })

// ── Printing ────────────────────────────────────────────────────────────────────────────────
const printing = ref(false)
async function print(): Promise<void> {
  printing.value = true
  await nextTick()
  window.print()
  printing.value = false
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ScrollText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Statements</h2>
      <p>A ratepayer's bills, payments and balance, ready to print and hand over.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <template v-if="id">
    <section class="cw-card">
      <div class="cw-card-head">
        <button type="button" class="cw-btn cw-btn--outline cw-btn--small" @click="router.push({ name: 'rev-statement' })">
          <ArrowLeft :size="16" aria-hidden="true" /> Another account
        </button>
        <span class="cw-spacer" />
        <button type="button" class="cw-btn cw-btn--primary cw-btn--small" :disabled="!statement" @click="print">
          <Printer :size="16" aria-hidden="true" /> Print statement
        </button>
      </div>
      <div class="cw-card-body">
        <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>
        <StatementDocument v-else-if="statement" :statement="statement" :as-at="today" />
      </div>
    </section>
  </template>

  <section v-else class="cw-card" aria-labelledby="as-find">
    <div class="cw-card-head"><h3 id="as-find">Find an account</h3></div>
    <div class="cw-card-body">
      <label class="cw-field"><span class="cw-label">Account number, ratepayer or stand number</span>
        <span class="as-search"><Search :size="16" aria-hidden="true" /><input v-model="q" class="cw-input" type="search" autocomplete="off" /></span>
      </label>
      <div class="cw-table-wrap as-results" aria-live="polite">
        <div v-if="searching"><span class="cw-skel" /></div>
        <p v-else-if="searched && !found.length" class="cw-empty">No account matches.</p>
        <table v-else-if="found.length" class="cw-table">
          <thead><tr><th>Account</th><th>Ratepayer</th><th>Stand</th><th>Ward</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="a in found" :key="a.id">
              <td class="num"><RouterLink class="cw-link" :to="{ name: 'rev-statement', params: { id: a.id } }">{{ a.account_no }}</RouterLink></td>
              <td>{{ a.party_name }}</td><td>{{ a.stand_no ?? '—' }}</td><td>{{ a.ward_code ?? '—' }}</td>
              <td><span class="cw-pill" :class="a.status === 'active' ? 'cw-pill--pos' : 'cw-pill--mute'">{{ a.status === 'active' ? 'Active' : 'Closed' }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="cw-hint">Type at least two characters.</p>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div v-if="printing && statement" class="cw-print-root" aria-hidden="true">
      <StatementDocument :statement="statement" :as-at="today" />
    </div>
  </Teleport>
</template>

<style scoped>
.as-search { position: relative; display: flex; align-items: center; max-width: 520px; }
.as-search svg { position: absolute; left: 10px; color: var(--cw-ink-2); }
.as-search input { padding-left: 32px; }
.as-results { margin-top: 14px; }
</style>
