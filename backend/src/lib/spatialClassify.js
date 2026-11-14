/**
 * Choropleth classification and reliability rules for the spatial engine, in one place so the server
 * and the map cannot disagree about what a ward's colour means.
 *
 * Rules (from the cartographic literature the design follows):
 *   - 3 to 7 classes; the method (quantile or fixed policy thresholds) is always reported with the breaks.
 *   - Breaks are computed over the wards that HAVE a value. A ward with no figure is null, never 0: it
 *     is drawn "no data", not in the bottom class.
 *   - Fewer than two distinct values is not a scale: no breaks, and the map shades flat.
 *   - A rate over a small base is unstable. A ward whose denominator is below the measure's minimum is
 *     flagged `small_base` and drawn without a class, rather than letting one household swing the map.
 *
 * Quantile semantics deliberately match the frontend's computeBreaks
 * (frontend/src/modules/finance/composables/useFinanceMap.ts): nearest-rank over the distinct values,
 * de-duplicated so a skewed distribution cannot produce an empty class.
 */
'use strict'

const MIN_CLASSES = 3
const MAX_CLASSES = 7

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** Upper class edges, length = classes - 1 at most. Empty when there is nothing to classify. */
function computeBreaks(values, classes = 5) {
  const distinct = [...new Set(values.filter(isNum))].sort((a, b) => a - b)
  if (distinct.length < 2 || classes < 2) return []
  const breaks = []
  for (let i = 1; i < classes; i++) {
    const rank = Math.round((i / classes) * (distinct.length - 1))
    const edge = distinct[rank]
    if (edge !== undefined && (breaks.length === 0 || edge > breaks[breaks.length - 1])) breaks.push(edge)
  }
  return breaks
}

/** Policy thresholds, validated: finite, strictly increasing, within the class limits. */
function fixedBreaks(breaks) {
  if (!Array.isArray(breaks) || breaks.length === 0) return []
  if (!breaks.every(isNum)) throw new Error('fixed breaks must be finite numbers')
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i] <= breaks[i - 1]) throw new Error('fixed breaks must be strictly increasing')
  }
  if (breaks.length + 1 < MIN_CLASSES || breaks.length + 1 > MAX_CLASSES) {
    throw new Error(`a measure has ${MIN_CLASSES} to ${MAX_CLASSES} classes`)
  }
  return breaks
}

/**
 * The classification a map is told to use.
 * @param {number[]} values  the ward values that exist (nulls already removed or not: both are fine)
 * @param {{method?: 'quantile'|'fixed', classes?: number, fixed?: number[]}} opts
 * @returns {{method: 'quantile'|'fixed', breaks: number[], classes: number}}
 */
function classify(values, { method = 'quantile', classes = 5, fixed = null } = {}) {
  if (method === 'fixed') {
    const breaks = fixedBreaks(fixed)
    return { method: 'fixed', breaks, classes: breaks.length ? breaks.length + 1 : 0 }
  }
  const n = Math.min(MAX_CLASSES, Math.max(MIN_CLASSES, Math.round(classes)))
  const breaks = computeBreaks(values, n)
  return { method: 'quantile', breaks, classes: breaks.length ? breaks.length + 1 : 0 }
}

/** `no_data`, `small_base` (denominator below the measure's minimum) or `ok`. */
function reliabilityOf({ value, denominator, minDenominator }) {
  if (value === null || value === undefined || !isNum(Number(value))) return 'no_data'
  if (minDenominator !== null && minDenominator !== undefined
      && denominator !== null && denominator !== undefined && Number(denominator) < Number(minDenominator)) {
    return 'small_base'
  }
  return 'ok'
}

/**
 * Rank wards that have a value; ties share a rank (1, 2, 2, 4). Rank 1 is the best ward for a
 * "higher_is_better" measure, the lowest value for "lower_is_better", and the highest value when the
 * measure takes no side (neutral). Wards without a value, or on a small base, are not ranked.
 */
function rankWards(rows, direction = 'neutral') {
  const rankable = rows.filter((r) => isNum(r.value) && r.reliability !== 'small_base')
  const ascending = direction === 'lower_is_better'
  const sorted = [...rankable].sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
  const ranks = new Map()
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1]
    ranks.set(r.ward_code, prev && prev.value === r.value ? ranks.get(prev.ward_code) : i + 1)
  })
  return ranks
}

module.exports = { MIN_CLASSES, MAX_CLASSES, computeBreaks, fixedBreaks, classify, reliabilityOf, rankWards }
