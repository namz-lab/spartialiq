<script setup lang="ts">
// Appeals — the shared statutory register (RTCP Act s.38).
//
// This was a second implementation of the same register, written against
// field names the appeals table does not have (`filed_at`, `outcome`,
// `assigned_officer`) and statuses its CHECK constraint would have rejected
// (`filed`, `admitted`, `heard`) — against an endpoint that did not exist.
// The clerk and the EO now work one register: components/appeals/AppealsRegister.vue.
import AppealsRegister from '@/components/appeals/AppealsRegister.vue'
</script>

<template>
  <AppealsRegister />
</template>
