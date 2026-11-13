<script setup lang="ts">
/**
 * The council finance workspace.
 *
 * One surface for everything the finance department does with the budget: set up the reporting
 * period and the classifications, prepare and revise allocations, import and reconcile the
 * accounting system's figures, track projects and their money, control what the public sees, report
 * and export, and read the trail.
 *
 * THE SECTIONS follow Appendix B of the Vungu RDC specification, grouped by the question each one
 * answers rather than by the table it reads:
 *   period    Overview · Financial years · Departments & accounts
 *   geo       Finance map
 *   budget    Budget · Revisions · Projects
 *   cash      Cash office
 *   revenue   Rates
 *   ledger    General ledger · Statements
 *   data      Transactions · Data imports · Reports & exports · Documents
 *   control   Publication · Audit history · Permissions · Finance access · Settings
 *
 * THE BOOK OF ACCOUNT IS ITS OWN GROUP, not a corner of "Data and reporting". The ledger
 * ORIGINATES figures; `transactions` restates what the council's previous accounting system
 * recorded, and during the parallel run the two are reconciled against each other rather than
 * read as one thing. Filing them together would invite exactly that confusion. Whether this
 * system may be described as the council's book of account at all is Council decision D16 and is
 * not settled; the sections say so on their own faces.
 *
 * THE RAIL IS SHAPED BY WHAT THE PERSON DOES, NOT ONLY BY WHAT THEY MAY SEE.
 * Six sections accept bare `finance.budget.view`, which all eight roles hold, so permission
 * filtering alone left a publisher looking at twelve sections of which two are its job and a
 * technical administrator at fourteen of which two are. The rail therefore has two bands — the
 * person's work, then everything else their permissions allow — and the landing section comes from
 * the role preset in `stores/rolePreset.ts`. That preset is PRESENTATION: it narrows nothing, it
 * makes nothing unreachable, and the server re-checks every action either way.
 *
 * WHAT IS DELIBERATELY ABSENT
 * There is no supplier-payment, payroll or procurement entry yet. The specification first put all
 * three out of scope (§1.3); the client has since directed otherwise, and they are scheduled as
 * Phases 3, 4 and 7 of docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md,
 * each arriving with the role that works it. What IS here since Phase 1 is money coming IN: the
 * cash office. There is also no "approve" control on a surface whose
 * role cannot approve: the rail hides nothing, but each section explains rather than offering a
 * button that would only produce a 403. Two absences that look like defects from the inside — a
 * finance administrator cannot administer finance access, and a technical administrator has no
 * finance map — are stated in words (`store.absenceNotes`, and Permissions) rather than left as a
 * gap in the rail.
 *
 * THE SECTION AND THE YEAR LIVE IN THE URL AND THE STORE RESPECTIVELY.
 * A finance conversation ends in "send me the link" as often as a planning one, so the section is
 * a query parameter, and an explicit `?section=` ALWAYS beats the role preset. The selected year is
 * in the store and remembered per browser, so moving between sections never silently changes which
 * period is on screen.
 *
 * The primitives are the shared ins-* sheet and the fin-* sheet beside it, both on the --ent-*
 * tokens: one console vocabulary across every staff role.
 */

import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore } from '../stores/finance'
import { useFinanceQueues } from '../composables/useFinanceQueues'
import { resolveActiveSection, type FinanceSectionKey } from '../stores/rolePreset'
import { useAuthStore } from '@/stores/auth'
import FinanceYearPicker from '../components/FinanceYearPicker.vue'
import FinanceWorkQueue from '../components/FinanceWorkQueue.vue'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import { financeRoleLabel } from '../shell/roleLabels'
import WorkspaceNotice from '../shell/WorkspaceNotice.vue'
import '@/views/inspector/inspector.css'
import './finance.css'

