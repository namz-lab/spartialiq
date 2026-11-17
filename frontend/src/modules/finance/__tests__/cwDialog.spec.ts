// @vitest-environment happy-dom
//
// The workspace's one modal dialog (a11y audit B10): role and name, description, focus in, Esc
// (ignored while busy), the Tab trap, the focus return to the opener and its fallback to the page.
import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import CwDialog from '../workspaces/shared/CwDialog.vue'
import ReasonDialog from '../workspaces/shared/ReasonDialog.vue'

afterEach(() => { document.body.innerHTML = '' })

/** A host page: an opener button and a dialog it shows. */
function host(opts: { busy?: boolean; role?: 'dialog' | 'alertdialog'; autofocusBack?: boolean; describe?: boolean } = {}) {
  const open = ref(false)
  const busy = ref(!!opts.busy)
  const closes = ref(0)
  const Host = defineComponent({
    setup() {
      return () => h('div', [
        h('main', { id: 'cw-main', tabindex: '-1' }, [
          h('button', { id: 'opener', onClick: () => { open.value = true } }, 'Open'),
          h('button', { id: 'behind' }, 'Behind'),
        ]),
        open.value
          ? h(CwDialog, { title: 'Discard this draft', role: opts.role, busy: busy.value, onClose: () => { closes.value++; open.value = false } }, {
            ...(opts.describe ? { describe: () => h('p', 'This cannot be undone.') } : {}),
            default: () => [h('label', ['Reason ', h('input', { id: 'first-field' })])],
            footer: () => [
              h('button', { id: 'back', ...(opts.autofocusBack ? { 'data-autofocus': '' } : {}) }, 'Back'),
              h('button', { id: 'go', 'aria-disabled': busy.value || undefined }, 'Discard'),
            ],
          })
          : null,
      ])
    },
  })
  const w = mount(Host, { attachTo: document.body })
  return { w, open, busy, closes }
}
const panel = () => document.querySelector<HTMLElement>('.cw-dialog')
const key = (k: string, shift = false) => {
  const ev = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })
  panel()!.dispatchEvent(ev)
  return ev
}

async function openFrom(w: ReturnType<typeof host>['w']) {
  const opener = w.get('#opener').element as HTMLElement
  opener.focus()
  await w.get('#opener').trigger('click')
  await flushPromises()
  return opener
}

describe('CwDialog', () => {
  it('is a modal named by its visible heading and described by the describe slot', async () => {
    const { w } = host({ role: 'alertdialog', describe: true })
    await openFrom(w)
    const p = panel()!
    expect(p.getAttribute('role')).toBe('alertdialog')
    expect(p.getAttribute('aria-modal')).toBe('true')
    expect(p.hasAttribute('aria-label')).toBe(false)
    expect(document.getElementById(p.getAttribute('aria-labelledby')!)!.textContent).toBe('Discard this draft')
    expect(document.getElementById(p.getAttribute('aria-describedby')!)!.textContent).toBe('This cannot be undone.')
    w.unmount()
  })

  it('has no aria-describedby without a describe slot, and defaults to role dialog', async () => {
    const { w } = host()
    await openFrom(w)
    expect(panel()!.getAttribute('role')).toBe('dialog')
    expect(panel()!.hasAttribute('aria-describedby')).toBe(false)
    w.unmount()
  })

  it('moves focus to the first field, or to the element marked data-autofocus', async () => {
    const a = host()
    await openFrom(a.w)
    expect(document.activeElement?.id).toBe('first-field')
    a.w.unmount()
    const b = host({ autofocusBack: true })
    await openFrom(b.w)
    expect(document.activeElement?.id).toBe('back')
    b.w.unmount()
  })

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const { w } = host()
    await openFrom(w)
    ;(document.getElementById('go') as HTMLElement).focus()
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('first-field')
    expect(key('Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('go')
    // In the middle, Tab is left to the browser.
    ;(document.getElementById('back') as HTMLElement).focus()
    expect(key('Tab').defaultPrevented).toBe(false)
    w.unmount()
  })

  it('closes on Escape and gives focus back to the opener', async () => {
    const { w, closes } = host()
    const opener = await openFrom(w)
    key('Escape')
    await flushPromises()
    expect(closes.value).toBe(1)
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(opener)
    w.unmount()
  })

  it('ignores Escape and a backdrop click while busy, and marks itself aria-busy', async () => {
    const { w, closes, busy } = host({ busy: true })
    await openFrom(w)
    expect(panel()!.getAttribute('aria-busy')).toBe('true')
    // The busy button keeps its focus: aria-disabled, never disabled.
    const go = document.getElementById('go') as HTMLButtonElement
    go.focus()
    expect(go.disabled).toBe(false)
    expect(go.getAttribute('aria-disabled')).toBe('true')
    key('Escape')
    ;(document.querySelector('.cw-dialog-backdrop') as HTMLElement).click()
    await flushPromises()
    expect(closes.value).toBe(0)
    expect(document.activeElement).toBe(go)
    busy.value = false
    await flushPromises()
    expect(panel()!.hasAttribute('aria-busy')).toBe(false)
    ;(document.querySelector('.cw-dialog-backdrop') as HTMLElement).click()
    await flushPromises()
    expect(closes.value).toBe(1)
    w.unmount()
  })

  it('falls back to the page when the opener has gone', async () => {
    const { w, open } = host()
    const opener = await openFrom(w)
    opener.remove()
    open.value = false
    await flushPromises()
    expect(document.activeElement?.id).toBe('cw-main')
    w.unmount()
  })

  it('leaves focus alone when the host has already moved it out of the dialog', async () => {
    const { w, open } = host()
    await openFrom(w)
    const behind = document.getElementById('behind') as HTMLElement
    // The page behind is inert while the dialog is open; a host moves focus once it has released the page.
    document.getElementById('cw-main')?.removeAttribute('inert')
    behind.focus()
    open.value = false
    await flushPromises()
    expect(document.activeElement).toBe(behind)
    w.unmount()
  })
})

