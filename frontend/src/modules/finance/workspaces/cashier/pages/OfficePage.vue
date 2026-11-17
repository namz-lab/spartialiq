<script setup lang="ts">
/**
 * The cash office's back-office pages, each the console's own screen opened in the workspace so
 * there is one implementation of every control (the blind count, the witnessed count, preparer is
 * not poster):
 *
 *   drawers   the supervisor's board: every drawer, who holds it, abandon and witnessed count,
 *             cashier assignments                         (finance.cash.session.supervise / assignment.manage)
 *   cashups   counted sessions awaiting a second person   (finance.cash.session.verify)
 *   banking   the till position and the deposit slip      (finance.cash.deposit.prepare)
 *
 * Route meta `cwOffice` picks the screen. Without the duty the page says who holds it instead of
 * drawing controls the server would refuse.
 */
import { computed, defineAsyncComponent, onMounted, ref, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { ClipboardCheck, Landmark, MonitorCheck, Lock } from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { useCashier } from '../useCashier'
import ReceiptDialog from '../components/ReceiptDialog.vue'
import '@/views/inspector/inspector.css'
import '../../../pages/finance.css'

const Drawers = defineAsyncComponent(() => import('../../../components/cash/CashDrawers.vue'))
const Sessions = defineAsyncComponent(() => import('../../../components/cash/CashSessions.vue'))
const Banking = defineAsyncComponent(() => import('../../../components/cash/CashBanking.vue'))

export type OfficeKey = 'drawers' | 'cashups' | 'banking'

interface Office { component: Component; icon: Component; desk: boolean; needs: string[]; holder: string }
const OFFICES: Record<OfficeKey, Office> = {
  drawers: {
    component: Drawers, icon: MonitorCheck, desk: true,
    needs: ['finance.cash.session.supervise', 'finance.cash.assignment.manage'],
    holder: 'The drawers board is kept by a cash supervisor.',
  },
  cashups: {
    component: Sessions, icon: ClipboardCheck, desk: false,
    needs: ['finance.cash.session.verify'],
    holder: 'A cash-up is verified by a cash supervisor or the accountant, never by the cashier who counted it.',
  },
  banking: {
    component: Banking, icon: Landmark, desk: true,
    needs: ['finance.cash.deposit.prepare', 'finance.ledger.voucher.post'],
    holder: 'Banking is prepared by a cashier and posted by the accountant.',
  },
}

const route = useRoute()
const store = useFinanceStore()
const { state, loadDesk } = useCashier()

const key = computed(() => route.meta.cwOffice as OfficeKey)
const office = computed(() => OFFICES[key.value])
const allowed = computed(() => office.value.needs.some((p) => store.can(p)))
const printing = ref<string | null>(null)

onMounted(() => { if (office.value.desk && !state.desk) void loadDesk() })
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="office.icon" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ route.meta.cwTitle }}</h2>
      <p>{{ route.meta.cwLead }}</p>
    </div>
  </section>

  <section v-if="!allowed" class="cw-card">
    <div class="cw-card-body office-denied">
      <Lock :size="20" aria-hidden="true" />
      <p>{{ office.holder }} Your role does not include it.</p>
    </div>
  </section>

  <section v-else class="cw-card">
    <div class="cw-card-body">
      <template v-if="office.desk">
        <div v-if="!state.desk" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>
        <component :is="office.component" v-else :desk="state.desk" @changed="loadDesk()" />
      </template>
      <component :is="office.component" v-else @changed="loadDesk()" @print="(id: string) => (printing = id)" />
    </div>
  </section>

  <ReceiptDialog v-if="printing" :receipt-id="printing" @close="printing = null" />
</template>

<style scoped>
.office-denied { display: flex; gap: 10px; align-items: center; color: var(--cw-ink-2); }
.office-denied p { margin: 0; }
</style>