import FinanceOverviewSection from './sections/FinanceOverviewSection.vue'
import FinanceMapSection from './sections/MapSection.vue'
import FinancialYearsSection from './sections/FinancialYearsSection.vue'
import ClassificationsSection from './sections/ClassificationsSection.vue'
import BudgetSection from './sections/BudgetSection.vue'
import RevisionsSection from './sections/RevisionsSection.vue'
import ProjectsSection from './sections/ProjectsSection.vue'
import TransactionsSection from './sections/TransactionsSection.vue'
import ImportsSection from './sections/ImportsSection.vue'
import ReportsSection from './sections/ReportsSection.vue'
import PublicationSection from './sections/PublicationSection.vue'
import AccessSection from './sections/AccessSection.vue'
import DocumentsSection from './sections/DocumentsSection.vue'
import AuditSection from './sections/FinanceAuditSection.vue'
import PermissionsSection from './sections/PermissionsSection.vue'
import SettingsSection from './sections/FinanceSettingsSection.vue'
import LedgerSection from './sections/LedgerSection.vue'
import StatementsSection from './sections/StatementsSection.vue'
import RatesSection from './sections/RatesSection.vue'
import CashOfficeSection from './sections/CashOfficeSection.vue'

import {
  LayoutDashboard, Map, CalendarRange, Network, Wallet, FileDiff, HardHat,
  Upload, FileBarChart, Globe2, ScrollText, KeyRound, SlidersHorizontal, Users, Receipt,
  AlertTriangle, RefreshCw, Menu, X, Paperclip, BookOpen, Scale, Landmark, Banknote,
} from 'lucide-vue-next'

/** The section keys live with the role preset, which is the other half of the rail's behaviour. */
type SectionKey = FinanceSectionKey

type Group = 'period' | 'cash' | 'revenue' | 'ledger' | 'budget' | 'geo' | 'data' | 'control'

const GROUP_LABELS: Record<Group, string> = {
  period: 'Reporting period',
  // By office, in the order money moves through a council: taken at the counter, billed and
  // chased by revenue, kept by accounting, planned by budget.
  cash: 'Cash office',
  revenue: 'Revenue',
  ledger: 'Accounting',
  budget: 'Budget and projects',
  geo: 'Where the money goes',
  data: 'Data and reporting',
  control: 'Governance',
}

interface Section {
  key: SectionKey
  label: string
  icon: Component
  group: Group
  component: Component
  desc: string
  /** Any one of these is enough to open the section. The backend re-checks every action inside it. */
  requires: string[]
}

const SECTIONS: readonly Section[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'period', component: FinanceOverviewSection,
    desc: 'Where the budget stands, per currency, and what needs attention',
    requires: ['finance.budget.view', 'finance.actuals.view'] },
  { key: 'map', label: 'Finance map', icon: Map, group: 'geo', component: FinanceMapSection,
    desc: 'Ward choropleths of budget, revenue and expenditure — and what has no geography',
    requires: ['finance.map.view'] },

  { key: 'years', label: 'Financial years', icon: CalendarRange, group: 'period', component: FinancialYearsSection,
    desc: 'Create, open and close reporting periods',
    requires: ['finance.budget.view'] },
  { key: 'classifications', label: 'Departments & accounts', icon: Network, group: 'period', component: ClassificationsSection,
    desc: 'Votes, programmes and the Council-approved chart of accounts',
    requires: ['finance.budget.view'] },

  { key: 'budget', label: 'Budget', icon: Wallet, group: 'budget', component: BudgetSection,
    desc: 'Budget lines, their approval, and performance against actuals',
    requires: ['finance.budget.view'] },
  { key: 'revisions', label: 'Revisions', icon: FileDiff, group: 'budget', component: RevisionsSection,
    desc: 'Supplementary allocations and reductions, and who decided them',
    requires: ['finance.budget.view'] },
  { key: 'projects', label: 'Projects', icon: HardHat, group: 'budget', component: ProjectsSection,
    desc: 'The project register, its allocations and its actual spend',
    requires: ['finance.project.view'] },

  { key: 'ledger', label: 'General ledger', icon: BookOpen, group: 'ledger', component: LedgerSection,
    desc: 'The chart of accounts, the accounting periods, and the vouchers posted into them',
    requires: ['finance.ledger.view'] },
  { key: 'statements', label: 'Statements', icon: Scale, group: 'ledger', component: StatementsSection,
    desc: 'Trial balance, financial position, financial performance and debtor ageing — per currency',
    requires: ['finance.ledger.view'] },
  { key: 'cash', label: 'Cash office', icon: Banknote, group: 'cash', component: CashOfficeSection,
    desc: 'The counter, the cash-ups awaiting verification, and the takings carried to the bank',
    requires: ['finance.cash.view'] },
  { key: 'rates', label: 'Rates', icon: Landmark, group: 'revenue', component: RatesSection,
    desc: 'The valuation roll, the tariff, billing runs, receipts and arrears — and what billing is waiting on',
    requires: ['finance.rates.view'] },

  { key: 'transactions', label: 'Transactions', icon: Receipt, group: 'data', component: TransactionsSection,
    desc: 'The register of posted actuals, their source and whether any were corrected',
    requires: ['finance.transaction.view'] },
  { key: 'imports', label: 'Data imports', icon: Upload, group: 'data', component: ImportsSection,
    desc: 'Upload, map, validate, resolve exceptions, reconcile and commit',
    requires: ['finance.import.upload', 'finance.import.validate', 'finance.import.commit', 'finance.audit.view'] },
  { key: 'reports', label: 'Reports & exports', icon: FileBarChart, group: 'data', component: ReportsSection,
    desc: 'Budget versus actual, variance, departmental and project reports',
    requires: ['finance.report.view'] },
  { key: 'documents', label: 'Documents', icon: Paperclip, group: 'data', component: DocumentsSection,
    desc: 'Invoices, vouchers, contracts and approved budgets attached to financial records',
    requires: ['finance.document.view', 'finance.document.upload', 'finance.budget.view', 'finance.project.view'] },

  { key: 'publication', label: 'Publication', icon: Globe2, group: 'control', component: PublicationSection,
    desc: 'What the public sees, who approved it and when it was released',
    requires: ['finance.publication.review', 'finance.publication.approve', 'finance.publication.publish', 'finance.budget.view'] },
  { key: 'audit', label: 'Audit history', icon: ScrollText, group: 'control', component: AuditSection,
    desc: 'Every finance action, including the ones that were refused',
    requires: ['finance.audit.view'] },
  { key: 'permissions', label: 'Permissions', icon: KeyRound, group: 'control', component: PermissionsSection,
    desc: 'What your role may do, and which duties are held apart',
    requires: ['finance.budget.view', 'finance.project.view', 'finance.audit.view'] },
  { key: 'access', label: 'Finance access', icon: Users, group: 'control', component: AccessSection,
    desc: 'Who holds a finance role, a personal override or a departmental scope',
    requires: ['finance.users.manage_finance_roles'] },
  { key: 'settings', label: 'Settings', icon: SlidersHorizontal, group: 'control', component: SettingsSection,
    desc: 'How the council wants balances shown and duties separated',
    requires: ['finance.budget.view'] },
]

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const auth = useAuthStore()

