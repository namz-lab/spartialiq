<script setup lang="ts">
// EHO Dashboard — what needs the officer today, in the order it matters.
//
// Deliberately a work queue, not a wall of metric tiles. A cholera cluster and
// a crèche certificate expiring next month are not the same size of problem,
// and a grid of equal-weight numbers presents them as if they were. The queue
// ranks by public-health consequence: disease first, then unsafe water, then
// owed return visits, then the register's backlog, then paperwork.
//
// Counters come from GET /eho/summary (one round trip, computed where the rows
// are). The lists beneath come from the offline-first registers, so the
// dashboard still shows the district's open outbreaks with no connection.

import { computed, onMounted, ref, type Component } from 'vue'
import { useHealthCase } from '@/composables/useHealthCase'
import { useAuthStore } from '@/stores/auth'
import { ehoOpsApi, PROGRAMME_LABELS, INSPECTION_SCOPE_LABELS, type FieldProgramme } from '@/services/environmentalHealthOps'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { useEhoPreferences } from '@/environment-officer/useEhoPreferences'
import { isOverdue, fmtDate, daysSince, humanise, isoDay, type SectionKey, wardLabel } from '@/environment-officer/console'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  AlertTriangle, Droplet, CalendarClock, Building, Stamp, BadgeCheck, Truck, MessageSquareWarning,
  ChevronRight, CheckCircle2, Plus, Activity, ClipboardCheck, ShieldAlert,
} from 'lucide-vue-next'

const hc = useHealthCase()
const nav = useEhoNav()
const auth = useAuthStore()
const { prefs } = useEhoPreferences()

const s = computed(() => hc.summary.value)
const cycle = computed(() => prefs.value.inspectionCycleDays)

// ── Attention queue ─────────────────────────────────────────────────
type Tone = 'negative' | 'warning' | 'info'
interface Item {
  key: string; tone: Tone; icon: Component; count: number
  title: string; detail: string; section: SectionKey; scoped?: Record<string, string>
}

const queue = computed<Item[]>(() => {
  const v = s.value
  if (!v) return []
  const items: Item[] = [
    { key: 'outbreaks', tone: 'negative', icon: AlertTriangle, count: v.outbreaksOpen,
      title: v.outbreaksOpen === 1 ? 'Open disease outbreak' : 'Open disease outbreaks',
      detail: `${v.outbreakCasesOpen} case${v.outbreakCasesOpen === 1 ? '' : 's'} under investigation or containment`,
      section: 'surveillance', scoped: { tab: 'outbreaks' } },
    { key: 'water', tone: 'negative', icon: Droplet, count: v.waterFailing90d,
      title: 'Water sources failing',
      detail: 'Not-potable results in the last 90 days — confirm the source is protected or closed',
      section: 'surveillance', scoped: { tab: 'water' } },
    { key: 'followups', tone: 'warning', icon: CalendarClock, count: v.followUpsDue,
      title: 'Return visits due',
      detail: 'Failed or conditional inspections whose follow-up date has arrived',
      section: 'inspections', scoped: { tab: 'followups' } },
    { key: 'notices', tone: 'warning', icon: ShieldAlert, count: v.noticesOverdue,
      title: v.noticesOverdue === 1 ? 'Notice past its compliance date' : 'Notices past their compliance date',
      detail: 'Re-inspect, extend or escalate — an expired notice left open is not enforced',
      section: 'enforcement' },
    { key: 'complaints', tone: 'warning', icon: MessageSquareWarning, count: v.complaintsOpen,
      title: 'Nuisance complaints open',
      detail: 'Received or under investigation, not yet abated',
      section: 'surveillance', scoped: { tab: 'complaints' } },
    { key: 'overdue', tone: 'warning', icon: Building, count: v.premisesOverdue,
      title: 'Premises overdue for inspection',
      detail: `Not inspected within the ${v.overdueDays}-day cycle, or never inspected`,
      section: 'inspections' },
    { key: 'clearances', tone: 'info', icon: Stamp, count: v.clearancesPending,
      title: 'Licence clearances awaiting decision',
      detail: 'A licence cannot be granted until you decide',
      section: 'licensing' },
    { key: 'programmes', tone: 'info', icon: Truck, count: v.programmesDue,
      title: 'Programme rounds due',
      detail: 'Planned or in progress, scheduled on or before today',
      section: 'programmes' },
    { key: 'expired', tone: 'warning', icon: BadgeCheck, count: v.handlerCertsExpired,
      title: 'Food-handler certificates expired',
      detail: `${v.handlerCertsExpiring30d} more expire within 30 days`,
      section: 'certificates', scoped: { tab: 'handlers' } },
  ]
  return items.filter(i => i.count > 0)
})

