<script setup lang="ts">
// Statutory clock tab — every deadline on the case, from server records.
import { computed, ref, watch } from 'vue'
import { dmApi, type Consultation, type PublicNotice, type PermitApplication } from '@/services/developmentManagementService'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { caseDeadlines, type DeadlineState } from '../caseClock'
import { referralState } from '../referralRules'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'

const { current } = usePlannerCase()
const notice = ref<PublicNotice | null>(null)
const referrals = ref<Consultation[]>([])
const permit = ref<PermitApplication | null>(null)

watch(() => current.value?.permitId, async (id) => {
  if (!id) return
  const [n, r, p] = await Promise.allSettled([dmApi.getPublicNotice(id), dmApi.listConsultations(id), dmApi.getPermit(id)])
  notice.value = n.status === 'fulfilled' ? n.value : null
  referrals.value = r.status === 'fulfilled' ? r.value : []
  permit.value = p.status === 'fulfilled' ? p.value : null
}, { immediate: true })

const rows = computed(() => {
  const c = current.value
  if (!c) return []
  return caseDeadlines({
    receivedAt: permit.value?.received_at ?? c.applicationDate,
    acknowledgedAt: permit.value?.acknowledged_at ?? c.acknowledgedDate,
    objectionStart: notice.value?.objection_period_start,
    objectionEnd: notice.value?.objection_period_end,
    objectionClosed: notice.value?.objection_period_closed,
    pendingReferralDue: referrals.value
      .filter(x => { const s = referralState(x); return s === 'awaiting' || s === 'overdue' })
      .map(x => x.response_due_at),
    decidedAt: permit.value?.decision_at ?? c.permit.decisionDate,
    notifiedAt: c.permit.notificationDate,
  })
})

const TONE: Record<DeadlineState, 'positive' | 'negative' | 'warning' | 'info' | 'neutral'> = {
  done: 'positive', overdue: 'negative', due_soon: 'warning', upcoming: 'info', not_started: 'neutral',
}
const LABEL: Record<DeadlineState, string> = {
  done: 'Done', overdue: 'Overdue', due_soon: 'Due within 7 days', upcoming: 'Upcoming', not_started: 'Not started',
}
const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
</script>

<template>
  <div class="ck">
    <table class="ck-table">
      <caption class="ent-sr-only">Statutory deadlines on this case</caption>
      <thead><tr><th scope="col">Deadline</th><th scope="col">Due</th><th scope="col">State</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key" :class="r.state">
          <td><strong>{{ r.label }}</strong><span>{{ r.basis }}</span></td>
          <td>{{ fmt(r.due) }}<span v-if="r.doneAt && r.key !== 'objections'">done {{ fmt(r.doneAt) }}</span></td>
          <td><UiStatusBadge :tone="TONE[r.state]" :label="LABEL[r.state]" /></td>
        </tr>
      </tbody>
    </table>
    <p class="ck-note">An application not determined within three months of acknowledgement is deemed refused (s.26(7)); the applicant may then appeal.</p>
  </div>
</template>

<style scoped>
.ck { display: flex; flex-direction: column; gap: var(--ent-s3); }
.ck-table { width: 100%; border-collapse: collapse; background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); font-size: var(--ent-fs-sm); }
.ck-table th { text-align: left; font-size: var(--ent-fs-xs); color: var(--ent-text-3); font-weight: var(--ent-fw-semibold); padding: var(--ent-s2) var(--ent-s3); border-bottom: 1px solid var(--ent-line); }
.ck-table td { padding: var(--ent-s2) var(--ent-s3); border-bottom: 1px solid var(--ent-line); vertical-align: top; }
.ck-table td span { display: block; font-size: var(--ent-fs-micro); color: var(--ent-text-3); margin-top: 2px; }
.ck-table tr.overdue td:first-child { box-shadow: inset 3px 0 0 var(--ent-danger); }
.ck-table tr.due_soon td:first-child { box-shadow: inset 3px 0 0 var(--ent-warning); }
.ck-note { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
</style>