const navOpen = ref(false)

/** What the person is called on the chip: the role the SERVER reports. See shell/roleLabels.ts. */
const roleLabel = computed(() => financeRoleLabel(store.identity?.role ?? auth.user?.role))

/**
 * Signing out of a finance console has one requirement the other role shells do not.
 *
 * The permission set, the department scope and the council's classifications are held in the
 * finance store, which outlives this component — Pinia state survives a route change. Clearing the
 * session without resetting it would leave the previous officer's permissions and selected year in
 * memory for whoever signs in next on the same machine, which in a shared council office is the
 * normal case. `store.reset()` is therefore part of signing out, not a nicety.
 */
async function handleLogout(): Promise<void> {
  await auth.logout()
  store.reset()
  void router.push('/login')
}

/** Only the sections this person can open at all. The rest are not rendered as dead rail entries. */
const visibleSections = computed(() => SECTIONS.filter((s) => store.canAny(...s.requires)))

/** What is waiting on this person. One set of reads, feeding both the rail counts and the panel. */
const queues = useFinanceQueues()

/** Where this person lands when the URL does not say. See `resolveActiveSection` for the order. */
const openable = computed<SectionKey[]>(() => visibleSections.value.map((s) => s.key))
const landing = computed<SectionKey>(() => resolveActiveSection({
  openable: openable.value, preset: store.rolePreset,
}))

/**
 * The rail in two bands.
 *
 * Band one is this person's work, in the preset's order. Band two is everything else their
 * permissions allow, still grouped by the question it answers, still fully operable — de-emphasised
 * is not disabled. Nothing is removed from the rail by the preset; a publisher can still open
 * Budget, and the server would still refuse it the controls inside.
 */
const myWork = computed(() => store.rolePreset.foreground
  .map((key) => visibleSections.value.find((s) => s.key === key))
  .filter((s): s is Section => Boolean(s)))

