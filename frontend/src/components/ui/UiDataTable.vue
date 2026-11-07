<script setup lang="ts">
// Enterprise UI kit — DataTable. The one table primitive for registers,
// queues and lists.
//
// TWO PRESENTATIONS, ONE COMPONENT (Phase 9 + Phase 20)
//   ≥768px  a real <table>: sticky header, per-column sort, alignment, mono
//           columns for machine identifiers, dense mode
//   ≤767px  a list of record cards: identity, status, the two or three fields
//           an officer scans for, and the row action — tap the card for the
//           full record
//
// The caller passes ONE set of columns, ONE set of rows, ONE row-click
// handler and ONE set of #cell-<key> slots. Both presentations render from
// them. There is no mobile variant of the register to keep in sync, and no
// business logic is duplicated: sorting and row activation are the same code
// path on both.
//
// WHY CARDS AND NOT A SCROLLER
// The Development Register is eight columns wide. Scrolling it horizontally
// on a 375px screen shows two columns at a time and hides the status — the
// one field an officer opens the register to check. Card mode surfaces
// register number, applicant, status and the open action together, which is
// the actual mobile task. A horizontal scroller is still right for genuinely
// tabular numeric data, and `:responsive="false"` selects it: the table then
// keeps its <table> layout inside the .ent-scroll-x wrapper at every width.
//
// WHICH FIELDS SURVIVE ON MOBILE
// Inferred from `columns` unless the caller overrides: the first column is
// the identity, a column keyed or labelled "status" is the status, an
// unlabelled right-aligned trailing column is the action, and the next three
// are meta rows. Nothing is dropped silently — every column not on the card
// is still reachable by opening the record, that fact is announced to screen
// readers, and a table whose rows are NOT clickable keeps all its columns as
// meta, because there is no "tap for the rest" to fall back on.
//
// ponytail: sort is client-side over the rows you pass (fine for a loaded
// server page of ≤ a few hundred). For datasets larger than one page, sort
// server-side and pass the already-ordered rows instead.
import { computed, ref } from 'vue'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from 'lucide-vue-next'
import { useBreakpoint } from '@/composables/useBreakpoint'

interface UiColumn {
  key: string
  label: string
  width?: string
  align?: string      // 'right' | 'center' — default left
  mono?: boolean      // machine identifiers (refs, ids, coords)
  capitalize?: boolean
  sortable?: boolean
  /** Keep out of the mobile card. Use for columns another card field already
   *  conveys, never for information with no other route to it. */
  hideOnMobile?: boolean
}

const props = withDefaults(defineProps<{
  columns: UiColumn[]
  rows: any[]         // ponytail: generic table, rows are untyped by design
  rowKey?: string
  loading?: boolean
  emptyMessage?: string
  clickable?: boolean
  dense?: boolean
  /** false keeps the <table> at every width, inside a horizontal scroller.
   *  Correct for wide numeric data where column alignment IS the meaning. */
  responsive?: boolean
  /** Column key used as the card title. Defaults to the first column. */
  mobilePrimary?: string
  /** Column key rendered under the title. */
  mobileSecondary?: string
  /** Column key rendered top-right of the card, typically a status badge. */
  mobileStatus?: string
  /** Column keys rendered as label/value rows. Defaults to the next three. */
  mobileMeta?: string[]
  /** Column key rendered in the card footer, typically the row action. */
  mobileActions?: string
}>(), {
  rowKey: 'id',
  emptyMessage: 'No records to display.',
  clickable: false,
  dense: false,
  responsive: true,
})

const emit = defineEmits<{ 'row-click': [row: any] }>()

const { isMobile } = useBreakpoint()
const asCards = computed(() => props.responsive && isMobile.value)

/* ── Sorting. One implementation, both presentations. ─────────────────── */
const sortKey = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')

function toggleSort(k: string) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
}
function sortIcon(k: string) {
  if (sortKey.value !== k) return ChevronsUpDown
  return sortDir.value === 'asc' ? ChevronUp : ChevronDown
}

const sortedRows = computed(() => {
  const k = sortKey.value
  if (!k) return props.rows
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...props.rows].sort((a, b) => {
    const av = a[k], bv = b[k]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir
  })
})

