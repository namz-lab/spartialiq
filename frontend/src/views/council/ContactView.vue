<script setup lang="ts">
/**
 * Contact the council.
 *
 * There is no contact endpoint on the backend, so this composes a `mailto:`
 * exactly as the old static site did. That is a deliberate limit, not an
 * oversight: a form that posts into a queue nobody has agreed to read is
 * worse than one that hands the message to the resident's own mail client,
 * where they keep a copy and can see it was sent.
 *
 * What it does add is validation and an honest hand-off. The previous
 * version put the mailto on an `<a>` whose `href` was `undefined` until a
 * message was typed — an anchor with no href is not focusable and not
 * announced as a control, so a keyboard or screen-reader user met a dead
 * element with no explanation. It is now a real form with a real submit
 * button, and the field rules are the ones the sign-up screens already use
 * (src/auth/validation.ts) rather than a second, looser copy.
 */
import { ref, computed } from 'vue'
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import { MapPin, Phone, Mail, Clock, AlertCircle, Send, Info } from 'lucide-vue-next'
import { COUNCIL_CONTACT } from '@/content/siteContent'
import { validateEmail, validateName, collectErrors } from '@/auth/validation'

const name = ref('')
const email = ref('')
const subject = ref('')
const message = ref('')

/** Errors appear on submit, or on blur once a field has been touched. */
const touched = ref<Record<string, boolean>>({})
const submitted = ref(false)
const handedOff = ref(false)

const MAX_MESSAGE = 2000

function checkMessage() {
  const v = message.value.trim()
  if (!v) return { ok: false, message: 'Write your message.' }
  if (v.length < 10) return { ok: false, message: 'Add a little more detail so the council can act on it.' }
  if (v.length > MAX_MESSAGE) return { ok: false, message: `Keep it under ${MAX_MESSAGE} characters.` }
  return { ok: true }
}

const checks = computed(() => ({
  name: validateName(name.value),
  email: validateEmail(email.value),
  message: checkMessage(),
}))

const result = computed(() => collectErrors(checks.value))

/** A field's error is withheld until the person has had a chance at it. */
function errorFor(field: 'name' | 'email' | 'message'): string | undefined {
  if (!submitted.value && !touched.value[field]) return undefined
  return result.value.errors[field]
}

const remaining = computed(() => MAX_MESSAGE - message.value.trim().length)

const mailtoHref = computed(() => {
  const line = subject.value.trim() || 'Website enquiry'
  const subjectPart = encodeURIComponent(`${line} — from ${name.value.trim() || 'a resident'}`)
  const body = encodeURIComponent(
    `${message.value.trim()}\n\n—\n${name.value.trim()}\n${email.value.trim()}`,
  )
  return `mailto:${COUNCIL_CONTACT.email}?subject=${subjectPart}&body=${body}`
})

function onSubmit() {
  submitted.value = true
  if (!result.value.valid) {
    // Move focus to the field that actually needs attention rather than
    // scrolling the person back to the top of the form.
    const first = result.value.firstInvalid
    if (first) document.getElementById(`contact-${first}`)?.focus()
    return
  }
  // Hand the composed message to the mail client. `location.href` rather
  // than window.open: a popup blocker eats the second, and a mailto that
  // silently does nothing is indistinguishable from a broken form.
  window.location.href = mailtoHref.value
  handedOff.value = true
}
</script>

