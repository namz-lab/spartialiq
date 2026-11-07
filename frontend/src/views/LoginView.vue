<script setup lang="ts">
/**
 * Sign in.
 *
 * Two steps, not one: an account with MFA enabled answers the password with
 * a pending token rather than a session, and this screen renders the code
 * step from it. That step did not exist before — the store threw "two-factor
 * authentication is not yet supported here", which meant any officer who
 * enrolled in MFA (the enrolment endpoints have always been live) locked
 * themselves out of the portal permanently.
 *
 * Failures are told apart rather than flattened into "Login failed": a wrong
 * password, a locked account, a blocked network, a suspended account and a
 * rate limit each need a different answer from the person reading them, and
 * only one of the five is worth retrying. See src/auth/authErrors.ts.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Info, KeyRound, LogIn, Loader2, ShieldCheck } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import { roleHome } from '../router'
import { isClientRole, type Role } from '../services/types'
import CaptchaField from '@/components/CaptchaField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthField from '@/components/auth/AuthField.vue'
import { validateEmail, validateRequired, collectErrors } from '@/auth/validation'
import { describeAuthError, untilPhrase, type AuthFailure } from '@/auth/authErrors'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// Demo one-click accounts in local development, and on a hosted demo when
// the build was made with VITE_ALLOW_DEMO_LOGIN=1.
const isDev = import.meta.env.VITE_ALLOW_DEMO_LOGIN === '1'
  || (import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEMO_LOGIN !== '0')

// ── Form state ─────────────────────────────────────────────────────────
const email = ref('')
const password = ref('')
const captchaToken = ref('')
const honeypot = ref('')
const captchaRef = ref<{ ensure: () => Promise<string>; refresh: () => void } | null>(null)

const errors = ref<{ email?: string; password?: string }>({})
const failure = ref<AuthFailure | null>(null)
const submitting = ref(false)
/** Announced politely so a screen reader hears the outcome of submit. */
const liveMessage = ref('')

const emailField = ref<{ focus: () => void } | null>(null)
const passwordField = ref<{ focus: () => void } | null>(null)
const banner = ref<HTMLElement | null>(null)

// ── Second factor ──────────────────────────────────────────────────────
const mfaToken = ref('')
const mfaCode = ref('')
const mfaError = ref('')
const mfaField = ref<{ focus: () => void } | null>(null)
const step = computed<'credentials' | 'code'>(() => (mfaToken.value ? 'code' : 'credentials'))

// ── Why the visitor is here ────────────────────────────────────────────
// The router sends a rejected navigation here with ?redirect=, and an expired
// session with ?reason=expired. Saying which is the difference between "the
// portal logged me out for no reason" and "my session ran out".
const redirectTo = computed(() => {
  const raw = route.query.redirect
  const path = typeof raw === 'string' ? raw : ''
  // Only ever an in-app path. An absolute URL here would make this an open
  // redirect — a sign-in page that forwards to any site an attacker names.
  return path.startsWith('/') && !path.startsWith('//') ? path : ''
})
const arrivalNotice = computed(() => {
  if (route.query.reason === 'expired') return 'Your session ended. Sign in to carry on where you left off.'
  if (route.query.reason === 'reset') return 'Password changed. Sign in with your new password.'
  if (redirectTo.value) return 'Sign in to open that page.'
  return ''
})

onMounted(() => {
  // Prefill after a reset so the officer types one thing, not two.
  const from = route.query.email
  if (typeof from === 'string' && from.includes('@')) email.value = from
})

// ── Validation ─────────────────────────────────────────────────────────
// Checked on blur (so a mistake is caught before submit) and again on submit
// (because a field that was never touched was never blurred).
function checkEmail() {
  const r = validateEmail(email.value)
  errors.value = { ...errors.value, email: r.ok ? undefined : r.message }
}
function checkPassword() {
  const r = validateRequired(password.value, 'Enter your password.')
  errors.value = { ...errors.value, password: r.ok ? undefined : r.message }
}

const canSubmit = computed(() => !submitting.value && failure.value?.retryable !== false)

async function focusBanner() {
  await nextTick()
  banner.value?.focus()
}

