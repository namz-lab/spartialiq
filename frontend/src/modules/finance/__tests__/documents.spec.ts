// @vitest-environment happy-dom
//
// The document register is the surface that puts the paper behind a figure. Three of its rules are
// controls rather than conveniences, and these tests pin them:
//
//   1. Releasing a document to the public is a PUBLISHER's act. A finance officer who can upload
//      must not be offered a Publish control, because a document released by accident is a
//      disclosure that cannot be taken back.
//   2. Making one public demands a written reason. The server requires it; the screen must ask for
//      it rather than send the request and show a 400.
//   3. Withdrawal is a soft delete and the screen must say so, because "delete" on a financial
//      record would be a promise the system does not keep.
//   4. Withdrawal is a WRITE. It used to be offered to any holder of `finance.document.view` —
//      which is the read-only auditor, the publisher and the committee — because the screen
//      mirrored a backend guard that was itself too permissive (audit BLOCKER-3 / GAP-3). The
//      button now needs `finance.document.withdraw`, and its absence is explained rather than
//      silently left out.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/financeApi', () => ({
  financeApi: {
    documents: vi.fn(),
    uploadDocument: vi.fn(),
    setDocumentVisibility: vi.fn(),
    withdrawDocument: vi.fn(),
    documentDownloadUrl: (id: string) => `/api/finance/documents/${id}/download`,
    budgetLines: vi.fn(),
    revisions: vi.fn(),
    projects: vi.fn(),
    imports: vi.fn(),
    publications: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import DocumentsSection from '../pages/sections/DocumentsSection.vue'
import { useFinanceStore } from '../stores/finance'
import type { FinanceDocument, FinanceIdentity, FinancePermission } from '../models/types'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const CATALOGUE: FinancePermission[] = [
  { code: 'finance.document.view', label: 'View documents', category: 'documents', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.document.upload', label: 'Attach documents', category: 'documents', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.document.withdraw', label: 'Withdraw finance documents', category: 'documents', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.publication.publish', label: 'Publish a dataset', category: 'publication', is_approval: false, is_publication: true, is_restricted: false, description: null },
]

function identity(permissions: string[], role = 'finance_officer'): FinanceIdentity {
  return { user_id: 'u1', role, authority_id: 1, permissions, department_scope: [], catalogue: CATALOGUE }
}

const INTERNAL_DOC: FinanceDocument = {
  id: 'd1', subject_kind: 'budget_line', subject_id: 'bl1',
  filename: 'roads-schedule.pdf', mime_type: 'application/pdf', size_bytes: '20480',
  document_type: 'approved_budget', visibility: 'internal',
  uploaded_at: '2026-10-01T09:00:00Z', uploaded_by_name: 'Rudo Moyo',
}

async function section(permissions: string[]) {
  api.documents.mockResolvedValue({ documents: [INTERNAL_DOC], restricted_visible: false })
  api.budgetLines.mockResolvedValue({ lines: [], total: 0, limit: 50, offset: 0, available_balance_includes_commitments: false })
  api.revisions.mockResolvedValue([])
  api.projects.mockResolvedValue([])
  api.imports.mockResolvedValue([])
  api.publications.mockResolvedValue([])

  const store = useFinanceStore()
  store.identity = identity(permissions)
  // Attached to the document because the prompt dialog sits on the shared sheet overlay, which
  // teleports out of the component's own tree.
  const wrapper = mount(DocumentsSection, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

/** What the prompt dialog is asking, read where the sheet teleported it. */
const dialogText = (): string => document.body.textContent ?? ''
const dialogField = () =>
  document.getElementById('fpq-field') as HTMLTextAreaElement | HTMLInputElement | null
function dialogConfirm(): HTMLButtonElement | null {
  const buttons = [...document.querySelectorAll('button')]
  return buttons.find((b) => /make it public|change visibility|withdraw it/i.test(b.textContent ?? '')) ?? null
}

const buttonSaying = (wrapper: Awaited<ReturnType<typeof section>>, text: string) =>
  wrapper.findAll('button').find((b) => b.text().includes(text))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('the finance document register', () => {
  it('offers no release control to an officer who may attach documents but not publish', async () => {
    const wrapper = await section(['finance.document.view', 'finance.document.upload'])

    expect(buttonSaying(wrapper, 'Attach a document')).toBeDefined()
    // The three visibility controls belong to the publisher, not the preparer.
    expect(buttonSaying(wrapper, 'Publish')).toBeUndefined()
    expect(buttonSaying(wrapper, 'Restrict')).toBeUndefined()
    // And the screen explains the absence rather than leaving a gap.
    expect(wrapper.text()).toContain('Publication is reserved to the roles holding')
    wrapper.unmount()
  })

  it('will not release a document to the public without a written reason', async () => {
    const wrapper = await section(['finance.document.view', 'finance.publication.publish'])

    await buttonSaying(wrapper, 'Publish')!.trigger('click')
    await flushPromises()

    // The dialog is open and nothing has been sent: a reason is collected first.
    expect(dialogText()).toContain('Why is this document being made public?')
    expect(api.setDocumentVisibility).not.toHaveBeenCalled()
    // And it cannot be sent empty: the confirming control stays disabled until the reason is long
    // enough for the server to accept it.
    expect(dialogConfirm()?.disabled).toBe(true)
    wrapper.unmount()
  })

  it('sends the visibility change with the reason once it has one', async () => {
    api.setDocumentVisibility.mockResolvedValue({ id: 'd1', visibility: 'public' })
    const wrapper = await section(['finance.document.view', 'finance.publication.publish'])

    await buttonSaying(wrapper, 'Publish')!.trigger('click')
    await flushPromises()

    const field = dialogField()!
    field.value = 'Released with the 2026 budget book.'
    field.dispatchEvent(new Event('input'))
    await flushPromises()
    dialogConfirm()!.click()
    await flushPromises()

    expect(api.setDocumentVisibility).toHaveBeenCalledWith('d1', 'public', 'Released with the 2026 budget book.')
    wrapper.unmount()
  })

  it('describes withdrawal as retention, not deletion', async () => {
    const wrapper = await section(['finance.document.view', 'finance.document.withdraw'])

    await buttonSaying(wrapper, 'Withdraw')!.trigger('click')
    await flushPromises()

    expect(dialogText()).toContain('financial documents are never deleted')
    expect(api.withdrawDocument).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('offers no withdrawal to a reader, and explains the absence', async () => {
    // The read-only auditor: holds every document READ permission and no write permission at all.
    const wrapper = await section(['finance.document.view', 'finance.document.view_restricted'])

    expect(buttonSaying(wrapper, 'Withdraw')).toBeUndefined()
    expect(wrapper.text()).toContain('finance.document.withdraw')
    expect(wrapper.text()).toContain('never a deletion')
    wrapper.unmount()
  })

  it('says that restricted documents are absent from the list rather than blanked out', async () => {
    const wrapper = await section(['finance.document.view'])
    expect(wrapper.text()).toContain('Restricted documents are not listed for your role')
    wrapper.unmount()
  })
})
