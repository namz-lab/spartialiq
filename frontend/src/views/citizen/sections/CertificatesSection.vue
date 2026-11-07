<script setup lang="ts">
// Certificates — registry of the Certificate of Occupation (Annexure 13)
// for each construction case. Layout matches the Stitch "Certificates"
// design: filters + stat bento + a registry table (desktop) / cards
// (mobile) + verification-info and new-application CTA cards. The
// Building Inspector issues each certificate after the joint Stage 9
// inspection with the EHO + Plumber.

import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useCitizenCase } from '@/composables/useCitizenCase'
import { dmApi, type OccupationCertificate } from '@/services/developmentManagementService'
import { isPermitApproved } from '@/composables/useApplicationPipeline'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import {
  BadgeCheck, RefreshCw, Search, MapPin, Info, Printer, ArrowRight,
} from 'lucide-vue-next'

const cc = useCitizenCase()
const fb = useUiFeedback()
const emit = defineEmits<{ 'open-section': [key: 'new'] }>()

const certByCase = ref<Record<string, OccupationCertificate | null>>({})
const loading = ref(false)

const constructionCases = computed(() =>
  cc.applications.value.filter(p => isPermitApproved(p.status)))

async function refresh() {
  loading.value = true
  try {
    for (const p of constructionCases.value) {
      try {
        certByCase.value[p.id] = p.has_occupation_certificate
          ? await dmApi.getCertificate(p.id)
          : null
      } catch { certByCase.value[p.id] = null }
    }
  } finally {
    loading.value = false
  }
}
onMounted(refresh)
watch(() => cc.applications.value.length, refresh)

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

interface Row {
  id: string; certNo: string; address: string; owner: string;
  type: string; issuedAt: string | null; issued: boolean;
  permitId: string; cert: OccupationCertificate | null; devType: string;
}
const rows = computed<Row[]>(() => constructionCases.value.map(p => {
  const cert = certByCase.value[p.id] || null
  return {
    permitId: p.id,
    id: cert?.certificate_no || p.dev_register_no || p.id.slice(0, 12),
    certNo: cert?.certificate_no || ('PEND-' + (p.dev_register_no || p.id.slice(0, 8))),
    address: `Stand ${p.stand_number}, ${p.suburb_ward}`,
    owner: p.applicant_name || '—',
    type: 'Certificate of Occupation',
    issuedAt: cert?.issued_at || null,
    issued: !!cert,
    cert,
    devType: p.development_type || 'residential',
  }
}))

const search = ref('')
const statusFilter = ref<'all' | 'issued' | 'pending'>('all')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(r => {
    if (statusFilter.value === 'issued' && !r.issued) return false
    if (statusFilter.value === 'pending' && r.issued) return false
    if (!q) return true
    return r.certNo.toLowerCase().includes(q) || r.address.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)
  })
})

const stats = computed(() => {
  const issued = rows.value.filter(r => r.issued)
  return {
    total: issued.length,
    pending: rows.value.filter(r => !r.issued).length,
  }
})

// Print a single certificate (preserves the legal document output).
const printId = ref<string | null>(null)
const printRow = computed(() => rows.value.find(r => r.permitId === printId.value) || null)
async function printCert(r: Row) {
  if (!r.issued) return
  printId.value = r.permitId
  await nextTick()
  window.print()
}
function startNew() {
  emit('open-section', 'new')
}
</script>

