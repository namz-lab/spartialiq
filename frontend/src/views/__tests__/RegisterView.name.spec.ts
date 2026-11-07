// @vitest-environment happy-dom
//
// Sign-up asks for a first name and a surname, but the council's register,
// every permit and every served notice carry ONE `name`, and /auth/register
// accepts one field of at most 120 characters. The split is a question the
// citizen can answer from their ID; the join is what the server is told.
//
// What this pins down is the seam between those two facts: that the parts are
// joined (trimmed, single space), that each half names itself when it is the
// one that is wrong, and that two halves which are individually in range
// cannot produce a name the endpoint will reject.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

vi.mock('@/components/CaptchaField.vue', () => ({
  default: { name: 'CaptchaField', template: '<div />', methods: { ensure() { return Promise.resolve('') }, refresh() {} } },
}))

const pushed: string[] = []
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: (to: string) => { pushed.push(to); return Promise.resolve() },
    replace: (to: string) => { pushed.push(to); return Promise.resolve() },
  }),
  useRoute: () => ({ query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

vi.mock('../../router', () => ({ roleHome: () => '/citizen', default: {} }))

const register = vi.fn()
const user = ref<Record<string, unknown> | null>(null)
vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ register, get user() { return user.value } }),
}))

import RegisterView from '../RegisterView.vue'

/** Fill the form by label, so the test does not depend on field order. */
async function fill(wrapper: ReturnType<typeof mount>, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    const field = wrapper.findAll('.auth-field').find(
      (f) => f.find('.auth-label').text().replace(/\s*\(optional\)$/, '') === label,
    )
    if (!field) throw new Error(`no field labelled "${label}"`)
    const control = field.find('input').exists() ? field.find('input') : field.find('select')
    await control.setValue(value)
  }
}

const VALID = {
  'First name': 'Chipo',
  'Surname': 'Moyo',
  'Email address': 'chipo.moyo@example.com',
  'Phone': '077 123 4567',
  'Which describes you?': 'resident',
  'Password': 'mvura inonaya muHarare',
  'Confirm password': 'mvura inonaya muHarare',
}

async function submitValid(wrapper: ReturnType<typeof mount>, overrides = {}) {
  await fill(wrapper, { ...VALID, ...overrides })
  await wrapper.find('.auth-check input[type="checkbox"]').setValue(true)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('RegisterView — name is two fields, one value', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    pushed.length = 0
    user.value = { role: 'registered', residencyStatus: 'verified' }
    register.mockReset()
    register.mockResolvedValue({})
  })

  it('asks for the two parts separately', async () => {
    const wrapper = mount(RegisterView)
    const labels = wrapper.findAll('.auth-label').map((l) => l.text())
    expect(labels).toContain('First name')
    expect(labels).toContain('Surname')
    expect(labels).not.toContain('Full name')
  })

  it('sends them to the server as one name', async () => {
    const wrapper = mount(RegisterView)
    await submitValid(wrapper)

    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toMatchObject({ name: 'Chipo Moyo' })
    // The split is a detail of this screen; the API contract has one field.
    expect(register.mock.calls[0][0]).not.toHaveProperty('firstName')
    expect(register.mock.calls[0][0]).not.toHaveProperty('surname')
  })

  it('trims each part rather than sending the spaces through', async () => {
    const wrapper = mount(RegisterView)
    await submitValid(wrapper, { 'First name': '  Chipo  ', 'Surname': '  Moyo  ' })
    expect(register.mock.calls[0][0].name).toBe('Chipo Moyo')
  })

  it('names the half that is wrong, not "your full name"', async () => {
    const wrapper = mount(RegisterView)
    await fill(wrapper, { ...VALID, Surname: '' })
    await wrapper.find('.auth-check input[type="checkbox"]').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(register).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter your surname.')
    expect(wrapper.text()).not.toContain('Enter your full name.')
  })

  it('refuses two in-range halves that join past the server cap', async () => {
    // 60 + 60 + the space is 121, and /auth/register takes 120. Without this
    // the form posts and the citizen gets a 400 naming no field.
    const wrapper = mount(RegisterView)
    await fill(wrapper, { ...VALID, 'First name': 'a'.repeat(60), Surname: 'b'.repeat(60) })
    await wrapper.find('.auth-check input[type="checkbox"]').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(register).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('too long for the register')
  })

  it('will not let the password be either half of the name', async () => {
    const wrapper = mount(RegisterView)
    await fill(wrapper, {
      ...VALID, Password: 'moyo-moyo-2026', 'Confirm password': 'moyo-moyo-2026',
    })
    await wrapper.find('.auth-check input[type="checkbox"]').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(register).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('must not contain your name')
  })
})
