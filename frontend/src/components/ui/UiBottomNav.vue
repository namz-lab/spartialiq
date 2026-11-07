<script setup lang="ts">
// Enterprise UI kit — Bottom navigation. The mobile counterpart of a desktop
// section rail.
//
// THE CONTRACT (Phase 20)
// It takes the SAME item array the desktop rail renders and emits the same
// key. The workspace keeps one list of sections, one active-section ref, one
// handler. Only the presentation differs: a vertical rail with labels at
// ≥768px, a four-slot bar plus an overflow sheet below it.
//
// WHY FOUR SLOTS
// The planner console has seven sections, the citizen portal six, the GIS
// officer nine. All fit a bottom bar badly: at 375px, five slots give each
// item 75px, and a label like "Statutory Workflow" is then either truncated
// to nonsense or wrapped to three lines. Four primary slots plus "More" keeps
// every label readable at 320px, the narrowest device supported, and puts the
// long tail one tap away in a sheet where labels have room to be complete.
//
// The caller decides WHICH four, by ordering the array most-used first. That
// is a product decision, not a component one.
//
// WHAT THIS REPLACES
// Two hand-rolled bars, private to CitizenPortalView and the admin console, with
// different heights, no overflow, no aria-current and no badges.
//
// ACCESSIBILITY (Phase 21)
//   <nav> landmark with an accessible name
//   aria-current="page" on the active item, so position is announced rather
//   than inferred from a colour change
//   the active item also carries a 2px top rule and a heavier label: never
//   colour alone (WCAG 1.4.1)
//   48px targets, above the 44px floor, because this is primary navigation
//   used one-handed
//   the bar clears the home indicator via --ent-safe-bottom
import { computed, ref } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import UiSheet from './UiSheet.vue'
import type { Component } from 'vue'

export interface BottomNavItem {
  key: string
  label: string
  icon: Component
  /** Short label for the bar; `label` is still used in the More sheet and as
   *  the accessible name. Use when the full label exceeds ~10 characters. */
  short?: string
  /** Count badge: outstanding tasks, unread notifications, overdue cases. */
  badge?: number
}

const props = withDefaults(defineProps<{
  items: BottomNavItem[]
  /** Key of the active section. */
  modelValue: string
  /** Accessible name for the landmark, e.g. "Planner console sections". */
  label: string
  /** Primary slots before the overflow. 4 keeps labels legible at 320px. */
  maxVisible?: number
}>(), { maxVisible: 4 })

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const moreOpen = ref(false)

/** Overflow only earns its slot when it holds more than one item — with
 *  exactly five items, showing all five beats four plus a "More" of one. */
const needsOverflow = computed(() => props.items.length > props.maxVisible + 1)

const visible = computed(() =>
  needsOverflow.value ? props.items.slice(0, props.maxVisible) : props.items,
)
const overflow = computed(() =>
  needsOverflow.value ? props.items.slice(props.maxVisible) : [],
)

/** Keeps "More" lit while one of its children is the active section, so the
 *  user never sees a bar with nothing selected. */
const overflowActive = computed(() =>
  overflow.value.some(i => i.key === props.modelValue),
)

function select(key: string) {
  moreOpen.value = false
  emit('update:modelValue', key)
}

/** A badge is a glance signal, not a report: past 99 the exact number stops
 *  mattering and the label stops fitting. */
function badgeText(n: number) { return n > 99 ? '99+' : String(n) }
</script>

