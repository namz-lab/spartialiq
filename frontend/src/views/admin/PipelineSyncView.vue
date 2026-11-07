<script setup lang="ts">
// PipelineSyncView — one screen answering "did my QGIS edit reach the web map?"
//
// THE QUESTION THIS EXISTS FOR
// On 2026-10-05 a planner edited proposed_peri_urban_zones in QGIS Desktop,
// saved, and nothing changed in the browser tab. There were two independent
// breaks: no change trigger on the base table, and no mapping from that table
// to a tile-layer id. Neither raised an error anywhere. Diagnosing it took four
// ad-hoc psql sessions, because no screen in the application reported the state
// of the chain. This is that screen.
//
// IT REPORTS WIRING, NOT ACTIVITY
// The coverage table answers "is this layer connected end to end right now" —
// read from pg_class, pg_trigger and the layer registry. It does NOT write a row
// to test whether a notification fires, so it is safe against production and
// safe to poll. Consequently it cannot tell you that QGIS Desktop is open, or
// that your last save committed. That is the live event tail's job, and the tail
// reports only what this browser tab has observed since it loaded.
//
// TWO COLOURS OF FINDING, DELIBERATELY SEPARATE
//   red    a registry layer that will NOT live-sync. A real user edit is lost.
//   amber  a relation whose trigger fires into nothing, or into the wrong layer.
//          No edit is lost through these today, but they are the reason an
//          earlier audit counted 29 triggers and looked clean.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RefreshCw, AlertTriangle, CircleCheck } from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import {
  getSyncCoverage, getPipelineHealth, getOgcHealth, BREAK_STAGE_TEXT,
  type CoverageLayer, type ListenerStatus, type OgcHealth, type SyncCoverage,
} from '@/services/pipelineSync'

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const coverage   = ref<SyncCoverage | null>(null)
const listener   = ref<ListenerStatus | null>(null)
const ogc        = ref<OgcHealth | null>(null)
const loading    = ref(false)
const expanded   = ref<string | null>(null)
const filter     = ref('')
const onlyBroken = ref(false)
const notice     = ref<{ tone: Tone; text: string } | null>(null)

const layerColumns = [
  { key: 'title', label: 'Layer', sortable: true },
  { key: 'group', label: 'Group', sortable: true, hideOnMobile: true },
  { key: 'chain', label: 'Notification path' },
  { key: 'syncs', label: 'Live sync', sortable: true, width: '170px' },
  { key: 'detail', label: '', width: '90px' },
]

// Findings rows are normalised to one shape so a single UiDataTable serves both
// kinds. `claims` is the layer id the browser would be told to refresh.
const findingColumns = [
  { key: 'findingLabel', label: 'Finding', width: '140px' },
  { key: 'relation', label: 'Relation', sortable: true },
  { key: 'rowLabel', label: 'Contents', hideOnMobile: true },
  { key: 'claims', label: 'Broadcasts as' },
]

function describeRelation(r: { relationKind: string; approxRows: number | null; exact: boolean }): string {
  if (r.approxRows === null) return r.relationKind
  const noun = r.approxRows === 1 ? 'row' : 'rows'
  return `${r.relationKind}, ${r.approxRows} ${noun}${r.exact ? '' : ' (estimated)'}`
}

const unroutedRows = computed(() => (coverage.value?.unrouted ?? []).map((u) => ({
  relation: u.relation,
  findingLabel: 'No source',
  rowLabel: describeRelation(u),
  claims: u.browserSourceId,
})))

const shadowedRows = computed(() => (coverage.value?.shadowed ?? []).map((s) => ({
  relation: s.relation,
  findingLabel: 'Wrong layer',
  rowLabel: describeRelation(s),
  claims: `vungu-${s.claimsLayerId}`,
})))

const visibleLayers = computed<CoverageLayer[]>(() => {
  const all = coverage.value?.layers ?? []
  const q = filter.value.trim().toLowerCase()
  return all.filter((l) => {
    if (onlyBroken.value && l.syncs) return false
    if (!q) return true
    return l.layerId.toLowerCase().includes(q)
      || l.title.toLowerCase().includes(q)
      || l.registryTable.toLowerCase().includes(q)
      || l.notifyTables.some((t) => t.toLowerCase().includes(q))
      || l.group.toLowerCase().includes(q)
  })
})

