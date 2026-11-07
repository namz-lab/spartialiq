<script setup lang="ts">
// Generic service-desk ticket form — rates, trading licence request, nuisance,
// road works, social welfare, survey. Intake only; EHO sees trading/nuisance tickets.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CITIZEN_SERVICES, type CitizenService } from '@/views/citizen/citizenServices'
import { serviceDeskApi } from '@/services/serviceDesk'
import { useAuthStore } from '@/stores/auth'
import { Ticket, CheckCircle2, AlertTriangle } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const DESK_IDS = new Set([
  'rates-enquiry',
  'trading-licence',
  'nuisance',
  'road-works',
  'social-welfare',
  'survey-request',
])

const deskServices = computed(() =>
  CITIZEN_SERVICES.filter(s => DESK_IDS.has(s.id)),
)

function serviceFromQuery(): CitizenService {
  const id = typeof route.query.service === 'string' ? route.query.service : ''
  return deskServices.value.find(s => s.id === id) || deskServices.value[0]
}

const selectedId = ref(serviceFromQuery().id)
const selected = computed(() =>
  deskServices.value.find(s => s.id === selectedId.value) || deskServices.value[0],
)

watch(() => route.query.service, () => {
  selectedId.value = serviceFromQuery().id
})

watch(selectedId, (id) => {
  if (route.query.service === id) return
  // Keep deep-link in sync when the citizen picks another desk service.
  const q = { ...route.query, section: 'service_desk', service: id }
  void router.replace({ query: q })
})

const submitting = ref(false)
const error = ref('')
const done = ref<{ id: string } | null>(null)
const mine = ref<{ id: string; title: string; status: string; created_at: string }[]>([])

const form = reactive({
  requester_name: auth.userName || '',
  contact_phone: '',
  contact_email: auth.userEmail || '',
  location_text: '',
  details: '',
})

async function loadMine() {
  try {
    const rows = await serviceDeskApi.mine()
    mine.value = rows.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      created_at: r.created_at,
    }))
  } catch {
    /* non-fatal — form still works */
  }
}

async function submit() {
  error.value = ''
  done.value = null
  if (!form.details.trim()) {
    error.value = 'Describe what you need.'
    return
  }
  submitting.value = true
  try {
    const row = await serviceDeskApi.create({
      service_id: selected.value.id,
      department: selected.value.department,
      title: selected.value.title,
      requester_name: form.requester_name || null,
      contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null,
      location_text: form.location_text || null,
      details: form.details.trim(),
    })
    done.value = { id: row.id }
    form.details = ''
    form.location_text = ''
    await loadMine()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string; message?: string } } }
    error.value = err.response?.data?.message
      || err.response?.data?.error
      || 'Could not lodge the request. Try again or visit reception.'
  } finally {
    submitting.value = false
  }
}

onMounted(loadMine)
</script>

<template>
  <div class="sd">
    <header>
      <p class="sd-eyebrow"><Ticket :size="14" /> Service desk</p>
      <h1>{{ selected.title }}</h1>
      <p>{{ selected.description }}</p>
    </header>

    <label class="sd-pick">Service
      <select v-model="selectedId">
        <option v-for="s in deskServices" :key="s.id" :value="s.id">{{ s.title }}</option>
      </select>
    </label>

    <div v-if="done" class="sd-ok" role="status">
      <CheckCircle2 :size="18" />
      <div>
        <strong>Request lodged</strong>
        <span>Reference {{ done.id.slice(0, 8) }}… — staff will follow up using your contact details.</span>
      </div>
    </div>

    <form class="sd-form" @submit.prevent="submit">
      <label>Your name <input v-model="form.requester_name" /></label>
      <label>Phone <input v-model="form.contact_phone" type="tel" /></label>
      <label>Email <input v-model="form.contact_email" type="email" /></label>
      <label>Location / stand / account
        <input v-model="form.location_text" placeholder="Stand, ward, rates account, premises…" />
      </label>
      <label class="wide">Details
        <textarea v-model="form.details" rows="4" required
                  :placeholder="selected.askFor" />
      </label>
      <p v-if="error" class="sd-err" role="alert"><AlertTriangle :size="14" /> {{ error }}</p>
      <button type="submit" class="sd-btn" :disabled="submitting">
        {{ submitting ? 'Sending…' : 'Lodge request' }}
      </button>
    </form>

    <section v-if="mine.length" class="sd-mine">
      <h2>My recent requests</h2>
      <ul>
        <li v-for="t in mine" :key="t.id">
          <strong>{{ t.title }}</strong>
          <span class="pill">{{ t.status.replace(/_/g, ' ') }}</span>
          <time :datetime="t.created_at">{{ new Date(t.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</time>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.sd { max-width:760px; margin:0 auto; width:100%; padding:1.25rem 1rem 2rem; display:flex; flex-direction:column; gap:1rem; }
.sd-eyebrow {
  margin:0; display:inline-flex; align-items:center; gap:0.35rem;
  font-size:0.72rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted);
}
.sd h1 { margin:0.25rem 0 0; font-size:1.3rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.sd header p:last-child { margin:0.35rem 0 0; color:var(--cp-text-2); font-size:0.9rem; line-height:1.5; }
.sd-pick { display:flex; flex-direction:column; gap:0.3rem; font-size:0.8rem; font-weight:600; color:var(--cp-text-2); }
.sd-pick select, .sd-form input, .sd-form textarea {
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.55rem 0.65rem;
  font-size:0.88rem; font-weight:400; color:var(--cp-text); background:var(--cp-surface); min-height:40px;
}
.sd-ok {
  display:flex; gap:0.65rem; align-items:flex-start; padding:0.85rem 1rem;
  background:var(--cp-green-bg); color:var(--cp-green-fg); border-radius:var(--cp-radius);
}
.sd-ok strong { display:block; }
.sd-ok span { font-size:0.82rem; }
.sd-form {
  display:grid; grid-template-columns:1fr 1fr; gap:0.85rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); padding:1.1rem;
}
.sd-form label { display:flex; flex-direction:column; gap:0.3rem; font-size:0.8rem; font-weight:600; color:var(--cp-text-2); }
.sd-form .wide { grid-column:1 / -1; }
.sd-err { grid-column:1 / -1; margin:0; color:var(--cp-red-fg); font-size:0.82rem; display:flex; gap:0.35rem; align-items:center; }
.sd-btn {
  grid-column:1 / -1; justify-self:start; min-height:42px; border:0; border-radius:var(--cp-radius-sm); padding:0 1.25rem;
  background:var(--cp-primary); color:var(--cp-on-primary); font-weight:600; cursor:pointer;
}
.sd-btn:hover:not(:disabled) { background:var(--cp-primary-hover); }
.sd-btn:disabled { cursor:not-allowed; }
.sd-mine h2 { margin:0 0 0.5rem; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.sd-mine ul { list-style:none; margin:0; padding:0; display:grid; gap:0.45rem; }
.sd-mine li {
  display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; background:var(--cp-surface);
  padding:0.6rem 0.8rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); font-size:0.82rem; color:var(--cp-text);
}
.pill {
  font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em;
  padding:0.12rem 0.5rem; border-radius:var(--cp-radius-pill); background:var(--cp-blue-bg); color:var(--cp-blue-fg);
}
.sd-mine time { margin-left:auto; color:var(--cp-muted); font-size:0.75rem; }
@media (max-width: 640px) { .sd-form { grid-template-columns:1fr; } .sd-btn { justify-self:stretch; } }
@media (min-width: 1024px) { .sd { padding:1.75rem 1.5rem 2.5rem; } }
</style>
