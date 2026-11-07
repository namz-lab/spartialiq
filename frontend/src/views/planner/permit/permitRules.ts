// src/views/planner/permit/permitRules.ts
// ─────────────────────────────────────────────────────────────────────────
// The statutory rule set behind permit issuance.
//
// WHY THIS MODULE EXISTS
// ----------------------
// Step4PermitDrafting.vue previously carried this literal:
//
//   • You have a right of appeal to the Administrative Court within one (1)
//     month of issue.
//   • This permit expires 12 months from issue if substantial work has not
//     commenced.
//
// Two separate problems with that:
//
//   1. It was a hard-coded legal assertion inside a presentation component. A
//      change in legislation meant editing a Vue template — with no version, no
//      citation, no effective date, and no way to tell which permits had been
//      issued under which wording.
//
//   2. Neither period is verifiable from any statutory source in this
//      repository. The one in-repo statutory constant is STATUTORY_DAYS = 90
//      ("Section 26(7) RTCP Act [Ch. 29:12]", src/composables/useStatutoryClock.ts).
//      Notably the backend's own decision letter
//      (../app-backend/src/routes/development-management.js,
//      renderDecisionLetter) deliberately writes "within the period prescribed
//      by the Act" rather than naming a number — whoever wrote it declined to
//      assert a specific appeal period.
//
// So the periods below are carried forward as DECLARED CONFIGURATION, each
// tagged with `status`. Anything not confirmable from a statutory source is
// marked 'unverified'; the UI renders those visibly as requiring confirmation,
// and the generated permit falls back to the same neutral wording the backend
// letter uses. This module invents no legal rule it cannot cite.
//
// EXTENSION POINT
// ---------------
// `setRuleProvider()` lets a backend statutory-rule service supply the set at
// runtime. Nothing in the UI reads a rule any other way, so wiring that service
// up is a one-line change here and touches no component.
// ─────────────────────────────────────────────────────────────────────────

export type RuleStatus = 'verified' | 'unverified'

export interface StatutoryRule {
  /** Stable identifier, recorded against anything issued under this rule. */
  id: string
  label: string
  /** Citation. An 'unverified' rule cites where the answer SHOULD come from. */
  source: string
  version: string
  /** ISO `YYYY-MM-DD`. */
  effectiveFrom: string
  status: RuleStatus
  /** Shown to the officer for an unverified rule. */
  note?: string
}

export interface DurationRule extends StatutoryRule {
  months?: number
  days?: number
}

export interface PermitRuleSet {
  version: string
  /** Statutory determination window — the deemed-refusal clock. */
  determinationPeriod: DurationRule
  /** Window in which a determination may be appealed. */
  appealPeriod: DurationRule
  /** Default commencement window. Overridable per permit by the officer. */
  implementationPeriod: DurationRule
  /** Narrative clauses carrying no arithmetic. */
  clauses: StatutoryRule[]
}