const allClear = computed(() => s.value !== null && queue.value.length === 0)

// ── Lists from the registers ────────────────────────────────────────
const openOutbreaks = computed(() =>
  hc.outbreaks.value
    .filter(o => o.status !== 'closed')
    .sort((a, b) => b.casesCount - a.casesCount || +new Date(b.firstReportedAt) - +new Date(a.firstReportedAt))
    .slice(0, 5))

const duePremises = computed(() =>
  hc.registry.value
    .filter(p => isOverdue(p.last_inspected_at, cycle.value))
    // Never-inspected first, then the longest gap.
    .sort((a, b) => (daysSince(b.last_inspected_at) ?? Infinity) - (daysSince(a.last_inspected_at) ?? Infinity))
    .slice(0, 6))

const recentInspections = computed(() =>
  [...hc.inspections.value]
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt))
    .slice(0, 6))

// ── Today's rounds ──────────────────────────────────────────────────
const rounds = ref<FieldProgramme[]>([])
const roundsError = ref(false)
onMounted(async () => {
  try {
    const [planned, running] = await Promise.all([
      ehoOpsApi.listProgrammes({ status: 'planned', to: isoDay(), limit: 20 }),
      ehoOpsApi.listProgrammes({ status: 'in_progress', limit: 20 }),
    ])
    rounds.value = [...running, ...planned].slice(0, 5)
  } catch {
    roundsError.value = true
  }
})

const greeting = computed(() => {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const first = (auth.userName || '').trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
})
const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function outbreakTone(status: string) {
  return status === 'investigating' ? 'negative' : 'warning'
}
</script>

