<script setup lang="ts">
// Public Notices — Section 26(3) notification duties and objections for the
// applicant's own cases in the objection period. Duty ticks and period dates
// come from the council's public_notice record; the applicant answers an
// objection by uploading a signed written response to the case file (the
// objections register itself is staff-only).

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCitizenCase } from '@/composables/useCitizenCase'
import { permitStatusToLifecycle } from '@/services/citizenPortalService'
import {
  dmApi, type Objection, type PublicNotice, type PermitApplication,
} from '@/services/developmentManagementService'
import api from '@/services/api'
import { documentFileError } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import {
  Megaphone, RefreshCw, Search, Calendar, ChevronDown, Upload,
  ChevronRight, AlertTriangle, CheckCircle2, Circle, MessageSquare,
} from 'lucide-vue-next'

const cc = useCitizenCase()
const fb = useUiFeedback()
const router = useRouter()
const emit = defineEmits<{ 'open-section': [key: 'reference'] }>()

const objectionsByCase = ref<Record<string, Objection[]>>({})
const noticeByCase = ref<Record<string, PublicNotice | null>>({})
const loading = ref(false)
const openNotices = ref<Array<{
  permit_app_id: string
  reference: string | null
  stand_number: string | null
  suburb_ward: string | null
  development_type: string | null
  objection_end: string | null
}>>([])
const myTitleNotices = ref<Array<Record<string, unknown>>>([])
const objectionDraft = ref<Record<string, string>>({})

const noticeCases = computed(() =>
  cc.applications.value.filter(p => permitStatusToLifecycle(p) === 'public_notice'))

async function refresh() {
  loading.value = true
  try {
    const [open, mine] = await Promise.all([
      dmApi.listOpenPublicNotices().catch(() => []),
      api.get('/title-notices/mine').then(r => r.data?.data || []).catch(() => []),
    ])
    openNotices.value = open
    myTitleNotices.value = mine
    await Promise.all(noticeCases.value.map(async p => {
      const [objections, notice] = await Promise.all([
        dmApi.listObjections(p.id).catch(() => [] as Objection[]),
        dmApi.getPublicNotice(p.id).catch(() => null),
      ])
      objectionsByCase.value[p.id] = objections
      noticeByCase.value[p.id] = notice
    }))
  } finally { loading.value = false }
}

async function lodge(permitId: string) {
  const grounds = (objectionDraft.value[permitId] || '').trim()
  if (grounds.length < 10) { fb.showToast('Write the grounds of your objection.', 'warning'); return }
  try {
    await dmApi.lodgePublicObjection(permitId, grounds)
    objectionDraft.value[permitId] = ''
    fb.showToast('Your objection is on the case file.', 'success')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'The objection period may have closed.'), 'error')
  }
}

async function markSeen(id: string) {
  try {
    await api.post(`/title-notices/${id}/seen`, {})
    fb.showToast('Council has a record that you have read this notice.', 'success')
    await refresh()
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not record that you have seen the notice.'), 'error')
  }
}
onMounted(refresh)
watch(() => noticeCases.value.map(p => p.id).join(), refresh)

// ── Written response to an objection ─────────────────────────────────
const uploadingFor = ref<string | null>(null)
async function uploadResponse(permitId: string, objection: Objection, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const err = documentFileError(file)
  if (err) { fb.showToast(err, 'warning'); return }
  uploadingFor.value = objection.id
  try {
    await dmApi.uploadPermitDocument(permitId, file, 'objection_response')
    fb.showToast(`Response to ${objection.objector_name} is on the case file.`, 'success')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not upload the response. Try again.'), 'error')
  } finally {
    uploadingFor.value = null
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}
function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

// ── Presentation ──────────────────────────────────────────────────────
const search = ref('')
const filter = ref<'all' | 'objections'>('all')
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'objections', label: 'With objections' },
] as const

const filtered = computed(() => {
  let arr = noticeCases.value
  if (filter.value === 'objections') arr = arr.filter(p => objCount(p) > 0)
  const q = search.value.trim().toLowerCase()
  if (q) arr = arr.filter(p =>
    (p.dev_register_no || '').toLowerCase().includes(q) || (p.stand_number || '').toLowerCase().includes(q))
  return arr
})

function objCount(p: PermitApplication) { return (objectionsByCase.value[p.id] || []).length }
function openObjections(p: PermitApplication) {
  return (objectionsByCase.value[p.id] || []).filter(o => !o.resolved_at).length
}

