/**
 * Checklist marking and GPS helpers for the field console.
 *
 * Photo custody lives in @/inspector/evidenceQueue — it holds the original
 * bytes in IndexedDB until the server confirms the upload.
 */

import type { GpsObservation } from './useInspectionNavigation'

export type ItemMark = 'pass' | 'fail' | 'na' | 'not_inspected'

export function checklistComplete(
  items: Array<{ result: ItemMark; is_mandatory?: boolean }>,
): { ok: boolean; remaining: number; failed: number } {
  let remaining = 0
  let failed = 0
  for (const it of items) {
    if (it.result === 'not_inspected' && it.is_mandatory !== false) remaining++
    if (it.result === 'fail') failed++
  }
  return { ok: remaining === 0, remaining, failed }
}

export function overallFromMarks(
  items: Array<{ result: ItemMark }>,
  computed?: string | null,
): string {
  if (computed) return computed
  const failed = items.filter(i => i.result === 'fail').length
  const pending = items.filter(i => i.result === 'not_inspected').length
  if (pending) return 'not_completed'
  if (failed) return 'fail'
  return 'pass'
}

export function gpsPayload(obs: GpsObservation | null): { lng?: number; lat?: number } {
  if (!obs) return {}
  return { lng: obs.lng, lat: obs.lat }
}
