<script setup lang="ts">
/** Put somebody in the service queue: who, what they came to pay, and their account if known. */
import { computed, nextTick, onMounted, ref } from 'vue'
import { X, Search } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf } from '../../../stores/finance'
import type { RatesAccount } from '../../../models/ratesTypes'
import { useCashier } from '../useCashier'

const emit = defineEmits<{ (e: 'close'): void; (e: 'added'): void }>()
const { state } = useCashier()

const name = ref('')
const service = ref('Property rates')
const q = ref('')
const results = ref<RatesAccount[]>([])
const account = ref<RatesAccount | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const nameEl = ref<HTMLInputElement | null>(null)

const services = computed(() => ['Property rates', ...(state.desk?.income_codes ?? []).filter((c) => c.status === 'active').map((c) => c.name)])

onMounted(() => { void nextTick(() => nameEl.value?.focus()) })

async function search(): Promise<void> {
  if (q.value.trim().length < 2) return
  try {
    results.value = (await ratesApi.accounts({ q: q.value.trim(), status: 'active', limit: 6 })).accounts
  } catch (err) {
    error.value = messageOf(err, 'The accounts could not be searched.')
  }
}

function pick(a: RatesAccount): void {
  account.value = a
  results.value = []
  if (!name.value.trim()) name.value = a.party_name
}

async function submit(): Promise<void> {
  if (name.value.trim().length < 2 || busy.value) return
  busy.value = true
  error.value = null
  try {
    await cashApi.addToQueue({
      customer_name: name.value.trim(),
      ...(account.value ? { rates_account_id: account.value.id } : {}),
      ...(service.value ? { service: service.value } : {}),
    })
    emit('added')
  } catch (err) {
    error.value = messageOf(err, 'The customer could not be added to the queue.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="cw-dialog-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="cw-dialog" role="dialog" aria-modal="true" aria-label="Add to the service queue" @submit.prevent="submit">
      <header>
        <h3>Add to the service queue</h3>
        <button type="button" class="cw-icon-btn" aria-label="Close" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="cw-dialog-body">
        <label class="cw-field">
          <span class="cw-label">Customer name <span class="req">*</span></span>
          <input ref="nameEl" v-model="name" class="cw-input" required minlength="2" maxlength="160" autocomplete="off" />
        </label>
        <label class="cw-field">
          <span class="cw-label">Came to pay</span>
          <select v-model="service" class="cw-select">
            <option v-for="s in services" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <div class="cw-field">
          <span class="cw-label">Rates account (optional)</span>
          <p v-if="account" style="margin: 0">
            <strong>{{ account.party_name }}</strong> · {{ account.account_no }}
            <button type="button" class="cw-link" @click="account = null">Change</button>
          </p>
          <template v-else>
            <div class="cw-search">
              <Search :size="20" aria-hidden="true" />
              <input v-model="q" class="cw-input" placeholder="Name or account number" autocomplete="off" aria-label="Search rates accounts" @keydown.enter.prevent="search" />
            </div>
            <button type="button" class="cw-btn cw-btn--small" style="align-self: flex-start" @click="search">Search</button>
            <ul v-if="results.length" style="list-style: none; margin: 0; padding: 0">
              <li v-for="a in results" :key="a.id">
                <button type="button" class="cw-link" @click="pick(a)">{{ a.party_name }} · {{ a.account_no }}<template v-if="a.stand_no"> · Stand {{ a.stand_no }}</template></button>
              </li>
            </ul>
          </template>
        </div>
        <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="emit('close')">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="busy || name.trim().length < 2">{{ busy ? 'Adding…' : 'Add to queue' }}</button>
      </footer>
    </form>
  </div>
</template>
