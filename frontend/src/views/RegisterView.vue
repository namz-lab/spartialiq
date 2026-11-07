<script setup lang="ts">
/**
 * Create an account.
 *
 * Customer self-registration only. Internal roles (admin, planner, surveyor,
 * gis_officer, env_officer, building_inspector, planning_clerk, eo) are
 * issued through the IT Admin invite flow and must never be selectable here —
 * an earlier version offered "Administrator" in this dropdown, which was a
 * role-escalation surface. The form collects an *applicant type*, which is
 * useful to the council for routing and statistics, and maps it to one of two
 * safe roles before posting. The backend ignores a client-supplied role
 * regardless; the mapping is belt and braces.
 *
 * WHAT CHANGED
 * Every field is checked here before it is posted, against the same rules the
 * server applies, and the errors are reported per field with a summary that
 * links to them (the GOV.UK pattern) rather than as one grey line at the
 * bottom. On a rural connection that is the difference between one round trip
 * and five, and it is the only way a nine-field form is usable with a screen
 * reader.
 */
import { computed, nextTick, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, Loader2, UserPlus } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import { roleHome } from '../router'
import { isClientRole } from '../services/types'
import CaptchaField from '@/components/CaptchaField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthField from '@/components/auth/AuthField.vue'
import {
  validateEmail, validateName, validatePassword, validateConfirmation,
  validatePhone, validateNationalId, validateRequired,
  passwordStrength, normalisePhone, normaliseNationalId, collectErrors, joinName,
} from '@/auth/validation'
import { describeAuthError, type AuthFailure } from '@/auth/authErrors'

const router = useRouter()
const auth = useAuthStore()

type ApplicantType = 'resident' | 'landowner' | 'business' | 'consultant' | 'visitor'

/** The only roles this screen is allowed to ask for. */
const APPLICANT_TYPE_TO_ROLE: Record<ApplicantType, 'registered' | 'public'> = {
  resident: 'registered',
  landowner: 'registered',
  business: 'registered',
  consultant: 'registered',
  visitor: 'public',
}

const form = reactive({
  // Captured as two fields and sent as one. The council's register, the
  // permit and the served notice all carry a single `name`, but a citizen
  // filling this in on a phone is answering the question their ID asks —
  // first name, then surname — not composing a display string.
  firstName: '',
  surname: '',
  email: '',
  phone: '',
  nationalId: '',
  organization: '',
  applicantType: '' as ApplicantType | '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
})

const captchaToken = ref('')
const honeypot = ref('')
const captchaRef = ref<{ ensure: () => Promise<string>; refresh: () => void } | null>(null)

type FieldKey =
  | 'firstName' | 'surname' | 'email' | 'phone' | 'nationalId' | 'organization'
  | 'applicantType' | 'password' | 'confirmPassword' | 'acceptTerms'

const errors = ref<Partial<Record<FieldKey, string>>>({})
const failure = ref<AuthFailure | null>(null)
const submitting = ref(false)
const done = ref(false)
const liveMessage = ref('')

const fieldRefs: Partial<Record<FieldKey, { focus: () => void } | null>> = {}
const setRef = (key: FieldKey) => (el: unknown) => {
  fieldRefs[key] = el as { focus: () => void } | null
}
const summary = ref<HTMLElement | null>(null)
const termsBox = ref<HTMLInputElement | null>(null)

// An organisation is the applicant of record for a business or consultant
// account — the permit is issued to the company, not to the person filing.
const orgRequired = computed(() =>
  form.applicantType === 'business' || form.applicantType === 'consultant',
)

const strength = computed(() => passwordStrength(form.password))

/** What the server is sent as `name`, and what the register will hold. */
const fullName = computed(() => joinName(form.firstName, form.surname))

/**
 * The surname carries the joined-length rule as well as its own: each field
 * allows 60, so 60 + 60 + the space is 121 — one past what the endpoint
 * accepts. Checked here so it surfaces on a field the person can see, rather
 * than coming back as a 400 that names nothing.
 */
function checkSurname() {
  const own = validateName(form.surname, { what: 'surname', max: 60 })
  if (!own.ok) return own
  if (fullName.value.length > 120) {
    return { ok: false as const, message: 'Together your names are too long for the register.' }
  }
  return own
}

/** Every rule this form enforces, in the order the fields appear. */
function checks() {
  return {
    firstName: validateName(form.firstName, { what: 'first name', max: 60 }),
    surname: checkSurname(),
    email: validateEmail(form.email),
    phone: validatePhone(form.phone, { required: true }),
    nationalId: validateNationalId(form.nationalId),
    applicantType: validateRequired(form.applicantType, 'Choose the option that describes you.'),
    organization: orgRequired.value
      ? validateRequired(form.organization, 'Enter the name of the business or practice.')
      : { ok: true as const },
    // Both parts, not the joined string: `validatePassword` splits an email's
    // local part into words but takes a name as given, and a password that is
    // just the surname is as guessable as one that is the whole name.
    password: validatePassword(form.password, {
      avoid: [form.email, form.firstName, form.surname],
    }),
    confirmPassword: validateConfirmation(form.password, form.confirmPassword),
    acceptTerms: form.acceptTerms
      ? { ok: true as const }
      : { ok: false as const, message: 'You need to accept the terms and privacy notice to continue.' },
  }
}

