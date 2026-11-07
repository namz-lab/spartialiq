<script setup lang="ts">
/**
 * Accept a staff invitation and set the account's first password.
 *
 * This is how every council officer gets in — planners, inspectors, clerks,
 * GIS officers, the EHO, IT. The role, job title and department are fixed by
 * the invite the IT admin issued; nothing on this screen can change them, and
 * the backend reads them from the invite row rather than from this form.
 *
 * TWO FIXES BEYOND THE RESTYLE
 *  - POST /auth/invite/accept sets the session cookies on its response, but
 *    this view never told the store, so a new officer finished the form and
 *    was shown "sign in now" while already signed in — the SPA rendered
 *    anonymous until a full reload. It now hydrates the store and goes
 *    straight to the workspace.
 *  - roleLabel knew three of the nine roles, so six of them displayed as the
 *    raw enum ('building_inspector'). The map is complete and lives beside
 *    the router's role list.
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Link2Off, Loader2, ShieldCheck } from 'lucide-vue-next'
import api from '../services/api'
import { useAuthStore } from '../stores/auth'
import { roleHome } from '../router'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthField from '@/components/auth/AuthField.vue'
import { validateName, validatePassword, validateConfirmation, collectErrors } from '@/auth/validation'
import { describeAuthError, type AuthFailure } from '@/auth/authErrors'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

type LinkState = 'checking' | 'valid' | 'dead'
const linkState = ref<LinkState>('checking')
const deadReason = ref('')

const invite = reactive({ email: '', role: '', jobTitle: '', department: '', token: '' })
const form = reactive({ name: '', password: '', confirmPassword: '' })

const errors = ref<{ name?: string; password?: string; confirmPassword?: string }>({})
const failure = ref<AuthFailure | null>(null)
const submitting = ref(false)
const liveMessage = ref('')

const nameField = ref<{ focus: () => void } | null>(null)
const passwordField = ref<{ focus: () => void } | null>(null)
const confirmField = ref<{ focus: () => void } | null>(null)
const banner = ref<HTMLElement | null>(null)

/** Every role the invite endpoint will issue (INVITABLE_ROLES in auth.js). */
const ROLE_LABELS: Record<string, string> = {
  admin: 'IT Administrator',
  planner: 'Planner',
  eo: 'Executive Officer — Planning',
  env_officer: 'Environmental Health Officer',
  building_inspector: 'Building Inspector',
  planning_clerk: 'Planning Clerk',
  surveyor: 'Surveyor',
  gis_officer: 'GIS Officer',
  viewer: 'Viewer',
}
const roleLabel = computed(() => ROLE_LABELS[invite.role] ?? invite.role)

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!token) {
    linkState.value = 'dead'
    deadReason.value = 'That invitation link is missing its code. Open the link from the email exactly as it was sent.'
    return
  }
  try {
    const res = await api.get('/auth/invite/validate', { params: { token } })
    const d = res.data?.data
    if (!res.data?.valid || !d) throw new Error('invalid')
    Object.assign(invite, {
      email: d.email, role: d.role, jobTitle: d.jobTitle || '', department: d.department || '', token,
    })
    linkState.value = 'valid'
    await nextTick()
    nameField.value?.focus()
  } catch (err) {
    const code = (err as { response?: { data?: { error?: string } } }).response?.data?.error
    linkState.value = 'dead'
    deadReason.value =
      code === 'used'
        ? 'This invitation has already been used. If that was not you, tell council IT straight away.'
        : code === 'expired'
          ? 'This invitation expired. Invitations last seven days — ask council IT for a new one.'
          : 'This invitation link is not valid. Ask council IT to send a new one.'
  }
})

function checks() {
  return {
    name: validateName(form.name),
    password: validatePassword(form.password, { avoid: [invite.email, form.name] }),
    confirmPassword: validateConfirmation(form.password, form.confirmPassword),
  }
}

function revalidate(key: 'name' | 'password' | 'confirmPassword') {
  const r = checks()[key]
  errors.value = { ...errors.value, [key]: r.ok ? undefined : r.message }
}