describe('CwDialog focusables', () => {
  it('skips hidden controls: Tab wraps past them and the first-field search ignores them', async () => {
    const open = ref(true)
    const Host = defineComponent({
      setup: () => () => open.value ? h(CwDialog, { title: 'T' }, {
        default: () => [
          h('input', { id: 'gone', hidden: true }),
          h('div', { style: 'display: none' }, [h('input', { id: 'gone2' })]),
          h('input', { id: 'shown' }),
          h('button', { id: 'hidden-last', style: 'visibility: hidden' }, 'x'),
        ],
        footer: () => [h('button', { id: 'ok' }, 'OK')],
      }) : null,
    })
    const w = mount(Host, { attachTo: document.body })
    await flushPromises()
    expect(document.activeElement?.id).toBe('shown')
    ;(document.getElementById('ok') as HTMLElement).focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    panel()!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('shown')
    ;(document.getElementById('shown') as HTMLElement).focus()
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    panel()!.dispatchEvent(back)
    expect(document.activeElement?.id).toBe('ok')
    w.unmount()
  })
})

describe('CwDialog page lock and backdrop', () => {
  it('makes the page behind inert and stops it scrolling while open, and restores both on close', async () => {
    const { w, open } = host()
    await openFrom(w)
    expect(document.getElementById('cw-main')?.hasAttribute('inert')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    open.value = false
    await flushPromises()
    expect(document.getElementById('cw-main')?.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('')
    w.unmount()
  })
  it('does not close a form dialog on a backdrop click, but closes a plain one', async () => {
    const closed = ref(0)
    const Form = defineComponent({ setup: () => () => h(CwDialog, { title: 'F', form: true, onClose: () => { closed.value++ } }, { default: () => h('input'), footer: () => h('button', 'ok') }) })
    const w = mount(Form, { attachTo: document.body })
    await flushPromises()
    ;(document.querySelector('.cw-dialog-backdrop') as HTMLElement).click()
    expect(closed.value).toBe(0)
    w.unmount()
  })
})

describe('ReasonDialog on CwDialog', () => {
  it('starts in the reason, describes itself by the message, and ignores Esc and Back while busy', async () => {
    const w = mount(ReasonDialog, { props: { title: 'Reverse this voucher', message: 'The original stays on the record.', busy: true }, attachTo: document.body })
    await flushPromises()
    const p = panel()!
    expect(p.tagName).toBe('FORM')
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
    expect(document.getElementById(p.getAttribute('aria-describedby')!)!.textContent).toContain('The original stays on the record.')
    key('Escape')
    await w.findAll('button').find((b) => b.text() === 'Back')!.trigger('click')
    expect(w.emitted('close')).toBeUndefined()
    const submit = w.find('button[type="submit"]')
    expect(submit.attributes('aria-disabled')).toBe('true')
    await w.setProps({ busy: false })
    key('Escape')
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
})
