<script setup lang="ts">
/** One sentence about the till when it is not ready to take a payment, with the way forward. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Lock } from 'lucide-vue-next'
import { useCashier } from '../useCashier'

const { state, till, session } = useCashier()

const text = computed<string | null>(() => {
  if (!state.desk) return null
  switch (till.value) {
    case 'none': return 'Your till is not open. Open it with your float before taking a payment.'
    case 'suspended': return `Your till ${session.value?.session_no ?? ''} is suspended. Resume it to take payments.`
    case 'abandoned': return 'Your session was found abandoned by a supervisor. It is counted under supervision; you cannot take payments in it.'
    case 'stale': return 'Your till is from an earlier business day. Cash it up before opening today\'s.'
    case 'counted': return 'Your count is declared and waiting for verification. Open a new till to take more payments.'
    case 'verified': return 'Your last session is verified. Open a new till to take payments.'
    default: return null
  }
})
</script>

<template>
  <div v-if="text" class="cw-banner-msg cw-banner-msg--warn" role="status">
    <Lock :size="18" aria-hidden="true" />
    <span>{{ text }}</span>
    <RouterLink :to="{ name: 'cashier-cashup' }" class="cw-btn cw-btn--small cw-btn--outline">Go to Daily Cash Up</RouterLink>
  </div>
</template>
