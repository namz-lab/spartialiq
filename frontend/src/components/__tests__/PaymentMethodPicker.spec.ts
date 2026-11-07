// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PaymentMethodPicker from '../PaymentMethodPicker.vue'

const baseProps = {
  priceUsd: 25,
  council:  { name: 'Vungu Rural District Council' },
}

describe('PaymentMethodPicker', () => {
  it('renders three active tiles and three disabled tiles', () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    expect(w.find('[data-tile="ecocash"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-tile="onemoney"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-tile="innbucks"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-tile="card"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-tile="googlepay"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-tile="applepay"]').attributes('disabled')).toBeDefined()
  })

  it('blocks submit when phone prefix does not match the picked wallet', async () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    await w.find('[data-tile="innbucks"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    expect(w.find('[data-test="pmp-pay"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('InnBucks numbers start with 086')
  })

  it('emits submit with normalised +263 phone when valid', async () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    await w.find('[data-test="pmp-pay"]').trigger('click')
    const events = w.emitted('submit')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({
      wallet:    'ecocash',
      phone:     '+263771234567',
      walletCcy: 'USD',
    })
  })

  it('emits cancel on close button', async () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    await w.find('[data-test="pmp-close"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})

// Review P0: handlePay had no busy flag, so a double-click lodged the same
// application twice and charged for both.
describe('PaymentMethodPicker double-submit protection', () => {
  async function readyToPay(props: Record<string, unknown> = {}) {
    const w = mount(PaymentMethodPicker, { props: { ...baseProps, ...props } })
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    return w
  }

  it('emits submit only once when Pay is clicked repeatedly on the same tick', async () => {
    const w = await readyToPay()
    const btn = w.find('[data-test="pmp-pay"]')
    // No await between them: this is the real double-click race.
    btn.trigger('click')
    btn.trigger('click')
    btn.trigger('click')
    await w.vm.$nextTick()
    expect(w.emitted('submit')).toHaveLength(1)
  })

  it('disables Pay while the parent reports a request in flight', async () => {
    const w = await readyToPay({ busy: true })
    expect(w.find('[data-test="pmp-pay"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Processing payment')
  })

  it('ignores a click that arrives while busy', async () => {
    const w = await readyToPay()
    await w.setProps({ busy: true })
    await w.find('[data-test="pmp-pay"]').trigger('click')
    expect(w.emitted('submit')).toBeFalsy()
  })

  it('re-enables Pay when the parent clears busy, so a failure can be retried', async () => {
    const w = await readyToPay()
    await w.find('[data-test="pmp-pay"]').trigger('click')
    await w.setProps({ busy: true })
    expect(w.find('[data-test="pmp-pay"]').attributes('disabled')).toBeDefined()

    await w.setProps({ busy: false })          // request failed and settled
    expect(w.find('[data-test="pmp-pay"]').attributes('disabled')).toBeUndefined()

    await w.find('[data-test="pmp-pay"]').trigger('click')
    expect(w.emitted('submit')).toHaveLength(2)
  })
})
