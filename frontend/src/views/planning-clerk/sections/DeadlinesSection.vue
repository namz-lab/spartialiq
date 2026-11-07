<script setup lang="ts">
// Statutory deadlines — every clock the council is answerable for, in one list.
//
// WHY ONE SCREEN AND NOT FIVE
// Five rules, five tables. The acknowledgement is five working days, the
// determination is three months, the refusal is seven calendar days, the
// objection window closes on a date the newspaper fixed, and the paper file
// is due back when somebody said it would be. Leaving each one in the section
// that happens to own its table is how a five-day acknowledgement is missed
// while the clerk is working the refusal queue. A clerk arriving in the
// morning needs one list, sorted by date, with the late ones at the top.
//
// THE CLOCK IS THE SERVER'S
// `days_left` and `overdue` are computed in the database, not here. A browser
// with a wrong date would otherwise show a deadline as met when it is not,
// and on a shared council machine that is not a hypothetical.

import { computed, onActivated, onMounted, ref } from 'vue'
import { useClerkNav, useClerkPreferences } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { HORIZON_CHOICES, formatDate } from '@/planning-clerk/console'
import type { Deadline, DeadlineKind } from '@/services/planningClerk'
import type { SectionKey } from '@/planning-clerk/console'
import UiButton from '@/components/ui/UiButton.vue'
import {
  AlarmClock, Mail, Scale, Gavel, Megaphone, FolderInput,
  AlertTriangle, CheckCircle2, RefreshCw, FolderOpen,
} from 'lucide-vue-next'

const nav = useClerkNav()
const { prefs, set } = useClerkPreferences()
const overview = useClerkOverview()

/** What each kind of deadline is, where it is worked, and what marks it. */
const KIND: Record<DeadlineKind, { label: string; icon: typeof Mail; section: SectionKey }> = {
  acknowledgement: { label: 'Acknowledgement letter', icon: Mail, section: 'acknowledgements' },
  determination: { label: 'Determination', icon: Gavel, section: 'register' },
  refusal: { label: 'Refusal letter', icon: Scale, section: 'refusals' },
  objection_window: { label: 'Objection period', icon: Megaphone, section: 'notices' },
  file_return: { label: 'File due back', icon: FolderInput, section: 'movements' },
}

const KIND_ORDER: DeadlineKind[] = [
  'acknowledgement', 'refusal', 'determination', 'objection_window', 'file_return',
]

const kindFilter = ref<DeadlineKind | 'all'>(
  (nav.param('kind') as DeadlineKind) || 'all')

function setKind(next: DeadlineKind | 'all') {
  kindFilter.value = next
  nav.setParam('kind', next === 'all' ? null : next)
}

function setHorizon(days: number) {
  set('deadlineHorizonDays', days)
  void overview.refreshDeadlines(days, true)
}

// Judged against the clock, so re-read on arrival rather than only on the
// first mount: a console left open over lunch shows stale deadlines, and
// stale is the one thing a deadline must not be.
onMounted(() => { void overview.refreshDeadlines(prefs.value.deadlineHorizonDays) })
onActivated(() => { void overview.refreshDeadlines(prefs.value.deadlineHorizonDays, true) })

const all = computed<Deadline[]>(() => overview.deadlines.value)

const shown = computed(() => (kindFilter.value === 'all'
  ? all.value
  : all.value.filter((d) => d.kind === kindFilter.value)))

const counts = computed(() => {
  const acc: Record<string, number> = { all: all.value.length }
  for (const k of KIND_ORDER) acc[k] = all.value.filter((d) => d.kind === k).length
  return acc
})

/**
 * Three buckets, in the order a clerk acts on them.
 *
 * Not a flat list sorted by date: "four days overdue" and "due in three
 * weeks" are different kinds of work, and a single list makes the reader do
 * the separating every morning.
 */
const buckets = computed(() => {
  const late = shown.value.filter((d) => d.overdue)
  const soon = shown.value.filter((d) => !d.overdue && d.days_left <= 3)
  const ahead = shown.value.filter((d) => !d.overdue && d.days_left > 3)
  return [
    { key: 'late', title: 'Past the date', tone: 'negative' as const, rows: late },
    { key: 'soon', title: 'Within three days', tone: 'warning' as const, rows: soon },
    { key: 'ahead', title: 'Ahead', tone: 'neutral' as const, rows: ahead },
  ].filter((b) => b.rows.length)
})

function openDeadline(d: Deadline) {
  if (d.permit_application_id) nav.openFile(d.permit_application_id)
  nav.go(KIND[d.kind].section)
}

