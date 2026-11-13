<script lang="ts">
/**
 * The shapes the three chart files share. Declared here, in the frame, because the frame is what
 * guarantees the rule they exist to serve: the rows that draw a chart are the rows that fill the
 * table beside it.
 */

/** One measure, as a table column and as a plotted series. */
export interface ChartColumn {
  key: string
  label: string
  /** Shown under the table as a sentence, where the measure needs one. */
  note?: string
}

/**
 * One period.
 *
 * `values` holds decimal STRINGS, exactly as the API sent them, or null. null means the figure was
 * not recorded; it is never rendered as 0 and never interpolated across.
 */
export interface ChartRow {
  key: string
  label: string
  /** The period's extent, for the table. */
  from: string
  to: string
  values: Record<string, string | null>
}

/** How one measure is drawn. The mark is part of the distinction, so colour is never the only one. */
export interface ChartSeries {
  key: string
  name: string
  /** `bar` and `line` are the measure itself; `reference` is what it is being read against. */
  role: 'bar' | 'bar-secondary' | 'line' | 'reference'
}
</script>

<script setup lang="ts">
/**
 * The frame every finance chart is drawn inside: its title, the currency it is stated in, the
 * sentence under it, the table that carries the same figures, and the empty state.
 *
 * WHY THE FRAME OWNS THE TABLE AND THE CHART DOES NOT
 * Design rule A6: every chart is rendered from the same rows as, and ships beside, a real table
 * with the same figures, because a chart a screen reader cannot read is not a report. Making that
 * a convention between two components would mean it could drift. So the frame takes the rows, puts
 * them through the default slot to whatever draws them, and renders the <table> itself from the
 * same array. There is no arrangement of this component in which the chart and the table are
 * reading different numbers.
 *
 * WHY THE CURRENCY IS ON THE FRAME AND NOT ON THE PAGE
 * Decision D4 and design A5: no chart plots two currencies on one axis, and a figure whose currency
 * is implicit is a figure that will eventually be added to the wrong one. The frame therefore
 * requires a currency, prints it in the heading with its full name, and the table's money columns
 * are bare because the heading above them has already said it.
 *
 * WHY THERE ARE NO HERO METRICS AND NO METRIC CARDS
 * PRODUCT.md names the generic SaaS dashboard — cream, bright blue, a row of large hero numbers in
 * identical cards — as the anti-reference to avoid most strongly. A chart frame is exactly where
 * that look arrives. So this one is a <figure> with an eyebrow, a small heading and a sentence; the
 * plot is a thin band; the figures live at table weight in a real table; and the only saturated
 * colour on the surface is the bars themselves, which cover a small fraction of it.
 *
 * MOTION
 * The entrance is a 160 ms opacity and 4 px lift on the plot, the duration and easing DESIGN.md
 * sets, and nothing animates the data itself — a bar that grows is a bar that was briefly showing
 * a figure nobody approved. `prefers-reduced-motion: reduce` removes it twice over: the media query
 * collapses the transition to none, and `prefersReducedMotion()` also stops the class ever being
 * applied. The helper mirrors the one in src/map/vunguBasemap.ts rather than importing it, because
 * that module pulls MapLibre and its basemap registry in behind it and a finance chart has no use
 * for either.
 */
import { computed, onMounted, ref } from 'vue'
import { formatMoney, currencyName, currencyLabel } from '../../composables/useMoney'
import type { Currency } from '../../models/types'
// ChartColumn and ChartRow are declared in this file's own <script lang="ts"> block above; both
// blocks compile into one module, so they are already in scope and must not be re-imported.

const props = withDefaults(defineProps<{
  /** What this chart is of. A name, not a sentence. */
  title: string
  /** The one currency every figure on this chart is stated in. Never two. */
  currency: Currency
  /** The eyebrow above the title — usually the side of the position. */
  eyebrow?: string
  /** One sentence saying what the reader is looking at and on what basis. */
  caption: string
  /** The periods, in order. The same array the chart in the slot is drawing. */
  rows: ChartRow[]
  /** The measures, as table columns. */
  columns: ChartColumn[]
  /** What would appear here, and how, when there is nothing. Never an illustration. */
  emptyMessage: string
  /** A caption for the table itself, explaining the basis of its figures. */
  tableCaption?: string
}>(), {
  eyebrow: '',
  tableCaption: '',
})

/** True when the reader has asked the operating system for reduced motion. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const entered = ref(false)
onMounted(() => {
  if (prefersReducedMotion()) return
  entered.value = true
})

const hasRows = computed(() => props.rows.length > 0)

/** How many cells in this chart have no recorded figure. Said in words, never drawn as zero. */
const notRecorded = computed(() => {
  let n = 0
  for (const row of props.rows) {
    for (const column of props.columns) {
      if (row.values[column.key] === null || row.values[column.key] === undefined) n += 1
    }
  }
  return n
})

const columnNotes = computed(() => props.columns.filter((c) => c.note))
</script>