const alsoGroups = computed(() => {
  const mine = new Set(myWork.value.map((s) => s.key))
  const rest = visibleSections.value.filter((s) => !mine.has(s.key))
  // EVERY group is listed. 'ledger' was missing from this array, so a role that reads the book
  // without keeping it (the auditor, the committee) had General ledger, Statements and Rates on
  // no band of its rail at all, reachable only by typing ?section= into the address bar.
  const order: Group[] = ['period', 'cash', 'revenue', 'ledger', 'budget', 'geo', 'data', 'control']
  return order
    .map((g) => ({ group: g, label: GROUP_LABELS[g], items: rest.filter((s) => s.group === g) }))
    .filter((g) => g.items.length > 0)
})

const activeKey = computed<SectionKey>(() => resolveActiveSection({
  requested: typeof route.query.section === 'string' ? route.query.section : null,
  openable: openable.value,
  preset: store.rolePreset,
}))
const active = computed(() => SECTIONS.find((s) => s.key === activeKey.value) ?? SECTIONS[0])

/** The work queue is shown on arrival — above the section's own content, not instead of it. */
/**
 * Except at a counter. For everyone else the queue is a list of things in other sections; for a
 * cashier the counter IS the state of their work — till open or not, count declared or not — and a
 * panel above it restating that pushed "Take a payment" below the fold with a payer waiting.
 */
const showQueue = computed(() => activeKey.value === landing.value
  && !(activeKey.value === 'cash' && store.can('finance.cash.session.operate')))

const mainEl = ref<HTMLElement | null>(null)

/**
 * Section-scoped filter parameters.
 *
 * A queue links to its section already filtered (`?section=budget&status=submitted`). Carrying that
 * `status` forward when the person then opens Data imports would silently filter a different
 * register by a value that was meant for this one, so changing section drops them unless the
 * caller supplies new ones. `ward` is kept: the finance map's selected ward is meant to follow the
 * person between Budget, Projects and the map, which is the map⇄dashboard sync.
 */
// `notice` explains the redirect that brought the person here; it stops being true once they move.
const SECTION_SCOPED_QUERY = ['status', 'state', 'view', 'notice'] as const

/**
 * Open a section.
 *
 * Focus moves to the main region, because the rail is sticky and a keyboard user who activates a
 * rail item would otherwise be left at the top of a list while the content below them was replaced.
 */
function open(key: SectionKey, extra?: Record<string, string>): void {
  navOpen.value = false
  if (key === activeKey.value && !extra) return
  const next: Record<string, string | null | undefined | (string | null)[]> = {
    ...route.query, section: key,
  }
  for (const param of SECTION_SCOPED_QUERY) delete next[param]
  Object.assign(next, extra ?? {})
  void router.replace({ query: next })
  void nextTick(() => { mainEl.value?.focus() })
}

/**
 * What a screen reader is told when the section changes.
 *
 * Focus is NOT moved when the landing section resolves after boot — the person has not acted, and
 * taking their focus for them is hostile. The change is announced instead.
 */
const sectionAnnouncement = ref('')
watch(active, (section) => { sectionAnnouncement.value = `${section.label}. ${section.desc}.` })

const bootError = ref<string | null>(null)

async function boot(force = false): Promise<void> {
  bootError.value = null
  const identity = await store.loadIdentity(force)
  if (!identity) {
    bootError.value = store.identityError ?? 'Your finance permissions could not be read.'
    return
  }
  await store.loadReference(force)
}

onMounted(() => { void boot() })

// Keep the URL honest: if the section in the query is one this person cannot open, correct it
// rather than silently showing something else under the wrong address. And once the preset has
// chosen a landing, write it into the URL — otherwise the address bar says nothing about what is on
// screen, and the link an officer copies in their first five seconds would open on the RECIPIENT's
// landing section instead of the one they were looking at.
//
// It waits for the identity. Writing a section into the URL before the permissions are known would
// write `overview` — the fallback every role resolves to while `visibleSections` is still empty —
// and that written value would then be an "explicit" section, which beats the preset. The preset
// would never apply to anyone.
watch([activeKey, () => route.query.section, () => store.identity], () => {
  if (!store.identity) return
  if (route.query.section !== activeKey.value) {
    void router.replace({ query: { ...route.query, section: activeKey.value } })
  }
}, { immediate: true })
</script>