<template>
  <div class="home-view">
    <SiteHeader />

    <main id="main" class="main-stage">
      <section class="page-hero">
        <div class="page-hero-inner">
          <p class="ds-eyebrow" v-reveal>Contact</p>
          <h1 class="ds-heading" v-reveal.up="60">Get in touch with the council</h1>
          <p class="ds-subtext" v-reveal.up="120">
            Write to us using the form below, or reach the council offices
            directly on the details alongside. For a development application,
            a building plan or a payment, use the online services — those are
            tracked, and an email is not.
          </p>
        </div>
      </section>

      <section class="section section--services">
        <div class="section-inner contact-layout">
          <!-- Details -->
          <div class="contact-details" v-reveal.up>
            <h2 class="council-block-title">Council offices</h2>
            <ul class="contact-list">
              <li>
                <span class="contact-ico" aria-hidden="true"><Phone :size="18" /></span>
                <span>
                  <span class="contact-label">Telephone</span>
                  <a class="contact-value" :href="COUNCIL_CONTACT.phoneHref">{{ COUNCIL_CONTACT.phone }}</a>
                </span>
              </li>
              <li>
                <span class="contact-ico" aria-hidden="true"><Mail :size="18" /></span>
                <span>
                  <span class="contact-label">Email</span>
                  <a class="contact-value" :href="`mailto:${COUNCIL_CONTACT.email}`">{{ COUNCIL_CONTACT.email }}</a>
                </span>
              </li>
              <li>
                <span class="contact-ico" aria-hidden="true"><MapPin :size="18" /></span>
                <span>
                  <span class="contact-label">Address</span>
                  <a
                    class="contact-value"
                    href="https://maps.google.com/?q=19+Lincoln+Road+Light+Industrial+Site+Gweru"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ COUNCIL_CONTACT.address }}</a>
                </span>
              </li>
              <li>
                <span class="contact-ico" aria-hidden="true"><Clock :size="18" /></span>
                <span>
                  <span class="contact-label">Office hours</span>
                  <span class="contact-value">{{ COUNCIL_CONTACT.hours }}</span>
                </span>
              </li>
            </ul>
          </div>

          <!-- Form -->
          <form class="contact-form" novalidate v-reveal.up="120" @submit.prevent="onSubmit">
            <p class="contact-status">
              <Info :size="15" aria-hidden="true" />
              <span>
                This form opens your own email program with the message ready
                to send, so you keep a copy of what you sent.
              </span>
            </p>

            <label class="contact-field">
              <span class="contact-field-label">Your name</span>
              <input
                id="contact-name"
                v-model="name"
                type="text"
                class="contact-input"
                autocomplete="name"
                placeholder="Full name"
                :aria-invalid="!!errorFor('name')"
                :aria-describedby="errorFor('name') ? 'contact-name-err' : undefined"
                @blur="touched.name = true"
              />
              <span v-if="errorFor('name')" id="contact-name-err" class="contact-error">
                <AlertCircle :size="13" aria-hidden="true" />
                {{ errorFor('name') }}
              </span>
            </label>

            <label class="contact-field">
              <span class="contact-field-label">Your email</span>
              <input
                id="contact-email"
                v-model="email"
                type="email"
                class="contact-input"
                autocomplete="email"
                placeholder="you@example.com"
                :aria-invalid="!!errorFor('email')"
                :aria-describedby="errorFor('email') ? 'contact-email-err' : undefined"
                @blur="touched.email = true"
              />
              <span v-if="errorFor('email')" id="contact-email-err" class="contact-error">
                <AlertCircle :size="13" aria-hidden="true" />
                {{ errorFor('email') }}
              </span>
            </label>

            <label class="contact-field">
              <span class="contact-field-label">Subject <span class="contact-hint">(optional)</span></span>
              <input
                id="contact-subject"
                v-model="subject"
                type="text"
                class="contact-input"
                maxlength="120"
                placeholder="Rates query, stand application, road maintenance…"
              />
            </label>

            <label class="contact-field">
              <span class="contact-field-label">Your message</span>
              <textarea
                id="contact-message"
                v-model="message"
                rows="6"
                class="contact-input"
                :maxlength="MAX_MESSAGE"
                placeholder="What can the council help you with?"
                :aria-invalid="!!errorFor('message')"
                :aria-describedby="errorFor('message') ? 'contact-message-err' : 'contact-message-count'"
                @blur="touched.message = true"
              ></textarea>
              <span v-if="errorFor('message')" id="contact-message-err" class="contact-error">
                <AlertCircle :size="13" aria-hidden="true" />
                {{ errorFor('message') }}
              </span>
              <span v-else id="contact-message-count" class="contact-hint">
                {{ remaining }} characters remaining
              </span>
            </label>

            <button type="submit" class="hero-btn-primary">
              <Send :size="16" aria-hidden="true" />
              Compose this message
            </button>

            <p v-if="handedOff" class="contact-status" role="status">
              <Info :size="15" aria-hidden="true" />
              <span>
                Your email program should now be open with the message ready.
                If nothing happened, write to
                <a :href="`mailto:${COUNCIL_CONTACT.email}`">{{ COUNCIL_CONTACT.email }}</a>
                directly.
              </span>
            </p>
          </form>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
