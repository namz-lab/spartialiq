// @vitest-environment happy-dom
//
// The Director's cockpit: the charts, the tables under them, and the exception feed.
//
// Five rules are pinned here because each of them is the difference between a report and a
// decoration, and each is a stated requirement rather than a preference:
//
//   - EVERY CHART HAS A TABLE WITH THE SAME FIGURES AND AN ACCESSIBLE NAME (design A6, check
//     C11). A chart a screen reader cannot read is not a report, so the table is a real <table>
//     with a caption and row headers, built from the same array the chart is drawn from.
//   - NO CHART PLOTS TWO CURRENCIES ON ONE AXIS (decision D4, design A5). One chart set per
//     currency and side, each naming its own currency, and no figure anywhere spans both.
//   - null IS NOT 0 (house rule 3). A figure that was not recorded reads "not recorded" in the
//     table and breaks the line in the chart; it is never drawn as nil and never interpolated.
//   - A ZERO COUNT IS RENDERED, NOT HIDDEN (check C12). "No line is overspent" is an answer a
//     director needs; an absent row only says the question was never asked.
//   - AN ITEM THE SERVER COULD NOT COMPUTE IS NOT A ZERO. It is listed apart, with its reason,
//     and no number appears for it anywhere.
//
// And one rule is pinned because it is what this rebuild promised not to break: every figure the
// overview showed before the charts arrived is still on the page.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

