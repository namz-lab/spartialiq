// The council's register of persons (backend src/routes/persons.js, migration 256): one record for each person or
// organisation, shared by every department. Search before registering; identity numbers arrive masked unless revealed.
import api from './api'

export type PersonKind = 'individual' | 'organisation'
export type Channel = 'sms' | 'email' | 'post' | 'collect'
export type IdentifierKind = 'national_id' | 'passport' | 'company_registration'

export interface PersonIdentifier { kind: IdentifierKind; value: string; masked: boolean }

export interface Person {
  id: string
  kind: PersonKind
  title: string | null
  surname: string | null
  first_names: string | null
  organisation_name: string | null
  display_name: string
  phone: string | null
  alt_phone: string | null
  email: string | null
  physical_address: string | null
  postal_address: string | null
  ward_no: number | null
  preferred_channel: Channel
  source: 'counter' | 'online' | 'backfill' | 'import'
  verified: boolean
  verified_at: string | null
  verified_how: string | null
  date_of_birth: string | null
  /** 0 recorded, 1 identity verified, 2 resident or ratepayer, 3 original sighted (migration 257). */
  assurance_level: AssuranceLevel
  level_label: string
  resident: boolean
  identity_method: 'original_sighted' | 'copy_approved' | null
  original_sighted_at: string | null
  residency_verified_at: string | null
  residency_evidence: string | null
  /** The latest answer from the Registrar-General, if one was asked. */
  registrar_general: RgCheck | null
  status: string
  identifiers: PersonIdentifier[]
  appears_as: { applications: number; objections: number; receipts: number }
  /** Set on search results and duplicate warnings: why this person was found. */
  match?: 'national_id' | 'passport' | 'company_registration' | 'phone' | 'name'
}

export type AssuranceLevel = 0 | 1 | 2 | 3

export type RgOutcome = 'match' | 'partial' | 'no_match' | 'not_found' | 'unavailable'
export type RgField = 'match' | 'partial' | 'no_match' | 'not_supplied'
export interface RgCheck {
  id?: string
  document_type: 'national_id' | 'passport'
  outcome: RgOutcome
  document_status: 'valid' | 'expired' | 'cancelled' | 'reported_lost_or_stolen' | 'holder_deceased' | null
  fields: Partial<Record<'surname' | 'first_names' | 'date_of_birth', RgField>>
  rg_reference?: string | null
  reference?: string | null
  service: string
  requested_at?: string
  message?: string
  /** Why this answer stops the document verifying identity, or null. */
  blocks: string | null
}
export interface RgStatus { available: boolean; mode: 'off' | 'prototype' | 'http'; prototype?: boolean; label: string }

export interface AssuranceEvent { event: string; method: string | null; evidence: string | null; level_after: AssuranceLevel; recorded_role: string | null; recorded_at: string }

export const LEVELS: { level: AssuranceLevel; label: string; means: string }[] = [
  { level: 0, label: 'Recorded', means: 'A name as given; nothing checked.' },
  { level: 1, label: 'Identity verified', means: 'The identity document was checked: a copy approved by an officer, or the original seen.' },
  { level: 2, label: 'Resident or ratepayer', means: 'Identity verified, and residence in the district proved.' },
  { level: 3, label: 'Original sighted', means: 'The original identity document was handled at the counter.' },
]
/** The desks that raise a person's level (backend src/services/personAssurance.js). Others register at level 0. */
export const VERIFIERS = ['planning_clerk', 'cash_supervisor', 'admin']
export const RESIDENCY_EVIDENCE: Record<string, string> = {
  title_deed: 'Title deed',
  occupation_certificate: 'Certificate of occupation',
  lodgers_permit: "Lodger's permit",
  settlement_letter: 'Offer or settlement letter',
  proof_of_residence: 'Rates or utility statement',
  chiefs_letter: 'Letter from the councillor, village head, headman or chief',
}
export const RG_FIELD_LABEL: Record<RgField, string> = { match: 'agrees', partial: 'agrees in part', no_match: 'does not agree', not_supplied: 'not sent' }
export const RG_OUTCOME_LABEL: Record<RgOutcome, string> = {
  match: 'Everything sent agrees',
  partial: 'The document is theirs; some particulars agree only in part or were not sent',
  no_match: 'The particulars do not agree',
  not_found: 'No such document',
  unavailable: 'The service did not answer',
}
export const RG_STATUS_LABEL: Record<string, string> = {
  valid: 'Valid', expired: 'Expired', cancelled: 'Cancelled', reported_lost_or_stolen: 'Reported lost or stolen', holder_deceased: 'Holder deceased',
}

export interface NewPerson {
  kind: PersonKind
  title?: string | null
  surname?: string | null
  first_names?: string | null
  organisation_name?: string | null
  phone?: string | null
  email?: string | null
  physical_address?: string | null
  postal_address?: string | null
  ward_no?: number | null
  date_of_birth?: string | null
  preferred_channel: Channel
  identifiers?: { kind: IdentifierKind; value: string }[]
  verified?: boolean
  verified_how?: string | null
  confirm_new?: boolean
}