interface Duty { label: string; done: boolean; when: string | null; detail?: string | null }
function duties(p: PermitApplication): Duty[] {
  const n = noticeByCase.value[p.id]
  return [
    { label: 'Notice published in a newspaper', done: !!n?.advert_verified, when: n?.advert_verified_at ?? null, detail: n?.advert_reference },
    { label: 'Notice posted on the site, visible from the street', done: !!n?.site_notice_verified, when: n?.site_notice_verified_at ?? null },
    { label: 'Abutting owners notified by registered post', done: !!n?.abutting_owners_verified, when: n?.abutting_owners_verified_at ?? null },
  ]
}

const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}
</script>

<template>
  <div class="no">
    <div class="no-grid">
      <!-- Feed -->
      <div class="no-feed">
        <header class="no-header">
          <div>
            <h1>Public notices</h1>
            <p>Section 26(3) RTCP Act · your notification duties and the objections on your cases.</p>
          </div>
          <button type="button" class="no-refresh" :disabled="loading" title="Refresh" aria-label="Refresh" @click="refresh">
            <RefreshCw :size="16" :class="{ spin: loading }" />
          </button>
        </header>

        <div class="no-search">
          <Search :size="18" />
          <input v-model="search" type="search" aria-label="Search notices" placeholder="Search by reference or stand…" />
        </div>

        <div class="no-chips" role="group" aria-label="Filter notices">
          <button v-for="f in FILTERS" :key="f.key" type="button" :class="{ active: filter === f.key }"
                  :aria-pressed="filter === f.key" @click="filter = f.key">{{ f.label }}</button>
        </div>

        <section v-if="myTitleNotices.length" class="cp-card" data-testid="my-title-notices">
          <h2>Notices served on you (section 73)</h2>
          <article v-for="n in myTitleNotices" :key="String(n.id)">
            <p><strong>Stand {{ n.stand_number }}</strong> · {{ n.stage }}</p>
            <pre class="no-note">{{ n.notice_text }}</pre>
            <p>An appeal goes to the Administrative Court, not through this portal. Ask the Planning Clerk to record the court reference.</p>
            <button type="button" class="no-btn primary" @click="markSeen(String(n.id))">I have read this notice</button>
          </article>
        </section>

        <section class="cp-card" data-testid="open-objections">
          <h2>Notices you may object to</h2>
          <p v-if="!openNotices.length" class="no-empty-line">No proposal is in its objection period right now.</p>
          <article v-for="n in openNotices" :key="n.permit_app_id" class="no-card">
            <h3>{{ n.reference || 'Notice' }} — Stand {{ n.stand_number }}, {{ n.suburb_ward }}</h3>
            <p>{{ n.development_type }} · objections close {{ fmtDate(n.objection_end) }}</p>
            <textarea v-model="objectionDraft[n.permit_app_id]" rows="3" placeholder="Grounds of your objection" />
            <button type="button" class="no-btn primary" @click="lodge(n.permit_app_id)">Lodge objection</button>
          </article>
        </section>

        <div v-if="loading && !filtered.length" class="cp-card no-empty"><p>Loading notices…</p></div>
        <div v-else-if="!filtered.length" class="cp-card no-empty">
          <Megaphone :size="26" />
          <h3>No active public notices</h3>
          <p>When one of your applications enters the objection period, its notice, your duties and any objections appear here.</p>
        </div>

        <div v-else class="no-list">
          <article v-for="p in filtered" :key="p.id" class="no-card" :class="{ urgent: openObjections(p) > 0 }">
            <div class="no-card-top">
              <span class="pill" :class="openObjections(p) ? 'pill-amber' : 'pill-blue'">
                {{ openObjections(p) ? 'Objections to answer' : 'Objection period' }}
              </span>
              <span class="mono no-ref">{{ p.dev_register_no || p.id.slice(0, 12) }}</span>
            </div>
            <h2 class="no-title">Section 26(3) notice — Stand {{ p.stand_number }}, {{ p.suburb_ward }}</h2>
            <div class="no-meta">
              <span v-if="noticeByCase[p.id]?.objection_period_end">
                <Calendar :size="15" />
                Objections close {{ fmtDate(noticeByCase[p.id]!.objection_period_end) }}
                <template v-if="(daysLeft(noticeByCase[p.id]!.objection_period_end) ?? -1) >= 0">
                  ({{ daysLeft(noticeByCase[p.id]!.objection_period_end) }} days left)
                </template>
              </span>
              <span v-else><Calendar :size="15" /> Objection period dates not yet set by Council</span>
              <span><MessageSquare :size="15" /> {{ objCount(p) }} objection{{ objCount(p) === 1 ? '' : 's' }}</span>
            </div>
            <div class="no-actions">
              <button type="button" class="no-btn primary" :aria-expanded="expanded.has(p.id)" @click="toggle(p.id)">
                {{ expanded.has(p.id) ? 'Hide details' : 'Duties and objections' }}
                <ChevronDown :size="16" :class="{ flip: expanded.has(p.id) }" />
              </button>
            </div>

            <div v-if="expanded.has(p.id)" class="no-detail">
              <h4>Your notification duties</h4>
              <ul class="no-duties">
                <li v-for="d in duties(p)" :key="d.label" :class="{ done: d.done }">
                  <CheckCircle2 v-if="d.done" :size="15" />
                  <Circle v-else :size="15" />
                  <span>
                    {{ d.label }}
                    <em v-if="d.done">Confirmed by Council {{ fmtDate(d.when) }}<template v-if="d.detail"> · {{ d.detail }}</template></em>
                    <em v-else>Not yet confirmed — bring proof (newspaper cutting, photo, postal slips) to the Planning Clerk.</em>
                  </span>
                </li>
              </ul>
              <p v-if="noticeByCase[p.id]?.notes" class="no-note">{{ noticeByCase[p.id]!.notes }}</p>

              <h4>Objections on file</h4>
              <div v-if="!objCount(p)" class="no-empty-line">No objections received.</div>
              <ul v-else class="no-obj-list">
                <li v-for="o in objectionsByCase[p.id]" :key="o.id">
                  <div class="no-obj-head">
                    <strong>{{ o.objector_name }}</strong>
                    <span class="muted">{{ fmtDate(o.received_at) }}</span>
                    <span v-if="o.resolved_at" class="pill pill-green sm">Considered {{ fmtDate(o.resolved_at) }}</span>
                  </div>
                  <p class="no-obj-grounds">{{ o.grounds }}</p>
                  <p v-if="o.resolution" class="no-resolution"><strong>Council’s note:</strong> {{ o.resolution }}</p>
                  <div v-if="!o.resolved_at" class="no-response">
                    <p>Answer in writing within 14 days. Upload a signed letter (PDF or photo) addressing each point.</p>
                    <label class="no-btn primary" :class="{ busy: uploadingFor === o.id }">
                      <Upload :size="14" /> {{ uploadingFor === o.id ? 'Uploading…' : 'Upload written response' }}
                      <input type="file" class="sr-only" :disabled="uploadingFor === o.id"
                             accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                             @change="uploadResponse(p.id, o, $event)" />
                    </label>
                  </div>
                </li>
              </ul>
            </div>
          </article>
        </div>
      </div>

      <!-- Sidebar -->
      <aside class="no-side">
        <div class="cp-card">
          <div class="cp-card-head"><AlertTriangle :size="16" class="ic-pri" /><h3>What the Act requires</h3></div>
          <ul class="no-side-duties">
            <li>Publish the notice in a newspaper circulating in the area.</li>
            <li>Post it on the site where the public can read it.</li>
            <li>Notify every abutting owner by registered post.</li>
            <li>Answer each objection in writing within 14 days.</li>
          </ul>
        </div>

        <div class="cp-card no-links">
          <div class="cp-card-head"><h3>Help</h3></div>
          <button type="button" class="no-link" @click="emit('open-section', 'reference')">
            Section 26(3) guidance <ChevronRight :size="15" />
          </button>
          <button type="button" class="no-link" @click="router.push('/contact')">
            Contact the Planning Clerk <ChevronRight :size="15" />
          </button>
        </div>
      </aside>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.no { padding:1rem; max-width:1200px; margin:0 auto; width:100%; }
