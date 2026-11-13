// @vitest-environment happy-dom
//
// The prompt dialog replaced every `window.prompt` this module used to open when a financial act
// needed a reason, an amount or a choice. These tests pin the contract the call sites rely on:
//
//   ask() resolves to the trimmed answer, or to null when cancelled — nothing else resolves it;
//   an invalid answer never resolves the promise (the server never sees it);
//   an amount must be the plain decimal string the money formatter accepts, signed only where
//   the caller allows a reduction;
//   a select offers the caller's options and resolves the chosen value, not its label.
//
// If a regression makes an empty or malformed reason resolvable, a financial mutation silently
// loses its audit note — that is what these tests exist to prevent.
import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import FinancePromptDialog from '../components/FinancePromptDialog.vue'
import { useFinancePrompt } from '../composables/useFinancePrompt'

let wrapper: VueWrapper | null = null

/** Mount the dialog wired to a real controller, attached to the document the Teleport targets. */
function fixture() {
  const prompt = useFinancePrompt()
  wrapper = mount(FinancePromptDialog, {
    props: { controller: prompt },
    attachTo: document.body,
  })
  return { prompt, wrapper }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

/** The dialog's field, found where the sheet teleported it. */
function field() {
  return document.getElementById('fpq-field') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
}
function confirmButton(): HTMLButtonElement | null {
  const buttons = [...document.querySelectorAll('button')]
  return buttons.find((b) => /confirm|approve|refuse|raise|commit|withdraw|close year|record|allocate|abandon|return it|reopen|withdraw/i.test(b.textContent ?? '')) ?? null
}
function cancelButton(): HTMLButtonElement | null {
  const buttons = [...document.querySelectorAll('button')]
  return buttons.find((b) => (b.textContent ?? '').trim() === 'Cancel') ?? null
}

describe('useFinancePrompt + FinancePromptDialog', () => {
  it('resolves the trimmed answer on confirm, then closes', async () => {
    const { prompt } = fixture()
    let settled: string | null | undefined = 'unsettled'
    const p = prompt.ask({ title: 'Note', label: 'A note', kind: 'textarea' }).then((v) => { settled = v })
    await new Promise((r) => setTimeout(r, 0))

    const input = field()
    expect(input).toBeTruthy()
    input.value = '  Grader hire rose after the tender  '
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))

    confirmButton()!.click()
    await p
    expect(settled).toBe('Grader hire rose after the tender')
  })

  it('resolves null on cancel — the window.prompt contract', async () => {
    const { prompt } = fixture()
    let settled: string | null | undefined = 'unsettled'
    const p = prompt.ask({ title: 'Note', label: 'Note', kind: 'text' }).then((v) => { settled = v })
    await new Promise((r) => setTimeout(r, 0))

    cancelButton()!.click()
    await p
    expect(settled).toBeNull()
    expect(field()).toBeNull()
  })

  it('never resolves a reason shorter than the stated minimum', async () => {
    const { prompt } = fixture()
    let settled: string | null | undefined = 'unsettled'
    const p = prompt.ask({ title: 'Refuse', label: 'Reason', kind: 'textarea', minLength: 10 }).then((v) => { settled = v })
    await new Promise((r) => setTimeout(r, 0))

    const input = field() as HTMLTextAreaElement
    input.value = 'short'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))

    confirmButton()!.click()
    // Give the resolver a chance to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe('unsettled')
    expect(field()).toBeTruthy()

    // Correcting the field past the minimum and confirming settles it.
    input.value = 'The tender figure was misread'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    confirmButton()!.click()
    await p
    expect(settled).toBe('The tender figure was misread')
  })

  it('refuses a malformed amount and accepts a decimal one', async () => {
    const { prompt } = fixture()
    let settled: string | null | undefined = 'unsettled'
    const p = prompt.ask({ title: 'Revise', label: 'Amount', kind: 'amount' }).then((v) => { settled = v })
    await new Promise((r) => setTimeout(r, 0))

    const input = field() as HTMLInputElement
    for (const bad of ['25 000.00', '25,000', '$25000', 'abc']) {
      input.value = bad
      input.dispatchEvent(new Event('input'))
      await new Promise((r) => setTimeout(r, 0))
      confirmButton()!.click()
      await new Promise((r) => setTimeout(r, 10))
      expect(settled).toBe('unsettled')
      expect(field()).toBeTruthy()
    }

    input.value = '-5000.00'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    confirmButton()!.click()
    await p
    expect(settled).toBe('-5000.00')
  })

  it('rejects a negative amount where the caller disallows one', async () => {
    const { prompt } = fixture()
    let settled: string | null | undefined = 'unsettled'
    const p = prompt.ask({ title: 'Allocate', label: 'Amount', kind: 'amount', allowNegative: false }).then((v) => { settled = v })
    await new Promise((r) => setTimeout(r, 0))

    const input = field() as HTMLInputElement
    input.value = '-5000.00'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    confirmButton()!.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe('unsettled')

    input.value = '5000.00'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    confirmButton()!.click()
    await p
    expect(settled).toBe('5000.00')
  })

  it('resolves the selected option value, not its label', async () => {
    const { prompt } = fixture()
    let settled: string | null | undefined = 'unsettled'
    const p = prompt.ask({
      title: 'Resolve', label: 'How?', kind: 'select',
      options: [
        { value: 'corrected_at_source', label: 'Corrected at source' },
        { value: 'row_excluded', label: 'Row excluded' },
      ],
    }).then((v) => { settled = v })
    await new Promise((r) => setTimeout(r, 0))

    const select = field() as HTMLSelectElement
    select.value = 'row_excluded'
    select.dispatchEvent(new Event('input'))
    select.dispatchEvent(new Event('change'))
    await new Promise((r) => setTimeout(r, 0))

    confirmButton()!.click()
    await p
    expect(settled).toBe('row_excluded')
  })

  it('re-seeds the field when a second ask() replaces the first', async () => {
    const { prompt } = fixture()
    let first: string | null | undefined = 'unsettled'
    let second: string | null | undefined = 'unsettled'
    const p1 = prompt.ask({ title: 'One', label: 'First', kind: 'text' }).then((v) => { first = v })
    await new Promise((r) => setTimeout(r, 0))

    const input = field() as HTMLInputElement
    input.value = 'answer one'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    confirmButton()!.click()
    await p1
    expect(first).toBe('answer one')

    const p2 = prompt.ask({ title: 'Two', label: 'Second', kind: 'text' }).then((v) => { second = v })
    await new Promise((r) => setTimeout(r, 0))
    const input2 = field() as HTMLInputElement
    expect(input2.value).toBe('')
    input2.value = 'answer two'
    input2.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    confirmButton()!.click()
    await p2
    expect(second).toBe('answer two')
  })
})