<template>
  <nav class="bn-root ent-bottomnav" :aria-label="label">
    <button
      v-for="item in visible"
      :key="item.key"
      type="button"
      class="bn-item"
      :class="{ active: modelValue === item.key }"
      :aria-current="modelValue === item.key ? 'page' : undefined"
      @click="select(item.key)"
    >
      <span class="bn-icon">
        <component :is="item.icon" :size="20" aria-hidden="true" />
        <span v-if="item.badge" class="bn-badge">
          {{ badgeText(item.badge) }}
          <span class="ent-sr-only">outstanding</span>
        </span>
      </span>
      <span class="bn-label">{{ item.short || item.label }}</span>
    </button>

    <button
      v-if="needsOverflow"
      type="button"
      class="bn-item"
      :class="{ active: overflowActive }"
      :aria-expanded="moreOpen"
      aria-haspopup="dialog"
      @click="moreOpen = true"
    >
      <span class="bn-icon"><MoreHorizontal :size="20" aria-hidden="true" /></span>
      <span class="bn-label">More</span>
    </button>
  </nav>

  <!-- Overflow. A sheet rather than a popover: at this width a popover
       anchored to a 60px bar item either covers the bar or drifts offscreen. -->
  <UiSheet
    v-model:open="moreOpen"
    variant="sheet"
    title="All sections"
    :subtitle="`${items.length} sections in this workspace`"
  >
    <ul class="bn-more">
      <li v-for="item in overflow" :key="item.key">
        <button
          type="button"
          class="bn-more-item"
          :class="{ active: modelValue === item.key }"
          :aria-current="modelValue === item.key ? 'page' : undefined"
          @click="select(item.key)"
        >
          <component :is="item.icon" :size="18" aria-hidden="true" />
          <span class="bn-more-label">{{ item.label }}</span>
          <span v-if="item.badge" class="bn-more-badge">{{ badgeText(item.badge) }}</span>
        </button>
      </li>
    </ul>
  </UiSheet>
</template>

<style scoped>
/* Tokens: src/styles/enterprise.css + src/styles/responsive.css. */

.bn-root {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--ent-z-rail);
  display: flex;
  align-items: stretch;
  height: calc(var(--ent-bottomnav-h) + var(--ent-safe-bottom));
  padding-bottom: var(--ent-safe-bottom);
  padding-left: var(--ent-safe-left);
  padding-right: var(--ent-safe-right);
  background: var(--ent-surface);
  border-top: 1px solid var(--ent-line);
  /* Upward shadow: the bar floats over scrolling content, so the elevation
     has to read from below. */
  box-shadow: 0 -2px 8px rgba(17, 29, 45, 0.06);
  font-family: var(--ent-font);
}

.bn-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 2px;
  border: none;
  /* The active rule, reserved on every item so selecting one does not shift
     the row by 2px. */
  border-top: 2px solid transparent;
  background: transparent;
  color: var(--ent-text-3);
  font-family: inherit;
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-medium);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Three simultaneous signals, so the state survives colour blindness, a
   greyscale screen and direct sunlight: top rule, weight, tint. */
.bn-item.active {
  color: var(--ent-accent);
  border-top-color: var(--ent-accent);
  font-weight: var(--ent-fw-semibold);
}

.bn-item:focus-visible {
  outline: none;
  box-shadow: inset var(--ent-focus-ring);
}

/* No :hover rules. This bar renders only on touch, where hover is emulated on
   tap and leaves the last-tapped item stuck looking hovered. */

.bn-icon { position: relative; display: inline-flex; }

.bn-badge {
  position: absolute;
  top: -5px;
  left: 11px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ent-r-pill);
  background: var(--ent-danger);
  color: #fff;
  font-size: 10px;
  font-weight: var(--ent-fw-bold);
  line-height: 1;
}

.bn-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

/* ── Overflow sheet ───────────────────────────────────────────────────── */
.bn-more { list-style: none; margin: 0; padding: 0; }

.bn-more-item {
  display: flex;
  align-items: center;
  gap: var(--ent-s3);
  width: 100%;
  min-height: var(--ent-touch-primary);
  padding: var(--ent-s3);
  border: none;
  border-radius: var(--ent-r);
  background: transparent;
  color: var(--ent-text);
  font-family: inherit;
  font-size: var(--ent-fs-base);
  font-weight: var(--ent-fw-medium);
  text-align: left;
  cursor: pointer;
}
.bn-more-item.active {
  background: var(--ent-accent-soft);
  color: var(--ent-accent);
  font-weight: var(--ent-fw-semibold);
}
.bn-more-item:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.bn-more-label { flex: 1; min-width: 0; }

.bn-more-badge {
  flex-shrink: 0;
  min-width: 20px;
  padding: 2px 6px;
  border-radius: var(--ent-r-pill);
  background: var(--ent-danger-soft);
  color: var(--ent-danger);
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-bold);
  text-align: center;
}
</style>