vi.mock('../api/financeApi', () => ({
  financeApi: {
    performance: vi.fn(),
    budgetExceptions: vi.fn(),
    overviewSeries: vi.fn(),
    overviewAttention: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import FinanceOverviewSection from '../pages/sections/FinanceOverviewSection.vue'
import ChartFrame from '../components/charts/ChartFrame.vue'
import PeriodBars from '../components/charts/PeriodBars.vue'
import PeriodLines from '../components/charts/PeriodLines.vue'
import { useFinanceStore } from '../stores/finance'
import type {
  AttentionItem, DepartmentPerformance, FinancialYear, OverviewSeries, OverviewSeriesPoint,
} from '../models/types'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

// The council's own year is July to June, which is the case the period engine exists for: a
// calendar-quarter report would hand this council a "Q1" three quarters into its own year.
const YEAR: FinancialYear = {
  id: 'y1', label: '2026/27', start_date: '2026-07-01', end_date: '2027-06-30',
  status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
}

const department = (over: Partial<DepartmentPerformance> = {}): DepartmentPerformance => ({
  financial_year_id: 'y1',
  department_id: 'd1',
  account_kind: 'expenditure',
  currency: 'USD',
  line_count: 4,
  original_amount: '2735000.00',
  approved_adjustments: '45000.00',
  revised_amount: '2780000.00',
  actual_amount: '2038000.00',
  open_commitments: '233000.00',
  available_excluding_commitments: '742000.00',
  available_including_commitments: '509000.00',
  execution_percentage: '73.31',
  actual_currency_mismatch_rows: 0,
  department_code: 'WORKS',
  department_name: 'Works and Infrastructure',
  ...over,
})

const point = (over: Partial<OverviewSeriesPoint> & { period_key: string }): OverviewSeriesPoint => ({
  period_label: over.period_key,
  from_date: '2026-07-01',
  to_date: '2026-09-30',
  budget: '2625000.00',
  actual: '622000.00',
  commitments: '233000.00',
  cumulative_actual: '622000.00',
  ...over,
})

const usdExpenditure: OverviewSeries = {
  currency: 'USD',
  account_kind: 'expenditure',
  points: [
    point({ period_key: 'q1', period_label: 'Jul-Sep 2026', from_date: '2026-07-01', to_date: '2026-09-30' }),
    point({
      period_key: 'q2', period_label: 'Oct-Dec 2026', from_date: '2026-10-01', to_date: '2026-12-31',
      budget: '2780000.00', actual: '648000.00', commitments: '0.00', cumulative_actual: '1270000.00',
    }),
  ],
}

const zwgExpenditure: OverviewSeries = {
  currency: 'ZWG',
  account_kind: 'expenditure',
  points: [
    point({
      period_key: 'q1', period_label: 'Jul-Sep 2026',
      budget: '24000000.00', actual: '5700000.00', commitments: '2600000.00', cumulative_actual: '5700000.00',
    }),
    point({
      period_key: 'q2', period_label: 'Oct-Dec 2026', from_date: '2026-10-01', to_date: '2026-12-31',
      budget: '27000000.00', actual: '5700000.00', commitments: '0.00', cumulative_actual: '11400000.00',
    }),
  ],
}

const item = (over: Partial<AttentionItem> & { id: string }): AttentionItem => ({
  label: 'Budget lines past the council\'s threshold',
  statement: 'Execution has reached 100% of the revised allocation.',
  count: 0,
  severity: 'act',
  section: 'budget',
  ...over,
})

function arrange(options: {
  series?: OverviewSeries[]
  items?: AttentionItem[]
  seriesFails?: boolean
  rows?: DepartmentPerformance[]
} = {}) {
  api.performance.mockResolvedValue({
    financial_year: YEAR,
    rows: options.rows ?? [department()],
    thresholds: { warn_execution_percentage: 90, flag_execution_percentage: 100 },
    available_balance_includes_commitments: false,
    currencies_present: ['USD'],
  })
  api.budgetExceptions.mockResolvedValue({
    rows: [], thresholds: { warn_execution_percentage: 90, flag_execution_percentage: 100 }, note: '',
  })
  if (options.seriesFails) {
    api.overviewSeries.mockRejectedValue(new Error('the series endpoint is not available'))
  } else {
    api.overviewSeries.mockResolvedValue({
      financial_year: YEAR,
      periodicity: 'quarterly',
      periods: [
        { from_date: '2026-07-01', to_date: '2026-09-30', key: 'q1', label: 'Jul-Sep 2026' },
        { from_date: '2026-10-01', to_date: '2026-12-31', key: 'q2', label: 'Oct-Dec 2026' },
      ],
      series: options.series ?? [usdExpenditure],
      scope_applied: null,
    })
  }
  api.overviewAttention.mockResolvedValue({
    financial_year_id: 'y1',
    generated_at: '2027-02-01T09:00:00.000Z',
    items: options.items ?? [],
    scope_applied: null,
  })
}

async function mountCockpit() {
  const wrapper = mount(FinanceOverviewSection)
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const store = useFinanceStore()
  store.identity = {
    user_id: 'me', role: 'finance_admin', authority_id: 1,
    permissions: ['finance.budget.view', 'finance.actuals.view'],
    department_scope: [], catalogue: [],
  }
  store.years = [YEAR]
  store.selectYear('y1')
})

describe('the position charts', () => {
  it('gives every chart an accessible name that says what it plots and in which currency', async () => {
    arrange()
    const wrapper = await mountCockpit()
    const plots = wrapper.findAll('svg[role="img"]')
    expect(plots.length).toBe(2) // the bars and the lines, for the one series
    for (const plot of plots) {
      const name = plot.attributes('aria-label') ?? ''
      expect(name.length).toBeGreaterThan(20)
      expect(name).toContain('USD')
      expect(name).toContain('table below')
    }
  })

  it('ships a real table carrying the same figures as the chart, not a div grid', async () => {
    arrange()
    const wrapper = await mountCockpit()
    const table = wrapper.find('.fcx-table')
    expect(table.element.tagName).toBe('TABLE')
    // A caption that states the basis, and row headers rather than plain cells.
    expect(table.find('caption').exists()).toBe(true)
    expect(table.findAll('tbody th[scope="row"]').length).toBe(2)
    const text = table.text()
    // Every measure of every period, formatted through formatMoney and no other route.
    expect(text).toContain('2 625 000.00')
    expect(text).toContain('622 000.00')
    expect(text).toContain('233 000.00')
    expect(text).toContain('1 270 000.00')
    expect(text).toContain('Jul-Sep 2026')
    expect(text).toContain('Oct-Dec 2026')
  })

  it('starts the period columns at the council\'s own year start, not at January', async () => {
    arrange()
    const wrapper = await mountCockpit()
    const firstRow = wrapper.findAll('.fcx-table tbody tr')[0]
    expect(firstRow.text()).toContain('Jul-Sep 2026')
    expect(firstRow.text()).toContain('2026-07-01')
  })

  it('never puts two currencies on one axis: one chart set per currency, each naming its own', async () => {
    arrange({ series: [usdExpenditure, zwgExpenditure] })
    const wrapper = await mountCockpit()
    const frames = wrapper.findAllComponents(ChartFrame)
    expect(frames).toHaveLength(2)
    expect(frames.map((f) => f.props('currency')).sort()).toEqual(['USD', 'ZWG'])
    // Each frame's own plots name one currency and not the other.
    for (const frame of frames) {
      const currency = frame.props('currency') as string
      const other = currency === 'USD' ? 'ZWG' : 'USD'
      for (const plot of frame.findAll('svg[role="img"]')) {
        expect(plot.attributes('aria-label')).toContain(currency)
        expect(plot.attributes('aria-label')).not.toContain(other)
      }
    }
  })

  it('keeps a period in which nothing moved, and shows it as nil rather than dropping it', async () => {
    arrange({
      series: [{
        currency: 'USD',
        account_kind: 'expenditure',
        points: [
          point({ period_key: 'q1', period_label: 'Jul-Sep 2026' }),
          point({
            period_key: 'q2', period_label: 'Oct-Dec 2026',
            actual: '0.00', commitments: '0.00', cumulative_actual: '622000.00',
          }),
        ],
      }],
    })
    const wrapper = await mountCockpit()
    const rows = wrapper.findAll('.fcx-table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[1].text()).toContain('Oct-Dec 2026')
    expect(rows[1].text()).toContain('0.00')
    // A recorded nil is not "not recorded".
    expect(rows[1].text()).not.toContain('not recorded')
  })
})

describe('a figure that was not recorded', () => {
  const withGap = {
    rows: [
      { key: 'q1', label: 'Jul-Sep 2026', from: '2026-07-01', to: '2026-09-30', values: { actual: '100.00' } },
      { key: 'q2', label: 'Oct-Dec 2026', from: '2026-10-01', to: '2026-12-31', values: { actual: null } },
      { key: 'q3', label: 'Jan-Mar 2027', from: '2027-01-01', to: '2027-03-31', values: { actual: '300.00' } },
    ],
    series: [{ key: 'actual', name: 'Spent in the period', role: 'line' as const }],
    currency: 'USD' as const,
    accessibleName: 'Line chart: spent per period in USD. The same figures are in the table below.',
  }

  it('reads as "not recorded" in the table, and never as a zero', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        title: 'Expenditure, period by period',
        currency: 'USD',
        caption: 'What moved in each period.',
        rows: withGap.rows,
        columns: [{ key: 'actual', label: 'Spent in period' }],
        emptyMessage: 'A chart appears here once the year has a period with something in it.',
      },
    })
    const gapRow = wrapper.findAll('tbody tr')[1]
    expect(gapRow.text()).toContain('not recorded')
    expect(gapRow.find('.fcx-unrecorded').exists()).toBe(true)
    expect(gapRow.text()).not.toContain('0.00')
    // And the frame says so in words rather than leaving the reader to spot it.
    expect(wrapper.text()).toMatch(/1 figure on this chart was not recorded/)
    expect(wrapper.text()).toMatch(/left open rather than drawn as nil/)
  })

  it('breaks the line rather than drawing one through it', () => {
    const wrapper = mount(PeriodLines, { props: withGap })
    // Two one-point runs either side of the gap: neither is a line, so no path spans it.
    expect(wrapper.findAll('path.fcx-path')).toHaveLength(0)
    // The gap itself is marked, and the legend names it.
    expect(wrapper.findAll('line.fcx-gap')).toHaveLength(1)
    expect(wrapper.text()).toContain('Not recorded')
  })

  it('draws no bar for it, and a stub on the baseline for a recorded nil', () => {
    const wrapper = mount(PeriodBars, {
      props: {
        ...withGap,
        rows: [
          { key: 'q1', label: 'Jul', from: '2026-07-01', to: '2026-09-30', values: { actual: '100.00' } },
          { key: 'q2', label: 'Oct', from: '2026-10-01', to: '2026-12-31', values: { actual: null } },
          { key: 'q3', label: 'Jan', from: '2027-01-01', to: '2027-03-31', values: { actual: '0.00' } },
        ],
        series: [{ key: 'actual', name: 'Spent in the period', role: 'bar' as const }],
      },
    })
    const bars = wrapper.findAll('rect.fcx-bar')
    // Two bars for three periods: the unrecorded one has none at all.
    expect(bars).toHaveLength(2)
    // The recorded nil is a stub, and is marked as nil rather than drawn as a value.
    expect(wrapper.findAll('rect.fcx-bar.is-nil')).toHaveLength(1)
    expect(wrapper.findAll('line.fcx-gap')).toHaveLength(1)
  })
})

