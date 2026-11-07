<template>
  <div id="app" class="h-screen flex flex-col">
    <!-- Main Content -->
    <main class="flex-1">
      <router-view />
    </main>
    <CookieConsent />
    <DesktopUpdateBanner />
  </div>
</template>

<script setup lang="ts">
import CookieConsent from './components/CookieConsent.vue'
import DesktopUpdateBanner from './components/DesktopUpdateBanner.vue'
</script>

<style>
/* Global layout */
#app {
  min-height: var(--ent-vh);
  display: flex;
  flex-direction: column;
}
</style>