/** Re-check one field on blur, but never raise an error on a field the
 *  person has not finished with — only clear or update one already shown. */
function revalidate(key: FieldKey) {
  const result = checks()[key]
  errors.value = { ...errors.value, [key]: result.ok ? undefined : result.message }
}

const errorList = computed(() =>
  (Object.entries(errors.value) as [FieldKey, string | undefined][])
    .filter((entry): entry is [FieldKey, string] => Boolean(entry[1])),
)

/** Which field the summary's first entry belongs to, for the live message. */
const firstProblem = ref<FieldKey | null>(null)

/** The terms checkbox is the one control that is not an AuthField. */
function focusField(key: FieldKey) {
  if (key === 'acceptTerms') termsBox.value?.focus()
  else fieldRefs[key]?.focus()
}

async function handleSubmit() {
  failure.value = null
  const { errors: found, valid, firstInvalid } = collectErrors(checks())
  errors.value = found

  if (!valid) {
    liveMessage.value = `${errorList.value.length} ${errorList.value.length === 1 ? 'problem' : 'problems'} with the form.`
    // Focus the summary, not the first bad field: the person needs to see how
    // many problems there are before being dropped into one of them. Each
    // entry then jumps to its own field (the GOV.UK error-summary pattern).
    firstProblem.value = firstInvalid
    await nextTick()
    summary.value?.focus()
    return
  }

  submitting.value = true
  try {
    await auth.register({
      name: fullName.value,
      email: form.email.trim(),
      password: form.password,
      // Normalised on the way out so the council's register holds one shape
      // of phone number and one shape of ID, whatever was typed.
      phone: normalisePhone(form.phone),
      organization: form.organization.trim() || undefined,
      nationalId: form.nationalId ? normaliseNationalId(form.nationalId) : undefined,
      applicantType: form.applicantType,
      role: APPLICANT_TYPE_TO_ROLE[form.applicantType as ApplicantType],
      captchaToken: (await captchaRef.value?.ensure()) ?? captchaToken.value,
      website: honeypot.value,
    })

    done.value = true
    liveMessage.value = 'Account created.'
    // Register signs the account in, so send it where sign-in would have:
    // a citizen who has not proved district residency verifies that first.
    const u = auth.user
    const target = isClientRole(u?.role) && u?.residencyStatus !== 'verified'
      ? '/residency'
      : roleHome(u?.role ?? '')
    setTimeout(() => { void router.push(target) }, 900)
  } catch (err) {
    failure.value = describeAuthError(err)
    liveMessage.value = failure.value.message
    if (failure.value.refreshCaptcha) {
      captchaRef.value?.refresh()
    }
    await nextTick()
    if (failure.value.field === 'email') fieldRefs.email?.focus()
    else summary.value?.focus()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthShell
    wide
    lede="One account for every council service."
    copy="Register once and the council has your details for every development application, inspection and payment that follows."
    :points="[
      'Lodge a development application and follow its progress.',
      'Receive notices, receipts and decisions by email.',
      'Council staff accounts are issued by IT, not created here.',
    ]"
  >
    <div class="auth-head">
      <span class="auth-eyebrow">Vungu RDC Portal</span>
      <h1 class="auth-title">Create an account</h1>
      <p class="auth-sub">
        The details below appear on every application you lodge, so enter them as
        they appear on your identity document.
      </p>
    </div>

    <div v-if="done" class="auth-banner auth-banner-success" role="status">
      <p>Account created. Taking you to your portal…</p>
    </div>

    <!-- Error summary: the one thing focus moves to on a failed submit, with
         a link per problem. A nine-field form needs it; a two-field one does not. -->
    <div
      v-if="errorList.length || failure"
      ref="summary"
      class="auth-banner auth-banner-error"
      role="alert"
      tabindex="-1"
    >
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <p v-if="failure"><strong>{{ failure.message }}</strong></p>
        <template v-if="errorList.length">
          <p><strong>Check these before continuing:</strong></p>
          <ul class="auth-summary-list">
            <li v-for="[key, message] in errorList" :key="key">
              <button type="button" @click="focusField(key)">{{ message }}</button>
            </li>
          </ul>
        </template>
        <p v-if="failure?.code === 'email_taken'">
          <router-link to="/login">Sign in</router-link> or
          <router-link to="/forgot-password">reset your password</router-link>.
        </p>
      </div>
    </div>

    <form v-if="!done" class="auth-form" novalidate @submit.prevent="handleSubmit">
      <div class="auth-row">
        <AuthField
          :ref="setRef('firstName')"
          v-model="form.firstName"
          label="First name"
          autocomplete="given-name"
          placeholder="Chipo"
          :maxlength="60"
          :error="errors.firstName"
          :disabled="submitting"
          @blur="revalidate('firstName')"
        />
        <AuthField
          :ref="setRef('surname')"
          v-model="form.surname"
          label="Surname"
          autocomplete="family-name"
          placeholder="Moyo"
          :maxlength="60"
          :error="errors.surname"
          :disabled="submitting"
          @blur="revalidate('surname')"
        />
      </div>
      <p class="auth-hint" style="margin-top: -8px">
        Enter both as they appear on your identity document — they are printed on
        every permit and notice the council issues to you.
      </p>

      <div class="auth-row">
        <AuthField
          :ref="setRef('email')"
          v-model="form.email"
          label="Email address"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="you@example.com"
          :maxlength="255"
          :error="errors.email"
          :disabled="submitting"
          @blur="revalidate('email')"
        />
        <AuthField
          :ref="setRef('phone')"
          v-model="form.phone"
          label="Phone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          placeholder="077 123 4567"
          :maxlength="24"
          :error="errors.phone"
          :disabled="submitting"
          hint="The council calls this number about site visits."
          @blur="revalidate('phone')"
        />
      </div>

      <AuthField
        :ref="setRef('applicantType')"
        v-model="form.applicantType"
        as="select"
        label="Which describes you?"
        :error="errors.applicantType"
        :disabled="submitting"
        hint="Council staff accounts — planners, inspectors, clerks, GIS officers — are issued by invitation only."
        @blur="revalidate('applicantType')"
      >
        <option value="" disabled>Choose one</option>
        <option value="resident">Resident of the district</option>
        <option value="landowner">Landowner</option>
        <option value="business">Business or developer</option>
        <option value="consultant">Surveyor or planning consultant</option>
        <option value="visitor">Visitor — read-only access</option>
      </AuthField>

      <AuthField
        :ref="setRef('organization')"
        v-model="form.organization"
        label="Organisation"
        autocomplete="organization"
        :optional="!orgRequired"
        :required="orgRequired"
        placeholder="e.g. Mukoma Holdings (Pvt) Ltd"
        :maxlength="200"
        :error="errors.organization"
        :disabled="submitting"
        :hint="orgRequired ? 'A permit is issued to the organisation, so it has to be named.' : undefined"
        @blur="revalidate('organization')"
      />

      <AuthField
        :ref="setRef('nationalId')"
        v-model="form.nationalId"
        label="National ID"
        optional
        :required="false"
        placeholder="63-123456 K 42"
        :maxlength="24"
        :error="errors.nationalId"
        :disabled="submitting"
        hint="Enter it once and every application is pre-filled. You can add it later instead."
        @blur="revalidate('nationalId')"
      />

      <div class="auth-section">
        <p class="auth-section-title">Choose a password</p>

        <AuthField
          :ref="setRef('password')"
          v-model="form.password"
          label="Password"
          type="password"
          autocomplete="new-password"
          :maxlength="72"
          :error="errors.password"
          :disabled="submitting"
          hint="At least 8 characters. A short phrase you will remember beats a short password you will not."
          @blur="revalidate('password')"
        />

        <!-- Hidden while the password is rejected. The meter scores shape
             only, so a password refused for being the account's own name
             still scored "Excellent" — an approving green bar directly above
             a red error, which reads as the form contradicting itself. -->
        <template v-if="form.password && !errors.password">
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
          :ref="setRef('confirmPassword')"
          v-model="form.confirmPassword"
          label="Confirm password"
          type="password"
          autocomplete="new-password"
          :maxlength="72"
          :error="errors.confirmPassword"
          :disabled="submitting"
          @blur="revalidate('confirmPassword')"
        />
      </div>

      <CaptchaField
        ref="captchaRef"
        v-model="captchaToken"
        v-model:website="honeypot"
      />

      <div>
        <label class="auth-check">
          <input
            ref="termsBox"
            v-model="form.acceptTerms"
            type="checkbox"
            :disabled="submitting"
            :aria-invalid="errors.acceptTerms ? 'true' : undefined"
            @change="revalidate('acceptTerms')"
          />
          <span>
            I accept the <router-link to="/terms">terms of use</router-link> and have read the
            <router-link to="/privacy">privacy notice</router-link>, including how the council
            handles my identity details.
          </span>
        </label>
        <p v-if="errors.acceptTerms" class="auth-field-error" style="margin-top: 6px">
          <AlertTriangle :size="13" aria-hidden="true" />
          <span>{{ errors.acceptTerms }}</span>
        </p>
      </div>

      <button type="submit" class="auth-btn auth-btn-primary" :disabled="submitting">
        <component
          :is="submitting ? Loader2 : UserPlus"
          :size="16"
          :class="submitting ? 'auth-spin' : ''"
          aria-hidden="true"
        />
        {{ submitting ? 'Creating account…' : 'Create account' }}
      </button>
    </form>

    <p class="auth-alt">
      Already registered? <router-link to="/login">Sign in</router-link>
    </p>

    <p class="auth-sr" role="status" aria-live="polite">{{ liveMessage }}</p>
  </AuthShell>
</template>
