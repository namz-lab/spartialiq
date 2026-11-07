<script setup lang="ts">
/**
 * Choose a new password from a reset link.
 *
 * The link is validated before the form renders, so someone on an expired or
 * already-spent link is told so rather than typing a password twice into a
 * page that cannot save it. The council's own minimum length comes back with
 * that check (admin_setting security.password_min_length) — the rule shown
 * here is the rule the server will apply, not a guess at it.
 *
 * Completing this does NOT sign the visitor in: the backend issues no cookie,
 * every existing session on the account is revoked, and the new password is
 * typed once on the sign-in screen. That proves it was remembered, and keeps
 * MFA in the loop for the staff accounts that have it.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Loader2, KeyRound, Link2Off, ShieldCheck } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthField from '@/components/auth/AuthField.vue'
import { validatePassword, validateConfirmation, passwordStrength, collectErrors } from '@/auth/validation'
import { describeAuthError, type AuthFailure } from '@/auth/authErrors'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

type LinkState = 'checking' | 'valid' | 'dead'
const linkState = ref<LinkState>('checking')
const deadReason = ref('')
const accountHint = ref('')
const minLength = ref(8)

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const password = ref('')
const confirmPassword = ref('')
const errors = ref<{ password?: string; confirmPassword?: string }>({})
const failure = ref<AuthFailure | null>(null)
const submitting = ref(false)
const liveMessage = ref('')

const passwordField = ref<{ focus: () => void } | null>(null)
const confirmField = ref<{ focus: () => void } | null>(null)
const banner = ref<HTMLElement | null>(null)

const strength = computed(() => passwordStrength(password.value))

onMounted(async () => {
  if (!token.value) {
    linkState.value = 'dead'
    deadReason.value = 'That link is missing its reset code. Open the link from the email exactly as it was sent.'
    return
  }
  try {
    const data = await auth.validateResetToken(token.value)
    accountHint.value = data.email ?? ''
    if (data.passwordMinLength) minLength.value = Number(data.passwordMinLength)
    linkState.value = 'valid'
    await nextTick()
    passwordField.value?.focus()
  } catch (err) {
    const described = describeAuthError(err)
    linkState.value = 'dead'
    deadReason.value =
      described.code === 'account_suspended'
        ? 'This account has been suspended, so its password cannot be changed. Contact council IT.'
        : 'This reset link has expired or has already been used. Reset links work once and last an hour.'
  }
})

function checks() {
  return {
    password: validatePassword(password.value, { minLength: minLength.value }),
    confirmPassword: validateConfirmation(password.value, confirmPassword.value),
  }
}

function revalidate(key: 'password' | 'confirmPassword') {
  const r = checks()[key]
  errors.value = { ...errors.value, [key]: r.ok ? undefined : r.message }
}

async function handleSubmit() {
  failure.value = null
  const { errors: found, valid, firstInvalid } = collectErrors(checks())
  errors.value = found
  if (!valid) {
    liveMessage.value = found[firstInvalid as 'password'] ?? 'Check the fields below.'
    await nextTick()
    ;(firstInvalid === 'password' ? passwordField : confirmField).value?.focus()
    return
  }

  submitting.value = true
  try {
    await auth.resetPassword(token.value, password.value)
    liveMessage.value = 'Password changed.'
    // Straight to sign-in with the reason stated, so the screen that opens
    // explains itself instead of looking like a session that dropped.
    await router.replace({ path: '/login', query: { reason: 'reset' } })
  } catch (err) {
    failure.value = describeAuthError(err)
    liveMessage.value = failure.value.message
    // A spent or expired token cannot be retried from this form at all.
    if (!failure.value.retryable && failure.value.code !== 'password_too_short') {
      linkState.value = 'dead'
      deadReason.value = failure.value.message
      return
    }
    await nextTick()
    banner.value?.focus()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthShell
    lede="Choose a new password."
    copy="Setting a new password signs out every other device on this account and lifts any sign-in lockout."
    :points="[
      'Length matters more than symbols — a short phrase is a strong password.',
      'Do not reuse a password from another service.',
      'Council IT cannot see your password, before or after.',
    ]"
  >
    <!-- Checking the link -->
    <div v-if="linkState === 'checking'" class="auth-state">
      <span class="auth-state-icon" aria-hidden="true"><Loader2 :size="22" class="auth-spin" /></span>
      <h1 class="auth-title">Checking your link…</h1>
    </div>

    <!-- Link no longer usable -->
    <div v-else-if="linkState === 'dead'" class="auth-state">
      <span class="auth-state-icon is-bad" aria-hidden="true"><Link2Off :size="22" /></span>
      <div class="auth-head" style="text-align: center; align-items: center">
        <h1 class="auth-title">This link no longer works</h1>
        <p class="auth-sub">{{ deadReason }}</p>
      </div>
      <router-link to="/forgot-password" class="auth-btn auth-btn-primary">
        <KeyRound :size="16" aria-hidden="true" />
        Request a new link
      </router-link>
      <p class="auth-alt"><router-link to="/login">Back to sign in</router-link></p>
    </div>

    <!-- The form -->
    <template v-else>
      <div class="auth-head">
        <span class="auth-eyebrow">Account recovery</span>
        <h1 class="auth-title">Set a new password</h1>
        <p class="auth-sub">
          This link belongs to the account
          <strong v-if="accountHint">{{ accountHint }}</strong>
          <span v-else>you asked to reset</span>. Choose a password you have not
          used anywhere else.
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

      <form class="auth-form" novalidate @submit.prevent="handleSubmit">
        <!-- The account this belongs to, for the password manager's benefit:
             without a username field, browsers save the new password against
             no account and never offer it again. Hidden, not absent. -->
        <input
          type="text"
          autocomplete="username"
          :value="accountHint"
          class="auth-sr"
          tabindex="-1"
          aria-hidden="true"
          readonly
        />

        <AuthField
          ref="passwordField"
          v-model="password"
          label="New password"
          type="password"
          autocomplete="new-password"
          :maxlength="72"
          :error="errors.password"
          :disabled="submitting"
          :hint="`At least ${minLength} characters. A phrase you will remember beats a short password you will not.`"
          @blur="revalidate('password')"
        />

        <!-- Hidden while the password is rejected: the meter scores shape
             only, and an approving green bar above a red error reads as the
             form contradicting itself. -->
        <template v-if="password && !errors.password">
          <div class="auth-strength">
            <div class="auth-strength-bars" aria-hidden="true">
              <span
                v-for="i in 4"
                :key="i"
                class="auth-strength-bar"
                :class="i <= strength.score ? `on-${strength.score}` : ''"
              />
            </div>
            <span class="auth-strength-label">{{ strength.label }}</span>
          </div>
          <p v-if="strength.hint" class="auth-hint">{{ strength.hint }}</p>
        </template>

        <AuthField
          ref="confirmField"
          v-model="confirmPassword"
          label="Confirm new password"
          type="password"
          autocomplete="new-password"
          :maxlength="72"
          :error="errors.confirmPassword"
          :disabled="submitting"
          @blur="revalidate('confirmPassword')"
        />

        <button type="submit" class="auth-btn auth-btn-primary" :disabled="submitting">
          <component
            :is="submitting ? Loader2 : ShieldCheck"
            :size="16"
            :class="submitting ? 'auth-spin' : ''"
            aria-hidden="true"
          />
          {{ submitting ? 'Saving…' : 'Save new password' }}
        </button>
      </form>

      <p class="auth-alt"><router-link to="/login">Back to sign in</router-link></p>
    </template>

    <p class="auth-sr" role="status" aria-live="polite">{{ liveMessage }}</p>
  </AuthShell>
</template>
