<template>
  <div class="rcpt-root">
    <div class="rcpt-bg"></div>

    <header class="rcpt-topbar">
      <div class="rcpt-topbar-inner">
        <button class="rcpt-back" @click="router.back()"><ArrowLeft :size="15"/> Back</button>
        <span class="rcpt-topbar-title">Official Payment Receipt</span>
        <button class="rcpt-print-btn" @click="printReceipt"><Printer :size="15"/> Print / Save PDF</button>
      </div>
    </header>

    <div v-if="loading" class="rcpt-state">
      <div class="rcpt-spinner"></div>
      <p>Loading receipt…</p>
    </div>

    <div v-else-if="!tx" class="rcpt-state">
      <AlertCircle :size="40" class="rcpt-err-icon"/>
      <h2>Receipt Not Found</h2>
      <p>The payment reference could not be located.</p>
      <button class="rcpt-btn-primary" @click="router.push('/portal')">My Applications</button>
    </div>

    <div v-else class="rcpt-document" id="rcpt-print-area">

      <CouncilLetterhead
        doc-type="OFFICIAL RECEIPT"
        :reference="tx.receipt_no || tx.ref_no"
        class="rcpt-letterhead"
      />

      <div class="rcpt-rule-gold"></div>

      <div class="rcpt-stamp-row">
        <div :class="['rcpt-stamp', tx.status === 'paid' ? 'stamp-paid' : 'stamp-pending']">
          {{ tx.status === 'paid' ? 'PAID' : 'PENDING' }}
        </div>
      </div>

      <div class="rcpt-section">
        <h3 class="rcpt-sh">Payment Details</h3>
        <table class="rcpt-tbl">
          <tr><td>Receipt Number</td><td><strong>{{ tx.receipt_no || '—' }}</strong></td></tr>
          <tr><td>Payment Reference</td><td><strong>{{ tx.ref_no }}</strong></td></tr>
          <tr><td>Service</td><td>{{ tx.service_name }}</td></tr>
          <tr><td>Payment Method</td><td>{{ methodLabel(tx.method) }}</td></tr>
          <tr v-if="tx.phone"><td>Mobile Number</td><td>{{ tx.phone }}</td></tr>
          <tr v-if="tx.paynow_ref"><td>Paynow Reference</td><td>{{ tx.paynow_ref }}</td></tr>
          <tr><td>Date Paid</td><td>{{ fmtDate(tx.paid_at) }}</td></tr>
        </table>
      </div>

      <div class="rcpt-amount-box">
        <span class="rcpt-al">Total Amount Paid</span>
        <span class="rcpt-av">
          <span v-if="Number(tx.amount_usd) === 0" class="rcpt-free">NIL — Free Service</span>
          <template v-else>USD <strong>{{ Number(tx.amount_paid || tx.amount_usd).toFixed(2) }}</strong></template>
        </span>
      </div>

      <div v-if="tx.citizen_name" class="rcpt-section">
        <h3 class="rcpt-sh">Received From</h3>
        <table class="rcpt-tbl">
          <tr><td>Name</td><td>{{ tx.citizen_name }}</td></tr>
          <tr v-if="tx.citizen_email"><td>Email</td><td>{{ tx.citizen_email }}</td></tr>
        </table>
      </div>

      <div class="rcpt-footer">
        <div class="rcpt-footer-rule"></div>
        <p class="rcpt-footer-text">
          This is an official computer-generated receipt issued by Vungu Rural District Council.
          No signature is required. For queries contact the Revenue Department at
          <strong>revenue@vungu.gov.zw</strong> quoting receipt <strong>{{ tx.receipt_no || tx.ref_no }}</strong>.
        </p>
        <div class="rcpt-footer-badges">
          <span>🔒 Digitally Verified</span>
          <span>🏛️ Vungu RDC Official</span>
          <span>📅 {{ new Date().getFullYear() }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ArrowLeft, Printer, AlertCircle } from 'lucide-vue-next'
import { paymentsApi } from '../services/api'
import CouncilLetterhead from '@/components/documents/CouncilLetterhead.vue'

const router  = useRouter()
const route   = useRoute()
const refNo   = computed(() => route.params.refNo as string)
const tx      = ref<any>(null)
const loading = ref(true)

const METHODS: Record<string,string> = {
  ecocash:'EcoCash', onemoney:'OneMoney', zimswitch:'ZimSwitch',
  bank_transfer:'Bank Transfer (CBZ)', cash:'Cash', waived:'Waived', free:'Free Service',
}
const methodLabel = (m?: string) => METHODS[m ?? ''] ?? m ?? '—'
const fmtDate = (d?: string) => d
  ? new Date(d).toLocaleString('en-ZW', { dateStyle:'long', timeStyle:'short' })
  : '—'