<template>
  <div class="fin-shell">
    <a class="fin-skip" href="#fin-main">Skip to content</a>
    <header class="fin-topbar">
      <button type="button" class="ins-iconbtn fin-nav-toggle" :aria-expanded="navOpen"
              aria-controls="fin-rail" @click="navOpen = !navOpen">
        <component :is="navOpen ? X : Menu" :size="18" aria-hidden="true" />
        <span class="sr-only">{{ navOpen ? 'Close sections' : 'Open sections' }}</span>
      </button>
      <div class="fin-topbar-text">
        <span class="ins-eyebrow">Vungu Rural District Council · Finance</span>
        <h1 class="ins-title">{{ active.label }}</h1>
        <p class="ins-lede">{{ active.desc }}</p>
      </div>
      <FinanceYearPicker v-if="store.identity && store.readsReference" />

      <ProfileDropdown
        class="fin-profile"
        :role-label="roleLabel"
        avatar-key="finance_avatar"
        @logout="handleLogout"
      />
    </header>

    <!-- Why the person was redirected here from a workspace address (shell/workspaceGuard.ts). -->
    <WorkspaceNotice />

    <div v-if="bootError" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ bootError }}</span>
      <button type="button" class="fin-btn small" @click="boot(true)">
        <RefreshCw :size="13" aria-hidden="true" /> Retry
      </button>
    </div>

    <p v-if="store.referenceError" class="ins-banner t-warning" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ store.referenceError }}</span>
    </p>

    <p v-if="store.loadingIdentity" class="fin-loading" role="status">Reading your finance permissions…</p>

    <div v-else-if="store.identity" class="fin-body">
      <nav id="fin-rail" class="fin-rail-wrap" :class="{ 'is-open': navOpen }" aria-label="Finance sections">
        <!-- Band one: what this person does. Band two: everything else they may open. -->
        <div v-if="myWork.length" class="fin-rail-group">
          <p id="fin-rail-mine" class="fin-rail-group-label">Your work</p>
          <div class="fin-rail" role="group" aria-labelledby="fin-rail-mine">
            <button
              v-for="s in myWork" :key="s.key" type="button"
              class="fin-rail-item" :class="{ 'is-active': s.key === activeKey }"
              :aria-current="s.key === activeKey ? 'page' : undefined"
              @click="open(s.key)"
            >
              <component :is="s.icon" :size="15" aria-hidden="true" />
              <span>{{ s.label }}</span>
              <span v-if="queues.countsBySection.value[s.key]" class="fin-rail-count">
                {{ queues.countsBySection.value[s.key] }}
                <span class="sr-only">
                  item{{ queues.countsBySection.value[s.key] === 1 ? '' : 's' }} waiting on you
                </span>
              </span>
            </button>
          </div>
        </div>

        <div v-if="alsoGroups.length" class="fin-rail-also">
          <p class="fin-rail-band-label">Also available to you</p>
          <div v-for="g in alsoGroups" :key="g.group" class="fin-rail-group">
            <p :id="`fin-rail-${g.group}`" class="fin-rail-group-label">{{ g.label }}</p>
            <div class="fin-rail" role="group" :aria-labelledby="`fin-rail-${g.group}`">
              <button
                v-for="s in g.items" :key="s.key" type="button"
                class="fin-rail-item" :class="{ 'is-active': s.key === activeKey }"
                :aria-current="s.key === activeKey ? 'page' : undefined"
                @click="open(s.key)"
              >
                <component :is="s.icon" :size="15" aria-hidden="true" />
                <span>{{ s.label }}</span>
                <span v-if="queues.countsBySection.value[s.key]" class="fin-rail-count">
                  {{ queues.countsBySection.value[s.key] }}
                  <span class="sr-only">
                    item{{ queues.countsBySection.value[s.key] === 1 ? '' : 's' }} waiting on you
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <p v-if="store.isScoped" class="fin-scope-note">
          You see
          <strong>{{ store.departmentScope.map((d) => d.name).join(', ') }}</strong>
          only. A departmental head's figures are confined to their own votes.
        </p>
      </nav>

      <main id="fin-main" ref="mainEl" class="fin-main" tabindex="-1">
        <p class="sr-only" role="status" aria-live="polite">{{ sectionAnnouncement }}</p>

        <!-- Nothing can be entered until the Council has supplied the three things every finance
             record needs. Saying so once, here, beats eleven sections each failing on their own.

             `setupStatusKnown` is what keeps this honest. The three arrays it reads are empty both
             when the council has entered nothing and when the four reference calls have not come
             back yet, and this panel used to fire on the second case: on a slow link every officer
             was told, in the most prominent place on the page, that their council had no financial
             year, no votes and no chart of accounts — for the two to four seconds the reads took,
             on a council that had all three. It is now claimed only once a load has finished with
             nothing failing. -->
        <div v-if="store.readsReference && store.setupStatusKnown && store.needsSetup.any && activeKey !== 'years' && activeKey !== 'classifications' && activeKey !== 'permissions'"
             class="fin-empty" role="status">
          <strong>The council's finance setup is incomplete.</strong>
          <p>
            <template v-if="store.needsSetup.noYear">No financial year has been created. </template>
            <template v-if="store.needsSetup.noDepartments">No departments (votes) have been entered. </template>
            <template v-if="store.needsSetup.noAccounts">The chart of accounts is empty. </template>
            Nothing can be budgeted or imported until these exist, and none of them is guessed: the
            financial year dates, the vote structure and the chart of accounts — including whether
            each account is revenue or expenditure — are the Council's to approve.
          </p>
          <p class="fin-setup-links">
            <button type="button" class="fin-btn small" @click="open('years')">Financial years</button>
            <button type="button" class="fin-btn small" @click="open('classifications')">Departments &amp; accounts</button>
          </p>
        </div>

        <!-- On arrival: what is waiting on you, then the section's own content. Not instead of it,
             and not on every section — a queue repeated on fifteen screens stops being read. -->
        <FinanceWorkQueue
          v-if="showQueue"
          :queues="queues.queues.value"
          :loading="queues.loading.value"
          :error="queues.error.value"
          @open="(section, query) => open(section, query)"
          @reload="queues.reload()"
        />

        <component :is="active.component" :key="active.key" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.fin-shell { display: flex; flex-direction: column; gap: var(--ent-s4); padding: var(--ent-s5) var(--ent-s6) var(--ent-s7); min-height: 100%; }
