<script setup lang="ts">
/**
 * Everything waiting for a decision across finance, for the finance director. Each row says who
 * decides it and opens the screen where it is decided, in whichever of the director's workspaces
 * serves it. Nothing is approved from here: the approver acts on the evidence in their own screen.
 */
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Inbox, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { inbox, loadInbox } from '../inbox'
import { waitingTotal } from '../approvals'
import { useWhere } from '../links'

const store = useFinanceStore()
const where = useWhere()
const load = () => loadInbox(store.selectedYearId, store.can)
onMounted(load)
watch(() => store.selectedYearId, load)

const rows = computed(() => inbox.items.map((it) => ({ ...it, link: where(it.where) })))
const total = computed(() => waitingTotal(inbox.items))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Inbox :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Approvals</h2>
      <p>What is waiting for a decision across finance, who decides it, and where. Approving happens in the approver's own screen.</p></div>
    <span class="cw-spacer" />
    <button type="button" class="cw-btn cw-btn--outline" :disabled="inbox.loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /> Read again</button>
  </section>

  <section class="cw-card" aria-labelledby="ap-h">
    <div class="cw-card-head"><h3 id="ap-h">Waiting for a decision</h3><span class="cw-spacer" />
      <span v-if="!inbox.loading" class="cw-hint" role="status">{{ total }} {{ total === 1 ? 'item' : 'items' }} waiting</span></div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="inbox.loading && !rows.length" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th scope="col">Waiting</th><th scope="col" class="r">Count</th><th scope="col">Who decides</th><th scope="col">Where</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.key" :data-key="r.key">
            <td class="dx-wrap">{{ r.label }}</td>
            <td class="r">
              <span v-if="r.n === null" class="cw-hint" :title="r.why">Not readable</span>
              <span v-else class="dx-count" :class="{ 'is-zero': !r.n }">{{ r.n }}</span>
            </td>
            <td>{{ r.decides }}</td>
            <td>
              <RouterLink v-if="r.link.ok" :to="r.link.to" class="cw-link">{{ r.link.where }} <ChevronRight :size="14" aria-hidden="true" /></RouterLink>
              <span v-else class="cw-hint">{{ r.link.reason }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="dx-note">"Not readable" means your role cannot read that count; it is not the same as nothing waiting.</p>
    </div>
  </section>
</template>