<template>
  <div class="cert">
    <!-- Header -->
    <header class="cert-header">
      <div>
        <h1>Certificates</h1>
        <p>Your registry of occupation and compliance certificates issued by Vungu RDC.
          <template v-if="rows.length"> {{ stats.total }} issued, {{ stats.pending }} pending.</template>
        </p>
      </div>
      <button class="cert-refresh" @click="refresh" :disabled="loading" title="Refresh">
        <RefreshCw :size="16" :class="{ spin: loading }" />
      </button>
    </header>

    <!-- Filters -->
    <div class="cert-filters">
      <div class="cert-search">
        <Search :size="18" />
        <input v-model="search" type="text" placeholder="Search by certificate ID or address…" />
      </div>
      <label class="sr-only" for="cert-status">Status</label>
      <select id="cert-status" v-model="statusFilter" class="cert-status">
        <option value="all">All</option>
        <option value="issued">Issued</option>
        <option value="pending">Pending</option>
      </select>
    </div>

    <!-- Empty -->
    <div v-if="!rows.length" class="cp-card cert-empty">
      <BadgeCheck :size="26" />
      <h3>No certificates yet</h3>
      <p>A certificate of occupation is issued after all nine inspection stages pass. Track inspections from that tab once a permit is issued.</p>
    </div>

    <template v-else>
      <!-- Desktop table -->
      <div class="cp-card cert-table-wrap">
        <table class="cert-table">
          <thead>
            <tr><th>Certificate ID</th><th>Type</th><th>Property address</th><th>Date issued</th><th>Status</th><th class="right">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.permitId">
              <td class="mono strong">{{ r.certNo }}</td>
              <td>{{ r.type }}</td>
              <td class="muted">{{ r.address }}</td>
              <td class="muted">{{ fmtDate(r.issuedAt) }}</td>
              <td>
                <span class="pill" :class="r.issued ? 'pill-blue' : 'pill-amber'">{{ r.issued ? 'Active' : 'Pending' }}</span>
              </td>
              <td class="right">
                <button type="button" class="cert-dl" :disabled="!r.issued" @click="printCert(r)">
                  <Printer :size="16" /> Print
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div class="cert-cards">
        <div v-for="r in filtered" :key="r.permitId" class="cp-card cert-mcard">
          <div class="between">
            <div>
              <h3>{{ r.type }}</h3>
              <p class="cert-mcard-addr"><MapPin :size="16" /> {{ r.address }}</p>
            </div>
            <span class="pill" :class="r.issued ? 'pill-blue' : 'pill-amber'">{{ r.issued ? 'Active' : 'Pending' }}</span>
          </div>
          <div class="cert-mcard-foot">
            <div>
              <p class="cert-stat-l">Issue date</p>
              <p class="mono">{{ fmtDate(r.issuedAt) }}</p>
            </div>
            <button type="button" class="cert-dl" :disabled="!r.issued" @click="printCert(r)">
              <Printer :size="16" /> Print
            </button>
          </div>
        </div>
      </div>

      <!-- Info + CTA -->
      <div class="cert-info-grid">
        <div class="cp-card cert-verify">
          <span class="cert-verify-ic"><Info :size="20" /></span>
          <div>
            <h3>Using your certificate</h3>
            <p>The Building Inspectorate keeps the original record. A printout from this page is your copy;
               for a certified copy (for a transfer or a bank), ask at the council office and quote the certificate number.
               Anyone can confirm a certificate is genuine by quoting that number to the Inspectorate.</p>
          </div>
        </div>
        <div class="cert-cta">
          <div class="cert-cta-body">
            <h3>Another application</h3>
            <p>Submit a new development application when you need a further permit or clearance.</p>
          </div>
          <button class="cert-cta-btn" @click="startNew">Start new application <ArrowRight :size="16" /></button>
        </div>
      </div>
    </template>

    <!-- Printable certificate (visible only when printing) -->
    <div v-if="printRow && printRow.cert" class="cert-print">
      <h2>Certificate of Occupation</h2>
      <p>This is to certify that the building at <strong>{{ printRow.address }}</strong>, of which
        <strong>{{ printRow.owner }}</strong> is the owner, has been inspected and found to comply with the
        Model Building By-Laws and the approved plan.</p>
      <p>The building may be occupied for <strong>{{ printRow.devType }}</strong> purposes from
        <strong>{{ fmtDate(printRow.cert.issued_at) }}</strong>.</p>
      <p v-if="printRow.cert.conditions"><strong>Conditions:</strong> {{ printRow.cert.conditions }}</p>
      <div class="cert-print-foot">
        <div><label>Certificate no.</label><strong>{{ printRow.cert.certificate_no }}</strong></div>
        <div><label>Issuing officer</label><strong>{{ printRow.cert.issued_by || '—' }}</strong></div>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.cert { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:1200px; margin:0 auto; width:100%; }
.mono { font-family:var(--cp-mono); }
.muted { color:var(--cp-muted); }

.cert-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
.cert-header h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.cert-header p { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); }
.cert-refresh { background:none; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.4rem; color:var(--cp-muted); cursor:pointer; }
.spin { animation: certspin 0.8s linear infinite; }
@keyframes certspin { to { transform: rotate(360deg); } }

/* Filters */
.cert-filters { display:flex; gap:0.5rem; }
.cert-search { flex:1; display:flex; align-items:center; gap:0.5rem; padding:0.45rem 0.75rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); }
.cert-search :deep(svg) { color:var(--cp-faint); flex-shrink:0; }
.cert-search:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.cert-search input { flex:1; border:0; outline:none; background:transparent; font-size:0.85rem; color:var(--cp-text); }
.cert-status { flex-shrink:0; padding:0 0.6rem; background:var(--cp-surface); border:1px solid var(--cp-border);
  border-radius:var(--cp-radius-sm); color:var(--cp-text); font-size:0.82rem; }

/* Stats leftover from the bento tiles — labels still used on mobile cards */
.cert-stat-l { margin:0 0 0.4rem; font-size:0.66rem; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; color:var(--cp-muted); }

/* Cards / pills */
.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.pill { display:inline-flex; align-items:center; padding:0.15rem 0.55rem; border-radius:var(--cp-radius-pill);
  font-size:0.64rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; white-space:nowrap; }
