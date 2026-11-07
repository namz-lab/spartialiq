// @vitest-environment happy-dom
//
// Every field needs an id of its own. The counter that generates it lives in a
// plain <script> block, not in <script setup>, and that distinction is the
// whole test: <script setup> is compiled into setup(), so a `let seq = 0`
// there is re-initialised per instance and every field renders "auth-f1".
//
// The failure is silent — the form looks right and works with a mouse — but
// duplicate ids mean every <label for> points at the first field and every
// aria-describedby resolves to the first field's error. A screen-reader user
// tabbing to the password box is read the email box's error message.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AuthField from '../AuthField.vue'

describe('AuthField identifiers', () => {
  it('gives each instance a distinct id', () => {
    const ids = [1, 2, 3, 4].map(
      (n) => mount(AuthField, { props: { label: `Field ${n}` } }).find('input').attributes('id'),
    )
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points each label at its own control', () => {
    const a = mount(AuthField, { props: { label: 'Email address' } })
    const b = mount(AuthField, { props: { label: 'Password', type: 'password' } })

    expect(a.find('label').attributes('for')).toBe(a.find('input').attributes('id'))
    expect(b.find('label').attributes('for')).toBe(b.find('input').attributes('id'))
    expect(a.find('label').attributes('for')).not.toBe(b.find('label').attributes('for'))
  })

  it('describes a field by its own hint and error, never a neighbour’s', () => {
    const first = mount(AuthField, {
      props: { label: 'Email', error: 'Enter your email address.' },
    })
    const second = mount(AuthField, {
      props: {
        label: 'Password', type: 'password',
        hint: 'At least 8 characters.', error: 'Choose a password.',
      },
    })

    const describedBy = second.find('input').attributes('aria-describedby')!.split(' ')
    expect(describedBy).toHaveLength(2)
    for (const id of describedBy) {
      expect(second.find(`#${id}`).exists()).toBe(true)
      expect(first.find(`#${id}`).exists()).toBe(false)
    }
  })

  it('leaves aria-describedby off a field with nothing to describe', () => {
    const plain = mount(AuthField, { props: { label: 'Organisation' } })
    expect(plain.find('input').attributes('aria-describedby')).toBeUndefined()
    expect(plain.find('input').attributes('aria-invalid')).toBeUndefined()
  })
})
