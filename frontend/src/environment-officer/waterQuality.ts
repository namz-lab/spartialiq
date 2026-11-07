/**
 * Water-sample classification against the drinking-water guideline values.
 *
 * WHAT THIS IS
 * A SUGGESTION for the result field, shown beside the officer's own choice, so
 * a borehole with coliforms in it is never saved as "potable" by a slip of the
 * dropdown. The officer's selection is what is recorded — laboratory context
 * (a resample pending, a known lab error) is theirs to weigh, not ours.
 *
 * THE VALUES
 *   E. coli / faecal coliform   0 CFU per 100 ml             (WHO GDWQ)
 *   free residual chlorine      0.2 – 5 mg/L at point of use (WHO GDWQ;
 *                               ≥ 0.5 recommended in outbreaks)
 *   pH                          6.5 – 8.5                    (operational range)
 *
 * Microbial contamination is decisive: any faecal indicator makes a sample
 * not potable regardless of chemistry. Chemistry out of range alone makes it
 * borderline — treatable, and a reason to resample, but not proof of faecal
 * contamination.
 */

export type WaterResult = 'potable' | 'not_potable' | 'borderline' | 'pending'

export interface WaterReadings {
  ecoliCount: number | null
  faecalColiform: number | null
  freeChlorine: number | null
  ph: number | null
}

export interface Classification {
  result: WaterResult
  reasons: string[]
}

export const CHLORINE_MIN = 0.2
export const CHLORINE_MAX = 5
export const PH_MIN = 6.5
export const PH_MAX = 8.5

export function classifyWater(r: WaterReadings): Classification {
  const reasons: string[] = []
  const micro = r.ecoliCount != null || r.faecalColiform != null

  if ((r.ecoliCount ?? 0) > 0) reasons.push(`E. coli ${r.ecoliCount} CFU/100 ml — the guideline is 0`)
  if ((r.faecalColiform ?? 0) > 0) reasons.push(`Faecal coliform ${r.faecalColiform} CFU/100 ml — the guideline is 0`)
  if (reasons.length) return { result: 'not_potable', reasons }

  if (r.freeChlorine != null && r.freeChlorine < CHLORINE_MIN) {
    reasons.push(`Free chlorine ${r.freeChlorine} mg/L is below ${CHLORINE_MIN} mg/L`)
  }
  if (r.freeChlorine != null && r.freeChlorine > CHLORINE_MAX) {
    reasons.push(`Free chlorine ${r.freeChlorine} mg/L is above ${CHLORINE_MAX} mg/L`)
  }
  if (r.ph != null && (r.ph < PH_MIN || r.ph > PH_MAX)) {
    reasons.push(`pH ${r.ph} is outside ${PH_MIN}–${PH_MAX}`)
  }
  if (reasons.length) return { result: 'borderline', reasons }

  // Clean chemistry says nothing about faecal contamination. Without a
  // microbial reading there is no basis to call the water potable.
  if (!micro) return { result: 'pending', reasons: ['No microbial result yet'] }
  return { result: 'potable', reasons: [] }
}