const allLegsOk  = (l: CoverageLayer, k: 'resolvesToThisLayer' | 'sourceRegistered') =>
  l.legs.length > 0 && l.legs.every((x) => x[k])

const verdictTone = computed<Tone>(() => {
  const s = coverage.value?.summary
  if (!s) return 'neutral'
  if (s.broken > 0) return 'negative'
  if (s.wiringProblems > 0) return 'warning'
  return 'positive'
})

const verdictTitle = computed(() => {
  const s = coverage.value?.summary
  if (!s) return ''
  if (s.broken > 0) return `${s.broken} ${s.broken === 1 ? 'layer does' : 'layers do'} not live-sync`
  return 'Every layer is live-syncing'
})

const verdictNote = computed(() => {
  const s = coverage.value?.summary
  if (!s) return ''
  if (s.broken > 0) {
    return 'An edit to a red layer is saved in the database and stops there. Each one is listed below with its cause.'
  }
  if (s.wiringProblems > 0) {
    return `The chain is complete for all ${s.layers} layers. ${s.wiringProblems} `
      + `${s.wiringProblems === 1 ? 'relation sits' : 'relations sit'} outside the registry — listed below.`
  }
  return 'A save in QGIS Desktop reaches every open map tab without a reload.'
})

function stageText(stage: string | null | undefined): string {
  if (!stage) return 'Unknown'
  return BREAK_STAGE_TEXT[stage] ?? stage
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString()
}

function toggle(row: CoverageLayer) {
  expanded.value = expanded.value === row.layerId ? null : row.layerId
}

function explain(e: unknown, what: string): string {
  const status = (e as { response?: { status?: number } })?.response?.status
  if (status === 403) {
    return `${what}: your role may not read the pipeline. It is limited to administrators `
      + 'and GIS officers — the same two who may publish symbology.'
  }
  if (status === 401) return `${what}: the session expired. Sign in again.`
  const msg = (e as { message?: string })?.message
  return msg && msg !== 'Network Error' ? `${what}: ${msg}.` : `${what}: the backend is not reachable.`
}

async function load() {
  loading.value = true
  // Three independent reads, settled separately: the OGC check is optional
  // context and must never blank the coverage table if it fails.
  const [cov, health, ogcHealth] = await Promise.allSettled([
    getSyncCoverage(),
    getPipelineHealth(),
    getOgcHealth(),
  ])

  if (cov.status === 'fulfilled') {
    coverage.value = cov.value
    listener.value = cov.value.listener
  } else {
    notice.value = { tone: 'negative', text: explain(cov.reason, 'Could not read sync coverage') }
  }
  if (health.status === 'fulfilled') {
    // /api/qgis/health is the older, thinner shape; the coverage report carries
    // countersSince, which only the report computes. Merge so the label survives
    // whichever request answered.
    const base = cov.status === 'fulfilled' ? cov.value.listener : ({} as ListenerStatus)
    listener.value = { ...base, ...health.value.realtimeSync } as ListenerStatus
  }
  if (ogcHealth.status === 'fulfilled') ogc.value = ogcHealth.value

  loading.value = false
}

// ── Live tail ──────────────────────────────────────────────────────────────
// The same EventSource the map itself opens (src/map/vunguBasemap.ts). A second
// connection is cheap, and it means this page can be opened on its own — with
// no map beside it — and still show that edits are arriving.
const tailing = ref(false)
const events  = ref<{ clock: string; layer: string; table: string; ops: string }[]>([])
let source: EventSource | null = null

function opsText(ops: unknown): string {
  if (!ops || typeof ops !== 'object') return ''
  return Object.entries(ops as Record<string, number>)
    .map(([op, n]) => `${n} ${op.toLowerCase()}`)
    .join(', ')
}

function stopTail() {
  source?.close()
  source = null
  tailing.value = false
}

