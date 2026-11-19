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
  status: string
  identifiers: PersonIdentifier[]
  appears_as: { applications: number; objections: number; receipts: number }
  /** Set on search results and duplicate warnings: why this person was found. */
  match?: 'national_id' | 'passport' | 'company_registration' | 'phone' | 'name'
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
  async register(body: NewPerson): Promise<{ person: Person } | RegisterConflict> {
    try {
      const r = await api.post('/persons', body)
      return { person: r.data.data.person }
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
  async linkApplicant(permitId: string, personId: string | null): Promise<void> {
    await api.put(`/permit-applications/${encodeURIComponent(permitId)}/applicant-person`, { person_id: personId })
  },
  async linkObjector(objectionId: string, personId: string | null): Promise<void> {
    await api.put(`/objections/${encodeURIComponent(objectionId)}/objector-person`, { person_id: personId })
  },
}