<template>
  <div class="ins-page eds">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">{{ today }}</span>
        <h2 class="ins-title">{{ greeting }}</h2>
        <p class="ins-lede">
          <template v-if="s">
            {{ s.premises }} premises on the register ·
            {{ s.outbreaksOpen }} open outbreak{{ s.outbreaksOpen === 1 ? '' : 's' }} ·
            {{ s.complaintsOpen }} open complaint{{ s.complaintsOpen === 1 ? '' : 's' }}
          </template>
          <template v-else-if="hc.syncState.value === 'offline'">
            Working from this device's copy of the registers. Counters return when the connection does.
          </template>
          <template v-else>Reading the registers…</template>
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="eds-quick" @click="nav.go('inspections')">
          <ClipboardCheck :size="15" aria-hidden="true" /> Record inspection
        </button>
        <button type="button" class="eds-quick" @click="nav.go('surveillance', { tab: 'complaints' })">
          <Plus :size="15" aria-hidden="true" /> Log complaint
        </button>
      </div>
    </header>

    <!-- Needs attention -->
    <section class="ins-card" aria-labelledby="eds-attn">
      <div class="ins-card-head">
        <h3 id="eds-attn"><Activity :size="16" aria-hidden="true" /> Needs attention</h3>
        <span v-if="queue.length" class="ins-count">{{ queue.length }} item{{ queue.length === 1 ? '' : 's' }}</span>
      </div>

      <ul v-if="!s" class="ins-rows" aria-busy="true">
        <li v-for="n in 4" :key="n" class="ins-row"><span class="ins-skel" style="width:60%" /></li>
      </ul>

      <div v-else-if="allClear" class="eds-clear">
        <CheckCircle2 :size="20" aria-hidden="true" />
        <div>
          <strong>Nothing is waiting on you.</strong>
          <p>No open outbreaks, failing water sources, overdue return visits or pending clearances.</p>
        </div>
      </div>

      <ul v-else class="ins-rows">
        <li v-for="item in queue" :key="item.key">
          <button type="button" class="eds-q" :class="`t-${item.tone}`"
                  @click="nav.go(item.section, item.scoped)">
            <span class="eds-q-icon"><component :is="item.icon" :size="16" aria-hidden="true" /></span>
            <span class="eds-q-count">{{ item.count }}</span>
            <span class="ins-row-main">
              <span class="ins-row-title">{{ item.title }}</span>
              <span class="ins-row-meta">{{ item.detail }}</span>
            </span>
            <ChevronRight :size="16" class="eds-q-go" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>

    <div class="eds-grid">
      <!-- Open outbreaks -->
      <section class="ins-card" aria-labelledby="eds-ob">
        <div class="ins-card-head">
          <h3 id="eds-ob"><AlertTriangle :size="16" aria-hidden="true" /> Open outbreaks</h3>
          <button type="button" class="eds-link" @click="nav.go('surveillance', { tab: 'outbreaks' })">All</button>
        </div>
        <p v-if="!openOutbreaks.length" class="eds-empty">
          No open outbreaks. A notifiable condition is logged from Surveillance the moment it is reported.
        </p>
        <ul v-else class="ins-rows">
          <li v-for="o in openOutbreaks" :key="o.id" class="ins-row">
            <span class="ins-row-main">
              <span class="ins-row-title">{{ humanise(o.disease) }} · {{ wardLabel(o.ward) }}</span>
              <span class="ins-row-meta">
                {{ o.casesCount }} case{{ o.casesCount === 1 ? '' : 's' }} · since {{ fmtDate(o.firstReportedAt) }}
                · {{ o.suspectedSource }}
              </span>
            </span>
            <UiStatusBadge :tone="outbreakTone(o.status)" :label="humanise(o.status)" />
          </li>
        </ul>
      </section>

      <!-- Due for inspection -->
      <section class="ins-card" aria-labelledby="eds-due">
        <div class="ins-card-head">
          <h3 id="eds-due"><Building :size="16" aria-hidden="true" /> Due for inspection</h3>
          <span class="ins-count">{{ cycle }}-day cycle</span>
        </div>
        <p v-if="!duePremises.length" class="eds-empty">
          Every premises on the register has been inspected within the {{ cycle }}-day cycle.
        </p>
        <ul v-else class="ins-rows">
          <li v-for="p in duePremises" :key="p.id">
            <button type="button" class="eds-rowbtn" @click="nav.go('inspections', { premises: p.id })">
              <span class="ins-row-main">
                <span class="ins-row-title">{{ p.name }}</span>
                <span class="ins-row-meta">{{ humanise(p.type) }} · Stand {{ p.stand_number || '—' }} · {{ p.suburb_ward || '—' }}</span>
              </span>
              <span class="eds-age" :class="{ never: !p.last_inspected_at }">
                {{ p.last_inspected_at ? `${daysSince(p.last_inspected_at)} days` : 'Never' }}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <!-- Rounds -->
      <section class="ins-card" aria-labelledby="eds-rounds">
        <div class="ins-card-head">
          <h3 id="eds-rounds"><Truck :size="16" aria-hidden="true" /> Programme rounds</h3>
          <button type="button" class="eds-link" @click="nav.go('programmes')">Plan</button>
        </div>
        <p v-if="roundsError" class="eds-empty">Rounds could not be loaded. They will show when the connection returns.</p>
        <p v-else-if="!rounds.length" class="eds-empty">No rounds scheduled for today or running.</p>
        <ul v-else class="ins-rows">
          <li v-for="r in rounds" :key="r.id" class="ins-row">
            <span class="ins-row-main">
              <span class="ins-row-title">{{ r.title }}</span>
              <span class="ins-row-meta">{{ PROGRAMME_LABELS[r.programmeType] }} · {{ wardLabel(r.ward) }} · {{ fmtDate(r.scheduledFor) }}</span>
            </span>
            <UiStatusBadge :status="r.status" />
          </li>
        </ul>
      </section>

      <!-- Recent inspections -->
      <section class="ins-card" aria-labelledby="eds-recent">
        <div class="ins-card-head">
          <h3 id="eds-recent"><ClipboardCheck :size="16" aria-hidden="true" /> Recent inspections</h3>
        </div>
        <p v-if="!recentInspections.length" class="eds-empty">No inspections recorded yet.</p>
        <ul v-else class="ins-rows">
          <li v-for="i in recentInspections" :key="i.id">
            <button type="button" class="eds-rowbtn" @click="nav.go('inspections', { premises: i.premisesId })">
              <span class="ins-row-main">
                <span class="ins-row-title">{{ i.premisesName || 'Premises' }}</span>
                <span class="ins-row-meta">
                  {{ INSPECTION_SCOPE_LABELS[i.scope] }} · {{ fmtDate(i.inspectedAt) }} · {{ i.inspectorName }}
                  <template v-if="i.pendingSync"> · not yet sent</template>
                </span>
              </span>
              <UiStatusBadge :status="i.verdict === 'conditional' ? 'conditional_pass' : i.verdict" />
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.eds-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap:var(--ent-s4); }