function toggleTail() {
  if (source) { stopTail(); return }
  try {
    source = new EventSource('/api/map/events')
  } catch {
    notice.value = { tone: 'warning', text: 'Could not open the event stream.' }
    return
  }
  tailing.value = true
  source.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data)
      if (!d || typeof d.layer !== 'string') return
      events.value.unshift({
        clock: new Date().toLocaleTimeString(),
        layer: d.layer,
        table: d.table ?? '',
        ops: opsText(d.ops),
      })
      if (events.value.length > 25) events.value.pop()
    } catch {
      // A keep-alive frame or an unparseable payload is not worth interrupting
      // the operator over; the stream stays open.
    }
  }
  source.onerror = () => {
    // EventSource reconnects on its own. Say that, rather than implying the
    // pipeline broke — a browser-level network error is not a database fault.
    if (source && tailing.value) {
      notice.value = {
        tone: 'warning',
        text: 'Event stream interrupted; the browser is retrying automatically.',
      }
    }
  }
}

onMounted(load)
onBeforeUnmount(stopTail)
</script>

<template>
  <div class="pipe-root">
    <header class="pipe-head">
      <div>
        <h1 class="pipe-title">QGIS → web pipeline</h1>
        <p class="pipe-sub">
          Whether a save in QGIS Desktop reaches an open browser tab, checked link by
          link. Data is authored in QGIS; this portal is the live view of the same
          PostGIS tables — nothing is exported or redigitised.
        </p>
      </div>
      <UiButton :disabled="loading" @click="load">
        <template #icon><RefreshCw :size="16" :class="{ spin: loading }" /></template>
        Re-check
      </UiButton>
    </header>

    <div v-if="notice" class="pipe-notice" :class="`t-${notice.tone}`" role="status">
      <AlertTriangle v-if="notice.tone !== 'info'" :size="16" />
      <CircleCheck v-else :size="16" />
      <span>{{ notice.text }}</span>
    </div>

    <UiPanel v-if="coverage">
      <div class="pipe-verdict" :class="`t-${verdictTone}`">
        <div class="pipe-verdict-figure">
          <span class="pipe-verdict-num">{{ coverage.summary.syncing }}</span>
          <span class="pipe-verdict-of">of {{ coverage.summary.layers }}</span>
        </div>
        <div class="pipe-verdict-text">
          <h2 class="pipe-verdict-title">{{ verdictTitle }}</h2>
          <p class="pipe-verdict-note">{{ verdictNote }}</p>
        </div>
      </div>
      <dl class="pipe-facts">
        <div><dt>Change triggers attached</dt><dd>{{ coverage.summary.triggersAttached }}</dd></div>
        <div>
          <dt>Broadcast to no source</dt>
          <dd :class="{ warn: coverage.summary.unroutedTriggers > 0 }">{{ coverage.summary.unroutedTriggers }}</dd>
        </div>
        <div>
          <dt>Claim another layer's id</dt>
          <dd :class="{ warn: coverage.summary.shadowedTriggers > 0 }">{{ coverage.summary.shadowedTriggers }}</dd>
        </div>
        <div v-if="coverage.summary.triggersInert.length">
          <dt>Present but not firing</dt>
          <dd class="warn">{{ coverage.summary.triggersInert.length }}</dd>
        </div>
      </dl>
    </UiPanel>

    <UiPanel title="Live listener" subtitle="The server's connection to PostGIS change notifications">
      <dl class="pipe-facts wide">
        <div>
          <dt>Listening</dt>
          <dd>
            <UiStatusBadge :tone="listener?.listening ? 'positive' : 'negative'"
                            :label="listener?.listening ? 'Connected' : 'Not connected'" />
          </dd>
        </div>
        <div><dt>Connected</dt><dd class="mono">{{ formatTime(listener?.connectedAt) }}</dd></div>
        <div><dt>Reconnects</dt><dd>{{ listener?.reconnects ?? '—' }}</dd></div>
        <div><dt>Notifications seen</dt><dd>{{ listener?.notifications ?? '—' }}</dd></div>
        <div><dt>Events sent to browsers</dt><dd>{{ listener?.eventsEmitted ?? '—' }}</dd></div>
      </dl>
      <p v-if="listener" class="pipe-aside">
        Counters are measured since the server started listening
        <template v-if="listener.countersSince"> at {{ formatTime(listener.countersSince) }}</template>,
        not since the last edit. Zero here means nothing has changed the database since
        the restart — it does not mean the chain is broken.
      </p>
    </UiPanel>

    <UiPanel title="WMS rendering" subtitle="QGIS Server, the alternate tile path">
      <p class="pipe-line">
        <UiStatusBadge
          :tone="ogc?.status === 'healthy' ? 'positive' : 'warning'"
          :label="ogc?.status === 'healthy' ? 'QGIS Server healthy' : 'Degraded — vector tiles in use'" />
      </p>
      <p class="pipe-aside">
        Degraded is the expected local state: QGIS Server runs in Docker and is
        optional. Vector tiles are generated from PostGIS directly and live sync does
        not depend on it.
      </p>
    </UiPanel>

    <UiPanel
      v-if="shadowedRows.length || unroutedRows.length"
      title="Findings outside the registry"
      subtitle="Relations carrying a change trigger that serve no browser source">
      <p class="pipe-aside">
        These do not lose a user's edit today. They matter because a trigger count
        taken from the database includes them — which is how a broken chain once looked
        clean.
      </p>

      <UiDataTable
        :columns="findingColumns"
        :rows="shadowedRows.concat(unroutedRows)"
        row-key="relation"
        mobile-primary="relation"
        mobile-status="findingLabel"
        :mobile-meta="['rowLabel', 'claims']"
        class="mt"
      >
        <template #cell-findingLabel="{ row }">
          <UiStatusBadge tone="warning" :label="row.findingLabel" />
        </template>
        <template #cell-relation="{ row }"><span class="mono">{{ row.relation }}</span></template>
        <template #cell-rowLabel="{ row }"><span class="dim">{{ row.rowLabel }}</span></template>
        <template #cell-claims="{ row }"><span class="mono dim">{{ row.claims }}</span></template>
      </UiDataTable>
    </UiPanel>

    <UiPanel
      v-if="coverage && coverage.summary.broken > 0"
      title="Layers that will not live-sync"
      subtitle="An edit to these reaches the database and stops there">
      <div v-for="b in coverage.summary.breaks" :key="b.layerId" class="pipe-break">
        <div class="pipe-break-head">
          <strong>{{ b.title }}</strong>
          <UiStatusBadge tone="negative" :label="stageText(b.stage)" />
        </div>
        <p class="pipe-break-why">{{ b.remedy }}</p>
      </div>
    </UiPanel>

    <UiPanel
      title="Every layer"
      :subtitle="coverage ? `${coverage.summary.syncing} of ${coverage.summary.layers} connected` : ''"
      flush
    >
      <div class="pipe-search">
        <input
          v-model="filter"
          type="search"
          class="pipe-input"
          placeholder="Filter by layer, table or group"
          aria-label="Filter layers" />
        <label class="pipe-check">
          <input v-model="onlyBroken" type="checkbox" />
          Problems only
        </label>
      </div>

      <UiDataTable
        :columns="layerColumns"
        :rows="visibleLayers"
        row-key="layerId"
        :loading="loading"
        :empty-message="filter || onlyBroken ? 'No layer matches.' : 'No layers reported.'"
        clickable
        @row-click="toggle"
      >
        <template #cell-syncs="{ row }">
          <UiStatusBadge
            :tone="row.syncs ? 'positive' : 'negative'"
            :label="row.syncs ? 'Live' : stageText(row.breakStage)" />
        </template>
        <template #cell-chain="{ row }"><span class="mono chain">{{ row.chain }}</span></template>
        <template #cell-detail="{ row }">
          <span class="dim">{{ expanded === row.layerId ? 'Hide' : 'Detail' }}</span>
        </template>
      </UiDataTable>

      <div
        v-for="row in visibleLayers.filter((l) => l.layerId === expanded)"
        :key="'d' + row.layerId"
        class="pipe-detail">
        <h4>Notification path — {{ row.title }}</h4>
        <ol class="pipe-steps">
          <li>
            <span class="step-label">Registry table</span>
            <span class="mono">{{ row.registryTable }}</span>
            <UiStatusBadge :tone="row.relationKind ? 'info' : 'negative'"
                            :label="row.relationKind ?? 'missing'" />
          </li>
          <li v-for="leg in row.legs" :key="leg.table">
            <span class="step-label">Trigger fires on</span>
            <span class="mono">{{ leg.table }}</span>
            <!-- Present-and-firing is the only green. `triggerAttached` alone is not
                 enough: a DISABLED trigger still shows up in pg_trigger, which
                 is precisely why this screen exists. -->
            <UiStatusBadge
              :tone="leg.triggerFires ? 'positive' : 'negative'"
              :label="leg.triggerFires ? 'fires' : (leg.triggerAttached ? (leg.triggerState ?? 'not firing') : 'no trigger')" />
          </li>
          <li>
            <span class="step-label">Resolves to layer</span>
            <span class="mono">{{ row.legs[0]?.resolvesTo ?? '(unresolved)' }}</span>
            <UiStatusBadge :tone="allLegsOk(row, 'resolvesToThisLayer') ? 'positive' : 'negative'"
                            :label="allLegsOk(row, 'resolvesToThisLayer') ? 'this layer' : 'another layer'" />
          </li>
          <li>
            <span class="step-label">Browser source</span>
            <span class="mono">{{ row.browserSourceId ?? '(unresolved)' }}</span>
            <UiStatusBadge :tone="allLegsOk(row, 'sourceRegistered') ? 'positive' : 'negative'"
                            :label="allLegsOk(row, 'sourceRegistered') ? 'registered' : 'no such source'" />
          </li>
        </ol>
        <p v-if="row.remedy" class="pipe-break-why">{{ row.remedy }}</p>
      </div>
    </UiPanel>

    <UiPanel title="Live event tail" subtitle="What this browser tab has received since it loaded">
      <div class="pipe-tail-actions">
        <UiButton :variant="tailing ? 'secondary' : 'primary'" @click="toggleTail">
          {{ tailing ? 'Stop watching' : 'Watch for edits' }}
        </UiButton>
        <span v-if="tailing" class="pipe-asive inline">Listening on /api/map/events</span>
      </div>

      <p v-if="!tailing" class="pipe-aside">
        Start watching, then edit a layer in QGIS Desktop and save. A working pipeline
        prints the layer, the table and the row count within a second. Only events this
        tab receives appear here; reloading the page clears them.
      </p>

      <ol v-if="events.length" class="pipe-tail">
        <li v-for="(e, i) in events" :key="i" :class="{ fresh: i === 0 }">
          <span class="mono tail-time">{{ e.clock }}</span>
          <span class="mono tail-layer">{{ e.layer }}</span>
          <span class="dim">{{ e.table }}</span>
          <span class="tail-ops">{{ e.ops }}</span>
        </li>
      </ol>
      <p v-else-if="tailing" class="pipe-asive">Connected. No changes yet.</p>
    </UiPanel>
  </div>