.mono { font-family:var(--cp-mono); }
.muted { color:var(--cp-muted); }

.no-grid { display:flex; flex-direction:column; gap:1.25rem; }
.no-feed { display:flex; flex-direction:column; gap:1rem; min-width:0; }

.no-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
.no-header h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.no-header p { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); }
.no-refresh { background:none; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.4rem; color:var(--cp-muted); cursor:pointer; }
.spin { animation: nospin 0.8s linear infinite; }
@keyframes nospin { to { transform: rotate(360deg); } }

.no-search { display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.8rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); }
.no-search :deep(svg) { color:var(--cp-faint); }
.no-search:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.no-search input { flex:1; border:0; outline:none; background:transparent; font-size:0.85rem; color:var(--cp-text); }

.no-chips { display:flex; gap:0.4rem; overflow-x:auto; }
.no-chips button { padding:0.35rem 0.9rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-pill);
  background:var(--cp-surface); font-size:0.76rem; font-weight:600; color:var(--cp-text-2); cursor:pointer; white-space:nowrap; }
.no-chips button.active { background:var(--cp-primary); color:var(--cp-on-primary); border-color:var(--cp-primary); }

.pill { display:inline-flex; align-items:center; padding:0.15rem 0.55rem; border-radius:var(--cp-radius-pill);
  font-size:0.62rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; white-space:nowrap; }