<template>
  <figure class="fcx-frame">
    <figcaption class="fcx-head">
      <p v-if="eyebrow" class="fcx-eyebrow">{{ eyebrow }}</p>
      <h4 class="fcx-title">
        {{ title }}
        <span class="fcx-ccy">
          <span class="fcx-ccy-code">{{ currency }}</span>
          <span class="fcx-ccy-name">{{ currencyName(currency) }}</span>
        </span>
      </h4>
      <p class="fcx-caption">{{ caption }}</p>
    </figcaption>

    <div v-if="!hasRows" class="fcx-empty">{{ emptyMessage }}</div>

    <template v-else>
      <!-- The plot. Its accessible name is set by whatever is drawn in it; the figures are in the
           table below, which is the representation this chart is accountable to. -->
      <div class="fcx-plot" :class="{ 'is-entered': entered }">
        <slot />
      </div>

      <p v-if="notRecorded > 0" class="fcx-missing-note">
        {{ notRecorded }} figure{{ notRecorded === 1 ? '' : 's' }} on this chart
        {{ notRecorded === 1 ? 'was' : 'were' }} not recorded. Those periods are left open rather
        than drawn as nil, and the table below names them.
      </p>

      <div class="fcx-table-wrap">
        <table class="fcx-table">
          <caption>
            {{ tableCaption || `The figures this chart is drawn from, in ${currencyLabel(currency)}.` }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th v-for="column in columns" :key="column.key" scope="col" class="fcx-num">
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <th scope="row">{{ row.label }}</th>
              <td class="fcx-date">{{ row.from }}</td>
              <td class="fcx-date">{{ row.to }}</td>
              <td v-for="column in columns" :key="column.key" class="fcx-num"
                  :class="{ 'fcx-unrecorded': row.values[column.key] === null || row.values[column.key] === undefined }">
                <template v-if="row.values[column.key] === null || row.values[column.key] === undefined">
                  not recorded
                </template>
                <template v-else>
                  {{ formatMoney(row.values[column.key], currency, { bare: true }) }}
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-for="column in columnNotes" :key="column.key" class="fcx-colnote">
        <strong>{{ column.label }}.</strong> {{ column.note }}
      </p>
    </template>
  </figure>
</template>

<style scoped>
/*
  Class prefix `fcx-` is deliberate. finance.css already owns .fin-bar, .fin-meter, .fin-figure,
  .fin-table and .fin-map — the last of which is a grid definition-list and not a map, and .ins-bar
  is a progress meter that once hid a whole toolbar. Nothing in this file can collide with any of
  them.
*/
.fcx-frame {
  margin: 0;
  padding: var(--ent-s4);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md);
  background: var(--ent-surface);
  display: flex;
  flex-direction: column;
  gap: var(--ent-s3);
  min-width: 0;
}

.fcx-head { display: flex; flex-direction: column; gap: 2px; }
.fcx-eyebrow {
  margin: 0;
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ent-text-3);
}
.fcx-title {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ent-s2);
  font-size: var(--ent-fs-md);
  font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight);
  color: var(--ent-text);
}
.fcx-ccy { display: inline-flex; align-items: baseline; gap: var(--ent-s1); }
.fcx-ccy-code {
  font-family: var(--ent-font-mono);
  font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold);
  padding: 1px 5px;
  border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-sm);
  color: var(--ent-text-2);
}
.fcx-ccy-name { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-normal); color: var(--ent-text-3); }
.fcx-caption {
  margin: 0;
  max-width: 76ch;
  font-size: var(--ent-fs-xs);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
}

.fcx-empty {
  padding: var(--ent-s4) 0;
  font-size: var(--ent-fs-sm);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
  border-top: 1px solid var(--ent-line);
  max-width: 76ch;
}

.fcx-plot {
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 160ms cubic-bezier(0.16, 1, 0.3, 1), transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
.fcx-plot.is-entered { opacity: 1; transform: none; }

.fcx-missing-note,
.fcx-colnote {
  margin: 0;
  max-width: 76ch;
  font-size: var(--ent-fs-micro);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
}
.fcx-colnote strong { font-weight: var(--ent-fw-semibold); color: var(--ent-text); }

.fcx-table-wrap { overflow-x: auto; }
.fcx-table { width: 100%; border-collapse: collapse; font-size: var(--ent-fs-xs); }
.fcx-table caption {
  caption-side: top;
  text-align: left;
  padding-bottom: var(--ent-s2);
  font-size: var(--ent-fs-micro);
  line-height: var(--ent-lh);
  color: var(--ent-text-3);
  max-width: 76ch;
}
.fcx-table th,
.fcx-table td {
  padding: 6px var(--ent-s2);
  border-bottom: 1px solid var(--ent-line);
  text-align: left;
  white-space: nowrap;
}
.fcx-table thead th {
  font-weight: var(--ent-fw-semibold);
  color: var(--ent-text-2);
  border-bottom: 1px solid var(--ent-line-strong);
}
.fcx-table tbody th { font-weight: var(--ent-fw-medium); color: var(--ent-text); }
.fcx-num { text-align: right; font-variant-numeric: tabular-nums; }
.fcx-date { font-family: var(--ent-font-mono); color: var(--ent-text-3); }
.fcx-unrecorded { color: var(--ent-text-3); font-style: italic; }

@media (prefers-reduced-motion: reduce) {
  .fcx-plot { opacity: 1; transform: none; transition: none; }
}
</style>