</template>

<style scoped>
/* Token-only, per the enterprise SSOT (src/styles/enterprise.css). The verdict
   figure and the chain column are the two places a monospace face earns its
   keep: both display identifiers a reader compares character by character
   against a psql prompt. */
.pipe-root {
  display: flex; flex-direction: column; gap: var(--ent-s5);
  padding: var(--ent-s6); max-width: 1180px; margin: 0 auto;
  background: var(--ent-canvas); color: var(--ent-text);
  font-family: var(--ent-font-sans, system-ui, sans-serif);
  min-height: var(--ent-vh);
}
@media (max-width: 768px) { .pipe-root { padding: var(--ent-s4); gap: var(--ent-s4); } }

.pipe-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ent-s4); flex-wrap: wrap; }
.pipe-title { margin: 0; font-size: var(--ent-fs-h2, 1.5rem); line-height: 1.2; }
.pipe-sub { margin: var(--ent-s2) 0 0; color: var(--ent-text-muted); font-size: var(--ent-fs-sm); max-width: 62ch; }
.mono { font-family: var(--ent-font-mono, ui-monospace, monospace); font-size: var(--ent-fs-micro, .8125rem); }
.dim { color: var(--ent-text-muted); }

.pipe-notice {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s3); border-radius: var(--ent-r-md);
  border: 1px solid var(--ent-tone-warning-line);
  background: var(--ent-tone-warning-bg); color: var(--ent-tone-warning-fg);
  font-size: var(--ent-fs-sm);
}
.pipe-notice.t-negative { border-color: var(--ent-tone-negative-line); background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }

.pipe-verdict { display: flex; align-items: center; gap: var(--ent-s5); flex-wrap: wrap; }
.pipe-verdict-figure { display: flex; align-items: baseline; gap: var(--ent-s2); }
.pipe-verdict-num { font-size: var(--ent-fs-h1, 2.25rem); font-weight: var(--ent-fw-bold, 700); line-height: 1; }
.pipe-verdict-of { color: var(--ent-text-muted); font-size: var(--ent-fs-sm); }
.pipe-verdict-text { flex: 1 1 260px; }
.pipe-verdict-title { margin: 0; font-size: var(--ent-fs-lg, 1.125rem); font-weight: var(--ent-fw-semibold, 600); }
.pipe-verdict-note { margin: var(--ent-s1) 0 0; color: var(--ent-text-muted); font-size: var(--ent-fs-sm); }
.pipe-verdict.t-negative .pipe-verdict-num,
.pipe-verdict.t-negative .pipe-verdict-title { color: var(--ent-tone-negative-fg); }
.pipe-verdict.t-warning .pipe-verdict-num,
.pipe-verdict.t-warning .pipe-verdict-title { color: var(--ent-tone-warning-fg); }
.pipe-verdict.t-positive .pipe-verdict-num,
.pipe-verdict.t-positive .pipe-verdict-title { color: var(--ent-tone-positive-fg); }

