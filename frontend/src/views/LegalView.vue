<template>
  <!--
    Single template for /privacy and /terms — content swapped via the
    route name. Lightweight by design: real legal copy is the
    council's responsibility; we ship a sober skeleton that already
    covers the headings the council typically needs to fill in.
  -->
  <div class="legal-page">
    <header class="page-topbar">
      <router-link to="/" class="page-back" aria-label="Back to home">
        <ArrowLeft :size="14" aria-hidden="true" />
        <span>Vungu Portal</span>
      </router-link>
    </header>

    <main class="page-stage">
      <header class="page-head">
        <p class="eyebrow">{{ eyebrow }}</p>
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-meta mono">Last updated: {{ lastUpdated }}</p>
      </header>

      <section v-if="kind === 'privacy'" class="prose">
        <h2>What we collect</h2>
        <p>
          When you create a Vungu Portal account we store the contact
          details you provide (name, email, phone, organisation if any),
          the documents you upload for verification (national ID,
          proof of residence, title deeds), and the records of your
          interactions with the council (applications, payments,
          inspections).
        </p>

        <h2>Why we collect it</h2>
        <p>
          The data is used solely to deliver council services to you:
          to receive and process applications, to verify identity for
          land allocations, to bill and receipt for fees, and to keep
          the regulatory records the council is required by law to
          maintain.
        </p>

        <h2>Who can see it</h2>
        <p>
          Council staff with a legitimate operational need (planners,
          building inspectors, planning clerks, environmental officers)
          can see your records. We do not sell your data or share it
          with third parties for marketing.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Application files are retained as required by the Regional,
          Town and Country Planning Act and the Public Records Act.
          Cancelled drafts are deleted after 90 days.
        </p>

        <h2 id="cookies">Cookies and analytics</h2>
        <p>
          Essential cookies are always used. They keep you signed in and
          protect the sign-in forms from automated abuse; the portal cannot
          work without them, and they are not used to track you.
        </p>
        <p>
          Usage analytics are optional and off until you accept them. If you
          do, the portal records each page you open on the council's own
          servers: the kind of page (for example "an application", never
          which one), the date and time, a random visitor number kept in your
          browser, and, on your first page only, the website that linked you
          here. We do not record your IP address, your account, your browser
          or device, search terms, or any record numbers, and nothing is sent
          to a third party. Browsers set to "Do Not Track" are never counted.
          These records are deleted automatically after at most 13 months.
        </p>
        <p class="cookie-choice">
          <span>
            Your current choice:
            <strong>{{ consentLabel }}</strong>.
          </span>
          <button type="button" class="cookie-change" @click="resetConsent">
            Change cookie choice
          </button>
        </p>

        <h2>Your rights</h2>
        <p>
          You can request a copy of your data, ask us to correct
          information, or close your account. Send the request to
          <a class="link" href="mailto:dpo@vungurdc.gov.zw">dpo@vungurdc.gov.zw</a>.
        </p>

        <h2>Contact</h2>
        <p>
          Vungu Rural District Council, Lower Gweru, Zimbabwe.
          <br>
          Email:
          <a class="link" href="mailto:info@vungurdc.gov.zw">info@vungurdc.gov.zw</a>
        </p>
      </section>

      <section v-else class="prose">
        <h2>Use of the portal</h2>
        <p>
          The Vungu Spatial Data Portal is provided by the Vungu Rural
          District Council to enable residents, landowners, businesses
          and authorised consultants to interact with council services
          online. By creating an account you agree to use the portal
          honestly and only for lawful purposes.
        </p>

        <h2>Account security</h2>
        <p>
          You are responsible for keeping your sign-in credentials
          confidential. Notify the council immediately of any suspected
          unauthorised use of your account.
        </p>

        <h2>Submitted information</h2>
        <p>
          You confirm that any information you submit, and any document
          you upload, is true and pertains to you (or to a person you
          are lawfully authorised to act for). Knowingly submitting
          false information may constitute an offence under the
          Regional, Town and Country Planning Act.
        </p>

        <h2>Council decisions</h2>
        <p>
          Suggestions or auto-review findings produced by this portal
          do not replace the decisions of the council. A council
          decision becomes effective only when it is communicated to
          you in writing or through the formal status of your record on
          this portal.
        </p>

        <h2>Service availability</h2>
        <p>
          The council uses reasonable efforts to keep the portal
          available, but does not guarantee uninterrupted service.
          Where statutory time limits apply (for example, the
          three-month default approval window under §26(7) of the Act)
          they continue to run regardless of portal availability.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          We may update these terms; significant changes will be
          announced on the portal. Continued use after a change
          constitutes acceptance.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of Zimbabwe.
        </p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { consent, resetConsent } from '@/services/analytics'

const route = useRoute()
const kind = computed<'privacy' | 'terms'>(() =>
  String(route.path).startsWith('/privacy') ? 'privacy' : 'terms',
)
const title = computed(() => kind.value === 'privacy' ? 'Privacy notice' : 'Terms of use')
const eyebrow = computed(() => kind.value === 'privacy' ? 'How we handle your data' : 'Conditions for using this portal')
const lastUpdated = '2026-09-29'
const consentLabel = computed(() =>
  consent.value === 'accepted' ? 'analytics accepted'
    : consent.value === 'rejected' ? 'analytics rejected'
      : 'not yet made',
)
</script>

<style scoped>
.legal-page {
  min-height: 100dvh;
  background:
    radial-gradient(900px 500px at 10% -10%, rgba(30, 107, 74, 0.06), transparent 60%),
    #fbfbf8;
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  color: #0b1220;
  display: flex; flex-direction: column;
}
.page-topbar { padding: 1rem 1.5rem; }
.page-back {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.8125rem; font-weight: 500; color: #404a59;
  text-decoration: none;
  transition: color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.page-back:hover { color: #0b1220; }
.page-stage {
  flex: 1; max-width: 48rem; width: 100%;
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 3rem) clamp(1rem, 4vw, 2rem) 4rem;
  display: flex; flex-direction: column; gap: 1.5rem;
}
.page-head { padding-bottom: 0.5rem; }
.eyebrow {
  font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5b6473;
  margin: 0 0 0.75rem;
}
.page-title {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-weight: 600;
  font-size: clamp(1.75rem, 3vw + 0.5rem, 2.5rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.4rem;
  line-height: 1.1;
}
.page-meta { margin: 0; font-size: 0.75rem; color: #8e96a4; }
.mono { font-family: 'Geist Mono', ui-monospace, monospace; }
.prose h2 {
  font-family: 'Fraunces', ui-serif, Georgia, serif;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: #0b1220;
  margin: 1.5rem 0 0.5rem;
}
.prose p {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  line-height: 1.65;
  color: #2b333f;
  max-width: 64ch;
}
.link { color: #1e6b4a; text-decoration: none; }
.link:hover { text-decoration: underline; }
.prose .cookie-choice {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem;
}
.cookie-change {
  min-height: 34px; padding: 0 0.75rem;
  font: inherit; font-size: 0.8125rem; font-weight: 500;
  color: #0b1220; background: #fff;
  border: 1px solid #c4ccd7; border-radius: 6px; cursor: pointer;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.cookie-change:hover { background: #f4f6f9; }
.cookie-change:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(31, 90, 168, 0.32); }
@media (prefers-reduced-motion: reduce) {
  .cookie-change { transition: none; }
}
</style>
