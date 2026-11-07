// @vitest-environment happy-dom
//
// Sign-in behaviour that a manual click-through cannot show, and that the
// screen got wrong before:
//
//   1. An account with MFA enabled must reach a second step. The store used
//      to THROW "two-factor authentication is not yet supported here", so an
//      officer who enrolled (the enrolment endpoints have always been live)
//      was locked out of the portal for good.
//   2. A rejected navigation must come back to where it was going. The guard
//      now carries ?redirect=, and the screen must honour it — but only for
//      in-app paths, or sign-in becomes an open redirect.
//   3. A failure that cannot succeed on retry must disable submit rather
//      than inviting a sixth attempt that deepens a lockout.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

// The bot check fetches and solves a challenge on mount; it is not what is under test.
vi.mock('@/components/CaptchaField.vue', () => ({
  default: { name: 'CaptchaField', template: '<div />', methods: { ensure() { return Promise.resolve('') }, refresh() {} } },
}))

const pushed: string[] = []
const routeQuery = ref<Record<string, string>>({})

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: (to: string) => { pushed.push(to); return Promise.resolve() },
    replace: (to: string) => { pushed.push(to); return Promise.resolve() },
  }),
  useRoute: () => ({ get query() { return routeQuery.value } }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

vi.mock('../../router', () => ({
  roleHome: (role: string) => (role === 'planner' ? '/planner-workspace' : '/citizen'),
  default: {},
}))

// The store's two network calls, stubbed at the store boundary so the test
// exercises the view's decisions rather than axios.
const login = vi.fn()
const completeMfa = vi.fn()
const user = ref<Record<string, unknown> | null>(null)

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({
    login,
    completeMfa,
    get user() { return user.value },
  }),
}))

import LoginView from '../LoginView.vue'

const apiError = (status: number, data: unknown) => ({ response: { status, data } })

async function fillAndSubmit(wrapper: ReturnType<typeof mount>) {
  const inputs = wrapper.findAll('input')
  await inputs[0].setValue('demo.planner@vungu.test')
  await inputs[1].setValue('demo1234')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    pushed.length = 0
    routeQuery.value = {}
    user.value = null
    login.mockReset()
    completeMfa.mockReset()
  })

  it('renders the second step when the account owes a second factor', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaToken: 'pending-token' })
    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper)

    expect(wrapper.text()).toContain('Confirm it is you')
    // Nothing was signed in, so nothing was navigated to.
    expect(pushed).toEqual([])

    completeMfa.mockResolvedValue({ role: 'planner' })
    user.value = { role: 'planner', residencyStatus: 'verified' }
    await wrapper.find('input').setValue('123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(completeMfa).toHaveBeenCalledWith('pending-token', '123456')
    expect(pushed).toEqual(['/planner-workspace'])
  })

  it('does not spend an attempt on a code that is obviously a typo', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaToken: 'pending-token' })
    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper)

    await wrapper.find('input').setValue('123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(completeMfa).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('six-digit code')
  })

  it('drops back to the password step when the pending token expires', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaToken: 'pending-token' })
    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper)

    completeMfa.mockRejectedValue(apiError(401, { error: 'invalid_or_expired_mfa_token' }))
    await wrapper.find('input').setValue('123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    // Back on step one — entering more codes against a token the server has
    // forgotten would burn attempts against the lockout for nothing.
    expect(wrapper.text()).toContain('Sign in')
    expect(wrapper.text()).not.toContain('Confirm it is you')
  })

  it('returns to the page the guard interrupted', async () => {
    routeQuery.value = { redirect: '/planner-workspace?permit=TPD-2026-0900' }
    login.mockResolvedValue({ mfaRequired: false, user: { role: 'planner' } })
    user.value = { role: 'planner', residencyStatus: 'verified' }

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper)

    expect(pushed).toEqual(['/planner-workspace?permit=TPD-2026-0900'])
  })

  it('refuses an off-site redirect', async () => {
    // A sign-in page that forwards anywhere a query string names is an open
    // redirect, and this one is linked from emails.
    for (const hostile of ['https://evil.example/harvest', '//evil.example/harvest']) {
      pushed.length = 0
      routeQuery.value = { redirect: hostile }
      login.mockResolvedValue({ mfaRequired: false, user: { role: 'planner' } })
      user.value = { role: 'planner', residencyStatus: 'verified' }

      const wrapper = mount(LoginView)
      await fillAndSubmit(wrapper)

      expect(pushed, hostile).toEqual(['/planner-workspace'])
    }
  })

  it('sends an unverified citizen to prove residency first', async () => {
    routeQuery.value = { redirect: '/citizen?section=applications' }
    login.mockResolvedValue({ mfaRequired: false, user: { role: 'registered' } })
    user.value = { role: 'registered', residencyStatus: 'pending' }

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper)

    expect(pushed).toEqual(['/residency'])
  })

  it('stops offering retry on a failure that cannot succeed', async () => {
    login.mockRejectedValue(apiError(429, {
      error: 'locked_out',
      message: 'Too many failed sign-in attempts. Try again later or contact council IT.',
      data: { retryAt: new Date(Date.now() + 12 * 60_000).toISOString() },
    }))

    const wrapper = mount(LoginView)
    await fillAndSubmit(wrapper)

    expect(wrapper.text()).toContain('Too many failed sign-in attempts')
    expect(wrapper.text()).toMatch(/in about \d+ minutes/)
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('does not post a form with an incomplete field', async () => {
    const wrapper = mount(LoginView)
    await wrapper.findAll('input')[0].setValue('not-an-email')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(login).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('complete email address')
  })

  it('explains an expired session rather than looking like a random logout', async () => {
    routeQuery.value = { reason: 'expired', redirect: '/planner-workspace' }
    const wrapper = mount(LoginView)
    await flushPromises()
    expect(wrapper.text()).toContain('Your session ended')
  })
})
