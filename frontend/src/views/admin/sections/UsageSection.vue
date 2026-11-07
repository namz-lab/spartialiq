<script setup lang="ts">
// Portal usage — page views counted by the portal itself.
//
// WHAT THESE NUMBERS ARE, AND ARE NOT
// Only visitors who accepted analytics on the cookie banner are counted, and
// browsers set to Do Not Track never are. So these are a floor, not a census:
// good for "which screens are used" and "is use rising", not for "how many
// residents used the portal". The screen says so rather than letting a lower
// number read as lower use.
//
// Pages are route patterns (/citizen, /planner-workspace), never concrete
// URLs — the table holds no record ids and no query strings, so a section
// inside a console counts as the console.

import { computed, ref, watch } from 'vue'
import { useAdminNav } from '@/admin/useAdminConsole'
import { getUsage, errorMessage, type UsageReport, type UsageWindow } from '@/services/adminConsole'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import { RefreshCw, AlertTriangle, Info, BarChart3, CalendarDays } from 'lucide-vue-next'

const nav = useAdminNav()

// The window lives in the URL like every other section filter, so a link to
// ?section=usage&days=30 opens on the month.
const days = computed<UsageWindow>(() => (nav.param('days') === '30' ? 30 : 7))

const report = ref<UsageReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    report.value = await getUsage(days.value)
  } catch (err) {
    report.value = null
    error.value = errorMessage(err, 'Portal usage could not be read.')
  } finally {
    loading.value = false
  }
}

watch(days, load, { immediate: true })

const number = new Intl.NumberFormat('en-GB')
const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Newest first: the question is nearly always "what happened lately". */
const dailyRows = computed(() => [...(report.value?.daily ?? [])].reverse())
const busiestDay = computed(() => Math.max(1, ...(report.value?.daily ?? []).map(d => d.views)))

const dailyColumns = [
  { key: 'day', label: 'Day', width: '9rem' },
  { key: 'views', label: 'Views', width: '6rem', align: 'right' },
  { key: 'visitors', label: 'Visitors', width: '6rem', align: 'right' },
  { key: 'bar', label: '', hideOnMobile: true },
]

const pathColumns = [
  { key: 'path', label: 'Page', mono: true },
  { key: 'views', label: 'Views', width: '6rem', align: 'right' },
  { key: 'visitors', label: 'Visitors', width: '6rem', align: 'right' },
]
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">System &amp; operations</span>
        <h2 class="ins-title">Portal usage</h2>
        <p class="ins-lede">
          Page views recorded by the portal itself, from visitors who accepted analytics.
        </p>
      </div>
      <div class="ins-actions">
        <div class="ins-seg" role="group" aria-label="Period">
          <button type="button" :aria-pressed="days === 7" @click="nav.setParam('days', null)">7 days</button>
          <button type="button" :aria-pressed="days === 30" @click="nav.setParam('days', '30')">30 days</button>
        </div>
        <button type="button" class="us-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="us-btn" @click="load">Retry</button>
    </div>

    <p v-else-if="loading && !report" class="us-loading" role="status">Counting page views…</p>

    <template v-else-if="report">
      <p class="us-context">
        <Info :size="15" aria-hidden="true" />
        <span>
          A floor, not a census: visitors who reject analytics, or whose browser asks not to be
          tracked, are never counted. No IP address, account or record number is stored.
        </span>
      </p>

      <section class="ins-card">
        <div class="ins-card-body">
          <dl class="ins-dl">
            <div><dt>Page views</dt><dd class="us-figure">{{ number.format(report.totalViews) }}</dd></div>
            <div><dt>Distinct visitors</dt><dd class="us-figure">{{ number.format(report.distinctVisitors) }}</dd></div>
            <div><dt>Period</dt><dd class="us-figure">Last {{ report.days }} days</dd></div>
          </dl>
        </div>
      </section>

      <section class="ins-card">
        <div class="ins-card-head">
          <h3><BarChart3 :size="15" aria-hidden="true" /> Most viewed pages
            <span class="ins-count">{{ report.topPaths.length }}</span></h3>
        </div>
        <UiDataTable
          :columns="pathColumns" :rows="report.topPaths" row-key="path" dense
          :empty-message="`No page view recorded in the last ${report.days} days.`"
          mobile-primary="path" mobile-secondary="views"
        >
          <template #cell-views="{ row }">{{ number.format(row.views) }}</template>
          <template #cell-visitors="{ row }">{{ number.format(row.visitors) }}</template>
        </UiDataTable>
      </section>

      <section class="ins-card">
        <div class="ins-card-head">
          <h3><CalendarDays :size="15" aria-hidden="true" /> By day</h3>
        </div>
        <UiDataTable
          :columns="dailyColumns" :rows="dailyRows" row-key="day" dense
          empty-message="No days in this period."
          mobile-primary="day" mobile-secondary="views"
        >
          <template #cell-day="{ row }">{{ dayLabel.format(new Date(`${row.day}T00:00:00Z`)) }}</template>
          <template #cell-views="{ row }">{{ number.format(row.views) }}</template>
          <template #cell-visitors="{ row }">{{ number.format(row.visitors) }}</template>
          <template #cell-bar="{ row }">
            <span class="us-bar" aria-hidden="true">
              <span class="us-bar-fill" :style="{ width: `${(row.views / busiestDay) * 100}%` }" />
            </span>
          </template>
        </UiDataTable>
      </section>
    </template>
  </div>
</template>

<style scoped>
.us-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.us-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.us-btn:disabled { opacity:0.55; cursor:not-allowed; }
.us-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.us-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }

.us-context { display:flex; align-items:flex-start; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s4); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.us-context > svg { flex-shrink:0; margin-top:2px; color:var(--ent-text-3); }

.us-figure { font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; }

.us-bar { display:block; height:6px; background:var(--ent-surface-sunken); border-radius:var(--ent-r-sm); overflow:hidden; }
.us-bar-fill { display:block; height:100%; background:var(--ent-accent-line); }
</style>