function printReceipt() {
  window.print()
}

async function loadReceipt() {
  try {
    const res = await paymentsApi.getReceipt(refNo.value)
    tx.value = res.data?.data
  } catch {
    try {
      const res = await paymentsApi.getStatus(refNo.value)
      tx.value = res.data?.data
    } catch { /* not found */ }
  } finally {
    loading.value = false
  }
}

onMounted(loadReceipt)
</script>

<style scoped>
/* Playfair Display + DM Sans are self-hosted via the global /fonts/webfonts/fonts.css
   loaded in index.html — no external font requests. */
*{box-sizing:border-box;margin:0;padding:0}
.rcpt-root{min-height:var(--ent-vh);background:#f5f0e8;font-family:'DM Sans',sans-serif;color:#1a1a1a}
.rcpt-bg{position:fixed;inset:0;background:linear-gradient(160deg,#f5f0e8,#ede5d0);z-index:0}
.rcpt-topbar{position:relative;z-index:10;background:#1a3d2b;padding:.85rem 1.5rem}
.rcpt-topbar-inner{max-width:780px;margin:0 auto;display:flex;align-items:center;gap:1rem}
.rcpt-back{display:flex;align-items:center;gap:.35rem;background:none;border:1px solid rgba(255,255,255,.25);color:#a8c4b0;padding:.38rem .8rem;border-radius:6px;font-size:.78rem;cursor:pointer;font-family:inherit;transition:all .2s}
.rcpt-back:hover{border-color:#c9a84c;color:#c9a84c}
.rcpt-topbar-title{flex:1;text-align:center;font-family:'Playfair Display',serif;font-size:.92rem;color:#e8f0ea}
.rcpt-print-btn{display:flex;align-items:center;gap:.35rem;background:linear-gradient(135deg,#c9a84c,#a8882e);color:#0d1f16;border:none;padding:.38rem .9rem;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit}
.rcpt-print-btn:hover{filter:brightness(1.1)}
.rcpt-state{position:relative;z-index:10;text-align:center;padding:4rem 2rem;color:#5a7a65}
.rcpt-state p{margin-top:.6rem;font-size:.88rem;color:#6b7280}
.rcpt-state h2{font-family:'Playfair Display',serif;font-size:1.5rem;color:#1a3d2b;margin:.5rem 0}
.rcpt-err-icon{color:#f87171;margin-bottom:.5rem}
.rcpt-spinner{width:34px;height:34px;margin:0 auto 1rem;border:3px solid rgba(26,61,43,.15);border-top-color:#1a3d2b;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.rcpt-btn-primary{margin-top:1rem;background:#1a3d2b;color:#e8f0ea;border:none;padding:.7rem 1.4rem;border-radius:8px;font-family:inherit;font-size:.88rem;cursor:pointer}
.rcpt-document{position:relative;z-index:10;max-width:720px;margin:2rem auto 3rem;background:#fff;border:1px solid #d9c89a;border-radius:3px;box-shadow:0 4px 30px rgba(26,61,43,.12);padding:3rem 3.5rem}
/* Map the receipt's palette onto the shared letterhead's theming hooks. The
   component is scoped, so these rules cannot reach inside it directly. */
.rcpt-letterhead{
  margin-bottom:1.5rem;
  --lh-name-color: var(--stitch-primary);
  --lh-ref-color: var(--stitch-primary);
  --lh-sub-color: var(--stitch-on-surface-muted);
  --lh-doctype-color: var(--stitch-secondary);
  /* The Stitch pass set the council name in Public Sans, and the receipt
     number is the most-scanned datum on the page — both were lost when this
     became a scoped component. */
  --lh-name-font: 'Public Sans', system-ui, sans-serif;
  --lh-ref-size: 1.15rem;
}
.rcpt-rule-gold{height:3px;background:linear-gradient(90deg,#1a3d2b,#c9a84c,#1a3d2b);margin-bottom:1.5rem;border-radius:2px}
.rcpt-stamp-row{display:flex;justify-content:flex-end;margin-bottom:1.25rem}
.rcpt-stamp{display:inline-block;padding:.3rem 1rem;border-radius:2px;font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;transform:rotate(-2deg)}
.stamp-paid{border:2px solid #16a34a;color:#16a34a}
.stamp-pending{border:2px solid #d97706;color:#d97706}
.rcpt-section{margin-bottom:1.75rem}
.rcpt-sh{font-family:'Playfair Display',serif;font-size:.84rem;color:#1a3d2b;border-bottom:1px solid #e5d9b0;padding-bottom:.35rem;margin-bottom:.7rem;text-transform:uppercase;letter-spacing:.06em}
.rcpt-tbl{width:100%;border-collapse:collapse}
.rcpt-tbl td{padding:.42rem .5rem;font-size:.83rem;border-bottom:1px solid #f0e8d0;vertical-align:top}
.rcpt-tbl td:first-child{color:#6b7280;width:42%}
.rcpt-tbl td:last-child{color:#1a1a1a}
.rcpt-tbl tr:last-child td{border-bottom:none}
.rcpt-amount-box{background:#f5f0e0;border:1px solid #d9c89a;border-radius:3px;padding:.9rem 1.2rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.75rem}
.rcpt-al{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#5a7a65;font-weight:600}
.rcpt-av{font-size:1.25rem;color:#1a3d2b}
.rcpt-av strong{font-family:'Playfair Display',serif;font-size:1.5rem}
.rcpt-free{color:#16a34a;font-size:.95rem;font-style:italic}
.rcpt-footer{margin-top:2rem}
.rcpt-footer-rule{height:1px;background:#e5d9b0;margin-bottom:.9rem}
.rcpt-footer-text{font-size:.7rem;color:#9ca3af;line-height:1.7}
.rcpt-footer-badges{display:flex;gap:1.5rem;margin-top:.7rem;font-size:.66rem;color:#9ca3af}
@media print{
  .rcpt-topbar{display:none !important}
  .rcpt-root,.rcpt-bg{background:#fff}
  .rcpt-bg{display:none}
  .rcpt-document{box-shadow:none;border:none;margin:0;max-width:100%;padding:1.5cm}
}
@media(max-width:600px){
  .rcpt-document{padding:1.5rem;margin:1rem}
  .rcpt-footer-badges{flex-wrap:wrap;gap:.5rem}
}

/* Stitch receipt refresh */
.rcpt-root {
  background: var(--stitch-surface);
  color: var(--stitch-on-surface);
  font-family: 'Public Sans', system-ui, sans-serif;
}
.rcpt-bg {
  display: none;
}
.rcpt-topbar {
  background: #fff;
  border-bottom: 1px solid rgba(196, 198, 207, 0.75);
  box-shadow: var(--stitch-shadow-soft);
}
.rcpt-topbar-inner {
  max-width: 920px;
}
.rcpt-back,
.rcpt-print-btn {
  background: var(--stitch-surface-low);
  border: 1px solid rgba(196, 198, 207, 0.75);
  color: var(--stitch-primary);
  border-radius: var(--stitch-radius-lg);
}
.rcpt-print-btn {
  background: var(--stitch-primary);
  color: #fff;
  border-color: var(--stitch-primary);
}
.rcpt-topbar-title,
.rcpt-state h2,
.rcpt-sh,
.rcpt-av {
  color: var(--stitch-primary);
  font-family: 'Public Sans', system-ui, sans-serif;
}
.rcpt-state,
.rcpt-state p,
.rcpt-tbl td:first-child,
.rcpt-al,
.rcpt-footer-text,
.rcpt-footer-badges {
  color: var(--stitch-on-surface-muted);
}
.rcpt-document {
  border: 1px solid rgba(196, 198, 207, 0.75);
  border-radius: var(--stitch-radius-xl);
  box-shadow: var(--stitch-shadow);
}
.rcpt-rule-gold {
  background: linear-gradient(90deg, var(--stitch-primary), var(--stitch-secondary), var(--stitch-primary));
}
.stamp-paid {
  border-color: var(--stitch-secondary);
  color: var(--stitch-secondary);
}
.stamp-pending {
  border-color: #b7791f;
  color: #875a00;
}
.rcpt-sh,
.rcpt-tbl td,
.rcpt-footer-rule {
  border-color: rgba(196, 198, 207, 0.65);
}
.rcpt-amount-box {
  background: var(--stitch-surface-low);
  border-color: rgba(196, 198, 207, 0.75);
  border-radius: var(--stitch-radius-lg);
}
.rcpt-free {
  color: var(--stitch-secondary);
}
.rcpt-btn-primary {
  background: var(--stitch-primary);
  color: #fff;
  border-radius: var(--stitch-radius-lg);
}
</style>
