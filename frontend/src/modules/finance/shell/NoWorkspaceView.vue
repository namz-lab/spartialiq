<script setup lang="ts">
/**
 * A finance account whose permissions open no finance workspace.
 *
 * This happens when a role's grants or a personal override were withdrawn, not in normal use. The
 * person is told so in a sentence and given the one action that helps (asking the finance
 * administrator), instead of an empty console that looks broken.
 */
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '../stores/finance'
import '@/views/inspector/inspector.css'
import '../pages/finance.css'

const router = useRouter()
const auth = useAuthStore()
const store = useFinanceStore()

async function signOut(): Promise<void> {
  await auth.logout()
  store.reset()
  void router.push('/login')
}
</script>

<template>
  <main class="fin-none">
    <span class="ins-eyebrow">Vungu Rural District Council · Finance</span>
    <h1 class="ins-title">No finance workspace</h1>
    <p class="ins-lede">
      You hold a finance role, but none of your permissions opens a finance workspace. The finance
      administrator can review your access.
    </p>
    <p>
      <button type="button" class="fin-btn" @click="signOut">Sign out</button>
    </p>
  </main>
</template>

<style scoped>
.fin-none {
  max-width: 40rem; margin: 0 auto; padding: var(--ent-s7) var(--ent-s5);
  display: flex; flex-direction: column; gap: var(--ent-s3);
}
</style>