async function handleSubmit() {
  failure.value = null
  liveMessage.value = ''

  const { errors: found, valid, firstInvalid } = collectErrors({
    email: validateEmail(email.value),
    // Length is not checked on sign-in: an old password that no longer meets
    // the council's current minimum is still the password on the account, and
    // refusing to send it would lock its owner out of their own reset.
    password: validateRequired(password.value, 'Enter your password.'),
  })
  errors.value = found
  if (!valid) {
    liveMessage.value = 'Check the fields marked below.'
    await nextTick()
    ;(firstInvalid === 'email' ? emailField : passwordField).value?.focus()
    return
  }

  submitting.value = true
  try {
    const outcome = await auth.login(email.value.trim(), password.value, {
      token: (await captchaRef.value?.ensure()) ?? captchaToken.value,
      website: honeypot.value,
    })

    if (outcome.mfaRequired) {
      mfaToken.value = outcome.mfaToken
      liveMessage.value = 'Enter the six-digit code from your authenticator app.'
      await nextTick()
      mfaField.value?.focus()
      return
    }

    await goHome()
  } catch (err) {
    failure.value = describeAuthError(err)
    liveMessage.value = failure.value.message
    if (failure.value.refreshCaptcha) {
      captchaRef.value?.refresh()
    }
    if (failure.value.field === 'password') passwordField.value?.focus()
    else if (failure.value.field === 'email') emailField.value?.focus()
    else await focusBanner()
  } finally {
    submitting.value = false
  }
}

async function handleMfa() {
  mfaError.value = ''
  const code = mfaCode.value.trim()
  if (!code) {
    mfaError.value = 'Enter the code from your authenticator app.'
    mfaField.value?.focus()
    return
  }
  // Six digits, or one of the longer backup codes. Anything shorter is a
  // typo, and sending it spends one of the five attempts before lockout.
  if (!/^\d{6}$/.test(code) && code.length < 8) {
    mfaError.value = 'That should be a six-digit code, or one of your backup codes.'
    mfaField.value?.focus()
    return
  }

  submitting.value = true
  try {
    await auth.completeMfa(mfaToken.value, code)
    await goHome()
  } catch (err) {
    const described = describeAuthError(err)
    // An expired pending token cannot be retried — the password has to be
    // typed again, so drop back to step one rather than leaving the person
    // entering codes into a token the server has already forgotten.
    if (described.code === 'invalid_or_expired_mfa_token' || !described.retryable) {
      mfaToken.value = ''
      mfaCode.value = ''
      failure.value = described
      liveMessage.value = described.message
      await nextTick()
      passwordField.value?.focus()
    } else {
      mfaError.value = described.message
      liveMessage.value = described.message
      mfaCode.value = ''
      mfaField.value?.focus()
    }
  } finally {
    submitting.value = false
  }
}

function cancelMfa() {
  mfaToken.value = ''
  mfaCode.value = ''
  mfaError.value = ''
  password.value = ''
  captchaRef.value?.refresh()
}

/**
 * Where a signed-in person goes. A citizen who has not proved they live in
 * the district is sent to verify residency first; everyone else goes to the
 * page they were trying to open, or to their role's home.
 */
async function goHome() {
  const u = auth.user
  if (isClientRole(u?.role) && u?.residencyStatus !== 'verified') {
    await router.push('/residency')
    return
  }
  await router.push(redirectTo.value || roleHome(u?.role ?? ''))
}

// ── Demo accounts (development builds only) ────────────────────────────
interface DemoAccount { label: string; email: string; password: string; role: Role }
const demoAccounts: DemoAccount[] = isDev
  ? [
      { label: 'Citizen',    email: 'demo.viewer@vungu.test',    password: 'demo1234', role: 'viewer' },
      { label: 'Planner',    email: 'demo.planner@vungu.test',   password: 'demo1234', role: 'planner' },
      { label: 'E.O.',       email: 'demo.eo@vungu.test',        password: 'demo1234', role: 'eo' },
      { label: 'Env. health', email: 'demo.envoffice@vungu.test', password: 'demo1234', role: 'env_officer' },
      { label: 'Inspector',  email: 'demo.inspector@vungu.test', password: 'demo1234', role: 'building_inspector' },
      { label: 'Clerk',      email: 'demo.clerk@vungu.test',     password: 'demo1234', role: 'planning_clerk' },
      { label: 'Finance',    email: 'demo.finance@vungu.test',   password: 'demo1234', role: 'finance_officer' },
      { label: 'Surveyor',   email: 'demo.surveyor@vungu.test',  password: 'demo1234', role: 'surveyor' },
      { label: 'GIS officer', email: 'demo.gis@vungu.test',      password: 'demo1234', role: 'gis_officer' },
      { label: 'IT admin',   email: 'demo.admin@vungu.test',     password: 'demo1234', role: 'admin' },
    ]
  : []

function fillDemo(account: DemoAccount) {
  email.value = account.email
  password.value = account.password
  errors.value = {}
  failure.value = null
}
</script>

