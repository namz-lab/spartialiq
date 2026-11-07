/**
 * Citizen-portal field rules. Shared by the TPD wizard, profile, payments,
 * notices, appeals and document staging so a letter cannot land in a
 * quantity field and a malformed ID cannot be submitted as a case.
 */

export type ApplicationCategory =
  | 'residential' | 'commercial' | 'industrial' | 'agricultural' | 'institutional'
  | 'subdivision' | 'change_of_use' | 'advertisement' | 'other'

export type WorksNature = 'new_building' | 'alteration' | 'addition' | 'change_of_use' | ''

export type PermitDevType =
  | 'new_building' | 'alteration' | 'extension' | 'change_of_use'
  | 'subdivision' | 'consolidation' | 'rezoning' | 'other'

/** Zimbabwe national ID: 12-345678-A-12 (dashes optional, check letter required). */
const NATIONAL_ID_RE = /^\d{2}-?\d{6,7}-?[A-Z]-?\d{2}$/i

/** Mobile: 07X XXX XXXX or +263 7X XXX XXXX. InnBucks 086 also accepted. */
const ZW_PHONE_RE = /^(?:\+?263|0)(?:7[1-9]\d{7}|86\d{7})$/

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PERSON_NAME_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,118}$/

export function sanitizeDecimal(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '')
  const first = cleaned.indexOf('.')
  if (first === -1) return cleaned
  return cleaned.slice(0, first + 1) + cleaned.slice(first + 1).replace(/\./g, '')
}

export function sanitizeInteger(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '')
}

export function sanitizePhone(raw: string): string {
  const s = String(raw ?? '').replace(/[^\d+]/g, '')
  const plus = s.startsWith('+') ? '+' : ''
  return plus + s.replace(/\+/g, '').replace(/^\+/, '')
}

export function sanitizeNationalId(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^0-9A-Z-]/g, '')
}

export function isPositiveNumber(
  raw: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): boolean {
  const s = String(raw ?? '').trim()
  if (!s || /[eE+]/.test(s)) return false
  const n = Number(s)
  if (!Number.isFinite(n)) return false
  const min = opts.min ?? 0
  if (n < min) return false
  if (opts.max != null && n > opts.max) return false
  if (opts.integer && !Number.isInteger(n)) return false
  return true
}

export function isNationalId(raw: string): boolean {
  return NATIONAL_ID_RE.test(String(raw ?? '').trim())
}

export function isZwPhone(raw: string): boolean {
  const digits = String(raw ?? '').replace(/[\s()-]/g, '')
  if (!digits) return false
  return ZW_PHONE_RE.test(digits)
}

export function isEmail(raw: string): boolean {
  const s = String(raw ?? '').trim()
  return s.length > 4 && s.length <= 255 && EMAIL_RE.test(s)
}

export function isPersonName(raw: string): boolean {
  const s = String(raw ?? '').trim()
  return PERSON_NAME_RE.test(s)
}

/** Job titles: letters, digits, and short punctuation (Planning Officer, EO-2). */
const JOB_TITLE_RE = /^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .'\-/&()]{0,118}$/

export function isJobTitle(raw: string): boolean {
  const s = String(raw ?? '').trim()
  return s.length >= 2 && JOB_TITLE_RE.test(s)
}

export const DOC_MAX_BYTES = 10 * 1024 * 1024
const DOC_EXT = /\.(pdf|jpe?g|png)$/i
const DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', ''])

export function documentFileError(file: File): string | null {
  if (file.size > DOC_MAX_BYTES) return `${file.name} is larger than 10 MB.`
  const mimeOk = !file.type || DOC_MIME.has(file.type.toLowerCase())
  if (!DOC_EXT.test(file.name) || !mimeOk) {
    return `${file.name} must be a PDF, JPG or PNG.`
  }
  return null
}

export function imageFileError(file: File): string | null {
  if (file.size > DOC_MAX_BYTES) return `${file.name} is larger than 10 MB.`
  const mimeOk = !file.type || file.type.toLowerCase().startsWith('image/')
  if (!/\.(jpe?g|png)$/i.test(file.name) || !mimeOk) {
    return `${file.name} must be a JPG or PNG.`
  }
  return null
}

/**
 * Map the citizen land-use category + nature of works onto the backend
 * permit `development_type` CHECK list. Sending "residential" 400s.
 */
export function toPermitDevType(
  category: ApplicationCategory | '' | string,
  works: WorksNature | string,
): PermitDevType {
  if (category === 'subdivision') return 'subdivision'
  if (category === 'change_of_use' || works === 'change_of_use') return 'change_of_use'
  if (works === 'new_building' || category === 'new_building') return 'new_building'
  if (works === 'alteration' || category === 'alteration') return 'alteration'
  if (works === 'addition' || category === 'extension') return 'extension'
  if (category === 'consolidation' || category === 'rezoning') return category
  return 'other'
}

export function parseOptionalNumber(raw: string): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
