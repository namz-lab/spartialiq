/**
 * "What is waiting on me" — one answer, for every finance role.
 *
 * WHY THIS IS A COMPOSABLE AND NOT A DASHBOARD
 * Before this module there were exactly two work queues in the whole finance workspace, and both
 * were buried inside the section they belonged to: the `awaitingMe` banner in Revisions and the
 * combined pending/approved list in Publication. Four handovers were therefore invisible, and the
 * audit found each one by reading the code rather than by using it:
 *
 *   - a departmental head had no "my department's lines awaiting my submission" at all;
 *   - the committee was never told that budget lines or projects were submitted to it;
 *   - the publisher's own queue was mixed in with the committee's;
 *   - the finance administrator, the only role that may commit an import batch, had no list of the
 *     batches validated and waiting for it — a batch could sit indefinitely with nobody informed;
 *   - a preparer whose line was returned was never told. "Returned" was terminal silence.
 *
 * This generalises the Revisions pattern, which was the one correct one, including its refusal: a
 * revision the viewer requested does not appear in the viewer's approval queue. It is surfaced in a
 * second, differently-worded queue — "awaiting another approver" — because the honest statement is
 * that the work exists and is not theirs to finish, not that it has gone away.
 *
 * WHERE THE COUNTS COME FROM
 * Entirely from endpoints that already exist, filtered. No count endpoint was added and no total is
 * computed over a partial page: `GET /finance/budget-lines` returns `total` for the whole filtered
 * set, so it is asked for one row and read for its count. Where a list is already small and
 * bounded — revisions, publications, import batches for one year — one request serves several
 * queues and they are derived from it, rather than one request per queue.
 *
 * WHAT IT WILL NOT DO
 * It will not invent a number. A queue whose read failed reports `count: null`, which renders as
 * "could not be read" and never as zero; the dev database has four budget lines, one transaction
 * and no ward register, and a screen that showed 0 where it meant "unknown" would be worse than one
 * that showed nothing. A queue whose count is genuinely zero says so in a sentence written for that
 * queue — a departmental head with nothing to submit should read that plainly.
 *
 * IT IS NOT A GATE. Every queue is built from a permission the server reported, and every action it
 * links to is re-checked by the server when taken.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useFinanceStore, messageOf } from '../stores/finance'
import { cashApi } from '../api/cashApi'
import { financeApi } from '../api/financeApi'
import type { FinanceSectionKey } from '../stores/rolePreset'
import { SECTION_TARGETS, type FinanceTarget } from '../shell/targets'

/** How urgently a queue reads. Never carried by colour alone — each tone has a word beside it. */
export type QueueTone = 'action' | 'watch' | 'info'

export interface FinanceQueue {
  id: string
  /** The count, or null when the read failed. Never 0 standing in for "unknown". */
  count: number | null
  /** "3 revisions awaiting your decision" is built from this plus the count. */
  label: string
  /** Why it is yours and what doing it means. One sentence. */
  help: string
  /** What to say when there is nothing. An honest empty state, not a blank panel. */
  empty: string
  tone: QueueTone
  /** The word that accompanies the tone, so status is never colour-only. */
  toneLabel: string
  /** Where the work is done. */
  section: FinanceSectionKey
  /** Query parameters so the section opens already filtered to this queue. */
  query?: Record<string, string>
  /**
   * Where the work is done, as a workspace target (shell/targets.ts). The console still reads
   * `section`; the workspaces resolve this through useFinanceNav.
   */
  target?: FinanceTarget
  /** A sentence that must appear with this queue — a separation-of-duties refusal, usually. */
  caveat?: string
}

export interface FinanceQueueSet {
  queues: FinanceQueue[]
  /** The queues whose read failed, named for the one banner that reports them. */
  failures: string[]
}

type FinanceStore = ReturnType<typeof useFinanceStore>

/** Today minus n days, as the `YYYY-MM-DD` the audit endpoint's `from` expects. */
function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * Gather the queues for whoever the store says is signed in.
 *
 * Exported as a plain function, not only as a composable, so "a revision the viewer requested never
 * appears in the viewer's approval queue" and "a dept_head with nothing to submit reads a sentence,
 * not a spinner" are assertions in a test rather than claims in a comment.
 */
