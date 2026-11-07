<script setup lang="ts">
// System health — the database, the process, the host, and what is stored where.
//
// WHAT AN IT ADMIN ACTUALLY ASKS THIS SCREEN
//   "Is the database about to run out of room?"      → size, and what is using it
//   "Are we running out of connections?"             → connections against the max
//   "Has the server been restarted?"                 → process uptime vs database uptime
//   "Which migration is this database on?"           → the migration count
// Everything here answers one of those. There is no chart, because none of
// these is a trend — they are all a current value with a threshold.
//
// ROW COUNTS ARE ESTIMATES AND SAY SO
// They come from pg_stat_user_tables.n_live_tup. An exact count(*) over the
// twenty-four spatial layers reads every heap page in the database, which is a
// minute of I/O to draw one screen. The estimate is within a percent after any
// autovacuum, and the column is labelled "approx" so nobody quotes it in a
// report as a figure.

import { computed, onMounted, ref } from 'vue'
import {
  getSystemHealth, listTables, errorMessage,
  type SystemHealth, type TableInfo,
} from '@/services/adminConsole'
import { formatBytes, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import { RefreshCw, AlertTriangle, Database, Cpu, Server, CheckCircle2, XCircle } from 'lucide-vue-next'

const health = ref<SystemHealth | null>(null)
const tables = ref<TableInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    // Together: the two halves of one picture, and showing the header while
    // the inventory is still arriving makes the page look half-broken.
    const [h, t] = await Promise.all([getSystemHealth(), listTables()])
    health.value = h
    tables.value = t
  } catch (err) {
    health.value = null
    tables.value = []
    error.value = errorMessage(err, 'The system could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** "3 days, 4 hours" — the form the question "has it restarted" wants. */
function duration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`
  if (hours) return `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} min`
  return `${minutes} min`
}

/**
 * Connection pressure.
 *
 * Postgres refuses new connections at max_connections, and a council portal
 * that cannot open one is entirely down. 70% is where an admin should be
 * looking at it, not where it breaks.
 */
const connectionPressure = computed(() => {
  const d = health.value?.database
  if (!d?.maxConnections) return null
  const pct = Math.round((d.connections / d.maxConnections) * 100)
  return {
    pct,
    tone: pct >= 85 ? 'negative' : pct >= 70 ? 'warning' : 'positive',
    note: pct >= 85
      ? 'Close to the limit. New connections will start being refused.'
      : pct >= 70
        ? 'Higher than usual. Worth watching.'
        : 'Comfortable.',
  }
})

const memoryPressure = computed(() => {
  const h = health.value?.host
  if (!h?.totalMemBytes) return null
  const used = h.totalMemBytes - h.freeMemBytes
  const pct = Math.round((used / h.totalMemBytes) * 100)
  return { pct, used, tone: pct >= 90 ? 'negative' : pct >= 75 ? 'warning' : 'positive' }
})

const columns = [
  { key: 'name', label: 'Table', width: '20rem' },
  { key: 'schema', label: 'Schema', width: '10rem', hideOnMobile: true },
  { key: 'rows_approx', label: 'Rows (approx)', width: '10rem', align: 'right' },
  { key: 'size', label: 'On disk', width: '8rem', align: 'right' },
  { key: 'last_analyze', label: 'Last analysed', width: '10rem', hideOnMobile: true },
]

/** What the twenty largest tables account for — the "what is using the space" answer. */
const topShare = computed(() => {
  if (!tables.value.length || !health.value) return null
  const top = tables.value.slice(0, 20).reduce((sum, t) => sum + t.bytes, 0)
  return Math.round((top / health.value.database.sizeBytes) * 100)
})
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">System &amp; operations</span>
        <h2 class="ins-title">System health</h2>
        <p class="ins-lede">
          The current state of the database, the API process and the machine they run on.
          Read before a migration, a bulk import, or when something is slow.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="hl-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="hl-btn" @click="load">Retry</button>
    </div>

    <p v-else-if="loading && !health" class="hl-loading" role="status">Reading the system…</p>

    <template v-else-if="health">
      <div class="hl-grid">
        <!-- ── Database ────────────────────────────────────────────────── -->
        <section class="ins-card">
          <div class="ins-card-head"><h3><Database :size="15" aria-hidden="true" /> Database</h3></div>
          <div class="ins-card-body">
            <dl class="ins-dl">
              <div><dt>Name</dt><dd class="ins-mono">{{ health.database.name }}</dd></div>
              <div><dt>Version</dt><dd>{{ health.database.version }}</dd></div>
              <div><dt>Size on disk</dt><dd>{{ health.database.size }}</dd></div>
              <div><dt>Running for</dt><dd>{{ duration(health.database.uptimeSeconds) }}</dd></div>
              <div>
                <dt>PostGIS</dt>
                <dd class="hl-flag" :class="health.database.postgis ? 't-ok' : 't-bad'">
                  <component :is="health.database.postgis ? CheckCircle2 : XCircle" :size="14" aria-hidden="true" />
                  {{ health.database.postgis ? 'Installed' : 'Not installed' }}
                </dd>
              </div>
              <div v-if="health.migrations">
                <dt>Migrations applied</dt>
                <dd>{{ health.migrations.applied }}</dd>
              </div>
            </dl>

            <div v-if="connectionPressure" class="hl-meter">
              <div class="hl-meter-head">
                <span>Connections</span>
                <strong>{{ health.database.connections }} of {{ health.database.maxConnections }}</strong>
              </div>
              <!-- --fill is a 0-1 fraction, not a width: the primitive scales the
                   span rather than resizing it, so a progress update cannot
                   thrash layout. A width here is silently ignored. -->
              <div class="ins-bar" :class="`t-${connectionPressure.tone}`">
                <span :style="{ '--fill': Math.min(1, connectionPressure.pct / 100) }" />
              </div>
              <p class="ins-hint">{{ connectionPressure.note }}</p>
            </div>
          </div>
        </section>

        <!-- ── Process ─────────────────────────────────────────────────── -->
        <section class="ins-card">
          <div class="ins-card-head"><h3><Cpu :size="15" aria-hidden="true" /> API process</h3></div>
          <div class="ins-card-body">
            <dl class="ins-dl">
              <div><dt>Node</dt><dd class="ins-mono">{{ health.process.node }}</dd></div>
              <div><dt>Environment</dt><dd>{{ health.process.env }}</dd></div>
              <div><dt>Running for</dt><dd>{{ duration(health.process.uptimeSeconds) }}</dd></div>
              <div><dt>Memory in use</dt><dd>{{ formatBytes(health.process.rssBytes) }}</dd></div>
              <div><dt>Heap</dt><dd>{{ formatBytes(health.process.heapUsedBytes) }}</dd></div>
            </dl>
            <!-- The comparison that answers "did the API restart without the
                 database noticing", which is what a crash loop looks like. -->
            <p v-if="health.process.uptimeSeconds < health.database.uptimeSeconds / 10" class="ins-hint hl-restart">
              The API has been running much less time than the database. If that is
              unexpected, the process has restarted — check the deployment log.
            </p>
          </div>
        </section>

        <!-- ── Host ────────────────────────────────────────────────────── -->
        <section class="ins-card">
          <div class="ins-card-head"><h3><Server :size="15" aria-hidden="true" /> Host</h3></div>
          <div class="ins-card-body">
            <dl class="ins-dl">
              <div><dt>Platform</dt><dd>{{ health.host.platform }}</dd></div>
              <div><dt>Processors</dt><dd>{{ health.host.cpus }}</dd></div>
              <div><dt>Memory</dt><dd>{{ formatBytes(health.host.totalMemBytes) }}</dd></div>
              <div v-if="health.host.loadAvgSupported">
                <dt>Load (1 / 5 / 15 min)</dt>
                <dd>{{ health.host.loadAvg.map(n => n.toFixed(2)).join(' · ') }}</dd>
              </div>
              <!-- Stated rather than drawn as three flat zeroes: Windows does
                   not report a load average, and a chart of zeros implies an
                   idle machine rather than an unavailable measurement. -->
              <div v-else>
                <dt>Load average</dt>
                <dd class="hl-muted">Not reported on this platform</dd>
              </div>
            </dl>

            <div v-if="memoryPressure" class="hl-meter">
              <div class="hl-meter-head">
                <span>Memory in use</span>
                <strong>{{ formatBytes(memoryPressure.used) }} ({{ memoryPressure.pct }}%)</strong>
              </div>
              <div class="ins-bar" :class="`t-${memoryPressure.tone}`">
                <span :style="{ '--fill': Math.min(1, memoryPressure.pct / 100) }" />
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ── Storage inventory ─────────────────────────────────────────── -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h3>What is using the space
            <span class="ins-count">
              {{ tables.length }} tables
              <template v-if="topShare">· the largest 20 hold about {{ topShare }}% of the database</template>
            </span>
          </h3>
        </div>
        <UiDataTable
          :columns="columns" :rows="tables" row-key="name" :loading="loading" dense
          empty-message="No table could be read."
          mobile-primary="name" mobile-secondary="schema"
        >
          <template #cell-name="{ row }">
            <span class="ins-mono">{{ row.name }}</span>
          </template>
          <template #cell-rows_approx="{ row }">
            <span class="hl-num">{{ row.rows_approx.toLocaleString() }}</span>
          </template>
          <template #cell-last_analyze="{ row }">
            <span v-if="row.last_analyze">{{ timeAgo(row.last_analyze) }}</span>
            <span v-else class="hl-muted">Never</span>
          </template>
        </UiDataTable>
        <div class="ins-card-foot hl-foot">
          <p class="ins-hint">
            Row counts are Postgres' own live estimates, not exact counts — an exact
            count over the spatial layers would read every page in the database. They
            are within a percent or so after a vacuum; do not quote them as figures.
          </p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hl-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.hl-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.hl-btn:disabled { opacity:0.55; cursor:not-allowed; }
.hl-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.hl-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }

.hl-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(20rem, 1fr)); gap:var(--ent-s4); align-items:start; }

.hl-meter { margin-top:var(--ent-s4); }
.hl-meter-head { display:flex; justify-content:space-between; align-items:baseline;
  margin-bottom:var(--ent-s2); font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.hl-meter-head strong { font-variant-numeric:tabular-nums; color:var(--ent-text); }

.ins-bar.t-warning > span { background:var(--ent-warning); }
.ins-bar.t-negative > span { background:var(--ent-danger); }

.hl-flag { display:inline-flex; align-items:center; gap:var(--ent-s1); }
.hl-flag.t-ok { color:var(--ent-success); }
.hl-flag.t-bad { color:var(--ent-danger); }

.hl-restart { margin-top:var(--ent-s3); color:var(--ent-warning); }
.hl-muted { color:var(--ent-text-3); }
.hl-num { font-variant-numeric:tabular-nums; }
.hl-foot { justify-content:flex-start; }
</style>
