<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import PaymentMethodPicker from '@/components/PaymentMethodPicker.vue'
import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'
import { dmApi } from '@/services/developmentManagementService'

const router = useRouter()
const route  = useRoute()
const loading = ref(true)
const council = ref<{ name: string; application_fee: number } | null>(null)
const permit  = ref<{ id: string } | null>(null)

onMounted(async () => {
  try {
    const relatedKind = String(route.query.relatedKind || '')
    const relatedId   = String(route.query.relatedId   || '')
    if (relatedKind !== 'permit' || !relatedId) {
      router.replace('/citizen')
      return
    }
    permit.value  = await dmApi.getPermit(relatedId)
    council.value = await citizenPortalService.getCouncil()
  } catch {
    router.replace('/citizen')
  } finally {
    loading.value = false
  }
})

// One in-flight payment init at a time. Without this a second click created a
// second payment record for the same permit; the picker is disabled while it
// is true and re-enabled only once the request settles, so a failed attempt
// can still be retried.
const paying = ref(false)
const payError = ref('')

async function onSubmit(p: { wallet: 'ecocash'|'onemoney'|'innbucks'; phone: string; walletCcy: 'USD'|'ZWG' }) {
  if (!council.value || !permit.value || paying.value) return
  paying.value = true
  payError.value = ''
  try {
    const payment = await paymentsService.init({
      purpose:     'application_fee',
      relatedKind: 'permit',
      relatedId:   permit.value.id,
      priceUsd:    council.value.application_fee,
      walletCcy:   p.walletCcy,
      driver:      'paynow',
      metadata:    { phone: p.phone, wallet: p.wallet },
    })
    // Only leave the screen once the server has a payment to send us to.
    router.replace(`/payment/${payment.id}`)
  } catch {
    payError.value = "Payment couldn't start. Check the number and try again."
  } finally {
    paying.value = false
  }
}

function onCancel() {
  router.replace('/citizen')
}
</script>

<template>
  <div class="piv">
    <div v-if="loading" class="piv-loading">Loading…</div>
    <PaymentMethodPicker
      v-else-if="council && permit"
      :price-usd="council.application_fee"
      :council="{ name: council.name }"
      :busy="paying"
      @submit="onSubmit"
      @cancel="onCancel"
    />
    <p v-if="payError" class="piv-error" role="alert">{{ payError }}</p>
  </div>
</template>

<style scoped>
.piv { min-height:80vh; display:flex; align-items:center; justify-content:center; padding:1.5rem; background:#f8fafc; }
.piv-loading { color:#64748b; font-size:0.85rem; }
.piv-error { margin:0.75rem 0 0; color:#b91c1c; font-size:0.8rem; text-align:center; }
</style>
