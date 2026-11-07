<script setup lang="ts">
/**
 * C15 — Request a section 109 rates clearance for a property transfer.
 * Citizen lodges; staff decide on /statutory-registers?tab=clearances.
 */
import { ref, onMounted } from 'vue'
import { registersApi } from '@/services/registersApi'
import { useAuthStore } from '@/stores/auth'
import { FileBadge, RefreshCw } from 'lucide-vue-next'

const auth = useAuthStore()
const loading = ref(false)
const error = ref('')
const ok = ref('')
const mine = ref<Record<string, unknown>[]>([])
const stand = ref('')
const name = ref(auth.user?.name || '')

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const res = await registersApi.myRatesClearances()
    mine.value = (res.data?.data || []) as Record<string, unknown>[]
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      || (e as Error).message || 'Could not load requests'
  } finally {
    loading.value = false
  }
}

async function submit() {
  error.value = ''
  ok.value = ''
  if (!stand.value.trim() || !name.value.trim()) {
    error.value = 'Stand number and applicant name are required'
    return
  }
  try {
    await registersApi.requestRatesClearance({
      stand_number: stand.value.trim(),
      applicant_name: name.value.trim(),
      applicant_email: auth.user?.email || undefined,
    })
    ok.value = 'Request lodged. The planning clerk will review charges and issue the certificate when paid up.'
    stand.value = ''
    await refresh()
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      || (e as Error).message || 'Request failed'
  }
}

onMounted(refresh)

function fmt(iso: unknown) {
  if (!iso || typeof iso !== 'string') return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="rc" data-testid="rates-clearance">
    <header class="rc-head">
      <div>
        <h1><FileBadge :size="22" /> Rates clearance (section 109)</h1>
        <p>
          Request the certificate that all council charges for the stand are paid,
          so a transfer can be registered at the Deeds Registry.
        </p>
      </div>
      <button type="button" class="rc-btn" data-testid="rc-refresh" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" :class="{ spin: loading }" /> Refresh
      </button>
    </header>

    <p v-if="error" class="rc-err" role="alert" data-testid="rc-error">{{ error }}</p>
    <p v-if="ok" class="rc-ok" role="status" data-testid="rc-ok">{{ ok }}</p>

    <section class="rc-panel">
      <h2>New request</h2>
      <form class="rc-form" data-testid="rc-form" @submit.prevent="submit">
        <label>Stand number
          <input v-model="stand" required placeholder="e.g. HDR-105" data-testid="rc-stand" />
        </label>
        <label>Applicant name
          <input v-model="name" required data-testid="rc-name" />
        </label>
        <button type="submit" class="rc-btn primary" data-testid="rc-submit">Lodge request</button>
      </form>
    </section>

    <section class="rc-panel">
      <h2>My requests <span>{{ mine.length }}</span></h2>
      <p v-if="!mine.length" class="rc-empty" data-testid="rc-empty">No rates-clearance requests yet.</p>
      <ul class="rc-list" data-testid="rc-list">
        <li v-for="r in mine" :key="String(r.id)" :data-testid="`rc-row-${r.id}`">
          <strong>Stand {{ r.stand_number }}</strong>
          <span class="badge">{{ r.status }}</span>
          <span v-if="r.certificate_no" class="mono">{{ r.certificate_no }}</span>
          <span class="muted">{{ fmt(r.created_at) }}</span>
          <span v-if="r.valid_until" class="muted">Valid to {{ fmt(r.valid_until) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.rc { padding: 0.25rem 0 2rem; }
.rc-head {
  display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start;
  margin-bottom: 1rem;
}
.rc-head h1 {
  margin: 0; font-size: 1.35rem; display: flex; align-items: center; gap: 0.4rem;
}
.rc-head p { margin: 0.35rem 0 0; color: #5a6578; max-width: 40rem; line-height: 1.4; }
.rc-panel {
  background: #fff; border: 1px solid #d8dee8; border-radius: 8px;
  padding: 1rem; margin-bottom: 0.85rem;
}
.rc-panel h2 {
  margin: 0 0 0.75rem; font-size: 1rem; display: flex; gap: 0.4rem; align-items: center;
}
.rc-panel h2 span {
  font-size: 0.75rem; background: #f0f3f7; padding: 0.1rem 0.4rem; border-radius: 999px; color: #5a6578;
}
.rc-form {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.65rem; align-items: end;
}
.rc-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: #5a6578; }
.rc-form input {
  border: 1px solid #d8dee8; border-radius: 5px; padding: 0.4rem 0.5rem; font: inherit;
}
.rc-btn {
  display: inline-flex; align-items: center; gap: 0.3rem;
  border: 1px solid #d8dee8; background: #fff; border-radius: 5px;
  padding: 0.45rem 0.75rem; font: inherit; cursor: pointer;
}
.rc-btn.primary { background: #0b5f4b; border-color: #0b5f4b; color: #fff; }
.rc-list { list-style: none; margin: 0; padding: 0; }
.rc-list li {
  display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
  padding: 0.55rem 0; border-top: 1px solid #d8dee8;
}
.badge {
  font-size: 0.72rem; text-transform: uppercase; background: #f0f3f7;
  padding: 0.1rem 0.4rem; border-radius: 3px;
}
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 0.85rem; }
.muted { color: #5a6578; font-size: 0.85rem; }
.rc-err { color: #8b1e1e; background: #fdecea; padding: 0.5rem 0.75rem; border-radius: 5px; }
.rc-ok { color: #0b5f4b; background: #e8f5ef; padding: 0.5rem 0.75rem; border-radius: 5px; }
.rc-empty { color: #5a6578; margin: 0; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