.pill.sm { font-size:0.56rem; }
.pill-blue  { background:var(--cp-blue-bg);  color:var(--cp-blue-fg); }
.pill-green { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.pill-amber { background:var(--cp-amber-bg); color:var(--cp-amber-fg); }

.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; gap:0.5rem; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head h3 { margin:0; font-size:0.92rem; font-weight:600; color:var(--cp-text); }
.cp-card-head .ic-pri { color:var(--cp-primary); }

.no-empty { padding:3rem 1.5rem; text-align:center; display:flex; flex-direction:column; align-items:center; gap:0.5rem; }
.no-empty :deep(svg) { color:var(--cp-faint); }
.no-empty h3 { margin:0; font-size:1rem; color:var(--cp-text); }
.no-empty p { margin:0; max-width:32rem; font-size:0.84rem; color:var(--cp-text-2); }
.no-empty-line { padding:0.85rem; text-align:center; color:var(--cp-faint); font-size:0.78rem; background:var(--cp-surface-2); border-radius:var(--cp-radius-sm); }

.no-list { display:flex; flex-direction:column; gap:0.85rem; }
.no-card { background:var(--cp-surface); border:1px solid var(--cp-border);
  border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); padding:1.1rem; }
.no-card.urgent { border-color:var(--cp-amber-fg); }
.no-card-top { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; margin-bottom:0.5rem; }
.no-ref { font-size:0.72rem; color:var(--cp-muted); }
.no-title { margin:0; font-size:1.02rem; font-weight:600; color:var(--cp-text); }
.no-meta { display:flex; flex-wrap:wrap; gap:1rem; margin:0.5rem 0 0.85rem; }
.no-meta span { display:inline-flex; align-items:center; gap:0.35rem; font-size:0.78rem; color:var(--cp-muted); }
.no-actions { display:flex; gap:0.5rem; }
.no-btn { display:inline-flex; align-items:center; gap:0.4rem; padding:0.45rem 0.9rem; border:1px solid transparent;
  border-radius:var(--cp-radius-sm); font-size:0.8rem; font-weight:600; cursor:pointer; }
.no-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.no-btn.primary:hover { background:var(--cp-primary-hover); }
.no-btn.busy { opacity:0.6; cursor:default; }
.no-btn:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.no-btn :deep(svg.flip) { transform:rotate(180deg); }

.no-detail { margin-top:1rem; padding-top:1rem; border-top:1px solid var(--cp-border); }
.no-detail h4 { margin:0 0 0.5rem; font-size:0.66rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.no-detail h4:not(:first-child) { margin-top:1.1rem; }
.no-duties { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.55rem; }
.no-duties li { display:flex; align-items:flex-start; gap:0.5rem; font-size:0.84rem; color:var(--cp-text); }
.no-duties li :deep(svg) { color:var(--cp-faint); flex-shrink:0; margin-top:0.15rem; }
.no-duties li.done :deep(svg) { color:var(--cp-green-fg); }
.no-duties em { display:block; font-style:normal; font-size:0.74rem; color:var(--cp-muted); margin-top:0.1rem; }
.no-note { margin:0.75rem 0 0; font-size:0.8rem; color:var(--cp-text-2); }
.no-obj-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.6rem; }
.no-obj-list li { padding:0.75rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface-2); }
.no-obj-head { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
.no-obj-head strong { font-size:0.82rem; color:var(--cp-text); }
.no-obj-grounds { margin:0.35rem 0; font-size:0.8rem; color:var(--cp-text-2); line-height:1.5; }
.no-response { display:flex; flex-direction:column; align-items:flex-start; gap:0.5rem; margin-top:0.5rem; }
.no-response p { margin:0; font-size:0.76rem; color:var(--cp-muted); }
.no-resolution { margin:0.5rem 0 0; padding:0.55rem 0.7rem; font-size:0.78rem; color:var(--cp-text);
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); }

.no-side { display:flex; flex-direction:column; gap:1rem; }
.no-side-duties { margin:0; padding:1rem 1.1rem 1rem 2.2rem; display:flex; flex-direction:column; gap:0.55rem;
  font-size:0.82rem; color:var(--cp-text-2); line-height:1.45; }
.no-links { padding-bottom:0.4rem; }
.no-link { display:flex; align-items:center; justify-content:space-between; width:100%; padding:0.6rem 1.1rem; border:0;
  background:none; font-size:0.82rem; color:var(--cp-text-2); cursor:pointer; }
.no-link:hover { color:var(--cp-primary); background:var(--cp-surface-2); }

@media (min-width: 1024px) {
  .no { padding:1.5rem; }
  .no-grid { display:grid; grid-template-columns:2fr 1fr; align-items:start; }
}
</style>