<template>
  <AuthShell
    lede="Sign in to the council's planning record."
    copy="Development applications, building inspections, statutory registers and the district spatial data, in one place."
    :points="[
      'Council officers sign in with the account issued by IT.',
      'Residents and developers use the account they registered with.',
      'Sessions end after the working day on shared workstations.',
    ]"
  >
    <!-- ── Step 1: credentials ──────────────────────────────────────── -->
    <template v-if="step === 'credentials'">
      <div class="auth-head">
        <span class="auth-eyebrow">Vungu RDC Portal</span>
        <h1 class="auth-title">Sign in</h1>
        <p class="auth-sub">Use the email address your account was created with.</p>
      </div>

      <div v-if="arrivalNotice && !failure" class="auth-banner auth-banner-info">
        <Info :size="16" aria-hidden="true" />
        <p>{{ arrivalNotice }}</p>
      </div>

      <div
        v-if="failure"
        ref="banner"
        class="auth-banner auth-banner-error"
        role="alert"
        tabindex="-1"
      >
        <AlertTriangle :size="16" aria-hidden="true" />
        <div>
          <p>{{ failure.message }}</p>
          <p v-if="failure.retryAt">
            You can try again {{ untilPhrase(failure.retryAt) }}.
          </p>
          <p v-if="failure.code === 'locked_out' || failure.code === 'password_reset_required'">
            <router-link to="/forgot-password">Reset your password</router-link> to get back in sooner.
          </p>
        </div>
      </div>

      <form class="auth-form" novalidate @submit.prevent="handleSubmit">
        <AuthField
          ref="emailField"
          v-model="email"
          label="Email address"
          type="email"
          inputmode="email"
          autocomplete="username"
          placeholder="you@example.com"
          :maxlength="255"
          :error="errors.email"
          :disabled="submitting"
          @blur="checkEmail"
        />

        <AuthField
          ref="passwordField"
          v-model="password"
          label="Password"
          type="password"
          autocomplete="current-password"
          :error="errors.password"
          :disabled="submitting"
          @blur="checkPassword"
        >
          <template #label-aside>
            <router-link class="auth-link-quiet" to="/forgot-password">Forgot password?</router-link>
          </template>
        </AuthField>

        <CaptchaField
          ref="captchaRef"
          v-model="captchaToken"
          v-model:website="honeypot"
        />

        <button type="submit" class="auth-btn auth-btn-primary" :disabled="!canSubmit">
          <component
            :is="submitting ? Loader2 : LogIn"
            :size="16"
            :class="submitting ? 'auth-spin' : ''"
            aria-hidden="true"
          />
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="auth-alt">
        No account yet? <router-link to="/register">Create one</router-link>
      </p>

      <div v-if="isDev" class="auth-demo">
        <p class="auth-demo-title">Demo accounts — development build</p>
        <div class="auth-demo-grid">
          <button
            v-for="d in demoAccounts"
            :key="d.email"
            type="button"
            class="auth-demo-pill"
            @click="fillDemo(d)"
          >{{ d.label }}</button>
        </div>
      </div>
    </template>

    <!-- ── Step 2: second factor ────────────────────────────────────── -->
    <template v-else>
      <div class="auth-head">
        <span class="auth-eyebrow">Step 2 of 2</span>
        <h1 class="auth-title">Confirm it is you</h1>
        <p class="auth-sub">
          This account is protected by two-factor authentication. Enter the current
          six-digit code from your authenticator app.
        </p>
      </div>

      <div
        v-if="failure"
        ref="banner"
        class="auth-banner auth-banner-error"
        role="alert"
        tabindex="-1"
      >
        <AlertTriangle :size="16" aria-hidden="true" />
        <p>{{ failure.message }}</p>
      </div>

      <form class="auth-form" novalidate @submit.prevent="handleMfa">
        <AuthField
          ref="mfaField"
          v-model="mfaCode"
          label="Verification code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="000000"
          :maxlength="20"
          :error="mfaError"
          :disabled="submitting"
          hint="Lost your phone? Use one of the backup codes you saved when you set this up."
        />

        <button type="submit" class="auth-btn auth-btn-primary" :disabled="submitting">
          <component
            :is="submitting ? Loader2 : ShieldCheck"
            :size="16"
            :class="submitting ? 'auth-spin' : ''"
            aria-hidden="true"
          />
          {{ submitting ? 'Checking…' : 'Verify and sign in' }}
        </button>

        <button type="button" class="auth-btn auth-btn-secondary" :disabled="submitting" @click="cancelMfa">
          <KeyRound :size="16" aria-hidden="true" />
          Use a different account
        </button>
      </form>
    </template>

    <p class="auth-sr" role="status" aria-live="polite">{{ liveMessage }}</p>
  </AuthShell>
</template>
