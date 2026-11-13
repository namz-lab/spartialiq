<script setup lang="ts">
/**
 * A cashier session's history, as the database recorded it (finance.cashier_session_event,
 * migration 208). Append-only: nothing here can be edited, and a count that was sent back for a
 * recount is still shown as it was declared.
 *
 * Events reconstructed for a session that existed before the history was kept are labelled so,
 * so nobody mistakes a reconstruction for a record made at the time.
 */
import type { SessionCount, SessionEvent } from '../../models/cashTypes'
import { formatDateTime, formatMoney } from '../../composables/useMoney'

defineProps<{ events: SessionEvent[] }>()

const LABEL: Record<SessionEvent['event'], string> = {
  opened: 'Till opened',
  float_recorded: 'Float recorded',
  suspended: 'Suspended',
  resumed: 'Resumed',
  abandoned: 'Found abandoned',
  counted: 'Counted by the cashier',
  counted_under_supervision: 'Counted under supervision',
  returned: 'Returned for recount',
  verified: 'Verified',
}

function counts(e: SessionEvent): SessionCount[] {
  const list = e.detail.counts ?? (Array.isArray(e.detail.counts_returned) ? e.detail.counts_returned : [])
  return list.filter((c) => c.declared_total !== null)
}

function variance(c: SessionCount): string {
  if (c.variance === null) return ''
  const n = Number(c.variance)
  if (n === 0) return 'agrees'
  return `${n < 0 ? 'short' : 'over'} ${formatMoney(c.variance.replace('-', ''), c.currency, { bare: true })}`
}
</script>

<template>
  <section class="cash-history" aria-label="Session history">
    <h4>History</h4>
    <p v-if="events.length === 0" class="ins-hint">No history recorded.</p>
    <ol v-else>
      <li v-for="e in events" :key="e.id" :class="`is-${e.event}`">
        <span class="cash-history-when">{{ formatDateTime(e.occurred_at) }}</span>
        <span class="cash-history-what">
          <strong>{{ LABEL[e.event] }}</strong>
          <template v-if="e.actor_name"> by {{ e.actor_name }}</template>
          <template v-if="e.witness_name">, witnessed by {{ e.witness_name }}</template>
          <template v-if="e.event === 'float_recorded' && e.detail.opening_float && e.detail.currency">:
            {{ formatMoney(e.detail.opening_float, e.detail.currency) }}</template>
          <span v-if="e.source === 'backfill'" class="cash-history-backfill">reconstructed from the session record</span>
        </span>
        <span v-if="e.reason" class="cash-history-reason">“{{ e.reason }}”</span>
        <span v-for="c in counts(e)" :key="c.currency" class="cash-history-count">
          {{ c.currency }} counted {{ formatMoney(c.declared_total, c.currency, { bare: true }) }}
          against {{ formatMoney(c.expected_takings, c.currency, { bare: true }) }} in receipts
          and {{ formatMoney(c.opening_float, c.currency, { bare: true }) }} float — {{ variance(c) }}<template v-if="c.explanation">: {{ c.explanation }}</template>
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.cash-history h4 {
  margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--ent-text-3);
}
.cash-history ol { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--ent-line); }
.cash-history li {
  position: relative; display: flex; flex-direction: column; gap: 2px;
  padding: 0 0 var(--ent-s3) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text);
}
.cash-history li::before {
  content: ''; position: absolute; left: -5px; top: 6px; width: 8px; height: 8px;
  border-radius: 50%; background: var(--ent-surface); border: 2px solid var(--ent-text-3);
}
.cash-history li.is-abandoned::before, .cash-history li.is-returned::before { border-color: var(--ent-warning); }
.cash-history li.is-verified::before { border-color: var(--ent-success); }
.cash-history-when { font-size: var(--ent-fs-xs); color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.cash-history-reason { font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.cash-history-count { font-size: var(--ent-fs-xs); color: var(--ent-text-2); font-variant-numeric: tabular-nums; }
.cash-history-backfill {
  margin-left: var(--ent-s2); font-size: var(--ent-fs-micro); color: var(--ent-text-3);
  font-style: italic;
}
</style>
