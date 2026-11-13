<script setup lang="ts">
/**
 * What is waiting on this person, above the section they landed in.
 *
 * WHY IT IS A LIST AND NOT A ROW OF METRIC CARDS
 * DESIGN.md names the generic SaaS dashboard — cream, bright blue, a row of big hero-metric
 * numbers — as the anti-reference to avoid most strongly, and PRODUCT.md bans invented placeholder
 * figures. A queue is not a metric: "4" means nothing without "budget lines awaiting your
 * approval", and a council officer's question is never "what is the number" but "what must I do and
 * where". So each row reads as a sentence with its count in front of it, at list weight, and the
 * one piece of accent in the panel is a 2px rule on the rows that need an action.
 *
 * WHY AN EMPTY QUEUE IS A SENTENCE
 * The dev database has four budget lines, one transaction, one project with no location and an
 * empty ward register, and no demo finance data may be created to make these screens look busy. A
 * departmental head with nothing awaiting submission therefore reads "Nothing in your votes is
 * waiting to be submitted" — which is information — rather than a blank panel or a spinner, which
 * are indistinguishable from a broken screen.
 *
 * WHY A FAILED READ IS NOT A ZERO
 * A queue whose count could not be read is listed apart, in words. Zero and unknown are different
 * facts and a finance console is the last place to conflate them.
 *
 * ACCESSIBILITY
 * The count of outstanding items is announced through one polite live region rather than one per
 * row, so a reload says "6 things are waiting on you" instead of reciting six numbers. Every row's
 * state carries a word as well as a tone, so nothing is conveyed by colour alone, and every control
 * is a real button in document order.
 */
import { computed } from 'vue'
import { useFinanceStore } from '../stores/finance'
import type { FinanceQueue } from '../composables/useFinanceQueues'
import type { FinanceSectionKey } from '../stores/rolePreset'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, ShieldAlert } from 'lucide-vue-next'

/**
 * The queues are gathered by the shell, not here, so the rail's counts and this panel's rows come
 * from one set of reads and cannot disagree.
 */