.pipe-facts { display: flex; flex-wrap: wrap; gap: var(--ent-s6); margin: var(--ent-s4) 0 0; }
.pipe-facts.wide { margin: 0; gap: var(--ent-s5); }
.pipe-facts dt { font-size: var(--ent-fs-micro, .8125rem); color: var(--ent-text-muted); text-transform: uppercase; letter-spacing: .04em; }
.pipe-facts dd { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-lg, 1.125rem); font-weight: var(--ent-fw-semibold, 600); }
.pipe-facts dd.warn { color: var(--ent-tone-warning-fg); }

.pipe-aside { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); max-width: 80ch; }
.pipe-aside.inline { margin: 0; }
.pipe-line { margin: 0; }
.chain { word-break: break-word; }

.pipe-break { border-top: 1px solid var(--ent-border); padding: var(--ent-s3) 0; }
.pipe-break:first-of-type { border-top: 0; }
.pipe-break-head { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.pipe-break-why { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-muted); max-width: 88ch; }

.pipe-search { display: flex; align-items: center; gap: var(--ent-s4); padding: var(--ent-s3) var(--ent-s4); flex-wrap: wrap; }
.pipe-input {
  flex: 1 1 240px; padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-border); border-radius: var(--ent-r-md);
  background: var(--ent-surface); color: var(--ent-text); font: inherit; font-size: var(--ent-fs-sm);
}
.pipe-check { display: flex; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-sm); color: var(--ent-text-muted); }

.pipe-detail { padding: var(--ent-s4); border-top: 1px solid var(--ent-border); }
.pipe-detail h4 { margin: 0 0 var(--ent-s3); font-size: var(--ent-fs-md, 1rem); }
.pipe-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.pipe-steps li { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.step-label { font-size: var(--ent-fs-micro, .8125rem); text-transform: uppercase; letter-spacing: .04em; color: var(--ent-text-muted); min-width: 150px; }

.pipe-tail-actions { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.pipe-tail { list-style: none; margin: var(--ent-s4) 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.pipe-tail li {
  display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap;
  padding: var(--ent-s2) var(--ent-s3); border-radius: var(--ent-r-sm);
  border: 1px solid var(--ent-border); font-size: var(--ent-fs-sm);
}
.pipe-tail li.fresh { border-color: var(--ent-tone-positive-line); background: var(--ent-tone-positive-bg); }
.tail-time { color: var(--ent-text-muted); }
.tail-layer { font-weight: var(--ent-fw-semibold, 600); }
.tail-ops { margin-left: auto; color: var(--ent-text-muted); font-size: var(--ent-fs-micro, .8125rem); }

.spin { animation: pipe-spin 900ms linear infinite; }
@keyframes pipe-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.mt { margin-top: var(--ent-s3); }
</style>