function keyOf(row: any, i: number): string | number {
  return row?.[props.rowKey] ?? i
}

function activate(row: any) {
  if (props.clickable) emit('row-click', row)
}

/* ── Mobile field inference ──────────────────────────────────────────────
   A card is built from named roles, not column order, so a caller can
   reorder the desktop table without silently changing what mobile shows. */

const usable = computed(() => props.columns.filter(c => !c.hideOnMobile))

const primaryCol = computed(() =>
  usable.value.find(c => c.key === props.mobilePrimary) ?? usable.value[0],
)

const statusCol = computed(() => {
  if (props.mobileStatus) return usable.value.find(c => c.key === props.mobileStatus)
  return usable.value.find(c =>
    /status|state|stage/i.test(c.key) || /status|state|stage/i.test(c.label))
})

const actionCol = computed(() => {
  if (props.mobileActions) return usable.value.find(c => c.key === props.mobileActions)
  // An unlabelled, right-aligned trailing column is the table's action slot.
  const last = usable.value[usable.value.length - 1]
  return last && last.align === 'right' && !last.label ? last : undefined
})

const secondaryCol = computed(() =>
  props.mobileSecondary ? usable.value.find(c => c.key === props.mobileSecondary) : undefined,
)

/** Everything not already holding a named role. Capped at three rows when the
 *  card opens a detail view; uncapped when it does not, because a
 *  non-clickable row has no "tap for the rest" and the rest must stay put. */
const metaCols = computed(() => {
  if (props.mobileMeta) {
    return props.mobileMeta
      .map(k => usable.value.find(c => c.key === k))
      .filter((c): c is UiColumn => Boolean(c))
  }
  const taken = new Set(
    [primaryCol.value, secondaryCol.value, statusCol.value, actionCol.value]
      .filter(Boolean).map(c => c!.key),
  )
  const rest = usable.value.filter(c => !taken.has(c.key) && c.label)
  return props.clickable ? rest.slice(0, 3) : rest
})

/** Columns absent from the card. Announced to assistive technology so a
 *  screen-reader user knows the record has more to it, rather than taking the
 *  card for the whole row. */
const hiddenCount = computed(() => {
  const shown = new Set([
    primaryCol.value?.key, secondaryCol.value?.key, statusCol.value?.key,
    actionCol.value?.key, ...metaCols.value.map(c => c.key),
  ].filter(Boolean))
  return props.columns.filter(c => !shown.has(c.key) && c.label).length
})

/* ── Mobile sort control ─────────────────────────────────────────────────
   Cards have no <th> to click, so the sort the table offers is offered
   another way rather than lost (Phase 9: do not remove capability). A select
   is right here — one tap, native on both platforms, rarely more than eight
   options. */
const sortableCols = computed(() => props.columns.filter(c => c.sortable))

function onMobileSort(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (!v) { sortKey.value = null; return }
  const [k, dir] = v.split(':')
  sortKey.value = k
  sortDir.value = dir === 'desc' ? 'desc' : 'asc'
}

const mobileSortValue = computed(() =>
  sortKey.value ? `${sortKey.value}:${sortDir.value}` : '',
)
</script>

