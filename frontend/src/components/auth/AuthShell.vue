<script setup lang="ts">
/**
 * The frame every anonymous screen sits in: sign in, create account, forgot
 * password, reset password, accept invite.
 *
 * Two columns on a desktop — the council's identity on the left, the form on
 * the right — collapsing to a compact banner above the form on a phone. The
 * left rail exists for one reason and it is not decoration: a sign-in page
 * with no institutional identity on it is indistinguishable from a page
 * pretending to be one, and this form collects national ID numbers.
 *
 * Callers supply the rail's words (`lede`, `points`) because "why am I
 * signing in" is a different sentence from "why am I resetting a password".
 *
 * No <style> block, deliberately: every rule is in src/styles/auth.css, so
 * the five screens cannot drift apart the way LoginView and RegisterView had.
 * An empty scoped block is not free either — Vite emits a 0-byte CSS asset
 * for it, and that is a round trip on a connection that cannot spare one.
 */
import { MapPin, Check } from 'lucide-vue-next'

withDefaults(defineProps<{
  /** The rail's one-line statement. */
  lede?: string
  /** The paragraph under it. */
  copy?: string
  /** Short factual lines, not selling points. */
  points?: string[]
  /** Widen the form card — used by create-account, which has nine fields. */
  wide?: boolean
}>(), {
  lede: 'The council’s planning record, online.',
  copy: 'Vungu Rural District Council runs development control, building inspections and the district spatial register through this portal.',
  points: () => [],
  wide: false,
})
</script>

<template>
  <div class="auth-page">
    <!-- Identity rail -->
    <aside class="auth-rail">
      <router-link to="/" class="auth-mark">
        <span class="auth-mark-tile" aria-hidden="true"><MapPin :size="18" /></span>
        <span>
          <span class="auth-mark-name">Vungu Rural District Council</span>
          <span class="auth-mark-sub">Development Planning Portal</span>
        </span>
      </router-link>

      <div class="auth-rail-body">
        <p class="auth-rail-lede">{{ lede }}</p>
        <p class="auth-rail-copy">{{ copy }}</p>
        <ul v-if="points.length" class="auth-rail-list">
          <li v-for="point in points" :key="point">
            <Check :size="15" aria-hidden="true" />
            <span>{{ point }}</span>
          </li>
        </ul>
      </div>

      <p class="auth-rail-foot">
        Vungu Rural District Council, Zimbabwe.
        <br />
        <router-link to="/privacy">Privacy notice</router-link> ·
        <router-link to="/terms">Terms of use</router-link> ·
        <a href="mailto:support@vungurdc.gov.zw">support@vungurdc.gov.zw</a>
      </p>
    </aside>

    <!-- Form column -->
    <main class="auth-main">
      <div class="auth-card" :class="{ 'auth-card-wide': wide }">
        <slot />
        <p class="auth-legal">
          <router-link to="/privacy">Privacy notice</router-link> ·
          <router-link to="/terms">Terms of use</router-link> ·
          <a href="mailto:support@vungurdc.gov.zw">Contact the council</a>
        </p>
      </div>
    </main>
  </div>
</template>
