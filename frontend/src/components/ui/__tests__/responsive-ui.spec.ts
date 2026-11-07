// @vitest-environment happy-dom
//
// Covers the three responsive primitives added for the mobile redesign. Each
// test is about the CONTRACT, not the pixels: that one component serves both
// presentations from one set of props, that nothing an officer can reach on
// desktop becomes unreachable on a phone, and that the overlay behaves like a
// dialog for a keyboard user.
//
// happy-dom's matchMedia reports `matches: false` for every query, so
// useBreakpoint's flags are all false and components render their desktop
// tree. That is deliberate: the desktop tree is the one with the richer
// markup, so asserting against it catches more regressions, and the mobile
// branches are exercised through UiBottomNav, which renders at every width.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { FileText, Gavel, Map as MapIcon, ShieldAlert, BarChart3, BookOpen } from 'lucide-vue-next'

import UiDataTable from '../UiDataTable.vue'
import UiSheet from '../UiSheet.vue'
import UiBottomNav from '../UiBottomNav.vue'
import { BREAKPOINTS } from '@/composables/useBreakpoint'

/** Synthetic register rows. Invented values, never production data. */
const ROWS = [
  { id: 'r1', ref: 'DEV/2026/0001', applicant: 'A. Moyo',  status: 'lodged',   stand: '14883', fee: 'PAID' },
  { id: 'r2', ref: 'DEV/2026/0002', applicant: 'B. Ncube', status: 'approved', stand: '14884', fee: 'UNPAID' },
]

const COLUMNS = [
  { key: 'ref',       label: 'Reg. no',   mono: true, sortable: true },
  { key: 'applicant', label: 'Applicant', sortable: true },
  { key: 'stand',     label: 'Stand' },
  { key: 'status',    label: 'Status' },
  { key: 'fee',       label: 'Fee' },
  { key: '_actions',  label: '',          align: 'right' },
]

describe('UiDataTable — one component, two presentations', () => {
  it('renders a real table at desktop width, with sortable headers', () => {
    const w = mount(UiDataTable, { props: { columns: COLUMNS, rows: ROWS, rowKey: 'id' } })

    expect(w.find('table.ui-table').exists()).toBe(true)
    expect(w.findAll('tbody tr')).toHaveLength(2)
    // A sortable column advertises its state to assistive technology.
    expect(w.find('th.sortable').attributes('aria-sort')).toBe('none')
  })

  it('sorts by a column and reports the direction', async () => {
    const w = mount(UiDataTable, { props: { columns: COLUMNS, rows: ROWS, rowKey: 'id' } })
    const applicantHeader = w.findAll('th.sortable')[1]

    await applicantHeader.trigger('click')
    expect(applicantHeader.attributes('aria-sort')).toBe('ascending')
    await applicantHeader.trigger('click')
    expect(applicantHeader.attributes('aria-sort')).toBe('descending')
  })

  it('emits row-click with the row when clickable', async () => {
    const w = mount(UiDataTable, {
      props: { columns: COLUMNS, rows: ROWS, rowKey: 'id', clickable: true },
    })
    await w.findAll('tbody tr')[1].trigger('click')

    expect(w.emitted('row-click')?.[0]?.[0]).toMatchObject({ id: 'r2' })
  })

  it('does not emit row-click when the table is not clickable', async () => {
    const w = mount(UiDataTable, { props: { columns: COLUMNS, rows: ROWS, rowKey: 'id' } })
    await w.findAll('tbody tr')[0].trigger('click')

    expect(w.emitted('row-click')).toBeUndefined()
  })

  it('shows the empty message rather than an empty table body', () => {
    const w = mount(UiDataTable, {
      props: { columns: COLUMNS, rows: [], emptyMessage: 'No permits match the current filters.' },
    })
    expect(w.text()).toContain('No permits match the current filters.')
  })

  it('renders #cell- slot overrides, which the card mode reuses verbatim', () => {
    const w = mount(UiDataTable, {
      props: { columns: COLUMNS, rows: ROWS, rowKey: 'id' },
      slots: { 'cell-status': '<span class="badge-stub">{{ params.row.status }}</span>' },
    })
    expect(w.findAll('.badge-stub')).toHaveLength(2)
  })
})

