<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  complaintsApi,
  COMPLAINT_CATEGORY_LABELS,
  type ComplaintCategory,
  type ComplaintSeverity,
} from '@/services/buildingComplaints'
import { useAuthStore } from '@/stores/auth'
import { AlertTriangle, CheckCircle2 } from 'lucide-vue-next'

const auth = useAuthStore()
const route = useRoute()
// "Report a problem here" on the map arrives with the site filled in.
const fromQuery = (k: string) => { const v = route?.query?.[k]; return typeof v === 'string' ? v.slice(0, 200) : '' }
const submitting = ref(false)
const error = ref('')
const done = ref<{ reference: string } | null>(null)

const form = reactive({
  category: 'building_without_permit' as ComplaintCategory,
  severity: 'routine' as ComplaintSeverity,
  description: '',
  stand_number: fromQuery('stand'),
  suburb_ward: fromQuery('ward'),
  location_note: fromQuery('note'),
  anonymous: false,
  reporter_name: auth.userName || '',
  reporter_phone: '',
})

const categories = Object.entries(COMPLAINT_CATEGORY_LABELS) as [ComplaintCategory, string][]

async function submit() {
  error.value = ''
  done.value = null
  if (!form.description.trim()) {
    error.value = 'Describe what you saw.'
    return
  }
  if (!form.stand_number && !form.suburb_ward && !form.location_note) {
    error.value = 'Add a stand number, ward, or directions so an inspector can find the site.'
    return
  }
  submitting.value = true
  try {
    const row = await complaintsApi.create({
      category: form.category,
      severity: form.severity,
      description: form.description.trim(),
      stand_number: form.stand_number || null,
      suburb_ward: form.suburb_ward || null,
      location_note: form.location_note || null,
      anonymous: form.anonymous,
      reporter_name: form.anonymous ? null : (form.reporter_name || null),
      reporter_phone: form.anonymous ? null : (form.reporter_phone || null),
    })
    done.value = { reference: row.reference }
    form.description = ''
    form.location_note = ''
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string; message?: string } } }
    error.value = err.response?.data?.message
      || err.response?.data?.error
      || 'Could not lodge the report. Try again or visit the Building Inspectorate counter.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="cmp">
    <header>
      <h1>Report unauthorised or dangerous building work</h1>
      <p>
        Same intake the inspectorate uses at the counter. Your report joins the
        building complaints register for triage. You may stay anonymous.
      </p>
    </header>

    <div v-if="done" class="cmp-ok" role="status">
      <CheckCircle2 :size="18" />
      <div>
        <strong>Report lodged — {{ done.reference }}</strong>
        <span>Keep this reference if you phone the office later.</span>
      </div>
    </div>

    <form class="cmp-form" @submit.prevent="submit">
      <label>Category
        <select v-model="form.category">
          <option v-for="[k, l] in categories" :key="k" :value="k">{{ l }}</option>
        </select>
      </label>
      <label>Urgency
        <select v-model="form.severity">
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency — danger to life</option>
        </select>
      </label>
      <label class="wide">What did you see?
        <textarea v-model="form.description" rows="4" required placeholder="Describe the site and the problem…" />
      </label>
      <label>Stand number <input v-model="form.stand_number" placeholder="e.g. CIT-SMK-1" /></label>
      <label>Ward / suburb <input v-model="form.suburb_ward" /></label>
      <label class="wide">Directions if no stand number
        <textarea v-model="form.location_note" rows="2" placeholder="Near the clinic, blue roof…" />
      </label>
      <label class="row"><input type="checkbox" v-model="form.anonymous" /> Report anonymously</label>
      <template v-if="!form.anonymous">
        <label>Your name <input v-model="form.reporter_name" /></label>
        <label>Phone <input v-model="form.reporter_phone" type="tel" /></label>
      </template>
      <p v-if="error" class="cmp-err" role="alert"><AlertTriangle :size="14" /> {{ error }}</p>
      <button type="submit" class="cmp-btn" :disabled="submitting">
        {{ submitting ? 'Sending…' : 'Lodge report' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.cmp { max-width:760px; margin:0 auto; width:100%; padding:1.25rem 1rem 2rem; display:flex; flex-direction:column; gap:1rem; }
.cmp h1 { margin:0; font-size:1.3rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.cmp header p { margin:0.35rem 0 0; color:var(--cp-text-2); font-size:0.9rem; line-height:1.5; }
.cmp-ok {
  display:flex; gap:0.65rem; align-items:flex-start; padding:0.85rem 1rem;
  background:var(--cp-green-bg); color:var(--cp-green-fg); border-radius:var(--cp-radius);
}
.cmp-ok strong { display:block; }
.cmp-ok span { font-size:0.82rem; }
.cmp-form {
  display:grid; grid-template-columns:1fr 1fr; gap:0.85rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); padding:1.1rem;
}
.cmp-form label { display:flex; flex-direction:column; gap:0.3rem; font-size:0.8rem; font-weight:600; color:var(--cp-text-2); }
.cmp-form .wide, .cmp-form .row { grid-column:1 / -1; }
.cmp-form .row { flex-direction:row; align-items:center; gap:0.45rem; font-weight:500; }
.cmp-form input:not([type=checkbox]), .cmp-form select, .cmp-form textarea {
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.55rem 0.65rem;
  font-size:0.88rem; font-weight:400; color:var(--cp-text); background:var(--cp-surface); min-height:40px;
}
.cmp-err { grid-column:1 / -1; margin:0; color:var(--cp-red-fg); font-size:0.82rem; display:flex; gap:0.35rem; align-items:center; }
.cmp-btn {
  grid-column:1 / -1; justify-self:start; min-height:42px; border:0; border-radius:var(--cp-radius-sm); padding:0 1.25rem;
  background:var(--cp-primary); color:var(--cp-on-primary); font-weight:600; cursor:pointer;
}
.cmp-btn:hover:not(:disabled) { background:var(--cp-primary-hover); }
.cmp-btn:disabled { cursor:not-allowed; }
@media (max-width: 640px) { .cmp-form { grid-template-columns:1fr; } .cmp-btn { justify-self:stretch; } }
@media (min-width: 1024px) { .cmp { padding:1.75rem 1.5rem 2.5rem; } }
</style>