// ── The council's current declared rule set ──────────────────────────────
const DEFAULT_RULES: PermitRuleSet = {
  version: '2026.08.1',

  determinationPeriod: {
    id: 'rtcp.s26.7.determination',
    label: 'Statutory determination period',
    source: 'Regional, Town and Country Planning Act [Chapter 29:12] s.26(7); s.40(6) for a subdivision or consolidation (four months)',
    version: '1.1.0',
    effectiveFrom: '2026-01-01',
    status: 'verified',
    months: 3,   // calendar months from acknowledgement; the arithmetic lives in '@/statutory/periods'
    note: 'Checked against the Act, 2026-10: three calendar months from the date of acknowledgement, or any extension the applicant grants in writing; then deemed refused.',
  },

  appealPeriod: {
    id: 'rtcp.appeal.administrative-court',
    label: 'Appeal period (Administrative Court)',
    source: 'RTCP Act [Chapter 29:12] s.38(1)(a) (also s.44(1) for subdivisions): one month from notification of the decision, including a deemed refusal',
    version: '1.0.0',
    effectiveFrom: '2026-01-01',
    status: 'verified',
    months: 1,
  },

  implementationPeriod: {
    id: 'permit.implementation.commencement',
    label: 'Substantial commencement period',
    source: 'Permit condition (commencement) — set per permit by the deciding officer',
    version: '0.1.0-draft',
    effectiveFrom: '2026-01-01',
    status: 'unverified',
    months: 12,
    note:
      'A default, not a universal rule. The previous screen asserted that every '
      + 'permit lapses at 12 months; that belongs to the individual permit\'s '
      + 'commencement condition, so it is editable per permit and printed only as '
      + 'the period actually imposed.',
  },

  clauses: [
    {
      id: 'permit.appeal.risk',
      label: 'Action taken during the appeal window',
      source: 'Council standard permit note',
      version: '1.0.0',
      effectiveFrom: '2026-01-01',
      status: 'verified',
    },
    {
      id: 'rtcp.s26.12.amendment',
      label: 'Amendment of a permit',
      source: 'RTCP Act [Chapter 29:12] s.26(12)',
      version: '1.0.0',
      effectiveFrom: '2026-01-01',
      status: 'verified',
    },
    {
      id: 'permit.runs-with-land',
      label: 'Permit runs with the land',
      source: 'Council standard permit note',
      version: '1.0.0',
      effectiveFrom: '2026-01-01',
      status: 'verified',
    },
  ],
}

let provider: () => PermitRuleSet = () => DEFAULT_RULES

/**
 * Replace the rule source — e.g. with a set fetched from a backend statutory
 * rule service. Call once at app start. No component reads rules any other way.
 */
export function setRuleProvider(fn: () => PermitRuleSet): void {
  provider = fn
}

export function permitRules(): PermitRuleSet {
  return provider()
}

// ── Date arithmetic ──────────────────────────────────────────────────────
// Permit dates are date-only (`YYYY-MM-DD`): a statutory deadline is a calendar
// day, not an instant, and the backend's isDate() guard accepts only this form.
// Parsed as UTC so a browser timezone can never shift a deadline by a day.