export interface PersonRecord {
  person: Person
  applications: { id: string; tpd_reference: string | null; dev_register_no: string | null; stand_number: string | null; development_type: string; status: string; received_at: string | null }[]
  objections: { id: string; received_at: string; sustained: boolean | null; permit_app_id: string; tpd_reference: string | null; stand_number: string | null }[]
  /** null: this post does not read the cash office's receipts. */
  receipts: { id: string; receipt_no: string; amount: string; currency: string; received_on: string }[] | null
  history: AssuranceEvent[]
  registrar_general_checks: RgCheck[]
}

/** A refusal that names people already in the register: the same ID, or the same phone or name. */
export interface RegisterConflict { error: 'already_registered' | 'possible_duplicate'; message: string; persons: Person[] }

export const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Rev', 'Chief'] as const
export const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', email: 'Email', post: 'Post', collect: 'Collect at the office' }
export const ID_LABEL: Record<IdentifierKind, string> = { national_id: 'National ID', passport: 'Passport', company_registration: 'Company registration' }
export const MATCH_LABEL: Record<NonNullable<Person['match']>, string> = {
  national_id: 'same national ID', passport: 'same passport', company_registration: 'same company number', phone: 'same phone', name: 'same name',
}

/** A Zimbabwean national ID however written: 63-123456 X 27, 631234567x27. */
export const looksLikeNationalId = (v: string) => /^[0-9]{2}[0-9]{6,7}[A-Z][0-9]{2}$/.test(v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())

export const personsApi = {
  async search(q: string): Promise<Person[]> {
    const r = await api.get('/persons/search', { params: { q } })
    return r.data.data.persons
  },
  async get(id: string, reveal = false): Promise<PersonRecord> {
    const r = await api.get(`/persons/${encodeURIComponent(id)}`, { params: reveal ? { reveal: 1 } : undefined })
    return r.data.data
  },
  /** Register a person. A conflict comes back as a value, not an error: the counter shows who is already there. */
  async register(body: NewPerson): Promise<{ person: Person; warning?: string | null } | RegisterConflict> {
    try {
      const r = await api.post('/persons', body)
      return { person: r.data.data.person, warning: r.data.data.warning ?? null }
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { error?: string; message?: string; data?: { persons?: Person[] } } } }).response
      if (res?.status === 409 && (res.data?.error === 'already_registered' || res.data?.error === 'possible_duplicate')) {
        return { error: res.data.error, message: res.data.message || '', persons: res.data.data?.persons || [] }
      }
      throw err
    }
  },
  async update(id: string, body: Partial<NewPerson>): Promise<Person> {
    const r = await api.patch(`/persons/${encodeURIComponent(id)}`, body)
    return r.data.data.person
  },
  /** Raise a person's level: the original identity document seen, or residence proved. The registrar's desks only. */
  async raise(id: string, body: { step: 'original_sighted' | 'residency'; how: string; evidence?: string }): Promise<Person> {
    const r = await api.post(`/persons/${encodeURIComponent(id)}/assurance`, body)
    return r.data.data.person
  },
  async registrarGeneralCheck(id: string, documentType?: 'national_id' | 'passport'): Promise<RgCheck> {
    const r = await api.post(`/persons/${encodeURIComponent(id)}/registrar-general-check`, documentType ? { document_type: documentType } : {})
    return r.data.data.check
  },
  async registrarGeneralStatus(): Promise<RgStatus> {
    const r = await api.get('/registrar-general/status')
    return r.data.data
  },
  async unlinked(role?: 'applicant' | 'objector'): Promise<{ total: number; records: UnlinkedRecord[] }> {
    const r = await api.get('/persons/unlinked', { params: role ? { role } : undefined })
    return r.data.data
  },
  async linkApplicant(permitId: string, personId: string | null): Promise<void> {
    await api.put(`/permit-applications/${encodeURIComponent(permitId)}/applicant-person`, { person_id: personId })
  },
  async linkObjector(objectionId: string, personId: string | null): Promise<void> {
    await api.put(`/objections/${encodeURIComponent(objectionId)}/objector-person`, { person_id: personId })
  },
}

export interface UnlinkedRecord {
  role: 'applicant' | 'objector'
  record_id: string
  name_as_written: string
  has_id_number: boolean
  phone_as_written: string | null
  reference: string | null
  recorded_at: string
}

/** The Registrar-General PROTOTYPE's own console (migration 258): who asked what, and the answer given. */
export interface RgConsole {
  register: { national_ids: number; passports: number; clients: number }
  outcomes: Partial<Record<RgOutcome, number>>
  recent: {
    reference: string; requested_at: string; client: string; document_type: string; document_number: string
    particulars_sent: string[]; outcome: RgOutcome; document_status: string | null; fields: RgCheck['fields']; purpose: string
  }[]
}
export interface RgAnswer {
  reference: string; checked_at: string; document_type: string; document_found: boolean
  document_status: string | null; fields: RgCheck['fields']; outcome: RgOutcome
}
export const rgPrototypeApi = {
  async console(): Promise<RgConsole> {
    const r = await api.get('/rg-prototype/console')
    return r.data.data
  },
  /** Ask the prototype as a client would, with a client key. The console's "try it" panel. */
  async ask(body: { document_type: string; document_number: string; surname: string; first_names?: string; date_of_birth?: string; purpose: string }, key: string): Promise<RgAnswer> {
    const r = await api.post('/rg-prototype/v1/verifications', body, { headers: { 'X-RG-Client-Key': key } })
    return r.data
  },
}
