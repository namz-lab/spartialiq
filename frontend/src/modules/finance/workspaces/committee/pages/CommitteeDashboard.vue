<script setup lang="ts">
/**
 * The committee's dashboard: an agenda, not a console. How many items of each kind wait for this
 * member's decision (only the kinds their permissions decide), the first of each, and the latest
 * decisions on the record. No council-wide totals are drawn: each item carries its own figures in
 * its own currency on the agenda.
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Wallet, ArrowLeftRight, HardHat, Globe2, Percent, Gavel, History, AlertTriangle, Landmark } from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { committeeDash, KINDS, headline, idOf, pendingTotal, type DecisionKind } from '../agenda'
import { loadDecisions, OUTCOME_LABEL, type Decision } from '../decisions'

const store = useFinanceStore()
const { state, load } = committeeDash
const d = computed(() => state.data)
const kinds = computed(() => KINDS.filter((m) => d.value?.[m.kind].allowed ?? store.can(m.permission)))

const ICON: Record<DecisionKind, unknown> = { budget: Wallet, revision: ArrowLeftRight, project: HardHat, publication: Globe2, tariff: Percent }
const TONE = ['cw-tile--blue', 'cw-tile--amber', 'cw-tile--violet', 'cw-tile--green', 'cw-tile--red']
const items = (k: DecisionKind) => d.value?.[k].items ?? []

const recent = ref<Decision[]>([])
const recentError = ref(false)
onMounted(async () => {
  if (!store.can('finance.audit.view') || !kinds.value.length) return
  try { recent.value = (await loadDecisions(kinds.value.map((m) => m.kind))).slice(0, 8) } catch { recentError.value = true }
})
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load()">Retry</button></p>

  <p v-if="!kinds.length" class="cw-banner-msg cw-banner-msg--warn" role="status">
    Your role does not decide any kind of finance item, so there is nothing on your agenda. Ask the finance access administrator if your duties have changed.
  </p>

  <template v-else>
    <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>
    <template v-else>
      <div class="cw-tiles dx-tiles">
        <RouterLink v-for="(m, i) in kinds" :key="m.kind" :to="{ name: 'com-agenda', query: { kind: m.kind } }" class="cw-tile" :class="TONE[i % TONE.length]">
          <span class="cw-tile-icon"><component :is="ICON[m.kind]" :size="32" aria-hidden="true" /></span>
          <div><p class="cw-tile-label">{{ m.label }}</p>
            <p class="cw-tile-value num">{{ d?.[m.kind].error ? '—' : items(m.kind).length }}</p>
            <p class="cw-tile-sub">{{ d?.[m.kind].error ? 'could not be read' : 'awaiting your decision' }}</p></div>
        </RouterLink>
      </div>

      <div class="dx-row dx-row--wide-left">
        <section class="cw-card" aria-labelledby="cd-agenda">
          <div class="cw-card-head"><h3 id="cd-agenda"><Gavel :size="24" class="cw-head-icon" aria-hidden="true" /> On the agenda</h3><span class="cw-spacer" />
            <RouterLink :to="{ name: 'com-agenda' }" class="cw-link">All {{ pendingTotal(d) }} items</RouterLink></div>
          <div class="cw-card-body">
            <p v-if="!pendingTotal(d)" class="cw-empty">Nothing is waiting for your decision.</p>
            <template v-else>
              <template v-for="m in kinds" :key="m.kind">
                <h4 v-if="items(m.kind).length" class="cd-group">{{ m.label }}</h4>
                <ul v-if="items(m.kind).length" class="dx-list">
                  <li v-for="it in items(m.kind).slice(0, 3)" :key="idOf(m.kind, it)">
                    <RouterLink :to="{ name: 'com-agenda', query: { kind: m.kind } }" class="dx-item">
                      <span class="dx-grow">{{ headline(m.kind, it).title }}<span class="cw-hint"> · {{ headline(m.kind, it).meta }}</span></span>
                      <span class="num">{{ headline(m.kind, it).figure }}</span>
                    </RouterLink>
                  </li>
                </ul>
              </template>
            </template>
          </div>
        </section>

        <section class="cw-card" aria-labelledby="cd-recent">
          <div class="cw-card-head"><h3 id="cd-recent"><History :size="24" class="cw-head-icon" aria-hidden="true" /> Latest decisions</h3><span class="cw-spacer" />
            <RouterLink :to="{ name: 'com-decided' }" class="cw-link">Decision register</RouterLink></div>
          <div class="cw-card-body">
            <p v-if="!store.can('finance.audit.view')" class="cw-empty">The register is read from the audit trail, which your role does not include.</p>
            <p v-else-if="recentError" class="cw-empty">The latest decisions could not be read.</p>
            <p v-else-if="!recent.length" class="cw-empty">No decision is on the record yet.</p>
            <ul v-else class="dx-list">
              <li v-for="r in recent" :key="r.id" class="dx-item">
                <span class="dx-grow">{{ r.subject }}<span class="cw-hint"> · {{ r.actor }}</span></span>
                <span class="cw-pill" :class="r.refused ? 'cw-pill--mute' : r.outcome === 'approved' ? 'cw-pill--pos' : 'cw-pill--warn'">{{ r.refused ? 'Refused' : OUTCOME_LABEL[r.outcome] }}</span>
                <span class="dx-when">{{ formatDateTime(r.at) }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <section class="cw-card" aria-labelledby="cd-ctx">
        <div class="cw-card-head"><h3 id="cd-ctx"><Landmark :size="24" class="cw-head-icon" aria-hidden="true" /> For context</h3></div>
        <div class="cw-card-body">
          <p class="cw-hint" style="margin-top: 0">The council's position, the budget as it stands and the reports are read-only here, so a decision can be taken against the whole picture.</p>
          <div class="dx-quick">
            <RouterLink :to="{ name: 'com-position' }" class="cw-action dx-qa-wide"><Landmark :size="24" aria-hidden="true" /><span>Financial position</span></RouterLink>
            <RouterLink v-if="store.can('finance.budget.view')" :to="{ name: 'com-budget' }" class="cw-action dx-qa-wide"><Wallet :size="24" aria-hidden="true" /><span>Budget</span></RouterLink>
            <RouterLink :to="{ name: 'com-reports' }" class="cw-action dx-qa-wide"><History :size="24" aria-hidden="true" /><span>Reports</span></RouterLink>
          </div>
        </div>
      </section>
    </template>
  </template>
</template>

<style scoped>
.cd-group { font-size: 13px; font-weight: 600; color: var(--cw-ink-2); margin: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.06em; }
.cd-group:first-child { margin-top: 0; }
</style>
