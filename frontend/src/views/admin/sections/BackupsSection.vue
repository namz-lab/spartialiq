<script setup lang="ts">
// Backups — what has actually been written to the backup directory.
//
// WHY THIS READS THE FILESYSTEM AND NOT A TABLE OF RUNS
// A table records what the application BELIEVES was backed up. The question an
// administrator needs answered before a risky migration is whether the file is
// really there — and "a recorded run whose file has since been deleted" is
// exactly the failure that table would hide. So the endpoint lists the
// directory, and this screen reports what it found.
//
// WHAT THIS SCREEN CANNOT DO, AND SAYS SO
// It does not take a backup. `pg_dump` runs on the server host, can take
// minutes on a spatial database, and writing an HTTP endpoint that shells out
// to it is how a web console becomes a way to run commands on the database
// server. The command is given here to be run by someone with a terminal, and
// the screen's job is to tell them whether it has been run recently enough.
//
// IT IS THE ONLY BACKUP
// The system is self-hosted, so there is no managed-host snapshot behind this.
// Saying so matters: "no backups" on this screen means the council has none.

import { computed, onMounted, ref } from 'vue'
import { getBackups, errorMessage, type BackupReport } from '@/services/adminConsole'
import { formatBytes, formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import {
  RefreshCw, AlertTriangle, DatabaseBackup, Terminal, Copy, CheckCircle2, Info,
} from 'lucide-vue-next'

const report = ref<BackupReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)

const COMMAND = 'cd ../app-backend && npm run backup'