.eds-quick { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-s4);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line-strong);
  border-radius:var(--ent-r); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.eds-quick:first-child { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.eds-quick:first-child:hover { background:var(--ent-accent-hover); }
.eds-quick:hover { background:var(--ent-surface-2); }
.eds-quick:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

/* Queue row: the whole row is the button. */
.eds-q { display:flex; align-items:center; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3) var(--ent-s4); border:0; border-top:1px solid var(--ent-line);
  background:transparent; font-family:var(--ent-font); text-align:left; cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease); }
li:first-child > .eds-q { border-top:0; }
.eds-q:hover { background:var(--ent-surface-2); }
.eds-q:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.eds-q-icon { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:2rem; height:2rem; border-radius:var(--ent-r); }
.eds-q.t-negative .eds-q-icon { color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }
.eds-q.t-warning  .eds-q-icon { color:var(--ent-tone-warning-fg);  background:var(--ent-tone-warning-bg); }
.eds-q.t-info     .eds-q-icon { color:var(--ent-tone-info-fg);     background:var(--ent-tone-info-bg); }
.eds-q-count { min-width:2.25rem; font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-bold);
  font-variant-numeric:tabular-nums; color:var(--ent-text); text-align:right; }
.eds-q.t-negative .eds-q-count { color:var(--ent-danger); }
/* The queue's explanation is the point of the row: it wraps, never truncates. */
.eds-q .ins-row-title, .eds-q .ins-row-meta { white-space:normal; }
.eds-q-go { color:var(--ent-text-3); flex-shrink:0; transition:transform var(--ent-dur) var(--ent-ease); }
.eds-q:hover .eds-q-go { transform:translateX(2px); color:var(--ent-text-2); }

.eds-rowbtn { display:flex; align-items:center; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3) var(--ent-s4); border:0; border-top:1px solid var(--ent-line);
  background:transparent; font-family:var(--ent-font); text-align:left; cursor:pointer; }
li:first-child > .eds-rowbtn { border-top:0; }
.eds-rowbtn:hover { background:var(--ent-surface-2); }
.eds-rowbtn:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }

.eds-age { flex-shrink:0; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; color:var(--ent-tone-warning-fg); }
.eds-age.never { color:var(--ent-danger); }

.eds-link { border:0; background:none; padding:var(--ent-s1) var(--ent-s2); cursor:pointer;
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-accent);
  border-radius:var(--ent-r-sm); }
.eds-link:hover { background:var(--ent-accent-soft); }
.eds-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.eds-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }

.eds-clear { display:flex; align-items:flex-start; gap:var(--ent-s3); padding:var(--ent-s5) var(--ent-s4); color:var(--ent-success); }
.eds-clear strong { display:block; color:var(--ent-text); font-size:var(--ent-fs-base); }
.eds-clear p { margin:2px 0 0; color:var(--ent-text-2); font-size:var(--ent-fs-sm); }

@media (max-width: 767px) {
  .ins-actions { width:100%; }
  .eds-quick { flex:1; justify-content:center; }
}
</style>