export function toDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Add whole months, clamping to the last valid day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(dateOnly: string, months: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export interface PermitDates {
  decisionDate: string | null
  issueDate: string | null
  notificationDate: string | null
  implementationPeriodMonths: number
}

export interface DerivedDeadlines {
  /** Null while the appeal rule is unverified — we do not print a date we
   *  cannot defend. `appealBasis` names the event it would run from. */
  appealDeadline: string | null
  appealBasis: string
  appealRule: DurationRule
  /** Runs from the issue date, using the period imposed on THIS permit. */
  implementationDeadline: string | null
  implementationRule: DurationRule
}

/**
 * Derive statutory deadlines from the permit's own dates.
 *
 * The appeal deadline runs from the NOTIFICATION date where one exists — a
 * person cannot be time-barred from a decision they were never told about —
 * falling back to the decision date. It stays null while the appeal rule is
 * unverified, rather than asserting a date the Act may not support.
 */
export function deriveDeadlines(
  dates: PermitDates,
  rules: PermitRuleSet = permitRules(),
): DerivedDeadlines {
  const appealFrom = dates.notificationDate ?? dates.decisionDate
  const appealBasis = dates.notificationDate
    ? 'notification of the decision'
    : dates.decisionDate ? 'the decision date' : 'not yet determined'

  const appealRule = rules.appealPeriod
  const appealDeadline =
    appealRule.status === 'verified' && appealFrom
      ? (appealRule.months != null
          ? addMonths(appealFrom, appealRule.months)
          : appealRule.days != null ? addDays(appealFrom, appealRule.days) : null)
      : null

  const implementationDeadline =
    dates.issueDate && dates.implementationPeriodMonths > 0
      ? addMonths(dates.issueDate, dates.implementationPeriodMonths)
      : null

  return {
    appealDeadline,
    appealBasis,
    appealRule,
    implementationDeadline,
    implementationRule: rules.implementationPeriod,
  }
}

// ── Annexure 7 ───────────────────────────────────────────────────────────

export interface Annexure7Clause {
  ruleId: string
  text: string
  source: string
  version: string
  effectiveFrom: string
  status: RuleStatus
  note?: string
}

/**
 * The system-generated Annexure 7 clauses for one permit.
 *
 * Officer-authored notes are NOT produced here — they live in
 * `CaseFile.permit.annexure7Notes` and are rendered separately and labelled, so
 * a reader can always tell a statutory clause from an officer's remark.
 */
export function buildAnnexure7(
  dates: PermitDates,
  rules: PermitRuleSet = permitRules(),
): Annexure7Clause[] {
  const derived = deriveDeadlines(dates, rules)
  const out: Annexure7Clause[] = []

  const appeal = rules.appealPeriod
  out.push({
    ruleId: appeal.id,
    // State a period only when the rule is verified. Otherwise mirror the
    // council's own letter, which asserts no number.
    text: appeal.status === 'verified' && derived.appealDeadline
      ? `You may appeal to the Administrative Court against this decision by `
        + `${derived.appealDeadline} (${appeal.months ?? appeal.days} `
        + `${appeal.months ? 'month(s)' : 'day(s)'} from ${derived.appealBasis}).`
      : 'Should you be aggrieved by this decision, you may appeal to the Administrative '
        + 'Court within the period prescribed by the Act.',
    source: appeal.source,
    version: appeal.version,
    effectiveFrom: appeal.effectiveFrom,
    status: appeal.status,
    note: appeal.note,
  })

  const risk = rules.clauses.find(c => c.id === 'permit.appeal.risk')
  if (risk) {
    out.push({
      ruleId: risk.id,
      text: 'Any action taken on this permit during the appeal window is at your own risk.',
      source: risk.source, version: risk.version,
      effectiveFrom: risk.effectiveFrom, status: risk.status,
    })
  }

  const amend = rules.clauses.find(c => c.id === 'rtcp.s26.12.amendment')
  if (amend) {
    out.push({
      ruleId: amend.id,
      text: 'Amendments to this permit may be applied for under Section 26(12) of the '
        + 'Regional, Town and Country Planning Act [Chapter 29:12].',
      source: amend.source, version: amend.version,
      effectiveFrom: amend.effectiveFrom, status: amend.status,
    })
  }

  // State a lapse date only when a period was actually imposed on this permit.
  if (derived.implementationDeadline) {
    out.push({
      ruleId: rules.implementationPeriod.id,
      text: `Substantial commencement of the permitted development must occur within `
        + `${dates.implementationPeriodMonths} month(s) of issue — by `
        + `${derived.implementationDeadline} — failing which this permit lapses.`,
      source: rules.implementationPeriod.source,
      version: rules.implementationPeriod.version,
      effectiveFrom: rules.implementationPeriod.effectiveFrom,
      status: rules.implementationPeriod.status,
      note: rules.implementationPeriod.note,
    })
  }

  const land = rules.clauses.find(c => c.id === 'permit.runs-with-land')
  if (land) {
    out.push({
      ruleId: land.id,
      text: 'This permit runs with the land; subsequent owners inherit its rights and obligations.',
      source: land.source, version: land.version,
      effectiveFrom: land.effectiveFrom, status: land.status,
    })
  }

  return out
}

/** Rules an officer should confirm before issuing. Drives the UI warning. */
export function unverifiedRules(rules: PermitRuleSet = permitRules()): StatutoryRule[] {
  return [rules.determinationPeriod, rules.appealPeriod, rules.implementationPeriod, ...rules.clauses]
    .filter(r => r.status === 'unverified')
}