describe('UiSheet — overlay contract', () => {
  afterEach(() => {
    // The sheet teleports to <body>, so its markup outlives the wrapper's own
    // element tree. Without this, a sheet left open by one test is still in
    // the document when the next one queries it, and document.querySelector
    // returns the wrong dialog. Vue Test Utils does not clean teleport
    // targets for us.
    document.querySelectorAll('.us-root').forEach(n => n.remove())
    // The sheet also locks body scroll while open; a leaked lock would break
    // every test that runs after it.
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  })

  it('renders nothing while closed', () => {
    mount(UiSheet, { props: { open: false, title: 'Filter the register' } })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('is a labelled modal dialog when open', async () => {
    mount(UiSheet, {
      props: { open: true, title: 'Filter the register' },
      attachTo: document.body,
    })
    await nextTick()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    // Labelled BY the title element, not with a duplicated aria-label.
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)?.textContent).toContain('Filter the register')
  })

  it('locks body scroll while open and releases it on close', async () => {
    const w = mount(UiSheet, {
      props: { open: false, title: 'Filter the register' },
      attachTo: document.body,
    })

    await w.setProps({ open: true })
    await nextTick()
    expect(document.body.style.overflow).toBe('hidden')

    await w.setProps({ open: false })
    await nextTick()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  // The sheet teleports to <body>, so its markup is NOT inside the wrapper's
  // element tree. Reach for it through the document, and dispatch a real
  // KeyboardEvent so the component's own @keydown handler runs exactly as it
  // would in a browser.
  function pressEscapeOnSheet() {
    const root = document.querySelector('.us-root')
    expect(root).not.toBeNull()
    root!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }

  it('requests close on Escape when dismissible', async () => {
    const w = mount(UiSheet, {
      props: { open: true, title: 'Filter', dismissible: true },
      attachTo: document.body,
    })
    await nextTick()

    pressEscapeOnSheet()
    await nextTick()
    expect(w.emitted('update:open')?.[0]).toEqual([false])
    expect(w.emitted('close')).toBeTruthy()

    w.unmount()
  })

  it('ignores Escape when the sheet is not dismissible', async () => {
    const w = mount(UiSheet, {
      props: { open: true, title: 'Confirm', dismissible: false },
      attachTo: document.body,
    })
    await nextTick()

    pressEscapeOnSheet()
    await nextTick()
    expect(w.emitted('update:open')).toBeUndefined()

    w.unmount()
  })

  it('omits the close button when the sheet is not dismissible', async () => {
    const w = mount(UiSheet, {
      props: { open: true, title: 'Confirm', dismissible: false },
      attachTo: document.body,
    })
    await nextTick()
    expect(document.querySelector('.us-close')).toBeNull()

    w.unmount()
  })
})

describe('UiBottomNav — mobile section navigation', () => {
  const SIX = [
    { key: 'dashboard',   label: 'Dashboard',          icon: MapIcon },
    { key: 'workflow',    label: 'Statutory Workflow', icon: Gavel },
    { key: 'register',    label: 'Permit Register',    icon: FileText },
    { key: 'enforcement', label: 'Enforcement',        icon: ShieldAlert },
    { key: 'reports',     label: 'Reports',            icon: BarChart3 },
    { key: 'reference',   label: 'Reference',          icon: BookOpen },
  ]

  it('marks the active item with aria-current, not colour alone', () => {
    const w = mount(UiBottomNav, {
      props: { items: SIX, modelValue: 'register', label: 'Planner console sections' },
    })
    const current = w.findAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].text()).toContain('Permit Register')
  })

  it('overflows past four items into a More control, losing none of them', async () => {
    const w = mount(UiBottomNav, {
      props: { items: SIX, modelValue: 'dashboard', label: 'Planner console sections' },
      attachTo: document.body,
    })

    // Four primary slots plus More.
    expect(w.findAll('.bn-item')).toHaveLength(5)
    expect(w.findAll('.bn-item').at(-1)?.text()).toContain('More')

    // The two that did not fit are still reachable.
    await w.findAll('.bn-item').at(-1)!.trigger('click')
    await nextTick()
    const overflowLabels = Array.from(document.querySelectorAll('.bn-more-item'))
      .map(el => el.textContent?.trim())
      .join(' ')
    expect(overflowLabels).toContain('Reports')
    expect(overflowLabels).toContain('Reference')
  })

  it('shows all five rather than four-plus-a-More-of-one', () => {
    const w = mount(UiBottomNav, {
      props: { items: SIX.slice(0, 5), modelValue: 'dashboard', label: 'Sections' },
    })
    expect(w.findAll('.bn-item')).toHaveLength(5)
    expect(w.text()).not.toContain('More')
  })

  it('emits the section key, the same key the desktop rail emits', async () => {
    const w = mount(UiBottomNav, {
      props: { items: SIX, modelValue: 'dashboard', label: 'Sections' },
    })
    await w.findAll('.bn-item')[2].trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['register'])
  })

  it('keeps More lit while one of its children is the active section', () => {
    const w = mount(UiBottomNav, {
      props: { items: SIX, modelValue: 'reference', label: 'Sections' },
    })
    expect(w.findAll('.bn-item').at(-1)?.classes()).toContain('active')
  })
})

describe('useBreakpoint — the values match the stylesheet', () => {
  it('exposes the same four breakpoints responsive.css declares', () => {
    // If these drift from --ent-bp-* in src/styles/responsive.css, CSS and JS
    // disagree about where a layout switches and the seam becomes visible.
    expect(BREAKPOINTS).toEqual({ mobile: 767, tablet: 768, desktop: 1024, wide: 1440 })
  })

  it('survives an environment whose matchMedia has no listener API', async () => {
    // Older happy-dom builds and some prerender shims return a MediaQueryList
    // with no addEventListener. Mounting must not throw because of that.
    vi.resetModules()
    const original = window.matchMedia
    // @ts-expect-error deliberately incomplete shim
    window.matchMedia = (q: string) => ({ matches: false, media: q })

    const { useBreakpoint } = await import('@/composables/useBreakpoint')
    expect(() => useBreakpoint()).not.toThrow()

    window.matchMedia = original
  })
})