<template>
  <!-- ── Mobile: record cards ──────────────────────────────────────────── -->
  <div v-if="asCards" class="ui-cards">
    <div v-if="sortableCols.length && sortedRows.length" class="ui-cards-bar">
      <label class="ui-cards-sortlab" :for="`${rowKey}-sort`">Sort</label>
      <select
        :id="`${rowKey}-sort`"
        class="ui-cards-sort"
        :value="mobileSortValue"
        @change="onMobileSort"
      >
        <option value="">Default order</option>
        <template v-for="c in sortableCols" :key="c.key">
          <option :value="`${c.key}:asc`">{{ c.label }}, ascending</option>
          <option :value="`${c.key}:desc`">{{ c.label }}, descending</option>
        </template>
      </select>
    </div>

    <p v-if="loading" class="ui-cards-msg" role="status">Loading…</p>
    <p v-else-if="!sortedRows.length" class="ui-cards-msg">{{ emptyMessage }}</p>

    <ul v-else class="ui-cards-list">
      <li v-for="(row, i) in sortedRows" :key="keyOf(row, i)">
        <component
          :is="clickable ? 'button' : 'article'"
          :type="clickable ? 'button' : undefined"
          class="ui-card"
          :class="{ tappable: clickable }"
          @click="activate(row)"
        >
          <div class="ui-card-top">
            <div class="ui-card-ident">
              <span class="ui-card-title" :class="{ mono: primaryCol?.mono, cap: primaryCol?.capitalize }">
                <slot v-if="primaryCol" :name="`cell-${primaryCol.key}`" :row="row" :value="row[primaryCol.key]">
                  {{ row[primaryCol.key] }}
                </slot>
              </span>
              <span v-if="secondaryCol" class="ui-card-sub">
                <slot :name="`cell-${secondaryCol.key}`" :row="row" :value="row[secondaryCol.key]">
                  {{ row[secondaryCol.key] }}
                </slot>
              </span>
            </div>

            <div v-if="statusCol" class="ui-card-status">
              <slot :name="`cell-${statusCol.key}`" :row="row" :value="row[statusCol.key]">
                {{ row[statusCol.key] }}
              </slot>
            </div>

            <ChevronRight v-else-if="clickable" class="ui-card-chev" :size="16" aria-hidden="true" />
          </div>

          <dl v-if="metaCols.length" class="ui-card-meta">
            <div v-for="c in metaCols" :key="c.key" class="ui-card-metarow">
              <dt>{{ c.label }}</dt>
              <dd :class="{ mono: c.mono, cap: c.capitalize }">
                <slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">
                  {{ row[c.key] ?? '—' }}
                </slot>
              </dd>
            </div>
          </dl>

          <!-- The action column keeps its own slot content, so the button here
               is literally the button from the desktop table, including its
               @click.stop. -->
          <div v-if="actionCol" class="ui-card-actions">
            <slot :name="`cell-${actionCol.key}`" :row="row" :value="row[actionCol.key]" />
          </div>

          <span v-if="hiddenCount && clickable" class="ent-sr-only">
            {{ hiddenCount }} further field{{ hiddenCount === 1 ? '' : 's' }}; open the record to see them.
          </span>
        </component>
      </li>
    </ul>
  </div>

  <!-- ── Tablet and desktop: the table ─────────────────────────────────── -->
  <div v-else class="ui-table-wrap ent-scroll-x">
    <table class="ui-table" :class="{ dense }">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key" :style="c.width ? { width: c.width } : undefined"
              :class="[{ sortable: c.sortable, 'is-sorted': sortKey === c.key },
                       c.align === 'right' ? 'ta-right' : c.align === 'center' ? 'ta-center' : '']"
              :aria-sort="sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending')
                          : c.sortable ? 'none' : undefined"
              @click="c.sortable && toggleSort(c.key)">
            <span class="ui-th-inner">
              {{ c.label }}
              <span v-if="c.sortable" class="ui-th-sort"><component :is="sortIcon(c.key)" :size="12" /></span>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading"><td :colspan="columns.length" class="ui-td-msg">Loading…</td></tr>
        <tr v-else-if="!sortedRows.length"><td :colspan="columns.length" class="ui-td-msg">{{ emptyMessage }}</td></tr>
        <tr v-else v-for="(row, i) in sortedRows" :key="keyOf(row, i)"
            :class="{ clickable }" @click="activate(row)">
          <td v-for="c in columns" :key="c.key"
              :class="[{ mono: c.mono, cap: c.capitalize },
                       c.align === 'right' ? 'ta-right' : c.align === 'center' ? 'ta-center' : '']">
            <slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">{{ row[c.key] }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* ── Table (tablet and up) ───────────────────────────────────────────── */
.ui-table-wrap { background: var(--ent-surface);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); }
.ui-table { width: 100%; border-collapse: collapse; font-family: var(--ent-font); font-size: var(--ent-fs-sm); }

.ui-table thead th { position: sticky; top: 0; z-index: var(--ent-z-sticky);
  background: var(--ent-surface-2); text-align: left; padding: 0 var(--ent-s3); height: var(--ent-row-h);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2);
  text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap;
  border-bottom: 1px solid var(--ent-line); }