.pill-blue  { background:var(--cp-blue-bg);  color:var(--cp-blue-fg); }
.pill-amber { background:var(--cp-amber-bg); color:var(--cp-amber-fg); }

.cert-empty { padding:3rem 1.5rem; text-align:center; display:flex; flex-direction:column; align-items:center; gap:0.5rem; }
.cert-empty :deep(svg) { color:var(--cp-faint); }
.cert-empty h3 { margin:0; font-size:1rem; color:var(--cp-text); }
.cert-empty p { margin:0; max-width:32rem; font-size:0.84rem; color:var(--cp-text-2); }

/* Buttons in rows */
.cert-dl { display:inline-flex; align-items:center; gap:0.35rem; padding:0.4rem 0.75rem;
  background:var(--cp-primary); color:var(--cp-on-primary); border:0; border-radius:var(--cp-radius-sm);
  font-size:0.78rem; font-weight:600; cursor:pointer; }
.cert-dl:hover:not(:disabled) { background:var(--cp-primary-hover); }
.cert-dl:disabled { background:var(--cp-border-strong); cursor:not-allowed; }

/* Table */
.cert-table-wrap { display:none; }
.cert-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
.cert-table th, .cert-table td { padding:0.7rem 1rem; text-align:left; border-bottom:1px solid var(--cp-border); vertical-align:middle; }
.cert-table th { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--cp-muted); background:var(--cp-surface-2); }
.cert-table tbody tr:last-child td { border-bottom:0; }
.cert-table tbody tr:hover { background:var(--cp-surface-2); }
.cert-table .right { text-align:right; white-space:nowrap; }
.cert-table .strong { font-weight:700; color:var(--cp-text); }

/* Mobile cards */
.cert-cards { display:flex; flex-direction:column; gap:0.75rem; }
.cert-mcard { padding:1rem; }
.between { display:flex; align-items:flex-start; justify-content:space-between; gap:0.5rem; }
.cert-mcard h3 { margin:0; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.cert-mcard-addr { display:flex; align-items:center; gap:0.3rem; margin:0.3rem 0 0; font-size:0.8rem; color:var(--cp-muted); }
.cert-mcard-foot { display:flex; align-items:flex-end; justify-content:space-between; margin-top:0.85rem; padding-top:0.75rem; border-top:1px solid var(--cp-border); }

/* Info + CTA */
.cert-info-grid { display:flex; flex-direction:column; gap:1rem; }
.cert-verify { display:flex; gap:1rem; padding:1.25rem; }
.cert-verify-ic { display:inline-flex; align-items:center; justify-content:center; width:42px; height:42px; flex-shrink:0;
  border-radius:var(--cp-radius-pill); background:var(--cp-primary-tint); color:var(--cp-primary); }
.cert-verify h3 { margin:0 0 0.4rem; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.cert-verify p { margin:0 0 0.75rem; font-size:0.82rem; color:var(--cp-text-2); line-height:1.55; }
.cert-verify-badges { display:flex; flex-wrap:wrap; gap:1rem; }
.cert-verify-badges span { display:inline-flex; align-items:center; gap:0.35rem; font-size:0.78rem; color:var(--cp-text); }
.cert-verify-badges :deep(svg) { color:var(--cp-primary); }
.cert-cta { display:flex; flex-direction:column; justify-content:space-between; gap:1rem;
  padding:1.25rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius); background:var(--cp-surface); }
.cert-cta-body { }
.cert-cta h3 { margin:0 0 0.35rem; font-size:1rem; font-weight:600; color:var(--cp-text); }
.cert-cta p { margin:0; font-size:0.82rem; line-height:1.5; color:var(--cp-text-2); }
.cert-cta-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem;
  padding:0.65rem; background:var(--cp-primary); color:var(--cp-on-primary); border:0; border-radius:var(--cp-radius-sm); font-size:0.85rem; font-weight:600; cursor:pointer; }
.cert-cta-btn:hover { background:var(--cp-primary-hover); }

/* Printable certificate */
.cert-print { display:none; }

@media (min-width: 1024px) {
  .cert { padding:1.5rem; }
  .cert-table-wrap { display:block; }
  .cert-cards { display:none; }
  .cert-info-grid { display:grid; grid-template-columns:2fr 1fr; align-items:stretch; }
}

@media print {
  .cert > *:not(.cert-print) { display:none !important; }
  .cert-print { display:block !important; position:absolute; inset:0; padding:2rem; }
  .cert-print h2 { font-size:1.4rem; margin-bottom:1rem; }
  .cert-print p { font-size:0.95rem; line-height:1.7; margin:0.6rem 0; }
  .cert-print-foot { display:flex; gap:3rem; margin-top:2rem; padding-top:1rem; border-top:1px solid #000; }
  .cert-print-foot label { display:block; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; }
  .cert-print-foot strong { font-family:monospace; }
}
</style>