export async function collectFinanceQueues(store: FinanceStore): Promise<FinanceQueueSet> {
  {
    const can = (code: string) => store.can(code)
    const year = store.selectedYearId
    const me = store.identity?.user_id ?? null
    const out: FinanceQueue[] = []
    const failed: string[] = []

    // Which reads this person's permissions warrant. Only these are issued.
    const wantsBudgetApproval = can('finance.budget.approve')
    const wantsBudgetPreparation = can('finance.budget.prepare') || can('finance.budget.submit')
    const wantsRevisions = can('finance.revision.approve') || can('finance.revision.prepare') || can('finance.revision.submit')
    const wantsProjects = can('finance.project.approve')
    // GAP-2. A ward split is a decision in exactly the same shape as a revision: recorded by one
    // officer, decided by another. Its queue therefore belongs in this composable rather than in a
    // second mechanism — the self-approval exclusion and the "awaiting another approver" sentence
    // are the parts that must not be reinvented.
    const wantsSplits = can('finance.budget.approve') || can('finance.project.approve')
    const wantsImports = can('finance.import.commit') || can('finance.import.exception.resolve')
    const wantsPublications = can('finance.publication.publish') || can('finance.publication.approve')
    const wantsExceptions = can('finance.variance.explain')
    // The cash office. A verifier is waiting on other people's counts; whoever posts vouchers is
    // waiting on bankings; a cashier is waiting on their own till.
    const wantsCashUps = can('finance.cash.session.verify')
    const wantsBankings = can('finance.cash.view') && can('finance.ledger.voucher.post')
    const wantsOwnTill = can('finance.cash.session.operate')
    const wantsRefusals = can('finance.audit.view') && (can('finance.audit.export') || can('finance.users.manage_finance_roles'))

    // The year-scoped reads need a year. The refusals read does not — an access problem is not
    // confined to a reporting period, which is exactly why a technical administrator has one.
    const needsYear = wantsBudgetApproval || wantsBudgetPreparation || wantsRevisions
      || wantsImports || wantsPublications || wantsExceptions

    if (needsYear && !year) {
      // Not an error and not an empty queue: the question has no answer until a period is chosen.
      return { queues: [], failures: [] }
    }

    const reads = await Promise.allSettled([
      wantsBudgetApproval && year
        ? financeApi.budgetLines({ financial_year_id: year, status: 'submitted', limit: 200 })
        : null,
      wantsBudgetPreparation && year
        ? financeApi.budgetLines({ financial_year_id: year, status: 'draft', limit: 1 })
        : null,
      wantsBudgetPreparation && year
        ? financeApi.budgetLines({ financial_year_id: year, status: 'returned', limit: 1 })
        : null,
      wantsRevisions && year
        ? financeApi.revisions({ financial_year_id: year, limit: 200 })
        : null,
      wantsProjects ? financeApi.projects({ status: 'awaiting_approval', limit: 200 }) : null,
      wantsImports && year ? financeApi.imports({ financial_year_id: year, limit: 200 }) : null,
      wantsPublications && year ? financeApi.publications({ financial_year_id: year }) : null,
      wantsExceptions && year ? financeApi.budgetExceptions(year) : null,
      wantsRefusals
        ? financeApi.audit({ status_min: 400, from: daysAgo(store.rolePreset.defaultFilters.auditDays ?? 30), limit: 200 })
        : null,
      // Not year-scoped: a project split belongs to no reporting period, and a draft sitting over a
      // year end is exactly the one nobody would otherwise be told about.
      wantsSplits ? financeApi.spatialAllocations({ status: 'draft', limit: 200 }) : null,
      // Not year-scoped either: a cash-up is waiting whichever period is on screen.
      wantsCashUps || wantsOwnTill ? cashApi.sessions({ status: 'closed', limit: 200 }) : null,
      wantsBankings ? cashApi.deposits({ status: 'draft', limit: 200 }) : null,
      wantsOwnTill ? cashApi.sessions({ status: 'open', mine: true, limit: 1 }) : null,
    ])

    const value = <T>(index: number): T | null => {
      const settled = reads[index]
      if (settled.status === 'fulfilled') return (settled.value as T | null) ?? null
      return null
    }
    const broke = (index: number): boolean => reads[index].status === 'rejected'

    // ── The committee: budget lines submitted to it (GAP-5) ──────────────────────────────────
    if (wantsBudgetApproval) {
      const page = value<Awaited<ReturnType<typeof financeApi.budgetLines>>>(0)
      // `total` is the whole filtered set; the page is only needed to split off the viewer's own
      // submissions, and 200 rows is far beyond any plausible single-year submission batch.
      const mine = (page?.lines ?? []).filter((l) => me !== null && l.submitted_by === me).length
      const total = page ? page.total : null
      const theirs = total === null ? null : Math.max(0, total - mine)
      out.push({
        id: 'budget-awaiting-approval',
        count: broke(0) ? null : theirs,
        label: 'Budget lines awaiting your approval',
        help: 'A submitted line is waiting on a decision. Approving it sets the council\'s approved allocation; returning it sends it back with a written reason.',
        empty: 'No budget line has been submitted for approval in this period.',
        tone: 'action',
        toneLabel: 'Needs a decision',
        section: 'budget',
        query: { status: 'submitted' },
        caveat: mine > 0
          ? `${mine} further submitted ${plural(mine, 'line is', 'lines are')} your own and ${plural(mine, 'is', 'are')} awaiting another approver. You hold the approval permission but cannot approve what you submitted — the route and the specification's §2.3 both refuse it.`
          : undefined,
      })
      if (broke(0)) failed.push('budget lines awaiting approval')
    }

    // ── The preparer: its own unfinished work, and what came back ────────────────────────────
    if (wantsBudgetPreparation) {
      const drafts = value<Awaited<ReturnType<typeof financeApi.budgetLines>>>(1)
      const returned = value<Awaited<ReturnType<typeof financeApi.budgetLines>>>(2)
      const scoped = store.isScoped
      out.push({
        id: 'budget-awaiting-submission',
        count: broke(1) ? null : (drafts?.total ?? null),
        label: scoped
          ? 'Your department\'s lines awaiting submission'
          : 'Draft lines awaiting submission',
        help: scoped
          ? `Draft allocations in ${store.departmentScope.map((d) => d.name).join(', ')}. Nothing goes to the committee until you submit it.`
          : 'Draft allocations. Nothing goes to the committee until it is submitted, and submitting it is not approving it.',
        empty: scoped
          ? 'Nothing in your votes is waiting to be submitted.'
          : 'No draft line is waiting to be submitted.',
        tone: 'action',
        toneLabel: 'Yours to do',
        section: 'budget',
        query: { status: 'draft' },
      })
      out.push({
        id: 'budget-returned',
        count: broke(2) ? null : (returned?.total ?? null),
        label: 'Lines returned to you',
        help: 'The committee sent these back with a reason. Edit the line and submit it again; the reason is on the row.',
        empty: 'Nothing has been returned.',
        tone: 'action',
        toneLabel: 'Yours to do',
        section: 'budget',
        query: { status: 'returned' },
      })
      if (broke(1)) failed.push('draft budget lines')
      if (broke(2)) failed.push('returned budget lines')
    }

    // ── Revisions: the pattern this composable generalises ───────────────────────────────────
    if (wantsRevisions) {
      const all = value<Awaited<ReturnType<typeof financeApi.revisions>>>(3) ?? []
      const submitted = all.filter((r) => r.state === 'submitted')
      const isOwn = (requestedBy: string) => me !== null && requestedBy === me
      if (can('finance.revision.approve')) {
        const theirs = submitted.filter((r) => !isOwn(r.requested_by))
        const own = submitted.filter((r) => isOwn(r.requested_by))
        out.push({
          id: 'revisions-awaiting-approval',
          count: broke(3) ? null : theirs.length,
          label: 'Revisions awaiting your decision',
          help: 'A supplementary allocation or a reduction on an approved line. The original approved figure is never overwritten; both stay visible.',
          empty: 'No revision is waiting on a decision.',
          tone: 'action',
          toneLabel: 'Needs a decision',
          section: 'revisions',
          query: { state: 'submitted' },
          caveat: own.length > 0
            ? `${own.length} further submitted ${plural(own.length, 'revision is', 'revisions are')} your own request and ${plural(own.length, 'is', 'are')} awaiting another approver. A CHECK constraint on finance.budget_revision refuses your own approval whatever this screen offers.`
            : undefined,
        })
      }
      if (can('finance.revision.prepare') || can('finance.revision.submit')) {
        const mine = all.filter((r) => r.state === 'draft' && isOwn(r.requested_by))
        out.push({
          id: 'revisions-awaiting-submission',
          count: broke(3) ? null : mine.length,
          label: 'Your draft revisions',
          help: 'A revision you raised and have not submitted. It changes nothing until it is submitted and someone else approves it.',
          empty: 'You have no unsubmitted revision.',
          tone: 'watch',
          toneLabel: 'Yours to do',
          section: 'revisions',
          query: { state: 'draft' },
        })
      }
      if (broke(3)) failed.push('revisions')
    }

    // ── Projects awaiting approval (GAP-7) ───────────────────────────────────────────────────
    if (wantsProjects) {
      const projects = value<Awaited<ReturnType<typeof financeApi.projects>>>(4) ?? []
      out.push({
        id: 'projects-awaiting-approval',
        count: broke(4) ? null : projects.length,
        label: 'Projects awaiting your approval',
        help: 'A project submitted for approval. Approving it does not allocate money to it; allocation is a separate act against a budget line.',
        empty: 'No project is waiting on a decision.',
        tone: 'action',
        toneLabel: 'Needs a decision',
        section: 'projects',
        query: { status: 'awaiting_approval' },
      })
      if (broke(4)) failed.push('projects awaiting approval')
    }

    // ── Import batches: the commit no one else may make (GAP-6) ──────────────────────────────
    if (wantsImports) {
      const batches = value<Awaited<ReturnType<typeof financeApi.imports>>>(5) ?? []
      if (can('finance.import.commit')) {
        const validated = batches.filter((b) => b.status === 'validated')
        out.push({
          id: 'imports-awaiting-commit',
          count: broke(5) ? null : validated.length,
          label: 'Batches validated and awaiting your commit',
          help: 'Validation is a second pair of eyes; committing is yours alone. Until a batch is committed none of its figures are in the register.',
          empty: 'No validated batch is waiting to be committed.',
          tone: 'action',
          toneLabel: 'Only you can do this',
          section: 'imports',
          query: { status: 'validated' },
        })
      }
      if (can('finance.import.exception.resolve')) {
        const live = batches.filter((b) => !['committed', 'cancelled', 'superseded', 'failed'].includes(b.status))
        const open = live.reduce((n, b) => n + Number(b.open_exceptions ?? 0), 0)
        out.push({
          id: 'imports-open-exceptions',
          count: broke(5) ? null : open,
          label: 'Open exceptions on batches not yet committed',
          help: 'Each exception names the row as the officer\'s own spreadsheet numbers it, the field and the reason. A batch cannot be trusted until they are resolved or accepted.',
          empty: 'No batch has an unresolved exception.',
          tone: 'action',
          toneLabel: 'Yours to do',
          section: 'imports',
        })
      }
      if (broke(5)) failed.push('import batches')
    }

    // ── Publication: the publisher's half and the committee's half, kept apart ───────────────
    if (wantsPublications) {
      const publications = value<Awaited<ReturnType<typeof financeApi.publications>>>(6) ?? []
      if (can('finance.publication.publish')) {
        const approved = publications.filter((p) => p.state === 'approved')
        out.push({
          id: 'publication-awaiting-release',
          count: broke(6) ? null : approved.length,
          label: 'Approved and awaiting publication',
          help: 'Someone else approved these for release. Publishing one puts its dataset on the public portal in the same instant; withdrawing it takes it off without changing a financial record.',
          empty: 'Nothing is approved and waiting to be released.',
          tone: 'action',
          toneLabel: 'Only you can do this',
          section: 'publication',
          query: { state: 'approved' },
        })
      }
      if (can('finance.publication.approve')) {
        const pending = publications.filter((p) => p.state === 'pending')
        out.push({
          id: 'publication-awaiting-approval',
          count: broke(6) ? null : pending.length,
          label: 'Releases awaiting your approval',
          help: 'A request to put a dataset in front of residents. Approving it is not publishing it — that is a separate act by the publisher.',
          empty: 'No release is waiting on a decision.',
          tone: 'action',
          toneLabel: 'Needs a decision',
          section: 'publication',
          query: { state: 'pending' },
        })
      }
      if (broke(6)) failed.push('publications')
    }

    // ── Variance: the work the explanation permission exists for ─────────────────────────────
    if (wantsExceptions) {
      const exceptions = value<Awaited<ReturnType<typeof financeApi.budgetExceptions>>>(7)
      out.push({
        id: 'budget-flagged',
        count: broke(7) ? null : (exceptions?.rows.length ?? null),
        label: 'Lines flagged against the council\'s thresholds',
        help: 'Advisory, not blocking. You hold the variance-explanation permission: an explanation recorded against the line is what turns a flag into a known position.',
        empty: 'No line is over or near the council\'s thresholds.',
        tone: 'watch',
        toneLabel: 'Worth a look',
        section: 'budget',
      })
      if (broke(7)) failed.push('flagged lines')
    }

    // ── Ward splits awaiting a decision (GAP-2) ──────────────────────────────────────────────
    //
    // Only the splits this person may actually decide are counted: a budget-line split rides
    // finance.budget.approve and a project split finance.project.approve, and the server re-checks
    // per subject kind. A draft the viewer recorded is excluded and reported in the caveat, because
    // the honest statement is that the work exists and is not theirs to finish.
    if (wantsSplits) {
      const page = value<Awaited<ReturnType<typeof financeApi.spatialAllocations>>>(9)
      const decidable = (page?.allocations ?? []).filter((a) =>
        a.subject_kind === 'budget_line' ? can('finance.budget.approve') : can('finance.project.approve'))
      const own = decidable.filter((a) => me !== null && a.requested_by === me)
      const theirs = decidable.length - own.length
      out.push({
        id: 'spatial-splits-awaiting-decision',
        count: broke(9) ? null : theirs,
        label: 'Ward splits awaiting your decision',
        help: 'A geographic split of a budget line or a project, with the methodology its author recorded. Until it is approved the whole amount is attributed by one ward code, or by none — approving it is what makes the ward map correct for money that spans wards.',
        empty: 'No ward split is waiting on a decision.',
        tone: 'action',
        toneLabel: 'Needs a decision',
        section: 'map',
        query: { splits: 'draft' },
        caveat: own.length > 0
          ? `${own.length} further draft ${plural(own.length, 'split is', 'splits are')} your own and ${plural(own.length, 'is', 'are')} awaiting another approver. The route refuses a decision by the officer who recorded the split (self_approval), whatever this screen offers.`
          : undefined,
      })
      if (broke(9)) failed.push('ward splits awaiting a decision')
    }

    // ── Refusals: an access problem presents as a 403 ────────────────────────────────────────
    if (wantsRefusals) {
      const audit = value<Awaited<ReturnType<typeof financeApi.audit>>>(8)
      const days = store.rolePreset.defaultFilters.auditDays ?? 30
      out.push({
        id: 'audit-refusals',
        count: broke(8) ? null : (audit?.events.length ?? null),
        label: `Refused finance attempts in the last ${days} days`,
        help: 'A refused request is as much a part of the record as a successful one. A cluster of them is usually a permission that someone needs and does not hold.',
        empty: `No finance request has been refused in the last ${days} days.`,
        tone: 'info',
        toneLabel: 'For review',
        section: 'audit',
      })
      if (broke(8)) failed.push('refused attempts')
    }

    // ── The cash office ──────────────────────────────────────────────────────────────────────
    if (wantsCashUps) {
      const page = value<Awaited<ReturnType<typeof cashApi.sessions>>>(10)
      // Not the viewer's own count, and not one they counted or witnessed under supervision
      // (migration 208): the server refuses all three, so none of them is work waiting on them.
      const theirs = (page?.sessions ?? []).filter((s) => me === null
        || (s.cashier_id !== me && s.closed_by !== me && s.witness_id !== me)).length
      out.push({
        id: 'cash-ups-awaiting-verification',
        count: broke(10) ? null : (page ? theirs : null),
        label: 'Cash-ups awaiting your verification',
        help: 'A cashier has declared a count. Until somebody else agrees it, none of that session\'s receipts is in the book of account and its takings cannot be banked.',
        empty: 'No cash-up is waiting to be verified.',
        tone: 'action',
        toneLabel: 'Needs a decision',
        section: 'cash',
        query: { view: 'sessions' },
      })
      if (broke(10)) failed.push('cash-ups awaiting verification')
    }
    if (wantsBankings) {
      const page = value<Awaited<ReturnType<typeof cashApi.deposits>>>(11)
      const theirs = (page?.deposits ?? []).filter((d) => me === null || d.prepared_by !== me).length
      out.push({
        id: 'bankings-awaiting-posting',
        count: broke(11) ? null : (page ? theirs : null),
        label: 'Bankings awaiting posting',
        help: 'Takings carried to the bank and recorded against a deposit slip. Posting one moves the money from the till to the bank account in the book of account.',
        empty: 'No banking is waiting to be posted.',
        tone: 'action',
        toneLabel: 'Needs a decision',
        section: 'cash',
        query: { view: 'banking' },
      })
      if (broke(11)) failed.push('bankings awaiting posting')
    }
    if (wantsOwnTill) {
      const open = value<Awaited<ReturnType<typeof cashApi.sessions>>>(12)
      const closed = value<Awaited<ReturnType<typeof cashApi.sessions>>>(10)
      const mineClosed = (closed?.sessions ?? []).filter((s) => me !== null && s.cashier_id === me).length
      out.push({
        id: 'cash-own-till',
        count: broke(12) ? null : (open ? open.total : null),
        label: 'Your till is open',
        help: 'Every payment you take today is receipted in this session. Cash it up before you leave: a till left open cannot be verified or banked.',
        empty: 'You have no till open. Open one at the counter to start taking payments.',
        tone: 'watch',
        toneLabel: 'In progress',
        section: 'cash',
        query: { view: 'counter' },
      })
      if (mineClosed > 0) {
        out.push({
          id: 'cash-own-awaiting',
          count: mineClosed,
          label: 'Your cash-up awaiting verification',
          help: 'You have declared this count. It waits on somebody else, and may be sent back to you for a recount.',
          empty: '',
          tone: 'info',
          toneLabel: 'With somebody else',
          section: 'cash',
          query: { view: 'sessions' },
        })
      }
      if (broke(12)) failed.push('your till')
    }

    return { queues: out.map((q) => ({ ...q, target: targetOf(q) })), failures: failed }
  }
}