describe('the chart frame itself', () => {
  it('names its currency in the heading, so no figure under it is implicit', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        title: 'Expenditure, period by period',
        currency: 'ZWG',
        caption: 'What moved in each period.',
        rows: [{ key: 'q1', label: 'Jul-Sep 2026', from: '2026-07-01', to: '2026-09-30', values: { actual: '1.00' } }],
        columns: [{ key: 'actual', label: 'Spent in period' }],
        emptyMessage: 'Nothing to plot yet.',
      },
    })
    expect(wrapper.find('.fcx-ccy-code').text()).toBe('ZWG')
    expect(wrapper.find('.fcx-ccy-name').text()).toBe('Zimbabwe Gold')
  })

  it('says what would appear, rather than drawing an empty axis', () => {
    const wrapper = mount(ChartFrame, {
      props: {
        title: 'Expenditure, period by period',
        currency: 'USD',
        caption: 'What moved in each period.',
        rows: [],
        columns: [{ key: 'actual', label: 'Spent in period' }],
        emptyMessage: 'A chart appears here once the year has a period with something in it.',
      },
    })
    expect(wrapper.find('.fcx-empty').text()).toContain('once the year has a period with something in it')
    expect(wrapper.find('.fcx-table').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('does not animate its entrance when the reader has asked for reduced motion', async () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, media: '(prefers-reduced-motion: reduce)' })
    // @ts-expect-error — happy-dom's window is writable in a test.
    window.matchMedia = matchMedia
    const props = {
      title: 'Expenditure, period by period',
      currency: 'USD' as const,
      caption: 'What moved in each period.',
      rows: [{ key: 'q1', label: 'Jul-Sep 2026', from: '2026-07-01', to: '2026-09-30', values: { actual: '1.00' } }],
      columns: [{ key: 'actual', label: 'Spent in period' }],
      emptyMessage: 'Nothing to plot yet.',
    }
    const reduced = mount(ChartFrame, { props })
    await flushPromises()
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(reduced.find('.fcx-plot').classes()).not.toContain('is-entered')

    matchMedia.mockReturnValue({ matches: false, media: '(prefers-reduced-motion: reduce)' })
    const moving = mount(ChartFrame, { props })
    await flushPromises()
    expect(moving.find('.fcx-plot').classes()).toContain('is-entered')
  })
})

