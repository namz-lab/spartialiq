<script setup lang="ts">
/**
 * What the finance system can say about its own health, from the same dashboard read: the database,
 * imports, the audit trail and the application process, and every alert in full. Backups are not
 * visible to the application, so the page says so instead of claiming them.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Activity, Database, PlugZap, ShieldCheck, Server, HardDriveDownload, CircleAlert, TriangleAlert, Info, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { managerDash } from '../dashboard'
import { shortWhen } from '../../shared/useDashboard'
import { uptimeText } from '../health'

const { state, load } = managerDash
const h = computed(() => state.data?.health)
const ALERT_ROUTE: Record<string, string> = { audit: 'mgr-audit', years: 'mgr-periods', imports: 'mgr-integration' }
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Activity :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>System Health</h2><p>What the finance system can see of itself, read just now.</p></div>
    <span class="cw-spacer" />
    <button type="button" class="cw-btn cw-btn--outline" :disabled="state.loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /> Check again</button>
  </section>

  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ state.error }}</p>

  <div v-if="h" class="dx-row dx-row--2">
    <section class="cw-card" aria-labelledby="sh-c">
      <div class="cw-card-head"><h3 id="sh-c">Components</h3></div>
      <div class="cw-card-body">
        <ul class="dx-health">
          <li><Database :size="20" class="dx-ok" aria-hidden="true" /><span>Database<br><small class="cw-hint">Answered a test query</small></span><strong class="dx-ok">Online · {{ h.database.ms }} ms</strong></li>
          <li><PlugZap :size="20" :class="h.imports.open_batches ? 'dx-warn' : 'dx-ok'" aria-hidden="true" /><span>Integrations<br><small class="cw-hint">Last import committed {{ shortWhen(h.imports.last_commit) }}</small></span>
            <strong>{{ h.imports.open_batches }} open</strong></li>
          <li><ShieldCheck :size="20" class="dx-ok" aria-hidden="true" /><span>Audit trail<br><small class="cw-hint">Every request is recorded</small></span><strong>{{ shortWhen(h.audit_trail.last_event) }}</strong></li>
          <li><Server :size="20" class="dx-ok" aria-hidden="true" /><span>Application<br><small class="cw-hint">Running since {{ shortWhen(h.started_at) }}</small></span><strong>{{ uptimeText(h.uptime_seconds) }}</strong></li>
          <li><HardDriveDownload :size="20" class="dx-info" aria-hidden="true" /><span>Backups<br><small class="cw-hint">Taken on the database server; the application cannot see them</small></span><strong>Not monitored here</strong></li>
        </ul>
      </div>
    </section>
    <section class="cw-card" aria-labelledby="sh-a">
      <div class="cw-card-head"><h3 id="sh-a">Alerts</h3></div>
      <div class="cw-card-body">
        <p v-if="!state.data?.alerts?.length" class="cw-empty">No alerts.</p>
        <ul v-else class="dx-list">
          <li v-for="(a, i) in state.data.alerts" :key="i">
            <RouterLink :to="{ name: ALERT_ROUTE[a.key] ?? 'mgr-dashboard' }" class="dx-item">
              <CircleAlert v-if="a.tone === 'neg'" :size="20" class="dx-neg" aria-hidden="true" />
              <TriangleAlert v-else-if="a.tone === 'warn'" :size="20" class="dx-warn" aria-hidden="true" />
              <Info v-else :size="20" class="dx-info" aria-hidden="true" />
              <span class="dx-grow">{{ a.text }}</span><ChevronRight :size="18" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
