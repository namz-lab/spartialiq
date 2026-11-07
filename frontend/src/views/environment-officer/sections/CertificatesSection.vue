<script setup lang="ts">
// Certificates — the documents the EHO issues directly.
//
//   Food handlers   health certificates for named handlers at a premises
//   Fitness         premises certificate of fitness (food premises, crèches, schools)
//   Burial          burial, exhumation and reburial permits
//
// Food-handler certificates and burial permits live on the server (migration
// 122) and are online-only: a document the council has not recorded must never
// look issued, and a certificate produced in the field has to be verifiable.
// That is also why this section has a Verify box — an officer checking a
// handler's certificate on site searches by national ID or reference.
//
// Nothing is deleted. A certificate is revoked and a permit cancelled, each
// with its reason, because "issued then withdrawn" and "never issued" are
// different facts.
//
// URL: ?tab=handlers|fitness|burial

import { computed, ref, watch } from 'vue'
import { useHealthCase, isServerId, type PremisesRecord } from '@/composables/useHealthCase'
import {
  ehoOpsApi, type FoodHandlerCertificate, type BurialPermit, type BurialPermitKind,
} from '@/services/environmentalHealthOps'
import { useAuthStore } from '@/stores/auth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { useEhoPreferences } from '@/environment-officer/useEhoPreferences'
import { councilDoc, rows, signatures, footer } from '@/environment-officer/documents'
import { daysSince, daysUntil, fmtDate, fmtDateTime, humanise, isoDay, wardLabel } from '@/environment-officer/console'
import { isNationalId, isPersonName, isZwPhone, sanitizePhone } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  IdCard, Building, Cross, Plus, Search, Printer, Ban, CloudOff, RefreshCw, ShieldCheck, AlertTriangle,
} from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const nav = useEhoNav()
const auth = useAuthStore()
const { prefs } = useEhoPreferences()

type Tab = 'handlers' | 'fitness' | 'burial'
const tab = computed<Tab>(() => {
  const t = nav.param('tab')
  return t === 'fitness' || t === 'burial' ? t : 'handlers'
})
function setTab(t: Tab) { nav.setParam('tab', t === 'handlers' ? null : t) }

const syncedPremises = computed(() => hc.registry.value.filter(p => isServerId(p.id)).sort((a, b) => a.name.localeCompare(b.name)))
const saving = ref(false)

// ══ FOOD HANDLERS ════════════════════════════════════════════════════
const handlers = ref<FoodHandlerCertificate[]>([])
const hLoading = ref(true)
const hError = ref<string | null>(null)
async function loadHandlers() {
  hLoading.value = true
  hError.value = null
  try { handlers.value = await ehoOpsApi.listFoodHandlers({ include_revoked: true, limit: 500 }) }
  catch (err: unknown) { hError.value = fb.parseApiError(err, 'Certificates could not be loaded.') }
  finally { hLoading.value = false }
}