function dueLabel(d: Deadline): string {
  if (d.overdue) {
    const n = Math.abs(d.days_left)
    return `${n} day${n === 1 ? '' : 's'} overdue`
  }
  if (d.days_left === 0) return 'Due today'
  return `Due in ${d.days_left} day${d.days_left === 1 ? '' : 's'}`
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Statutory clocks</span>
        <h2 class="ins-title">Statutory deadlines</h2>
        <p class="ins-lede">
          Five rules across five registers, in one list. Dates are computed by
          the server, from the database’s clock rather than this machine’s.
        </p>
      </div>
      <div class="ins-actions">
        <div class="ins-seg" role="group" aria-label="How far ahead to look">
          <button v-for="d in HORIZON_CHOICES" :key="d" type="button"
                  :aria-pressed="prefs.deadlineHorizonDays === d" @click="setHorizon(d)">
            {{ d }}d
          </button>
        </div>
        <UiButton size="sm" variant="ghost" :disabled="overview.deadlinesLoading.value"
                  @click="overview.refreshDeadlines(prefs.deadlineHorizonDays, true)">
          <template #icon>
            <RefreshCw :size="14" :class="{ 'ins-spin': overview.deadlinesLoading.value }" />
          </template>
          Refresh
        </UiButton>
      </div>
    </header>

    <p v-if="overview.deadlinesError.value" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ overview.deadlinesError.value }}</span>
    </p>

    <div class="ins-chips" role="group" aria-label="Filter by rule">
      <button type="button" class="ins-chip" :aria-pressed="kindFilter === 'all'"
              @click="setKind('all')">
        Everything<span class="ins-chip-n">{{ counts.all }}</span>
      </button>
      <button v-for="k in KIND_ORDER" :key="k" type="button" class="ins-chip"
              :aria-pressed="kindFilter === k" @click="setKind(k)">
        {{ KIND[k].label }}<span class="ins-chip-n">{{ counts[k] }}</span>
      </button>
    </div>

    <div v-if="overview.deadlinesLoading.value && !all.length" class="clk-dl-load" aria-busy="true">
      <span v-for="n in 5" :key="n" class="ins-skel" />
      <span class="ent-sr-only">Reading the statutory deadlines</span>
    </div>

    <section v-for="bucket in buckets" :key="bucket.key" class="ins-card">
      <header class="ins-card-head">
        <h3>
          <AlarmClock :size="15" aria-hidden="true" />
          {{ bucket.title }}
          <span class="ins-count">{{ bucket.rows.length }}</span>
        </h3>
      </header>
      <ul class="ins-rows">
        <li v-for="d in bucket.rows" :key="`${d.kind}:${d.id}`" class="ins-row clk-dl-row"
            :class="`t-${bucket.tone}`">
          <span class="clk-dl-icon" :class="`t-${bucket.tone}`">
            <component :is="KIND[d.kind].icon" :size="15" aria-hidden="true" />
          </span>
          <div class="ins-row-main">
            <span class="ins-row-title">
              {{ KIND[d.kind].label }}
              <span class="clk-dl-ref ins-mono">
                {{ d.tpd_reference || d.reference || '—' }}
              </span>
            </span>
            <span class="ins-row-meta">
              {{ d.applicant_name || d.party || '—' }}
              <template v-if="d.stand_number"> · Stand {{ d.stand_number }}</template>
              · due {{ formatDate(d.due_at) }}
            </span>
            <!-- The rule itself, in words. A clerk should not have to
                 remember which of five periods this row is counting. -->
            <span class="clk-dl-rule">{{ d.rule }}</span>
          </div>
          <span class="clk-dl-due" :class="`t-${bucket.tone}`">{{ dueLabel(d) }}</span>
          <UiButton size="sm" variant="secondary" @click="openDeadline(d)">
            <template #icon><FolderOpen :size="13" /></template>
            Work it
          </UiButton>
        </li>
      </ul>
    </section>

    <div v-if="!overview.deadlinesLoading.value && !shown.length" class="clk-dl-clear">
      <CheckCircle2 :size="26" aria-hidden="true" />
      <p v-if="kindFilter !== 'all'">
        Nothing of that kind falls inside the next
        {{ prefs.deadlineHorizonDays }} days.
      </p>
      <p v-else>
        Nothing is due inside the next {{ prefs.deadlineHorizonDays }} days, and
        nothing is past its date. Widen the horizon to look further out.
      </p>
    </div>
  </div>
</template>

<style scoped>
.clk-dl-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-dl-load .ins-skel:nth-child(even) { width:76%; }

.clk-dl-row { align-items:flex-start; gap:var(--ent-s3); }
/* A hairline on the left rather than a filled row: the colour has to say
   "late" without turning a morning's work into a wall of red. */
.clk-dl-row.t-negative { box-shadow:inset 3px 0 0 var(--ent-danger); }
.clk-dl-row.t-warning { box-shadow:inset 3px 0 0 var(--ent-warning); }

.clk-dl-icon { display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; flex-shrink:0; margin-top:2px;
  border-radius:var(--ent-r); color:var(--ent-tone-neutral-fg);
  background:var(--ent-tone-neutral-bg); }
.clk-dl-icon.t-negative { color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }
.clk-dl-icon.t-warning { color:var(--ent-tone-warning-fg); background:var(--ent-tone-warning-bg); }

.clk-dl-ref { margin-left:var(--ent-s2); font-weight:var(--ent-fw-normal);
  color:var(--ent-text-2); font-size:var(--ent-fs-xs); }
.clk-dl-rule { display:block; margin-top:2px; font-size:var(--ent-fs-micro);
  color:var(--ent-text-3); line-height:var(--ent-lh); }

.clk-dl-due { flex-shrink:0; font-size:var(--ent-fs-xs);
  font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums;
  color:var(--ent-text-2); white-space:nowrap; }
.clk-dl-due.t-negative { color:var(--ent-danger); }
.clk-dl-due.t-warning { color:var(--ent-warning); }

.clk-dl-clear { display:flex; flex-direction:column; align-items:center;
  gap:var(--ent-s3); padding:var(--ent-s8) var(--ent-s4); text-align:center;
  color:var(--ent-success); }
.clk-dl-clear p { margin:0; max-width:40ch; font-size:var(--ent-fs-sm);
  color:var(--ent-text-2); line-height:var(--ent-lh); }

@media (max-width: 767px) {
  .clk-dl-row { flex-wrap:wrap; }
  .clk-dl-due { order:3; width:100%; }
}
</style>