.ui-table th.sortable { cursor: pointer; user-select: none; }
.ui-table th.sortable:hover { color: var(--ent-text); }
.ui-th-inner { display: inline-flex; align-items: center; gap: var(--ent-s1); }
.ui-th-sort { display: inline-flex; color: var(--ent-text-3); }
.ui-table th.is-sorted { color: var(--ent-text); }
.ui-table th.is-sorted .ui-th-sort { color: var(--ent-accent); }

.ui-table td { padding: 0 var(--ent-s3); height: var(--ent-row-h); vertical-align: middle;
  border-top: 1px solid var(--ent-line); color: var(--ent-text); }
.ui-table.dense thead th, .ui-table.dense td { height: var(--ent-row-h-sm); }
.ui-table tbody tr.clickable { cursor: pointer; }
.ui-table tbody tr.clickable:hover { background: var(--ent-surface-2); }

.ui-td-msg { text-align: center; color: var(--ent-text-3); height: auto !important;
  padding: var(--ent-s7) var(--ent-s4) !important; }

.ui-table td.mono { font-family: var(--ent-font-mono); font-weight: var(--ent-fw-semibold); font-size: var(--ent-fs-xs); }
.ui-table td.cap { text-transform: capitalize; }
.ta-right { text-align: right !important; }
.ta-center { text-align: center !important; }

/* ── Record cards (mobile) ───────────────────────────────────────────── */
.ui-cards { font-family: var(--ent-font); }

.ui-cards-bar {
  display: flex; align-items: center; gap: var(--ent-s2);
  margin-bottom: var(--ent-s3);
}
.ui-cards-sortlab {
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text-2); text-transform: uppercase; letter-spacing: 0.04em;
}
.ui-cards-sort {
  flex: 1; min-width: 0; height: var(--ent-control-h);
  padding: 0 var(--ent-control-px);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface); color: var(--ent-text);
  font-family: inherit;
}
.ui-cards-sort:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.ui-cards-msg {
  margin: 0; padding: var(--ent-s7) var(--ent-s4);
  text-align: center; color: var(--ent-text-3); font-size: var(--ent-fs-sm);
  background: var(--ent-surface);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md);
}

.ui-cards-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--ent-s2);
}

.ui-card {
  display: block; width: 100%; text-align: left;
  padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-surface);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md);
  color: var(--ent-text);
  font-family: inherit; font-size: var(--ent-fs-sm);
}
.ui-card.tappable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-card.tappable:active { background: var(--ent-surface-2); }
.ui-card:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.ui-card-top { display: flex; align-items: flex-start; gap: var(--ent-s3); }
.ui-card-ident { flex: 1; min-width: 0; }

.ui-card-title {
  display: block;
  font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight); color: var(--ent-text);
}
.ui-card-title.mono { font-family: var(--ent-font-mono); font-size: var(--ent-fs-sm); }
.ui-card-title.cap { text-transform: capitalize; }

.ui-card-sub {
  display: block; margin-top: 2px;
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}

.ui-card-status { flex-shrink: 0; }
.ui-card-chev { flex-shrink: 0; color: var(--ent-text-3); margin-top: 2px; }

/* Label/value rows. A two-column grid rather than stacked pairs: the labels
   align, so the eye scans down the values instead of hopping. */
.ui-card-meta {
  margin: var(--ent-s3) 0 0; padding: var(--ent-s3) 0 0;
  border-top: 1px solid var(--ent-line);
  display: grid; gap: var(--ent-s1);
}
.ui-card-metarow {
  display: grid; grid-template-columns: minmax(5.5rem, 34%) minmax(0, 1fr);
  gap: var(--ent-s3); align-items: baseline;
}
.ui-card-metarow dt {
  font-size: var(--ent-fs-xs); color: var(--ent-text-3);
}
.ui-card-metarow dd {
  margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text);
  overflow-wrap: anywhere;
}
.ui-card-metarow dd.mono { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); }
.ui-card-metarow dd.cap { text-transform: capitalize; }

.ui-card-actions {
  margin-top: var(--ent-s3); padding-top: var(--ent-s3);
  border-top: 1px solid var(--ent-line);
  display: flex; gap: var(--ent-s2);
}
/* The row action goes full width on a card: it is the card's primary verb,
   and a 60px button on a 343px card is a target the thumb must aim for. */
.ui-card-actions > :deep(*) { flex: 1; }
</style>
