<script setup lang="ts">
// The EO's day, in the order it matters.
//
//   1. what the statutory clock says — cases near, and past, deemed refusal
//   2. what is waiting on the EO personally — determinations and returns
//   3. where everything else is sitting, as a way into it
//
// It reads the shared workload (src/eo-planner/useEoWorkload), which loads the
// working set once for the whole console. This section used to call the permit
// register five times on mount for five queues cut from the same list, and the
// rail then called it again.
//
// Every row opens the case AND goes to the section that does the next piece of
// work on it, so the dashboard is a way into the work rather than a poster
// about it.

import { computed } from 'vue'
import { useEoWorkload } from '@/eo-planner/useEoWorkload'
import { useEoNav } from '@/eo-planner/useEoNav'
import { useEoPreferences } from '@/eo-planner/useEoPreferences'
import { nextStepFor, type SectionKey } from '@/eo-planner/console'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { fmtDate } from '@/utils/dates'
import type { EoCase } from '@/services/developmentManagementService'
import {
  Briefcase, RefreshCw, Clock, AlertTriangle, Gavel, CornerUpLeft, Send,
  Megaphone, Users, Inbox, ArrowRight, CheckCircle2,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const workload = useEoWorkload()
const nav = useEoNav()
const { prefs } = useEoPreferences()

// The dashboard is judged against the clock, so it re-reads when the officer
// comes back to it or wakes the machine — not once per session.
const { refreshNow } = useStaleRefresh(() => workload.refresh())

const warning = computed(() => prefs.value.clockWarningDays)

function open(c: EoCase) {
  const step = nextStepFor(c.status)
  nav.go((step?.section ?? 'decision') as SectionKey, { case: c.id })
}

function caseRef(c: EoCase): string {
  return c.dev_register_no || c.tpd_reference || c.id.slice(0, 8).toUpperCase()
}

const tiles = computed(() => [
  { key: 'decision' as SectionKey, label: 'Awaiting your determination',
    n: workload.awaitingDecision.value.length, icon: Gavel, tone: 'accent' },
  { key: 'circulation' as SectionKey, label: 'Out with departments',
    n: workload.circulation.value.length, icon: Send, tone: 'plain' },
  { key: 'notification' as SectionKey, label: 'On public notice',
    n: workload.notification.value.length, icon: Megaphone, tone: 'plain' },
  { key: 'committee' as SectionKey, label: 'For committee',
    n: workload.forCommittee.value.length, icon: Users, tone: 'plain' },
  { key: 'intake' as SectionKey, label: 'Awaiting intake check',
    n: workload.intake.value.length, icon: Inbox, tone: 'plain' },
  { key: 'decision' as SectionKey, label: 'Past the three months',
    n: workload.breached.value.length, icon: AlertTriangle,
    tone: workload.breached.value.length ? 'danger' : 'plain' },
])
</script>

<template>
  <div class="ins-page db">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Executive Officer — Planning</span>
        <h2 class="ins-title"><Briefcase :size="18" aria-hidden="true" /> Today</h2>
        <p class="ins-lede">
          Section 26(7) gives the council three months from acknowledgement to determine an
          application. Everything below is ordered by how much of that is left.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="workload.loading.value"
                title="Re-read the queues" @click="refreshNow">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': workload.loading.value }" />
          <span class="ent-sr-only">Re-read the queues</span>
        </button>
      </div>
    </header>

    <div v-if="workload.error.value" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>The queues could not be read.</strong>
        <p>{{ workload.error.value }} Figures below may be out of date.</p>
      </div>
      <button type="button" class="db-btn" @click="refreshNow">Try again</button>
    </div>

    <!-- Where the work is -->
    <div class="ins-kpis">
      <button v-for="t in tiles" :key="t.label" type="button"
              class="db-tile" :class="`tone-${t.tone}`" @click="nav.go(t.key)">
        <component :is="t.icon" :size="15" aria-hidden="true" class="db-tile-ico" />
        <span class="db-tile-n">{{ t.n }}</span>
        <span class="db-tile-l">{{ t.label }}</span>
      </button>
    </div>

    <!-- 1. The clock -->
    <section class="ins-card">
      <header class="ins-card-head">
        <h3><Clock :size="15" aria-hidden="true" /> Against the clock</h3>
        <span class="ins-count">within {{ warning }} days of deemed refusal</span>
      </header>

      <p v-if="workload.loading.value && !workload.cases.value.length" class="db-msg">
        Reading the queues…
      </p>
      <div v-else-if="!workload.urgent.value.length" class="db-clear">
        <CheckCircle2 :size="18" aria-hidden="true" />
        <p>
          No case is inside the {{ warning }}-day window. That window is this council's
          choice and can be widened in Settings.
        </p>
      </div>
      <ul v-else class="ins-rows">
        <li v-for="c in workload.urgent.value" :key="c.id">
          <button type="button" class="ins-row db-row" @click="open(c)">
            <span class="ins-row-main">
              <span class="ins-row-title">
                <span class="ins-mono">{{ caseRef(c) }}</span> · {{ c.applicant_name }}
              </span>
              <span class="ins-row-meta">
                Stand {{ c.stand_number }}<template v-if="c.suburb_ward"> · {{ c.suburb_ward }}</template>
                · {{ statusLabel(c.status) }} · received {{ fmtDate(c.received_at) }}
              </span>
            </span>
            <span class="db-clock" :class="`t-${workload.clockFor(c).tone}`">
              <Clock :size="11" aria-hidden="true" /> {{ workload.clockFor(c).label }}
            </span>
            <ArrowRight :size="14" aria-hidden="true" class="db-go" />
          </button>
        </li>
      </ul>
    </section>

    <div class="db-cols">
      <!-- 2. Waiting on the EO -->
      <section class="ins-card">
        <header class="ins-card-head">
          <h3><Gavel :size="15" aria-hidden="true" /> Waiting on you</h3>
          <span class="ins-count">{{ workload.awaitingDecision.value.length }}</span>
        </header>
        <p v-if="!workload.awaitingDecision.value.length" class="db-msg">
          Nothing is waiting for a determination.
        </p>
        <ul v-else class="ins-rows">
          <li v-for="c in workload.awaitingDecision.value.slice(0, 8)" :key="c.id">
            <button type="button" class="ins-row db-row"
                    @click="nav.go('decision', { case: c.id })">
              <span class="ins-row-main">
                <span class="ins-row-title"><span class="ins-mono">{{ caseRef(c) }}</span></span>
                <span class="ins-row-meta">
                  {{ c.applicant_name }} · Stand {{ c.stand_number }}
                  <template v-if="c.handoff_recommendation">
                    · planner recommends {{ c.handoff_recommendation.replace(/_/g, ' ') }}
                  </template>
                </span>
              </span>
              <span class="db-clock" :class="`t-${workload.clockFor(c).tone}`">
                {{ workload.clockFor(c).label }}
              </span>
            </button>
          </li>
        </ul>
        <footer v-if="workload.awaitingDecision.value.length > 8" class="ins-card-foot">
          <button type="button" class="db-btn" @click="nav.go('decision')">
            See all {{ workload.awaitingDecision.value.length }}
          </button>
        </footer>
      </section>

      <!-- 3. Sent back -->
      <section class="ins-card">
        <header class="ins-card-head">
          <h3><CornerUpLeft :size="15" aria-hidden="true" /> Sent back for more work</h3>
          <span class="ins-count">{{ workload.returned.value.length }}</span>
        </header>
        <p v-if="!workload.returned.value.length" class="db-msg">
          Nothing has been returned to another officer.
        </p>
        <ul v-else class="ins-rows">
          <li v-for="c in workload.returned.value.slice(0, 8)" :key="c.id">
            <button type="button" class="ins-row db-row"
                    @click="nav.go('decision', { case: c.id })">
              <span class="ins-row-main">
                <span class="ins-row-title"><span class="ins-mono">{{ caseRef(c) }}</span></span>
                <span class="ins-row-meta">
                  with {{ (c.returned_to_role || 'an officer').replace(/_/g, ' ') }}
                  since {{ fmtDate(c.handoff_submitted_at) }}
                </span>
              </span>
              <span class="db-clock" :class="`t-${workload.clockFor(c).tone}`">
                {{ workload.clockFor(c).label }}
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.db-tile { display:flex; flex-direction:column; align-items:flex-start; gap:2px;
  padding:var(--ent-s3) var(--ent-s4); text-align:left; cursor:pointer;
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md);
  font-family:var(--ent-font);
  transition:border-color var(--ent-dur) var(--ent-ease), background-color var(--ent-dur) var(--ent-ease); }