/** The workspace target a queue opens: the cash office tab it names, else its section. */
export function targetOf(queue: Pick<FinanceQueue, 'section' | 'query'>): FinanceTarget {
  const view = queue.query?.view
  if (queue.section === 'cash' && (view === 'counter' || view === 'sessions' || view === 'banking' || view === 'setup')) {
    return `cash.${view}`
  }
  return SECTION_TARGETS[queue.section]
}

/**
 * The same thing, mounted in a component: reactive, reloaded when the reporting period changes.
 */
export function useFinanceQueues() {
  const store = useFinanceStore()

  const queues = ref<FinanceQueue[]>([])
  const failures = ref<string[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const yearId = computed(() => store.selectedYearId)

  async function load(): Promise<void> {
    if (!store.identity) { queues.value = []; return }
    loading.value = true
    error.value = null
    try {
      const result = await collectFinanceQueues(store)
      queues.value = result.queues
      failures.value = result.failures
    } catch (err) {
      // A single queue failing is reported inside that queue; reaching here means the whole
      // gathering fell over, which is worth a banner.
      error.value = messageOf(err, 'What is waiting on you could not be read.')
    } finally {
      loading.value = false
    }
  }

  onMounted(() => { void load() })
  watch([yearId, () => store.identity?.user_id], () => { void load() })

  /** The queues with something in them. What a role should see first. */
  const actionable = computed(() => queues.value.filter((q) => q.count !== null && q.count > 0))
  /** The queues that read cleanly and are empty. Shown as sentences, not as zeroes. */
  const clear = computed(() => queues.value.filter((q) => q.count === 0))
  /** The queues whose count could not be read. Never shown as zero. */
  const unreadable = computed(() => queues.value.filter((q) => q.count === null))

  /** Everything waiting, for the one line a screen reader is given. */
  const waiting = computed(() => actionable.value.reduce((n, q) => n + (q.count ?? 0), 0))

  /** Per section, so the rail can carry a count. */
  const countsBySection = computed<Partial<Record<FinanceSectionKey, number>>>(() => {
    const totals: Partial<Record<FinanceSectionKey, number>> = {}
    for (const q of actionable.value) {
      if (q.tone === 'info') continue
      totals[q.section] = (totals[q.section] ?? 0) + (q.count ?? 0)
    }
    return totals
  })

  return {
    queues, loading, error, failures,
    actionable, clear, unreadable, waiting, countsBySection,
    reload: load,
  }
}
