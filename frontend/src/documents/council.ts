/**
 * The council's identity, in one place. Every letterhead — PDF, screen, print
 * and email — renders from this module, so a notice and the certificate that
 * follows it cannot drift apart.
 *
 * Pure data and pure functions: no Vue, no I/O, no jsPDF.
 */

export interface CouncilIdentity {
  name: string
  department: string
  address: string
  telephone: string
  email: string
  /** Telephone and email as one line, for a letterhead's contact row. */
  contactLine: () => string
}

export const COUNCIL: CouncilIdentity = {
  name: 'VUNGU RURAL DISTRICT COUNCIL',
  department: 'Department of Environmental Health',
  address: 'Stand 1, Gweru Road, Gweru, Zimbabwe',
  telephone: '+263 54 123 456',
  email: 'admin@vungu.gov.zw',
  contactLine() {
    return `Tel: ${this.telephone}  |  ${this.email}`
  },
}

/**
 * The one swap point. Drop the council's real letterhead artwork at this path
 * under `public/` and every surface picks it up with no code change.
 *
 * Until that file exists, every renderer falls back to a typographic
 * letterhead. That fallback is deliberate: the previous surveyor
 * implementation hard-coded an image path that did not exist, so every print
 * carried a broken image.
 */
export const LETTERHEAD_ASSET = '/letterhead/council-letterhead.png'
