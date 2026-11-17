/**
 * Audit sample selection over the transaction register.
 *
 * The population is a filtered, stably ordered register (`GET /finance/transactions` orders by the
 * chosen column and then by id, so position k always names the same row while the population does
 * not change). A sample is a set of positions in it, drawn from a seed the auditor can write down
 * and re-run: the same seed, population and size always give the same positions.
 *
 *   random       simple random sampling without replacement
 *   systematic   every k-th item from a random start, k = floor(population / size)
 *
 * Positions only. Nothing here reads or adds money.
 */

/** mulberry32: a small, well-known seeded generator. Deterministic across browsers. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type SampleMethod = 'random' | 'systematic'

/** Zero-based positions in the population, ascending. Never more than the population. */
export function samplePositions(population: number, size: number, seed: number, method: SampleMethod): number[] {
  const n = Math.max(0, Math.floor(population))
  const k = Math.min(n, Math.max(0, Math.floor(size)))
  if (!k) return []
  if (k === n) return Array.from({ length: n }, (_, i) => i)
  const rand = seededRandom(seed)
  if (method === 'systematic') {
    const interval = Math.floor(n / k)
    const start = Math.floor(rand() * interval)
    return Array.from({ length: k }, (_, i) => start + i * interval)
  }
  // Partial Fisher-Yates over a sparse map: exact, without allocating the whole population.
  const swapped = new Map<number, number>()
  const out: number[] = []
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (n - i))
    const vj = swapped.get(j) ?? j
    const vi = swapped.get(i) ?? i
    swapped.set(j, vi)
    out.push(vj)
  }
  return out.sort((a, b) => a - b)
}

/** A seed the auditor can read aloud: six digits. */
export const newSeed = (): number => 100000 + Math.floor(Math.random() * 900000)

/** The largest sample this screen draws: each item is one read of the register. */
export const MAX_SAMPLE = 60