describe('the attention feed', () => {
  it('renders a zero count as a sentence under "checked and clear", never hiding it', async () => {
    arrange({
      items: [
        item({ id: 'budget_lines_overspent', label: 'Budget lines past the council\'s threshold', count: 0 }),
        item({ id: 'budget_currency_mismatch', label: 'Postings in another currency', count: 0 }),
      ],
    })
    const wrapper = await mountCockpit()
    const clear = wrapper.find('.fcx-clear')
    expect(clear.exists()).toBe(true)
    expect(clear.text()).toContain('Budget lines past the council\'s threshold')
    expect(clear.text()).toContain('none')
    expect(clear.findAll('li')).toHaveLength(2)
    // No count is rendered as a number for an empty check.
    expect(wrapper.find('.fcx-feed-number').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nothing in 2026/27 needs attention')
  })

  it('shows a count, the sentence that explains it and a way to get to the work', async () => {
    arrange({
      items: [item({
        id: 'budget_lines_awaiting_decision',
        label: 'Budget lines awaiting a decision',
        statement: 'Submitted and waiting on an approver.',
        count: 3,
        section: 'budget',
        query: { status: 'submitted' },
      })],
    })
    const wrapper = await mountCockpit()
    expect(wrapper.find('.fcx-feed-number').text()).toBe('3')
    expect(wrapper.text()).toContain('Submitted and waiting on an approver.')
    const go = wrapper.find('.fcx-feed-go')
    expect(go.element.tagName).toBe('BUTTON')
    expect(go.attributes('type')).toBe('button')
    // "Open" is not the whole accessible name: the item travels inside the button.
    expect(go.text()).toContain('Budget lines awaiting a decision')
    await go.trigger('click')
    expect(replace).toHaveBeenCalledWith({ query: { status: 'submitted', section: 'budget' } })
  })

  it('carries a word beside every severity, so urgency is never colour alone', async () => {
    arrange({
      items: [
        item({ id: 'a', count: 1, severity: 'act' }),
        item({ id: 'b', count: 2, severity: 'watch' }),
        item({ id: 'c', count: 3, severity: 'info' }),
      ],
    })
    const wrapper = await mountCockpit()
    expect(wrapper.text()).toContain('Needs action')
    expect(wrapper.text()).toContain('Worth a look')
    expect(wrapper.text()).toContain('For information')
  })

  it('reports an item it could not compute as unavailable, with its reason and no number', async () => {
    arrange({
      items: [item({
        id: 'imports_awaiting_commit',
        label: 'Import batches validated and awaiting commit',
        count: 0,
        unavailable: true,
        unavailable_reason: 'This queue is council-wide and has no departmental dimension, so it cannot be narrowed to your votes.',
      })],
    })
    const wrapper = await mountCockpit()
    const block = wrapper.find('.fcx-unavailable')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('council-wide and has no departmental dimension')
    expect(wrapper.text()).toContain('Not counted — which is not the same as none')
    // Crucially: the 0 the contract forces onto an unavailable item never reaches the screen,
    // and the item is not listed among the checks that came back empty.
    expect(wrapper.find('.fcx-feed-number').exists()).toBe(false)
    expect(wrapper.find('.fcx-clear').exists()).toBe(false)
  })

  it('states an item\'s money per currency and never adds two currencies together', async () => {
    arrange({
      items: [item({
        id: 'budget_lines_over_committed',
        label: 'Budget lines with no room left once commitments are counted',
        count: 2,
        amounts: [
          { currency: 'USD', amount: '12000.00' },
          { currency: 'ZWG', amount: '450000.00' },
        ],
      })],
    })
    const wrapper = await mountCockpit()
    const amounts = wrapper.findAll('.fcx-feed-amount')
    expect(amounts).toHaveLength(2)
    expect(amounts[0].text()).toBe('US$ 12 000.00')
    expect(amounts[1].text()).toBe('ZWG 450 000.00')
    expect(wrapper.text()).toContain('never added together')
  })

  it('announces the total through one polite live region, not one per row', async () => {
    arrange({
      items: [
        item({ id: 'a', count: 3 }),
        item({ id: 'b', count: 2, severity: 'watch' }),
      ],
    })
    const wrapper = await mountCockpit()
    const live = wrapper.findAll('[aria-live="polite"]')
    expect(live).toHaveLength(1)
    expect(live[0].text()).toBe('5 items need attention, across 2 checks.')
  })

  it('reports a failed read as a warning that explicitly refuses to show it as zero', async () => {
    arrange()
    api.overviewAttention.mockRejectedValue(new Error('the attention endpoint is not available'))
    const wrapper = await mountCockpit()
    const alert = wrapper.findAll('[role="alert"]').find((a) => a.text().includes('attention'))
    expect(alert).toBeTruthy()
    expect(alert!.text()).toMatch(/could not be read is not a count of none/)
    expect(wrapper.find('.fcx-feed-number').exists()).toBe(false)
  })
})

describe('the rebuild keeps what the overview already showed', () => {
  it('still shows every per-currency figure, the departmental table and the no-conversion note', async () => {
    arrange({
      rows: [
        department(),
        department({ department_id: 'd2', account_kind: 'revenue', department_code: 'FIN', department_name: 'Finance' }),
      ],
    })
    const wrapper = await mountCockpit()
    const text = wrapper.text()
    for (const label of ['Original budget', 'Approved adjustments', 'Revised budget', 'Spent', 'Available', 'Execution']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('commitments excluded')
    expect(text).toContain('By department')
    expect(text).toContain('Works and Infrastructure')
    expect(text).toContain('USD and ZWG figures are reported separately')
    expect(text).toContain('never added together')
    // And no hero metric: the only large numerals on the page are the feed's counts.
    expect(wrapper.findAll('.fcx-feed-number')).toHaveLength(0)
  })

  it('keeps the rest of the page when the series endpoint is unavailable', async () => {
    arrange({ seriesFails: true })
    const wrapper = await mountCockpit()
    const alert = wrapper.findAll('[role="alert"]').find((a) => a.text().includes('unaffected'))
    expect(alert).toBeTruthy()
    expect(alert!.text()).toContain('the series endpoint is not available')
    // The departmental position is still there.
    expect(wrapper.text()).toContain('By department')
    expect(wrapper.text()).toContain('Revised budget')
    // And nothing was plotted from nothing.
    expect(wrapper.findAll('svg[role="img"]')).toHaveLength(0)
  })
})
