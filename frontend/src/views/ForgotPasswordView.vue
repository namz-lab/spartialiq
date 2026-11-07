<script setup lang="ts">
/**
 * Ask for a password reset link.
 *
 * WHY THIS PAGE EXISTS
 * There was no way to recover an account. The sign-in screen's "Forgot?" link
 * was a mailto: to the council support address, and the only real reset in
 * the system was an IT admin typing a new password for someone and telling
 * them what it was — by phone, in the clear, to a desk that then knew it.
 * With the sign-in lockout live, a locked-out officer had no route back at
 * all. See migration 126 and POST /api/auth/forgot-password.
 *
 * THE ONE RULE ON THIS SCREEN
 * It must not reveal whether an address has an account. The server answers
 * identically either way; this screen shows that same answer and never
 * "no such user", however helpful that would feel.
 */
import { nextTick, ref } from 'vue'
import { AlertTriangle, ArrowLeft, Loader2, Mail, MailCheck } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import CaptchaField from '@/components/CaptchaField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthField from '@/components/auth/AuthField.vue'
import { validateEmail } from '@/auth/validation'
import { describeAuthError, type AuthFailure } from '@/auth/authErrors'

const auth = useAuthStore()

const email = ref('')
const emailError = ref('')
const captchaToken = ref('')
const honeypot = ref('')
const captchaRef = ref<{ ensure: () => Promise<string>; refresh: () => void } | null>(null)

const submitting = ref(false)
const sent = ref(false)
const failure = ref<AuthFailure | null>(null)
const liveMessage = ref('')

const emailField = ref<{ focus: () => void } | null>(null)
const banner = ref<HTMLElement | null>(null)

function checkEmail() {
  const r = validateEmail(email.value)
  emailError.value = r.ok ? '' : (r.message ?? '')
}

async function handleSubmit() {
  failure.value = null
  checkEmail()
  if (emailError.value) {
    liveMessage.value = emailError.value
    emailField.value?.focus()
    return
  }

  submitting.value = true
  try {
    await auth.requestPasswordReset(email.value.trim(), {
      token: (await captchaRef.value?.ensure()) ?? captchaToken.value,
      website: honeypot.value,
    })
    // Deliberately unconditional. The server returns the same body for an
    // address it knows and one it does not, and the screen keeps that promise.
    sent.value = true
    liveMessage.value = 'If that address has an account, a reset link has been sent.'
  } catch (err) {
    failure.value = describeAuthError(err)
    liveMessage.value = failure.value.message
    if (failure.value.refreshCaptcha) {
      captchaRef.value?.refresh()
    }
    await nextTick()
    banner.value?.focus()
  } finally {
    submitting.value = false
  }
}

function tryAgain() {
  sent.value = false
  failure.value = null
  captchaRef.value?.refresh()
  void nextTick(() => emailField.value?.focus())
}
</script>

<template>
  <AuthShell
    lede="Locked out? Get back in."
    copy="A reset link goes to the email address on the account. It works once and stops working after an hour."
    :points="[
      'Completing a reset also clears a sign-in lockout.',
      'Every other device signed in to the account is signed out.',
      'Council IT never needs to know your password.',
    ]"
  >
    <template v-if="!sent">
      <div class="auth-head">
        <span class="auth-eyebrow">Account recovery</span>
        <h1 class="auth-title">Reset your password</h1>
        <p class="auth-sub">
          Enter the email address on your account and the council will send you a
          link to choose a new password.
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
        <AuthField
          ref="emailField"
          v-model="email"
          label="Email address"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="you@example.com"
          :maxlength="255"
          :error="emailError"
          :disabled="submitting"
          @blur="checkEmail"
        />

        <CaptchaField
          ref="captchaRef"
          v-model="captchaToken"
          v-model:website="honeypot"
        />

        <button type="submit" class="auth-btn auth-btn-primary" :disabled="submitting">
          <component
            :is="submitting ? Loader2 : Mail"
            :size="16"
            :class="submitting ? 'auth-spin' : ''"
            aria-hidden="true"
          />
          {{ submitting ? 'Sending…' : 'Send reset link' }}
        </button>
      </form>

      <p class="auth-alt">
        <router-link to="/login">Back to sign in</router-link>
      </p>
    </template>

    <!-- Sent. Says nothing about whether the address exists. -->
    <template v-else>
      <div class="auth-state">
        <span class="auth-state-icon is-good" aria-hidden="true"><MailCheck :size="22" /></span>
        <div class="auth-head" style="text-align: center; align-items: center">
          <h1 class="auth-title">Check your email</h1>
          <p class="auth-sub">
            If <strong>{{ email.trim() }}</strong> has an account with the council, a
            reset link is on its way. It works once and expires in an hour.
          </p>
        </div>

        <div class="auth-banner auth-banner-info" style="text-align: left">
          <div>
            <p><strong>Nothing arrived?</strong></p>
            <p>
              Look in your spam folder, and check the address above for a typo.
              If the account was created with a different address, try that one.
            </p>
          </div>
        </div>

        <button type="button" class="auth-btn auth-btn-secondary" @click="tryAgain">
          <ArrowLeft :size="16" aria-hidden="true" />
          Use a different address
        </button>

        <p class="auth-alt">
          <router-link to="/login">Back to sign in</router-link>
        </p>
      </div>
    </template>

    <p class="auth-sr" role="status" aria-live="polite">{{ liveMessage }}</p>
  </AuthShell>
</template>
