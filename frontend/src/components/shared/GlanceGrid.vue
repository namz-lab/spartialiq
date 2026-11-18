<script setup lang="ts">
// "At a glance": one tile per area of work with its headline figures, the flagged ones first, and the whole
// tile opens the area. First built for the Chief Executive's overview; shared so the EO Planning's team
// overview and each planning officer's home read the same way.
//
// The tile is one control with one name: its title is a button whose ::after covers the tile. Nothing on a
// tile changes a figure. A group that could not be read says so on the tile instead of showing zeros.
//
// The class names keep their xo- prefix from the Chief Executive's page, whose tests and print rules use them.
import { Info, TriangleAlert, ArrowRight } from 'lucide-vue-next'
import { headline, unbroken, type GlanceCard } from './glance'

withDefaults(defineProps<{
  cards: GlanceCard[]
  /** Prefix for the tiles' data-testid: `${prefix}-tile-${key}`. */
  testid?: string
  /** How many figures a tile shows before "n more figures". */
  max?: number
}>(), { testid: 'xo', max: 3 })

defineEmits<{ open: [key: string] }>()
</script>

<template>
  <div class="xo-tiles">
    <article v-for="c in cards" :key="c.key" class="xo-tile" :class="{ 'has-flag': headline(c, max).flagged }" :data-testid="`${testid}-tile-${c.key}`">
      <header class="xo-card-head">
        <component :is="c.icon" :size="20" class="xo-card-icon" aria-hidden="true" />
        <h3 class="xo-tile-title">
          <button type="button" class="xo-tile-open" @click="$emit('open', c.key)">{{ c.title }}</button>
        </h3>
      </header>
      <dl v-if="headline(c, max).shown.length" class="xo-stats">
        <div v-for="s in headline(c, max).shown" :key="s.label" class="xo-stat">
          <dt>{{ s.label }}</dt>
          <dd :class="s.tone ? `is-${s.tone}` : undefined">{{ unbroken(s.value) }}</dd>
        </div>
      </dl>
      <p v-if="headline(c, max).gap && (!headline(c, max).shown.length || headline(c, max).gap?.unavailable)" class="xo-missing" :class="{ 'is-error': headline(c, max).gap?.unavailable }">
        <component :is="headline(c, max).gap?.unavailable ? TriangleAlert : Info" :size="16" aria-hidden="true" />
        <span>{{ headline(c, max).gap?.note }}</span>
      </p>
      <p class="xo-tile-more" aria-hidden="true">
        {{ headline(c, max).more ? `${headline(c, max).more} more figure${headline(c, max).more === 1 ? '' : 's'}` : 'Open' }} <ArrowRight :size="14" />
      </p>
    </article>
  </div>
</template>

<style scoped>
.xo-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: 1rem; }
.xo-tile { position: relative; display: flex; flex-direction: column; background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1rem 1.125rem; transition: border-color 150ms ease, box-shadow 150ms ease; }
.xo-tile:hover { border-color: var(--ent-line-strong); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
.xo-tile.has-flag { box-shadow: inset 3px 0 0 var(--ent-warning); }
.xo-tile:focus-within { outline: 2px solid var(--ent-accent); outline-offset: 2px; }
.xo-card-head { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.75rem; }
.xo-card-icon { color: var(--ent-accent); margin-top: 0.125rem; flex: none; }
.xo-tile-title { margin: 0; font-size: 1rem; font-weight: 600; }
/* The title's button covers the whole tile, so the tile is one control with one name. */
.xo-tile-open { padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.xo-tile-open::after { content: ''; position: absolute; inset: 0; border-radius: 8px; }
.xo-tile-open:focus { outline: none; }
.xo-tile-more { display: flex; align-items: center; gap: 0.25rem; margin: auto 0 0; padding-top: 0.75rem; color: var(--ent-accent); font-size: 0.8125rem; }
@media (prefers-reduced-motion: reduce) { .xo-tile { transition: none; } }

.xo-stats { margin: 0; display: grid; gap: 0.25rem; }
/* On a tile the label sits above its figure, so a narrow tile never squeezes either one. */
.xo-stat { display: flex; flex-direction: column; gap: 0.0625rem; padding: 0.375rem 0; border-bottom: 1px solid var(--ent-surface-2); }
.xo-stat:last-child { border-bottom: 0; }
.xo-stat dt { color: var(--ent-text-2); font-size: 0.8125rem; }
.xo-stat dd { margin: 0; font-weight: 600; font-size: 1.0625rem; font-variant-numeric: tabular-nums; overflow-wrap: normal; word-break: normal; }
.xo-stat dd.is-warn { color: var(--ent-warning); }
.xo-stat dd.is-bad { color: var(--ent-danger); }
.xo-stat dd.is-good { color: var(--ent-success); }

.xo-missing { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.25rem 0 0; padding: 0.625rem 0.75rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); font-size: 0.875rem; }
.xo-missing svg { flex: none; margin-top: 0.125rem; }
.xo-missing.is-error { background: var(--ent-warning-soft); color: var(--ent-warning); }

@media (min-width: 64rem) {
  .xo-tiles { flex: 1; grid-template-columns: repeat(auto-fill, minmax(max(14rem, calc((100% - 2rem) / 3)), 1fr)); grid-auto-rows: auto; align-content: start; }
  .xo-tile { min-height: 11rem; }
}
</style>