.fin-topbar { display: flex; align-items: flex-end; gap: var(--ent-s4); flex-wrap: wrap; }
.fin-topbar-text { flex: 1; min-width: 16rem; }
.fin-profile { align-self: center; margin-left: auto; }
.fin-skip {
  position: absolute; top: 8px; left: 8px; z-index: 80;
  padding: 0.45rem 0.75rem; background: var(--ent-surface); color: var(--ent-accent);
  border: 1px solid var(--ent-accent); border-radius: var(--ent-r-sm);
  font-weight: 600; text-decoration: none; transform: translateY(-220%);
}
.fin-skip:focus-visible { transform: translateY(0); outline: var(--ent-focus-ring); outline-offset: 2px; }
.fin-main:focus { outline: none; }
.fin-nav-toggle { display: none; }
.fin-body { display: grid; grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr); gap: var(--ent-s5); align-items: start; }
.fin-rail-wrap { position: sticky; top: var(--ent-s4); display: flex; flex-direction: column; gap: var(--ent-s2); }
.fin-main { min-width: 0; display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.fin-scope-note {
  margin: var(--ent-s3) 0 0; padding: var(--ent-s2) var(--ent-s3);
  border-left: 2px solid var(--ent-accent); border-radius: 0 var(--ent-r-sm) var(--ent-r-sm) 0;
  background: var(--ent-surface-2); font-size: var(--ent-fs-micro); color: var(--ent-text-2); line-height: var(--ent-lh);
}
.fin-setup-links { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }
/* The second band is set apart by a rule and a quieter label, not by being greyed out: every
   section in it is fully operable and a disabled-looking rail would say otherwise. */
.fin-rail-also { margin-top: var(--ent-s4); padding-top: var(--ent-s3); border-top: 1px solid var(--ent-line); }
.fin-rail-band-label {
  margin: 0 0 var(--ent-s1); padding: 0 var(--ent-s2);
  font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: var(--ent-lh);
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (max-width: 1023px) {
  .fin-shell { padding: var(--ent-s4) var(--ent-s3) var(--ent-s7); }
  .fin-nav-toggle { display: inline-grid; }
  .fin-body { grid-template-columns: minmax(0, 1fr); }
  .fin-rail-wrap { position: static; display: none; padding: var(--ent-s3); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface); }
  .fin-rail-wrap.is-open { display: flex; }
}
</style>