.db-tile:hover { border-color:var(--ent-line-strong); background:var(--ent-surface-2); }
.db-tile:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.db-tile-ico { color:var(--ent-text-3); }
.db-tile-n { font-size:var(--ent-fs-num); font-weight:var(--ent-fw-bold); line-height:1.1;
  font-variant-numeric:tabular-nums; color:var(--ent-text); }
.db-tile-l { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.db-tile.tone-accent { border-color:var(--ent-accent-line); background:var(--ent-accent-soft); }
.db-tile.tone-accent .db-tile-ico, .db-tile.tone-accent .db-tile-n { color:var(--ent-accent); }
.db-tile.tone-danger { border-color:var(--ent-tone-negative-line); background:var(--ent-tone-negative-bg); }
.db-tile.tone-danger .db-tile-ico, .db-tile.tone-danger .db-tile-n { color:var(--ent-tone-negative-fg); }

.db-row { width:100%; background:none; border:0; text-align:left; cursor:pointer;
  font-family:var(--ent-font); }
.db-row:hover { background:var(--ent-surface-2); }
.db-row:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.db-go { color:var(--ent-text-3); flex-shrink:0; }

.db-clock { display:inline-flex; align-items:center; gap:4px; flex-shrink:0; white-space:nowrap;
  padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.db-clock.t-caution { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.db-clock.t-urgent, .db-clock.t-expired { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }

.db-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(20rem, 1fr)); gap:var(--ent-s4); }

.db-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.db-clear { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s5) var(--ent-s4); color:var(--ent-success); }
.db-clear p { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); }

.db-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; }
.db-btn:hover { background:var(--ent-surface-2); }
.db-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
</style>