async function handleSubmit() {
  failure.value = null
  const { errors: found, valid, firstInvalid } = collectErrors(checks())
  errors.value = found
  if (!valid) {
    liveMessage.value = found[firstInvalid as 'name'] ?? 'Check the fields below.'
    await nextTick()
    const target = firstInvalid === 'name' ? nameField : firstInvalid === 'password' ? passwordField : confirmField
    target.value?.focus()
    return
  }

  submitting.value = true
  try {
    await api.post('/auth/invite/accept', {
      token: invite.token,
      name: form.name.trim(),
      password: form.password,
    })
    // The response already set vungu_at / vungu_rt. Hydrate the store from
    // /auth/me so the app knows it, then go to the workspace this officer
    // was hired into rather than back to a sign-in form.
    const user = await auth.fetchProfile()
    liveMessage.value = 'Account activated.'
    await router.replace(roleHome(user?.role ?? invite.role))
  } catch (err) {
    failure.value = describeAuthError(err)
    liveMessage.value = failure.value.message
    // A consumed or expired invite cannot be retried from this form.
    if (failure.value.code === 'invite_invalid' || failure.value.code === 'email_taken') {
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
    lede="Welcome to the council's planning portal."
    copy="Your account has already been created by council IT. Set a password and it is ready to use."
    :points="[
      'Your role and department were set by the invitation.',
      'Council IT never sees the password you choose here.',
      'The invitation works once, and lasts seven days.',
    ]"
  >
    <div v-if="linkState === 'checking'" class="auth-state">
      <span class="auth-state-icon" aria-hidden="true"><Loader2 :size="22" class="auth-spin" /></span>
      <h1 class="auth-title">Checking your invitation…</h1>
    </div>

    <div v-else-if="linkState === 'dead'" class="auth-state">
      <span class="auth-state-icon is-bad" aria-hidden="true"><Link2Off :size="22" /></span>
      <div class="auth-head" style="text-align: center; align-items: center">
        <h1 class="auth-title">This invitation cannot be used</h1>
        <p class="auth-sub">{{ deadReason }}</p>
      </div>
      <a href="mailto:support@vungurdc.gov.zw?subject=New%20portal%20invitation" class="auth-btn auth-btn-secondary">
        Email council IT
      </a>
      <p class="auth-alt"><router-link to="/login">Back to sign in</router-link></p>
    </div>

    <template v-else>
      <div class="auth-head">
        <span class="auth-eyebrow">Staff invitation</span>
        <h1 class="auth-title">Activate your account</h1>
        <p class="auth-sub">
          Council IT has created this account for you. Confirm your name and choose
          a password to finish.
        </p>
      </div>

      <dl class="auth-facts">
        <dt>Email</dt>
        <dd>{{ invite.email }}</dd>
        <dt>Role</dt>
        <dd>{{ roleLabel }}</dd>
        <template v-if="invite.jobTitle">
          <dt>Job title</dt>
          <dd>{{ invite.jobTitle }}</dd>
        </template>
        <template v-if="invite.department">
          <dt>Department</dt>
          <dd>{{ invite.department }}</dd>
        </template>
      </dl>

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
          ref="nameField"
          v-model="form.name"
          label="Full name"
          autocomplete="name"
          placeholder="As it should appear on council documents"
          :maxlength="120"
          :error="errors.name"
          :disabled="submitting"
          hint="This name signs the notices and decisions you issue."
          @blur="revalidate('name')"
        />

        <!-- Fixed by the invitation. Present so a password manager saves the
             new password against the right account. -->
        <AuthField
          :model-value="invite.email"
          label="Email address"
          type="email"
          autocomplete="username"
          disabled
          :required="false"
        />

        <AuthField
          ref="passwordField"
          v-model="form.password"
          label="Choose a password"
          type="password"
          autocomplete="new-password"
          :maxlength="72"
          :error="errors.password"
          :disabled="submitting"
          hint="At least 8 characters. Do not reuse a password from another service."
          @blur="revalidate('password')"
        />

        <AuthField
          ref="confirmField"
          v-model="form.confirmPassword"
          label="Confirm password"
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
          {{ submitting ? 'Activating…' : 'Activate my account' }}
        </button>
      </form>
    </template>

    <p class="auth-sr" role="status" aria-live="polite">{{ liveMessage }}</p>
  </AuthShell>
</template>
