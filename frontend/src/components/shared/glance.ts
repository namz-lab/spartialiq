// "At a glance": the rule the Chief Executive's overview uses to pick a tile's headline figures, shared so the
// EO Planning's team overview and the officers' own homes pick theirs the same way.
import type { Component } from 'vue'
import type { Group, Stat, Tone } from '@/views/units/unitStats'

/** One tile: an area of work, its figures in groups, and what opens when it is chosen. */
export interface GlanceCard {
  key: string
  title: string
  icon: Component
  groups: Group[]
  /** Who answers for it, shown under the title when the area is open in full. */
  post?: string
}

/** A tile's headline: up to `max` figures, the flagged ones first, in the card's own order. */
export function headline(c: Pick<GlanceCard, 'groups'>, max = 3): { shown: Stat[]; more: number; gap: Group | undefined; flagged: number } {
  const stats = c.groups.filter((g) => g.loaded).flatMap((g) => g.stats)
  const flagged = stats.filter((s) => s.tone === 'bad' || s.tone === 'warn')
  const picked = new Set([...flagged, ...stats.filter((s) => !flagged.includes(s))].slice(0, max))
  const shown = stats.filter((s) => picked.has(s))
  const gap = c.groups.find((g) => !g.loaded)
  return { shown, more: stats.length - shown.length, gap, flagged: flagged.length }
}

/** A figure for a tile, carrying `tone` only when there is something there (a quiet desk shows no colour). */
export function figure(label: string, v: number | null | undefined, tone?: Tone, value?: string): Stat {
  const n = v ?? 0
  const text = value ?? n.toLocaleString('en-GB')
  return tone && n > 0 ? { label, value: text, tone } : { label, value: text }
}

/**
 * One tile from figures a screen has already read. `stats` is null until the read has come back: the tile then
 * says it is being read, or that the read failed, and never shows zeros in the meantime.
 */
export function glanceCard(
  key: string, title: string, icon: Component, stats: Stat[] | null,
  state: { loading: boolean; error: string | null },
): GlanceCard {
  if (stats) return { key, title, icon, groups: [{ loaded: true, stats }] }
  const note = state.error ?? (state.loading ? 'Reading…' : 'Not read yet.')
  return { key, title, icon, groups: [{ loaded: false, unavailable: !!state.error, note, stats: [] }] }
}

/** A figure may wrap between its words but never inside a number ("US$ 1 466 000.00" keeps its digit groups together). */
export const unbroken = (v: string) => v.replace(/(\d) (?=\d)/g, '$1 ')
