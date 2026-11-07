<script setup lang="ts">
// Cookie consent. Sign-in and security cookies are essential and always set;
// the only optional thing is first-party usage analytics, which stays off
// until the visitor accepts (see services/analytics.ts). The banner shows
// while no choice is stored, and again after the privacy notice resets it.
import { consent, setConsent } from '@/services/analytics'
import UiButton from '@/components/ui/UiButton.vue'
</script>

<template>
  <Transition name="cookie">
    <section
      v-if="consent === null"
      class="cookie-consent"
      role="region"
      aria-labelledby="cookie-consent-title"
    >
      <div class="cookie-consent__text">
        <h2 id="cookie-consent-title" class="cookie-consent__title">Cookies on this portal</h2>
        <p>
          Essential cookies keep you signed in and protect sign-in forms; they are always used.
          With your permission we also count page views, on the council's own servers, to see
          how the portal is used. No advertising or third-party tracking.
          <router-link to="/privacy" class="cookie-consent__link">Privacy notice</router-link>
        </p>
      </div>
      <div class="cookie-consent__actions">
        <UiButton size="sm" @click="setConsent('rejected')">Reject analytics</UiButton>
        <UiButton variant="primary" size="sm" @click="setConsent('accepted')">Accept analytics</UiButton>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.cookie-consent {
  position: fixed;
  left: 50%;
  bottom: var(--ent-s4);
  transform: translateX(-50%);
  z-index: var(--ent-z-toast);
  width: min(44rem, calc(100% - 2 * var(--ent-s4)));
  display: flex;
  align-items: center;
  gap: var(--ent-s4);
  padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-surface);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-lg);
  box-shadow: var(--ent-e3);
  font-family: var(--ent-font);
}

.cookie-consent__text { flex: 1; min-width: 0; }

.cookie-consent__title {
  margin: 0 0 var(--ent-s1);
  font-size: var(--ent-fs-base);
  font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight);
  color: var(--ent-text);
}

.cookie-consent__text p {
  margin: 0;
  font-size: var(--ent-fs-sm);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
}

.cookie-consent__link {
  color: var(--ent-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}

.cookie-consent__link:focus-visible {
  outline: none;
  border-radius: var(--ent-r-sm);
  box-shadow: var(--ent-focus-ring);
}

.cookie-consent__actions {
  display: flex;
  gap: var(--ent-s2);
  flex-shrink: 0;
}

@media (max-width: 767px) {
  .cookie-consent {
    flex-direction: column;
    align-items: stretch;
  }
  .cookie-consent__actions > * { flex: 1; min-height: 40px; }
}

.cookie-enter-active,
.cookie-leave-active {
  transition: opacity var(--ent-dur-lg) var(--ent-ease), transform var(--ent-dur-lg) var(--ent-ease);
}

.cookie-enter-from,
.cookie-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (prefers-reduced-motion: reduce) {
  .cookie-enter-active,
  .cookie-leave-active {
    transition: none;
  }
}
</style>