const props = defineProps<{
  queues: FinanceQueue[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  (e: 'open', section: FinanceSectionKey, query?: Record<string, string>): void
  (e: 'reload'): void
}>()

const store = useFinanceStore()

const loading = computed(() => props.loading)
const error = computed(() => props.error)
/** Something to do. */
const actionable = computed(() => props.queues.filter((q) => q.count !== null && q.count > 0))
/** Read cleanly and empty — a result, shown as a sentence. */
const clear = computed(() => props.queues.filter((q) => q.count === 0))
/** Could not be read. Listed apart, because unknown is not zero. */
const unreadable = computed(() => props.queues.filter((q) => q.count === null))
const waiting = computed(() => actionable.value.reduce((n, q) => n + (q.count ?? 0), 0))
const reload = () => emit('reload')

/** The sentence a screen reader is given when the panel refreshes. */
const announcement = computed(() => {
  if (loading.value) return 'Reading what is waiting on you.'
  if (actionable.value.length === 0) return 'Nothing is waiting on you.'
  return `${waiting.value} item${waiting.value === 1 ? '' : 's'} waiting on you, across ${actionable.value.length} queue${actionable.value.length === 1 ? '' : 's'}.`
})

const toneClass: Record<string, string> = {
  action: 'tone-info', watch: 'tone-warning', info: '',
}
</script>

<template>
  <section class="ins-card fin-queue" aria-labelledby="fin-queue-head">
    <div class="ins-card-head">
      <h2 id="fin-queue-head">Your work</h2>
      <button type="button" class="fin-btn small" :disabled="loading" @click="reload">Refresh</button>
    </div>

    <div class="ins-card-body">
      <p class="fin-queue-summary">{{ store.rolePreset.summary }}</p>

      <!-- One live region for the whole panel. Counts are announced; the rows are read on demand. -->
      <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>

      <div v-if="error" class="ins-banner t-negative" role="alert">
        <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
      </div>

      <p v-if="loading && actionable.length === 0 && clear.length === 0" class="fin-queue-loading" role="status">
        Reading what is waiting on you…
      </p>

      <ul v-if="actionable.length" class="fin-queue-list">
        <li v-for="q in actionable" :key="q.id" class="fin-queue-row">
          <p class="fin-queue-count">
            <span class="fin-queue-number">{{ q.count }}</span>
            <span class="fin-pill" :class="toneClass[q.tone]">{{ q.toneLabel }}</span>
          </p>
          <div class="fin-queue-text">
            <h3 class="fin-queue-label">{{ q.label }}</h3>
            <p class="fin-queue-help">{{ q.help }}</p>
            <p v-if="q.caveat" class="fin-queue-caveat">
              <ShieldAlert :size="13" aria-hidden="true" /><span>{{ q.caveat }}</span>
            </p>
          </div>
          <button type="button" class="fin-btn small fin-queue-go"
                  @click="emit('open', q.section, q.query)">
            Open
            <span class="sr-only"> {{ q.label }}</span>
            <ArrowRight :size="13" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <!-- Nothing waiting is a result, stated plainly. It is never a blank panel. -->
      <div v-else-if="!loading && clear.length" class="fin-queue-allclear">
        <p>
          <CheckCircle2 :size="15" aria-hidden="true" />
          <span>Nothing is waiting on you in {{ store.selectedYear?.label ?? 'this period' }}.</span>
        </p>
      </div>

      <div v-if="clear.length" class="fin-queue-clear">
        <p class="fin-queue-clear-head">Checked and clear</p>
        <ul>
          <li v-for="q in clear" :key="q.id">{{ q.empty }}</li>
        </ul>
      </div>

      <div v-if="unreadable.length" class="ins-banner t-warning" role="status">
        <AlertTriangle :size="16" aria-hidden="true" />
        <span>
          {{ unreadable.map((q) => q.label.toLowerCase()).join('; ') }} could not be read, so no
          count is shown for {{ unreadable.length === 1 ? 'it' : 'them' }}. That is not the same as
          nothing being there.
        </span>
      </div>

      <div v-if="!loading && !error && actionable.length === 0 && clear.length === 0 && unreadable.length === 0"
           class="fin-empty">
        <strong>There is no queue for your role in this period.</strong>
        <p>
          Your permissions do not place you in any of the workspace's handovers — preparation,
          approval, import commit or publication. The sections on your rail are still open to you,
          and Permissions lists what your role may do and which duties are held apart from it.
        </p>
      </div>

      <!-- The absences that look like defects from the inside, said out loud rather than hidden. -->
      <p v-for="note in store.absenceNotes" :key="note" class="fin-queue-absence">
        <Info :size="14" aria-hidden="true" /><span>{{ note }}</span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.fin-queue-summary {
  margin: 0 0 var(--ent-s3);
  max-width: 80ch;
  font-size: var(--ent-fs-sm);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
}
.fin-queue-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

.fin-queue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.fin-queue-row {
  display: grid;
  grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--ent-s3);
  padding: var(--ent-s3);
  border-left: 2px solid var(--ent-accent);
  background: var(--ent-surface-2);
  border-radius: 0 var(--ent-r-sm) var(--ent-r-sm) 0;
}
.fin-queue-count { margin: 0; display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s1); }
.fin-queue-number {
  font-variant-numeric: tabular-nums;
  font-size: var(--ent-fs-lg);
  font-weight: var(--ent-fw-semibold);
  line-height: 1.1;
  color: var(--ent-text);
}
.fin-queue-text { min-width: 0; }
.fin-queue-label { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.fin-queue-help { margin: var(--ent-s1) 0 0; max-width: 72ch; font-size: var(--ent-fs-xs); line-height: var(--ent-lh); color: var(--ent-text-2); }
.fin-queue-caveat {
  margin: var(--ent-s2) 0 0; display: flex; align-items: flex-start; gap: var(--ent-s2);
  max-width: 72ch; font-size: var(--ent-fs-xs); line-height: var(--ent-lh); color: var(--ent-text-2);
  padding-left: var(--ent-s2); border-left: 1px solid var(--ent-line);
}
.fin-queue-go { align-self: center; white-space: nowrap; }

.fin-queue-allclear p {
  margin: 0; display: flex; align-items: center; gap: var(--ent-s2);
  font-size: var(--ent-fs-sm); color: var(--ent-text);
}
.fin-queue-clear { margin-top: var(--ent-s3); }
.fin-queue-clear-head {
  margin: 0 0 var(--ent-s1);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3);
}
.fin-queue-clear ul { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 2px; }
.fin-queue-clear li { font-size: var(--ent-fs-xs); line-height: var(--ent-lh); color: var(--ent-text-3); }

.fin-queue-absence {
  margin: var(--ent-s3) 0 0; display: flex; align-items: flex-start; gap: var(--ent-s2);
  max-width: 80ch; font-size: var(--ent-fs-xs); line-height: var(--ent-lh); color: var(--ent-text-2);
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 719px) {
  .fin-queue-row { grid-template-columns: minmax(0, 1fr); }
  .fin-queue-count { flex-direction: row; align-items: center; }
  .fin-queue-go { align-self: flex-start; }
}
</style>
