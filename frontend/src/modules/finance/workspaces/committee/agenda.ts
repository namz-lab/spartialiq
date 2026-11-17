/**
 * The committee's agenda: everything submitted to it for a decision, by kind.
 *
 * Each kind is read only when the member holds the permission that decides it, so a member who
 * approves tariffs but not budgets never sees (or loads) the budget lines. That is presentation:
 * every approve, return and reject is re-checked by the server, which also refuses a decision on
 * one's own submission.
 *
 * Each kind loads on its own. A failed read of one kind is shown against that kind and does not
 * blank the rest of the agenda.
 *
 * Reads (all existing endpoints):
 *   budget       GET /finance/budget-lines?status=submitted       finance.budget.approve
 *   revision     GET /finance/budget-revisions?state=submitted    finance.revision.approve
 *   project      GET /finance/projects?status=awaiting_approval   finance.project.approve
 *   publication  GET /finance/publications?state=pending          finance.publication.approve
 *   tariff       GET /finance/rates/tariffs?status=draft          finance.rates.tariff.approve
 */
import { financeApi } from '../../api/financeApi'
import { ratesApi } from '../../api/ratesApi'
import type { BudgetLinePerformance, BudgetRevision, FinanceProject, Publication } from '../../models/types'
import type { RatesTariff } from '../../models/ratesTypes'
import { messageOf, useFinanceStore } from '../../stores/finance'
import { formatDateTime, formatMoney } from '../../composables/useMoney'
import { defineDashboard } from '../shared/useDashboard'

export type DecisionKind = 'budget' | 'revision' | 'project' | 'publication' | 'tariff'

export interface KindMeta {
  kind: DecisionKind
  /** The permission that decides this kind. */
  permission: string
  label: string
  /** One item, in a sentence. */
  noun: string
  /** What the committee is deciding, said once at the head of the group. */
  lead: string
  /** The audit event the server writes for the decision (src/middleware/auditLog.js). */
  event: string
}

export const KINDS: KindMeta[] = [
  { kind: 'budget', permission: 'finance.budget.approve', label: 'Budget lines', noun: 'budget line', event: 'FIN_BUDGET',
    lead: 'Lines of the estimates submitted by the budget office. Approving makes the allocation official; returning sends it back to the preparer with your reason.' },
  { kind: 'revision', permission: 'finance.revision.approve', label: 'Revisions and virements', noun: 'revision', event: 'FIN_REVISION',
    lead: 'Supplementary allocations and reductions to approved lines. The change is shown beside the line it alters; nothing is added up here.' },
  { kind: 'project', permission: 'finance.project.approve', label: 'Capital projects', noun: 'project', event: 'FIN_PROJECT',
    lead: 'Projects put forward for approval, with the budget asked for and what is already allocated to them.' },
  { kind: 'publication', permission: 'finance.publication.approve', label: 'Publications', noun: 'release', event: 'FIN_PUBLICATION',
    lead: 'Requests to release finance data to the public portal. Approving does not publish: the publisher does that, separately.' },
  { kind: 'tariff', permission: 'finance.rates.tariff.approve', label: 'Rates tariffs', noun: 'tariff', event: 'FIN_RATES_TARIFF',
    lead: 'Draft rates in the dollar per property category. Approval records the Council resolution that sets the rate; billing uses it from then on.' },
]

export const kindMeta = (k: DecisionKind): KindMeta => KINDS.find((m) => m.kind === k) as KindMeta

export interface KindRead<T> { allowed: boolean; items: T[]; error: string | null }

export interface Agenda {
  budget: KindRead<BudgetLinePerformance>
  revision: KindRead<BudgetRevision>
  project: KindRead<FinanceProject>
  publication: KindRead<Publication>
  /** Each draft carries the approved tariff it would replace, so the two can be read side by side. */
  tariff: KindRead<RatesTariff & { current?: RatesTariff | null }>
  read_at: string
}

async function read<T>(allowed: boolean, fetch: () => Promise<T[]>, message: string): Promise<KindRead<T>> {
  if (!allowed) return { allowed, items: [], error: null }
  try {
    return { allowed, items: await fetch(), error: null }
  } catch (err) {
    return { allowed, items: [], error: messageOf(err, message) }
  }
}

/** The tariff a draft would replace: the approved one for the same year, category and currency. */
export function currentTariff(draft: RatesTariff, approved: RatesTariff[]): RatesTariff | null {
  return approved.find((t) => t.financial_year_id === draft.financial_year_id
    && t.property_category_id === draft.property_category_id && t.currency === draft.currency) ?? null
}