async function load() {
  loading.value = true
  error.value = null
  try {
    report.value = await getBackups()
  } catch (err) {
    report.value = null
    error.value = errorMessage(err, 'The backup directory could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/**
 * How old the newest backup is, and whether that is acceptable.
 *
 * A week is the threshold because the manual script's own retention default is
 * fourteen runs — a council backing up less often than weekly is not keeping
 * fourteen of anything useful. Below 24 hours it is simply current.
 */
const freshness = computed(() => {
  const r = report.value
  if (!r) return null
  if (!r.exists) return {
    tone: 'warning' as const,
    headline: 'No backup directory on this server',
    detail: 'Nothing has been backed up here yet. Run the command below on the server to create the first one.',
  }
  if (!r.files.length) return {
    tone: 'warning' as const,
    headline: 'The backup directory is empty',
    detail: 'It exists but holds no dump. Run the command below before any migration or bulk import.',
  }
  const hours = r.newestAgeHours ?? 0
  if (hours <= 24) return {
    tone: 'positive' as const,
    headline: 'The most recent backup is from the last day',
    detail: 'Current. Take a fresh one immediately before a migration regardless.',
  }
  if (hours <= 168) return {
    tone: 'info' as const,
    headline: `The most recent backup is ${Math.round(hours / 24)} days old`,
    detail: 'Within the week. Take a fresh one before any migration or bulk import.',
  }
  return {
    tone: 'negative' as const,
    headline: `The most recent backup is ${Math.round(hours / 24)} days old`,
    detail: 'Older than a week. Everything since then exists only in the live database and in Render’s own snapshots.',
  }
})

const columns = [
  { key: 'name', label: 'File', width: '22rem', mono: true },
  { key: 'kind', label: 'Contains', width: '10rem' },
  { key: 'bytes', label: 'Size', width: '8rem', align: 'right' },
  { key: 'modifiedAt', label: 'Written', width: '11rem' },
]

const databaseDumps = computed(() => report.value?.files.filter(f => f.kind === 'database') ?? [])
const uploadArchives = computed(() => report.value?.files.filter(f => f.kind === 'uploads') ?? [])

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(COMMAND)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">System &amp; operations</span>
        <h2 class="ins-title">Backups</h2>
        <p class="ins-lede">
          What is actually on disk in the server's backup directory — read from the
          filesystem, not from a record of what was meant to have run.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="bk-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="bk-btn" @click="load">Retry</button>
    </div>

    <p v-else-if="loading && !report" class="bk-loading" role="status">Reading the backup directory…</p>

    <template v-else-if="report">
      <div class="ins-banner" :class="`t-${freshness!.tone === 'info' ? 'info' : freshness!.tone}`">
        <component :is="freshness!.tone === 'positive' ? CheckCircle2 : AlertTriangle" :size="16" aria-hidden="true" />
        <div>
          <strong>{{ freshness!.headline }}</strong>
          <p>{{ freshness!.detail }}</p>
        </div>
      </div>

      <!-- The context that stops both wrong conclusions. -->
      <p class="bk-context">
        <Info :size="15" aria-hidden="true" />
        <span>
          These are the <strong>only</strong> backups of the live system: the database and
          the uploads folder (citizen documents and inspection photographs). Run
          <code>npm run backup</code> nightly on a schedule and copy the files off the server.
        </span>
      </p>

      <!-- ── Taking one ────────────────────────────────────────────────── -->
      <section class="ins-card">
        <div class="ins-card-head"><h3><Terminal :size="15" aria-hidden="true" /> Taking a backup</h3></div>
        <div class="ins-card-body">
          <p class="bk-why">
            Run this on the server, from a terminal. It is deliberately not a button here:
            <code class="ins-mono">pg_dump</code> runs on the database host and takes minutes
            on a spatial database, and a web console that can execute shell commands on the
            database server is a larger risk than the convenience is worth.
          </p>
          <div class="bk-cmd">
            <code class="ins-mono">{{ COMMAND }}</code>
            <button type="button" class="bk-btn bk-btn-sm" @click="copyCommand">
              <Copy :size="13" aria-hidden="true" /> {{ copied ? 'Copied' : 'Copy' }}
            </button>
          </div>
          <p class="ins-hint">
            Writes a database dump and an archive of the uploads directory, and prunes
            all but the newest fourteen of each. Restore with
            <code class="ins-mono">pg_restore</code>.
          </p>
          <p class="bk-dir">
            Directory: <code class="ins-mono">{{ report.directory }}</code>
          </p>
        </div>
      </section>

      <!-- ── What is there ─────────────────────────────────────────────── -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h3><DatabaseBackup :size="15" aria-hidden="true" /> Database dumps
            <span class="ins-count">{{ databaseDumps.length }}</span></h3>
        </div>
        <UiDataTable
          :columns="columns" :rows="databaseDumps" row-key="name" dense
          empty-message="No database dump in this directory."
          mobile-primary="name" mobile-secondary="modifiedAt"
        >
          <template #cell-kind>Database</template>
          <template #cell-bytes="{ row }">{{ formatBytes(row.bytes) }}</template>
          <template #cell-modifiedAt="{ row }">
            <span :title="formatWhen(row.modifiedAt)">{{ timeAgo(row.modifiedAt) }}</span>
          </template>
        </UiDataTable>
      </section>

      <section class="ins-card">
        <div class="ins-card-head">
          <h3>Upload archives
            <span class="ins-count">{{ uploadArchives.length }}</span></h3>
        </div>
        <UiDataTable
          :columns="columns" :rows="uploadArchives" row-key="name" dense
          empty-message="No uploads archive in this directory. Citizen documents and inspection photographs are not covered by database snapshots."
          mobile-primary="name" mobile-secondary="modifiedAt"
        >
          <template #cell-kind>Citizen documents &amp; photographs</template>
          <template #cell-bytes="{ row }">{{ formatBytes(row.bytes) }}</template>
          <template #cell-modifiedAt="{ row }">
            <span :title="formatWhen(row.modifiedAt)">{{ timeAgo(row.modifiedAt) }}</span>
          </template>
        </UiDataTable>
      </section>
    </template>
  </div>
</template>

<style scoped>
.bk-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.bk-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.bk-btn:disabled { opacity:0.55; cursor:not-allowed; }
.bk-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.bk-btn-sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2); font-size:var(--ent-fs-xs); }

.bk-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }

.bk-context { display:flex; align-items:flex-start; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s4); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.bk-context > svg { flex-shrink:0; margin-top:2px; color:var(--ent-text-3); }

.bk-why { margin:0 0 var(--ent-s3); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2); }

.bk-cmd { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3); background:var(--ent-surface-sunken);
  border:1px solid var(--ent-line); border-radius:var(--ent-r); }
.bk-cmd code { flex:1; min-width:0; font-size:var(--ent-fs-sm); color:var(--ent-text);
  overflow-x:auto; white-space:nowrap; }

.bk-dir { margin:var(--ent-s3) 0 0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); overflow-wrap:anywhere; }
</style>