type HState = 'valid' | 'expiring' | 'expired' | 'revoked'
function hState(h: FoodHandlerCertificate): HState {
  if (h.revokedAt) return 'revoked'
  const d = daysUntil(h.expiresAt) ?? 0
  return d < 0 ? 'expired' : d <= 30 ? 'expiring' : 'valid'
}
const H_TONE: Record<HState, 'positive' | 'warning' | 'negative' | 'neutral'> = { valid: 'positive', expiring: 'warning', expired: 'negative', revoked: 'neutral' }
const hFilter = ref<'all' | HState>('all')
const hSearch = ref('')
const hCounts = computed(() => {
  const c = { valid: 0, expiring: 0, expired: 0, revoked: 0 }
  for (const h of handlers.value) c[hState(h)]++
  return c
})
const shownHandlers = computed(() => {
  let arr = handlers.value
  if (hFilter.value !== 'all') arr = arr.filter(h => hState(h) === hFilter.value)
  const q = hSearch.value.trim().toLowerCase().replace(/\s+/g, '')
  if (q) arr = arr.filter(h => `${h.handlerName}${h.handlerIdNumber ?? ''}${h.reference}${h.premisesName ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(q))
  return arr
})
/** A search that looks like an ID or reference is a verification, and gets a verdict. */
const verification = computed(() => {
  const q = hSearch.value.trim()
  if (!/^(FH-|\d{2}-?\d{5,7})/i.test(q)) return null
  const hits = shownHandlers.value
  if (!hits.length) return { tone: 't-negative', text: `No certificate on the council record matches “${q}”.` }
  const valid = hits.filter(h => hState(h) === 'valid' || hState(h) === 'expiring')
  return valid.length
    ? { tone: 't-positive', text: `${valid.length} valid certificate${valid.length === 1 ? '' : 's'} on record for this search.` }
    : { tone: 't-warning', text: 'Certificates exist for this search, but none is currently valid.' }
})

const hOpen = ref(false)
const blankH = () => ({ premisesId: '', handlerName: '', handlerIdNumber: '', medicalClearanceSource: '', months: 12, notes: '' })
const hForm = ref(blankH())
async function issueHandler() {
  const f = hForm.value
  if (!f.premisesId) return fb.showToast('Choose the premises the handler works at.', 'warning')
  if (!isPersonName(f.handlerName)) return fb.showToast('Enter the handler’s full name.', 'warning')
  if (f.handlerIdNumber.trim() && !isNationalId(f.handlerIdNumber)) return fb.showToast('Enter a Zimbabwe national ID, e.g. 12-345678-A-12.', 'warning')
  if (f.medicalClearanceSource.trim().length < 3) return fb.showToast('Record which clinic or doctor cleared the handler — no clearance, no certificate.', 'warning')
  const months = Number(f.months)
  if (!Number.isInteger(months) || months < 1 || months > 24) return fb.showToast('Validity must be 1–24 months.', 'warning')
  const exp = new Date(); exp.setMonth(exp.getMonth() + months)
  saving.value = true
  try {
    const h = await ehoOpsApi.issueFoodHandler({
      premisesId: f.premisesId, handlerName: f.handlerName.trim(),
      handlerIdNumber: f.handlerIdNumber.trim() || null, expiresAt: isoDay(exp),
      medicalClearanceSource: f.medicalClearanceSource.trim(), notes: f.notes.trim() || null,
    })
    handlers.value = [h, ...handlers.value]
    hOpen.value = false
    printHandler(h)
    fb.showToast(`${h.reference} issued, valid to ${fmtDate(h.expiresAt)}.`, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The certificate could not be issued. Nothing was recorded.'), 'error')
  } finally { saving.value = false }
}
function renew(h: FoodHandlerCertificate) {
  hForm.value = { ...blankH(), premisesId: h.premisesId, handlerName: h.handlerName, handlerIdNumber: h.handlerIdNumber ?? '' }
  hOpen.value = true
}

// Revoke / cancel share one reason sheet.
const reasonFor = ref<{ kind: 'handler' | 'burial'; id: string; label: string } | null>(null)
const reason = ref('')
async function submitReason() {
  const r = reasonFor.value
  if (!r) return
  if (reason.value.trim().length < 5) return fb.showToast('Give the reason — it is kept on the record.', 'warning')
  saving.value = true
  try {
    if (r.kind === 'handler') {
      const h = await ehoOpsApi.revokeFoodHandler(r.id, reason.value.trim())
      handlers.value = handlers.value.map(x => (x.id === h.id ? h : x))
      fb.showToast('Certificate revoked.', 'success')
    } else {
      const b = await ehoOpsApi.cancelBurialPermit(r.id, reason.value.trim())
      burials.value = burials.value.map(x => (x.id === b.id ? b : x))
      fb.showToast('Permit cancelled.', 'success')
    }
    reasonFor.value = null
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The change could not be saved.'), 'error')
  } finally { saving.value = false }
}

function printHandler(h: FoodHandlerCertificate) {
  const d = councilDoc('Food-handler health certificate', h.reference)
  rows(d, [
    ['Holder', h.handlerName], ['National ID', h.handlerIdNumber || '—'],
    ['Premises', h.premisesName || '—'], ['Issued', fmtDate(h.issuedAt)], ['Valid until', fmtDate(h.expiresAt)],
    ['Medical clearance', h.medicalClearanceSource],
  ])
  signatures(d, 'Environmental Health Officer')
  footer(d, 'To be produced on request. Verify with the council by reference or national ID.')
  d.doc.save(`${h.reference}.pdf`)
}

// ══ FITNESS ══════════════════════════════════════════════════════════
const fitnessRows = computed(() =>
  hc.registry.value.filter(p => p.fitness_certificate_no)
    .sort((a, b) => (a.fitness_certificate_expiry ?? '').localeCompare(b.fitness_certificate_expiry ?? '')))
const fOpen = ref(false)
const fForm = ref({ premisesId: '', months: 12 })
const fPremises = computed(() => hc.registry.value.find(p => p.id === fForm.value.premisesId) ?? null)
const fEvidence = computed(() => {
  const p = fPremises.value
  if (!p) return null
  const latest = hc.inspections.value.filter(i => i.premisesId === p.id)
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt))[0]
  if (!latest) return { ok: false, text: 'This premises has never been inspected.' }
  const age = daysSince(latest.inspectedAt) ?? 0
  if (latest.verdict !== 'pass') return { ok: false, text: `The latest inspection (${fmtDate(latest.inspectedAt)}) was ${humanise(latest.verdict).toLowerCase()}.` }
  if (age > prefs.value.inspectionCycleDays) return { ok: false, text: `The latest pass was ${age} days ago, outside the ${prefs.value.inspectionCycleDays}-day cycle.` }
  return { ok: true, text: `Passed inspection ${fmtDate(latest.inspectedAt)} (${latest.inspectorName}).` }
})

async function issueFitness() {
  const p = fPremises.value
  if (!p) return fb.showToast('Choose the premises.', 'warning')
  const months = Number(fForm.value.months)
  if (!Number.isInteger(months) || months < 1 || months > 36) return fb.showToast('Validity must be 1–36 months.', 'warning')
  if (fEvidence.value && !fEvidence.value.ok) {
    const ok = await fb.confirmAction('Certify without a current pass?', `${fEvidence.value.text} Issue a certificate of fitness anyway?`, { confirmLabel: 'Issue anyway', danger: true })
    if (!ok) return
  }
  const exp = new Date(); exp.setMonth(exp.getMonth() + months)
  const certNo = `FIT-${new Date().getFullYear()}-${(p.reference?.split('-').pop() ?? Math.random().toString(36).slice(2, 6)).toUpperCase()}`
  hc.upsertPremises({ ...p, fitness_certificate_no: certNo, fitness_certificate_expiry: isoDay(exp) })
  fOpen.value = false
  printFitness({ ...p, fitness_certificate_no: certNo, fitness_certificate_expiry: isoDay(exp) })
  fb.showToast(`Certificate ${certNo} recorded against ${p.name}.`, 'success')
}
function printFitness(p: PremisesRecord) {
  const d = councilDoc('Certificate of fitness', p.fitness_certificate_no || '')
  rows(d, [
    ['Premises', p.name], ['Use', humanise(p.type)],
    ['Location', [p.stand_number && `Stand ${p.stand_number}`, p.suburb_ward].filter(Boolean).join(' · ')],
    ['Operator', p.operator_name || '—'], ['Valid until', fmtDate(p.fitness_certificate_expiry)],
  ])
  signatures(d, 'Environmental Health Officer')
  footer(d, 'Certifies the premises fit for the use stated, under the Public Health Act [Ch. 15:09]. To be displayed on the premises.')
  d.doc.save(`${p.fitness_certificate_no}.pdf`)
}

// ══ BURIAL ═══════════════════════════════════════════════════════════
const burials = ref<BurialPermit[]>([])
const bLoading = ref(true)
const bError = ref<string | null>(null)
const bSearch = ref('')
async function loadBurials() {
  bLoading.value = true
  bError.value = null
  try { burials.value = await ehoOpsApi.listBurialPermits({ limit: 300 }) }
  catch (err: unknown) { bError.value = fb.parseApiError(err, 'Permits could not be loaded.') }
  finally { bLoading.value = false }
}
const shownBurials = computed(() => {
  const q = bSearch.value.trim().toLowerCase()
  return q ? burials.value.filter(b => `${b.deceasedName} ${b.reference} ${b.cemetery}`.toLowerCase().includes(q)) : burials.value
})
const bOpen = ref(false)
const blankB = () => ({
  permitKind: 'burial' as BurialPermitKind, deceasedName: '', deceasedIdNumber: '', dateOfDeath: '', causeOfDeath: '',
  cemetery: '', ward: '', intermentAt: '', applicantName: '', applicantRelation: '', applicantContact: '', issuedByName: auth.userName || '',
})
const bForm = ref(blankB())
async function issueBurial() {
  const f = bForm.value
  if (!isPersonName(f.deceasedName)) return fb.showToast('Enter the deceased’s full name.', 'warning')
  if (!f.dateOfDeath) return fb.showToast('Enter the date of death.', 'warning')
  if (f.dateOfDeath > isoDay()) return fb.showToast('The date of death cannot be in the future.', 'warning')
  if (f.deceasedIdNumber.trim() && !isNationalId(f.deceasedIdNumber)) return fb.showToast('The ID must be a Zimbabwe national ID, or left blank.', 'warning')
  if (!f.cemetery.trim()) return fb.showToast('Name the cemetery.', 'warning')
  if (f.applicantName.trim() && !isPersonName(f.applicantName)) return fb.showToast('Applicant name must be a person’s name.', 'warning')
  if (f.applicantContact.trim() && !isZwPhone(f.applicantContact)) return fb.showToast('Applicant phone must be a Zimbabwe mobile number.', 'warning')
  if (!isPersonName(f.issuedByName)) return fb.showToast('Enter the issuing officer’s name.', 'warning')
  saving.value = true
  try {
    const b = await ehoOpsApi.issueBurialPermit({
      permitKind: f.permitKind, deceasedName: f.deceasedName.trim(), deceasedIdNumber: f.deceasedIdNumber.trim() || null,
      dateOfDeath: f.dateOfDeath, causeOfDeath: f.causeOfDeath.trim() || null, cemetery: f.cemetery.trim(), ward: f.ward.trim() || null,
      intermentAt: f.intermentAt ? new Date(f.intermentAt).toISOString() : null,
      applicantName: f.applicantName.trim() || null, applicantRelation: f.applicantRelation.trim() || null,
      applicantContact: f.applicantContact.trim() ? sanitizePhone(f.applicantContact) : null, issuedByName: f.issuedByName.trim(),
    })
    burials.value = [b, ...burials.value]
    bOpen.value = false
    printBurial(b)
    fb.showToast(`Permit ${b.reference} issued.`, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The permit could not be issued. Nothing was recorded.'), 'error')
  } finally { saving.value = false }
}
function printBurial(b: BurialPermit) {
  const d = councilDoc(`${humanise(b.permitKind)} permit`, `${b.reference} · Public Health Act [Ch. 15:09]`)
  rows(d, [
    ['Deceased', b.deceasedName], ['National ID', b.deceasedIdNumber || '—'], ['Date of death', fmtDate(b.dateOfDeath)],
    ['Cause of death', b.causeOfDeath || 'As on the medical certificate'], ['Cemetery', [b.cemetery, b.ward && wardLabel(b.ward)].filter(Boolean).join(' · ')],
    ['Interment', b.intermentAt ? fmtDateTime(b.intermentAt) : 'Not scheduled'],
    ['Applicant', [b.applicantName, b.applicantRelation && `(${b.applicantRelation})`].filter(Boolean).join(' ') || '—'],
    ['Issued', `${fmtDateTime(b.issuedAt)} by ${b.issuedByName}`],
  ])
  signatures(d, `${b.issuedByName}, Environmental Health Officer`, 'Cemetery keeper (on interment)')
  footer(d, 'To be produced to the cemetery keeper before interment.')
  d.doc.save(`${b.reference}.pdf`)
}

// Load each server list the first time its tab is shown.
const loaded = new Set<Tab>()
watch(tab, (t) => {
  if (loaded.has(t)) return
  loaded.add(t)
  if (t === 'handlers') void loadHandlers()
  if (t === 'burial') void loadBurials()
}, { immediate: true })
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Public Health Act [Ch. 15:09]</span>
        <h2 class="ins-title">Certificates</h2>
        <p class="ins-lede">Issued documents are recorded before they are printed. Nothing is deleted — a certificate is revoked, a permit cancelled, each with its reason.</p>
      </div>
      <div class="ins-actions">
        <UiButton v-if="tab === 'handlers'" variant="primary" @click="hForm = blankH(); hOpen = true"><template #icon><Plus :size="15" /></template>Issue certificate</UiButton>
        <UiButton v-else-if="tab === 'fitness'" variant="primary" @click="fForm = { premisesId: '', months: 12 }; fOpen = true"><template #icon><Plus :size="15" /></template>Certify premises</UiButton>
        <UiButton v-else variant="primary" @click="bForm = blankB(); bOpen = true"><template #icon><Plus :size="15" /></template>Issue permit</UiButton>
      </div>
    </header>

    <div class="ins-seg" role="tablist" aria-label="Certificate registers">
      <button type="button" role="tab" :aria-selected="tab === 'handlers'" @click="setTab('handlers')"><IdCard :size="14" aria-hidden="true" /> Food handlers</button>
      <button type="button" role="tab" :aria-selected="tab === 'fitness'" @click="setTab('fitness')"><Building :size="14" aria-hidden="true" /> Premises fitness</button>
      <button type="button" role="tab" :aria-selected="tab === 'burial'" @click="setTab('burial')"><Cross :size="14" aria-hidden="true" /> Burial permits</button>
    </div>

    <!-- ══ HANDLERS ═════════════════════════════════════════════ -->
    <template v-if="tab === 'handlers'">
      <div class="ec-tools">
        <div class="ins-chips" role="group" aria-label="Show">
          <button type="button" class="ins-chip" :aria-pressed="hFilter === 'all'" @click="hFilter = 'all'">All</button>
          <button type="button" class="ins-chip" :aria-pressed="hFilter === 'valid'" @click="hFilter = 'valid'">Valid<span class="ins-chip-n">{{ hCounts.valid }}</span></button>
          <button type="button" class="ins-chip" :aria-pressed="hFilter === 'expiring'" @click="hFilter = 'expiring'">Expiring 30d<span class="ins-chip-n">{{ hCounts.expiring }}</span></button>
          <button type="button" class="ins-chip" :aria-pressed="hFilter === 'expired'" @click="hFilter = 'expired'">Expired<span class="ins-chip-n">{{ hCounts.expired }}</span></button>
          <button type="button" class="ins-chip" :aria-pressed="hFilter === 'revoked'" @click="hFilter = 'revoked'">Revoked<span class="ins-chip-n">{{ hCounts.revoked }}</span></button>
        </div>
        <label class="ins-search ec-search"><ShieldCheck :size="15" aria-hidden="true" /><span class="ent-sr-only">Search or verify</span>
          <input v-model="hSearch" type="search" placeholder="Verify: national ID or FH- reference, or search a name" /></label>
      </div>
      <p v-if="verification" class="ins-banner" :class="verification.tone">
        <ShieldCheck :size="16" aria-hidden="true" /><span>{{ verification.text }}</span>
      </p>
      <section class="ins-card" aria-label="Food-handler certificates">
        <ul v-if="hLoading" class="ins-rows" aria-busy="true"><li v-for="i in 4" :key="i" class="ins-row"><span class="ins-skel" style="width:60%" /></li></ul>
        <div v-else-if="hError" class="ins-card-body">
          <p class="ins-banner t-negative"><CloudOff :size="16" aria-hidden="true" /><span><strong>{{ hError }}</strong> A certificate cannot be verified until the register loads.</span></p>
          <UiButton size="sm" @click="loadHandlers"><template #icon><RefreshCw :size="14" /></template>Retry</UiButton>
        </div>
        <p v-else-if="!shownHandlers.length" class="ec-empty">{{ handlers.length ? 'No certificates match.' : 'No food-handler certificates have been issued.' }}</p>
        <ul v-else class="ins-rows">
          <li v-for="h in shownHandlers" :key="h.id" class="ins-row ec-row">
            <span class="ins-row-main">
              <span class="ins-row-title">{{ h.handlerName }}</span>
              <span class="ins-row-meta">
                <span class="ins-mono">{{ h.reference }}</span> · {{ h.handlerIdNumber || 'No ID' }} · {{ h.premisesName }}
                · to {{ fmtDate(h.expiresAt) }}<template v-if="h.revokedReason"> · revoked: {{ h.revokedReason }}</template>
              </span>
            </span>
            <UiStatusBadge :tone="H_TONE[hState(h)]" :label="humanise(hState(h))" />
            <div class="ec-actions">
              <button type="button" class="ins-iconbtn" title="Print" @click="printHandler(h)"><Printer :size="14" aria-hidden="true" /><span class="ent-sr-only">Print certificate</span></button>
              <UiButton v-if="hState(h) === 'expiring' || hState(h) === 'expired'" size="sm" @click="renew(h)">Renew</UiButton>
              <button v-if="!h.revokedAt" type="button" class="ins-iconbtn" title="Revoke"
                      @click="reason = ''; reasonFor = { kind: 'handler', id: h.id, label: `${h.reference} · ${h.handlerName}` }">
                <Ban :size="14" aria-hidden="true" /><span class="ent-sr-only">Revoke certificate</span></button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <!-- ══ FITNESS ══════════════════════════════════════════════ -->
    <section v-else-if="tab === 'fitness'" class="ins-card" aria-label="Certificates of fitness">
      <p v-if="!fitnessRows.length" class="ec-empty">No premises holds a certificate of fitness yet.</p>
      <ul v-else class="ins-rows">
        <li v-for="p in fitnessRows" :key="p.id" class="ins-row ec-row">
          <span class="ins-row-main">
            <span class="ins-row-title">{{ p.name }}</span>
            <span class="ins-row-meta"><span class="ins-mono">{{ p.fitness_certificate_no }}</span> · {{ humanise(p.type) }} · to {{ fmtDate(p.fitness_certificate_expiry) }}
              <template v-if="p.pendingSync"> · <CloudOff :size="11" aria-hidden="true" /> not yet sent</template></span>
          </span>
          <UiStatusBadge :tone="(daysUntil(p.fitness_certificate_expiry) ?? 0) < 0 ? 'negative' : (daysUntil(p.fitness_certificate_expiry) ?? 0) <= 30 ? 'warning' : 'positive'"
                         :label="(daysUntil(p.fitness_certificate_expiry) ?? 0) < 0 ? 'Expired' : (daysUntil(p.fitness_certificate_expiry) ?? 0) <= 30 ? 'Expiring' : 'Valid'" />
          <div class="ec-actions">
            <button type="button" class="ins-iconbtn" title="Print" @click="printFitness(p)"><Printer :size="14" aria-hidden="true" /><span class="ent-sr-only">Print certificate</span></button>
            <UiButton size="sm" @click="fForm = { premisesId: p.id, months: 12 }; fOpen = true">Renew</UiButton>
          </div>
        </li>
      </ul>
    </section>

    <!-- ══ BURIAL ═══════════════════════════════════════════════ -->
    <template v-else>
      <label class="ins-search ec-search ec-self-end"><Search :size="15" aria-hidden="true" /><span class="ent-sr-only">Search permits</span>
        <input v-model="bSearch" type="search" placeholder="Deceased, reference, cemetery" /></label>
      <section class="ins-card" aria-label="Burial permits">
        <ul v-if="bLoading" class="ins-rows" aria-busy="true"><li v-for="i in 3" :key="i" class="ins-row"><span class="ins-skel" style="width:60%" /></li></ul>
        <div v-else-if="bError" class="ins-card-body">
          <p class="ins-banner t-negative"><CloudOff :size="16" aria-hidden="true" /><span>{{ bError }}</span></p>
          <UiButton size="sm" @click="loadBurials"><template #icon><RefreshCw :size="14" /></template>Retry</UiButton>
        </div>
        <p v-else-if="!shownBurials.length" class="ec-empty">{{ burials.length ? 'No permits match.' : 'No permits have been issued.' }}</p>
        <ul v-else class="ins-rows">
          <li v-for="b in shownBurials" :key="b.id" class="ins-row ec-row">
            <span class="ins-row-main">
              <span class="ins-row-title">{{ b.deceasedName }}</span>
              <span class="ins-row-meta"><span class="ins-mono">{{ b.reference }}</span> · {{ humanise(b.permitKind) }} · {{ b.cemetery }} · died {{ fmtDate(b.dateOfDeath) }}
                <template v-if="b.cancelledReason"> · cancelled: {{ b.cancelledReason }}</template></span>
            </span>
            <UiStatusBadge :tone="b.cancelledAt ? 'neutral' : 'positive'" :label="b.cancelledAt ? 'Cancelled' : 'Issued'" />
            <div class="ec-actions">
              <button type="button" class="ins-iconbtn" title="Print" @click="printBurial(b)"><Printer :size="14" aria-hidden="true" /><span class="ent-sr-only">Print permit</span></button>
              <button v-if="!b.cancelledAt" type="button" class="ins-iconbtn" title="Cancel"
                      @click="reason = ''; reasonFor = { kind: 'burial', id: b.id, label: `${b.reference} · ${b.deceasedName}` }">
                <Ban :size="14" aria-hidden="true" /><span class="ent-sr-only">Cancel permit</span></button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <!-- Sheets -->
    <UiSheet :open="hOpen" title="Issue food-handler certificate" width="36rem" @update:open="hOpen = $event">
      <form id="ec-h" class="ins-form" @submit.prevent="issueHandler">
        <label class="ins-field full"><span class="ins-label">Premises</span>
          <select v-model="hForm.premisesId" class="ins-input"><option value="">Choose…</option>
            <option v-for="p in syncedPremises" :key="p.id" :value="p.id">{{ p.name }} · Stand {{ p.stand_number }}</option></select></label>
        <label class="ins-field"><span class="ins-label">Handler’s name</span><input v-model="hForm.handlerName" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">National ID</span><input v-model="hForm.handlerIdNumber" class="ins-input" placeholder="12-345678-A-12" /></label>
        <label class="ins-field full"><span class="ins-label">Medical clearance from</span>
          <input v-model="hForm.medicalClearanceSource" class="ins-input" placeholder="Clinic or doctor, and the date of examination" />
          <span class="ins-hint">Required. The certificate exists only because someone cleared the handler.</span></label>
        <label class="ins-field"><span class="ins-label">Valid for (months)</span><input v-model.number="hForm.months" type="number" min="1" max="24" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Notes</span><textarea v-model="hForm.notes" class="ins-input" rows="2" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="hOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="ec-h" :loading="saving">Issue and print</UiButton>
      </template>
    </UiSheet>

    <UiSheet :open="fOpen" title="Certificate of fitness" width="34rem" @update:open="fOpen = $event">
      <form id="ec-f" class="ins-form" @submit.prevent="issueFitness">
        <label class="ins-field full"><span class="ins-label">Premises</span>
          <select v-model="fForm.premisesId" class="ins-input"><option value="">Choose…</option>
            <option v-for="p in hc.registry.value" :key="p.id" :value="p.id">{{ p.name }} · {{ humanise(p.type) }}</option></select></label>
        <p v-if="fEvidence" class="ins-banner full-row" :class="fEvidence.ok ? 't-positive' : 't-warning'">
          <component :is="fEvidence.ok ? ShieldCheck : AlertTriangle" :size="15" aria-hidden="true" /><span>{{ fEvidence.text }}</span></p>
        <label class="ins-field"><span class="ins-label">Valid for (months)</span><input v-model.number="fForm.months" type="number" min="1" max="36" class="ins-input" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="fOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="ec-f">Certify and print</UiButton>
      </template>
    </UiSheet>

    <UiSheet :open="bOpen" title="Issue permit" subtitle="Burial · exhumation · reburial" width="40rem" @update:open="bOpen = $event">
      <form id="ec-b" class="ins-form" @submit.prevent="issueBurial">
        <div class="ins-field full"><span class="ins-label">Permit</span>
          <div class="ins-seg" role="radiogroup">
            <button v-for="k in (['burial', 'exhumation', 'reburial'] as BurialPermitKind[])" :key="k" type="button" role="radio"
                    :aria-checked="bForm.permitKind === k" @click="bForm.permitKind = k">{{ humanise(k) }}</button>
          </div></div>
        <label class="ins-field"><span class="ins-label">Deceased</span><input v-model="bForm.deceasedName" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">National ID</span><input v-model="bForm.deceasedIdNumber" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Date of death</span><input v-model="bForm.dateOfDeath" type="date" :max="isoDay()" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Cause of death</span><input v-model="bForm.causeOfDeath" class="ins-input" placeholder="As on the medical certificate" /></label>
        <label class="ins-field"><span class="ins-label">Cemetery</span><input v-model="bForm.cemetery" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Ward</span><input v-model="bForm.ward" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Interment (if scheduled)</span><input v-model="bForm.intermentAt" type="datetime-local" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Applicant</span><input v-model="bForm.applicantName" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Relationship</span><input v-model="bForm.applicantRelation" class="ins-input" placeholder="Spouse, son, daughter…" /></label>
        <label class="ins-field"><span class="ins-label">Applicant phone</span><input v-model="bForm.applicantContact" class="ins-input" inputmode="tel" /></label>
        <label class="ins-field"><span class="ins-label">Issuing officer</span><input v-model="bForm.issuedByName" class="ins-input" autocomplete="name" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="bOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="ec-b" :loading="saving">Issue and print</UiButton>
      </template>
    </UiSheet>

    <UiSheet :open="!!reasonFor" :title="reasonFor?.kind === 'handler' ? 'Revoke certificate' : 'Cancel permit'" :subtitle="reasonFor?.label"
             width="30rem" :scrim-close="false" @update:open="v => { if (!v) reasonFor = null }">
      <form id="ec-r" class="ins-form" @submit.prevent="submitReason">
        <label class="ins-field full"><span class="ins-label">Reason</span>
          <textarea v-model="reason" class="ins-input" rows="3" /></label>
        <p class="ins-hint full-row">The document stays on the record, marked with this reason. It cannot be reinstated — issue a new one instead.</p>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="reasonFor = null">Back</UiButton>
        <UiButton variant="danger" type="submit" form="ec-r" :loading="saving">{{ reasonFor?.kind === 'handler' ? 'Revoke' : 'Cancel permit' }}</UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ec-tools { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s3); flex-wrap:wrap; }
.ec-search { flex:0 1 26rem; }
.ec-self-end { align-self:flex-end; }
.ec-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.ec-row { flex-wrap:wrap; }
.ec-row .ins-row-meta { white-space:normal; }
.ec-actions { display:flex; align-items:center; gap:var(--ent-s2); }
.full-row { grid-column:1 / -1; margin:0; }
@media (max-width: 767px) { .ec-search { flex:1 1 100%; } .ec-actions { width:100%; justify-content:flex-end; } }
</style>