export async function loadAgenda(can: (code: string) => boolean): Promise<Agenda> {
  const [budget, revision, project, publication, tariff] = await Promise.all([
    read(can('finance.budget.approve'),
      async () => (await financeApi.budgetLines({ status: 'submitted', limit: 500 })).lines,
      'The submitted budget lines could not be read.'),
    read(can('finance.revision.approve'),
      () => financeApi.revisions({ state: 'submitted', limit: 500 }),
      'The submitted revisions could not be read.'),
    read(can('finance.project.approve'),
      () => financeApi.projects({ status: 'awaiting_approval', limit: 500 }),
      'The projects awaiting approval could not be read.'),
    read(can('finance.publication.approve'),
      () => financeApi.publications({ state: 'pending' }),
      'The release requests could not be read.'),
    read(can('finance.rates.tariff.approve'), async () => {
      const [drafts, approved] = await Promise.all([
        ratesApi.tariffs({ status: 'draft' }),
        ratesApi.tariffs({ status: 'approved' }),
      ])
      return drafts.tariffs.map((t) => ({ ...t, current: currentTariff(t, approved.tariffs) }))
    }, 'The draft tariffs could not be read.'),
  ])
  return { budget, revision, project, publication, tariff, read_at: new Date().toISOString() }
}

export const pendingCount = (a: Agenda | null, k: DecisionKind): number => a?.[k].items.length ?? 0
export const pendingTotal = (a: Agenda | null): number => KINDS.reduce((n, m) => n + pendingCount(a, m.kind), 0)

/** The workspace's one read, shared by the layout (badges), the dashboard and the agenda. */
export const committeeDash = defineDashboard<Agenda>(
  () => loadAgenda((code) => useFinanceStore().can(code)),
  'The committee agenda could not be read.',
)

/**
 * A committee resolution reference, carried in the decision note where the endpoint has no field
 * of its own for it. Written as the first sentence so it reads naturally on every screen that
 * shows the note, and parsed back for the decision register.
 */
export function noteWithResolution(note: string, resolution: string): string {
  const ref = resolution.trim()
  const text = note.trim()
  return ref ? `Resolution ${ref}. ${text}` : text
}

export function resolutionOf(note: string | null | undefined): string | null {
  const m = /^Resolution ([^.\s][^.]*)\.\s/.exec(note ?? '')
  return m ? m[1].trim() : null
}

/** Signed revision amount: a supplementary allocation or a reduction. Read off the sign only. */
export const isReduction = (delta: string): boolean => delta.trim().startsWith('-')
export const unsigned = (delta: string): string => delta.trim().replace(/^[-+]/, '')

export const DATASET: Record<string, string> = {
  budget: 'Budget', revenue: 'Revenue', expenditure: 'Expenditure', projects: 'Capital projects', documents: 'Documents', reports: 'Financial reports',
}

/** What an item is, its key figure, and who or where it comes from: one line of the agenda. */
export const idOf = (k: DecisionKind, item: unknown): string =>
  k === 'budget' ? (item as BudgetLinePerformance).budget_line_id : k === 'project' ? (item as FinanceProject).project_id : (item as { id: string }).id

export function headline(k: DecisionKind, item: unknown): { title: string; figure: string; meta: string } {
  switch (k) {
    case 'budget': { const b = item as BudgetLinePerformance
      return { title: `${b.code} ${b.description}`, figure: formatMoney(b.original_amount, b.currency), meta: `${b.department_code ?? ''} ${b.department_name ?? ''}`.trim() } }
    case 'revision': { const r = item as BudgetRevision
      return { title: `${r.budget_line_code ?? ''} ${r.budget_line_description ?? ''} · revision ${r.revision_no}`.trim(),
        figure: `${isReduction(r.amount_delta) ? '−' : '+'}${formatMoney(unsigned(r.amount_delta), r.currency)}`,
        meta: `${r.requested_by_name ?? ''} · ${formatDateTime(r.requested_at)}` } }
    case 'project': { const p = item as FinanceProject
      return { title: `${p.reference} ${p.name}`, figure: formatMoney(p.approved_budget, p.currency), meta: p.department_name ?? '' } }
    case 'publication': { const p = item as Publication
      return { title: `${DATASET[p.dataset] ?? p.dataset} v${p.version}${p.reporting_period_label ? ` · ${p.reporting_period_label}` : ''}`, figure: '', meta: p.financial_year_label ?? '' } }
    case 'tariff': { const t = item as RatesTariff
      return { title: `${t.category_code} ${t.category_name} · ${t.currency}`, figure: `${t.rate_in_dollar} in the dollar`, meta: t.financial_year_label } }
  }
}

