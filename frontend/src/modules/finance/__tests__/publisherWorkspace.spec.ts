// @vitest-environment happy-dom
//
// Publication workspace:
//   1. THE LOG READS EVERY PAGE, not the server's default fifty.
//   2. VERSION CHAINS group by dataset, year and period, newest first, with the live one marked.
//   3. QUICK ACTIONS ARE OFFERED ONLY WITH THE PERMISSION THEIR DESTINATION NEEDS.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../../../services/api', () => ({ default: { get: vi.fn() } }))

import api from '../../../services/api'
import { publicationApi, versionChains, sameApproverAndPublisher, type PublicationRecord } from '../api/publicationApi'
import PublisherDashboard from '../workspaces/publisher/pages/PublisherDashboard.vue'
import { publisherDash } from '../workspaces/publisher/dashboard'
import { useFinanceStore } from '../stores/finance'

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get
const pub = (over: Partial<PublicationRecord> = {}): PublicationRecord => ({
  id: 'p1', financial_year_id: 'y1', financial_year_label: 'FY2026 (Jan to Dec)', dataset: 'budget', version: 1, state: 'published',
  reporting_period_label: 'Q1', data_as_at: null, decision_note: null, withdraw_reason: null, reviewed_at: null, approved_at: null,
  published_at: '2026-04-01T10:00:00Z', withdrawn_at: null, ...over,
})

beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

describe('publicationApi.all', () => {
  it('reads every page of 200 until a short page', async () => {
    get.mockResolvedValueOnce({ data: { data: Array.from({ length: 200 }, (_, i) => pub({ id: `a${i}` })) } })
      .mockResolvedValueOnce({ data: { data: [pub({ id: 'last' })] } })
    const r = await publicationApi.all({ dataset: 'budget' })
    expect(r.rows).toHaveLength(201)
    expect(r.truncated).toBe(false)
    expect(get).toHaveBeenNthCalledWith(2, '/finance/publications', { params: { dataset: 'budget', limit: 200, offset: 200 } })
  })
})

describe('version chains', () => {
  it('groups by dataset, year and period, newest version first, and marks the live one', () => {
    const chains = versionChains([
      pub({ id: 'v1', version: 1, state: 'withdrawn' }), pub({ id: 'v2', version: 2, state: 'published' }), pub({ id: 'v3', version: 3, state: 'pending', published_at: null }),
      pub({ id: 'q2', reporting_period_label: 'Q2', version: 1, state: 'approved', published_at: null }),
    ])
    expect(chains).toHaveLength(2)
    const q1 = chains.find((c) => c.period === 'Q1')!
    expect(q1.versions.map((v) => v.version)).toEqual([3, 2, 1])
    expect(q1.live?.id).toBe('v2')
    expect(chains.find((c) => c.period === 'Q2')!.live).toBeNull()
  })
  it('flags one person approving and publishing only when both ids are known', () => {
    expect(sameApproverAndPublisher(pub({ approved_by: 'u1', published_by: 'u1' }))).toBe(true)
    expect(sameApproverAndPublisher(pub({ approved_by: 'u1', published_by: 'u2' }))).toBe(false)
    expect(sameApproverAndPublisher(pub({ approved_by: null, published_by: 'u2' }))).toBe(false)
  })
})

describe('publisher dashboard quick actions', () => {
  let w: VueWrapper | null = null
  afterEach(() => { w?.unmount(); w = null; publisherDash.reset() })
  async function mountDash(permissions: string[]) {
    const store = useFinanceStore()
    store.identity = { user_id: 'u', role: 'publisher', authority_id: 1, permissions, department_scope: [], catalogue: [] } as never
    publisherDash.state.data = {
      states: { published: 2, pending: 1, approved: 1, rejected: 0, withdrawn: 0 }, this_month: { published: 0, pending: 0, approved: 0, rejected: 0, withdrawn: 0 },
      recent: [], documents: { public: 3, internal: 0, private: 0 },
    } as never
    const Stub = defineComponent({ render: () => h('div') })
    const router = createRouter({ history: createMemoryHistory(), routes: ['pub-dashboard', 'pub-website', 'pub-reports', 'pub-log', 'pub-council', 'pub-disclosures', 'pub-versions']
      .map((name) => ({ path: `/${name}`, name, component: Stub })) })
    await router.push('/pub-dashboard')
    w = mount(PublisherDashboard, { global: { plugins: [router] } })
    await flushPromises()
    return w
  }
  it('does not offer document upload to a publisher without finance.document.upload', async () => {
    const d = await mountDash(['finance.publication.publish', 'finance.publication.review'])
    expect(d.text()).not.toContain('Upload Document')
    expect(d.text()).toContain('Publish Approved')
    expect(d.text()).toContain('Version History')
  })
  it('offers it when the role holds the upload permission', async () => {
    const d = await mountDash(['finance.publication.publish', 'finance.document.upload'])
    expect(d.text()).toContain('Upload Document')
  })
})
