<script setup lang="ts">
// Application receipt desk — taking a TPD over the counter in one pass.
//
// WHAT THIS REPLACED
// The old desk asked the clerk to type the applicant's name, the stand
// number, the register number AND the application's UUID into a form, while
// the person stood there — all of it already on the record it was about to
// write against. It then wrote three rows into localStorage and printed a
// receipt for money the council had no server-side record of taking.
//
// This works against the file the clerk already has open. Everything it needs
// about the application it reads; what it asks for is what only the counter
// knows: what was actually in the envelope, and what was paid.
//
// THE FEE IS TAKEN AT THE CASH OFFICE (migration 246)
// The clerk no longer takes money or writes a receipt. The applicant pays at
// the cash office, where the cashier names this application: the fee reaches
// the council's books, and an application fee marks the application paid.
// This desk reads that payment from the file and shows it; if there is none
// yet, it says to send the applicant to the cash office.
//
// TWO WRITES, NOT ONE TRANSACTION — AND IT SAYS SO
// Receipting a TPD makes two entries in two registers: the incoming
// correspondence, and the acknowledgement letter that starts both statutory
// clocks. They are two endpoints and there is no cross-register transaction,
// so a duplicate letter number can leave the correspondence logged and the
// acknowledgement not drafted. Each step reports its own outcome and the ones
// that succeeded are named.
//
// THE CHECKLIST IS EVIDENCE, NOT A GATE
// Unticked items do not block the receipt — an incomplete application is
// still lodged, and refusing to receipt it is not the clerk's decision to
// make. What the checklist does is write what was missing into the
// correspondence entry, so the planner sees it and the council can show what
// it was given.

import { computed, ref, watch } from 'vue'
import { useClerkNav } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import {
  asLabel, formatDate, formatMoney,
  plusWorkingDays, plusMonths, toDateTimeInput,
} from '@/planning-clerk/console'
import { createEntry, errorMessage } from '@/services/planningClerk'
import { determinationDeadline } from '@/statutory/periods'
import UiButton from '@/components/ui/UiButton.vue'
import PermitDocumentsPanel from '@/components/workflow/PermitDocumentsPanel.vue'
import PersonPicker from '@/components/shared/PersonPicker.vue'
import { personsApi, type Person } from '@/services/persons'
import {
  FileInput, Stamp, CheckCircle2, AlertTriangle, FolderOpen,
  Search, Receipt as ReceiptIcon, Mail, Inbox, XCircle, RefreshCw, UserRound,
} from 'lucide-vue-next'

const nav = useClerkNav()
const overview = useClerkOverview()

/**
 * What must be in the envelope.
 *
 * `always` items apply to every application; the rest are conditional and say
 * so, because a clerk who sees eleven unticked boxes on a straightforward
 * house extension learns to ignore the list.
 */
const CHECKLIST = [
  { key: 'signature_applicant', label: 'Applicant’s signature on the TPD form', always: true },
  { key: 'title_deed', label: 'Title deed — extract or certified copy', always: true },
  { key: 'building_plans_5', label: 'Building plans — five copies', always: true },
  { key: 'fee_paid', label: 'Application fee paid', always: true },
  { key: 'signature_owner', label: 'Owner’s signature', when: 'if the applicant is not the owner' },
  { key: 'agent_authority', label: 'Agent’s authority letter', when: 'if lodged by an agent' },
  { key: 'company_resolution', label: 'Company resolution', when: 'if the applicant is a company' },
  { key: 'bondholder_consent', label: 'Bondholder’s consent', when: 'if the property is bonded' },
  { key: 'lessee_consent', label: 'Lessee’s consent', when: 'if the property is leased' },
  { key: 'mining_restoration', label: 'Mining restoration programme', when: 'if mining' },
  { key: 'industrial_disclosure', label: 'Industrial processes disclosure', when: 'if industrial' },
] as const

const checks = ref<Record<string, boolean>>(
  Object.fromEntries(CHECKLIST.map((c) => [c.key, false])))

// ── The counter's own inputs ────────────────────────────────────────────

const receivedAt = ref(toDateTimeInput(new Date().toISOString()))
const letterNo = ref('')
const recipient = ref('')
const lodgedBy = ref('')

const permit = computed(() => overview.file.value?.permit ?? null)

// ── The applicant in the council's register of persons (migration 256) ──
// The name on the application stays as written; the link says who it is, so the same person is known across
// applications, objections and receipts. Read from the register when the file opens; linked as soon as one is chosen.
const applicant = ref<Person | null>(null)
const applicantError = ref('')
const linkingApplicant = ref(false)
watch(() => [permit.value?.id, permit.value?.applicant_person_id] as const, async ([, personId]) => {
  applicantError.value = ''
  if (!personId) { applicant.value = null; return }
  if (applicant.value?.id === personId) return
  try { applicant.value = (await personsApi.get(personId)).person } catch { applicant.value = null }
}, { immediate: true })
async function chooseApplicant(p: Person | null) {
  if (!permit.value || linkingApplicant.value) return
  const before = applicant.value
  applicant.value = p
  linkingApplicant.value = true
  applicantError.value = ''
  try {
    await personsApi.linkApplicant(permit.value.id, p ? p.id : null)
    permit.value.applicant_person_id = p ? p.id : null
    // Re-read, so "where they appear" counts this application.
    if (p) applicant.value = (await personsApi.get(p.id)).person
  } catch (err) {
    applicant.value = before
    applicantError.value = errorMessage(err, 'The applicant could not be linked.')
  } finally {
    linkingApplicant.value = false
  }
}

// ── The fee: what the cash office (or an online payment) took ───────────
// Read from the open file (migration 246). A cancelled receipt does not pay.
const fees = computed(() => (overview.file.value?.cash_office_fees ?? []).filter((f) => f.state !== 'cancelled'))
const applicationFee = computed(() => fees.value.find((f) => f.fee_kind === 'application') ?? null)
const feeRef = (f: { receipt_no: string | null; reference: string | null }) => f.receipt_no || f.reference || '—'
const checkingFee = ref(false)
async function checkFee() {
  if (!permit.value || checkingFee.value) return
  checkingFee.value = true
  try { await overview.loadFile(permit.value.id, true) } finally { checkingFee.value = false }
}
// The checklist's "Application fee paid" follows the record rather than a tick.
watch(applicationFee, (f) => { checks.value.fee_paid = !!f }, { immediate: true })

// Seed the addressee and the letter number from the file once it opens. The
// clerk can change both; this only saves retyping what is already known.
watch(permit, (p) => {
  if (!p) return
  if (!recipient.value) {
    recipient.value = [p.applicant_name, p.street_address].filter(Boolean).join(', ')
  }
  if (!lodgedBy.value) lodgedBy.value = p.applicant_name
  if (!letterNo.value && (p.tpd_reference || p.dev_register_no)) {
    letterNo.value = `ACK/${(p.tpd_reference || p.dev_register_no || '').replace(/\//g, '-')}`
  }
}, { immediate: true })

const dueBy = computed(() => plusWorkingDays(new Date(receivedAt.value).toISOString(), 5))
// The Act starts this clock at ACKNOWLEDGEMENT, not receipt (s.26(7)). The receipt desk issues the acknowledgement now, so the
// period runs from now; a letter that goes out on a later day moves the date (the Acknowledgements section).
const determinationDue = computed(() =>
  determinationDeadline(new Date().toISOString(), permit.value?.development_type) ?? plusMonths(new Date().toISOString(), 3))

const missing = computed(() => CHECKLIST.filter((c) => !checks.value[c.key]))
const missingAlways = computed(() => missing.value.filter((c) => 'always' in c && c.always))

// The application fee must have been paid at the cash office (or online)
// before the application is acknowledged, as it had to be receipted here
// before. Nothing else on this desk is a gate.
const canStamp = computed(() =>
  !!permit.value
  && !!applicationFee.value
  && letterNo.value.trim().length > 0
  && recipient.value.trim().length > 0
  && !stamping.value)

// ── Stamping ────────────────────────────────────────────────────────────

type StepState = 'pending' | 'done' | 'failed'
interface Step { key: string; label: string; icon: typeof ReceiptIcon; state: StepState; detail: string }

const steps = ref<Step[]>([])
const stamping = ref(false)
const finished = ref(false)

function checklistNote(): string {
  if (!missing.value.length) return 'Every item on the checklist was presented.'
  const names = missing.value.map((c) => c.label).join('; ')
  return `Not presented at receipt: ${names}.`
}

async function stamp() {
  if (!canStamp.value || !permit.value || !applicationFee.value) return
  stamping.value = true
  finished.value = false

  const permitId = permit.value.id
  const receivedIso = new Date(receivedAt.value).toISOString()
  const fee = applicationFee.value

  steps.value = [
    { key: 'fee', label: 'Application fee', icon: ReceiptIcon, state: 'done',
      detail: `${feeRef(fee)} · ${formatMoney(Number(fee.amount), fee.currency)} · ${fee.source === 'counter' ? 'cash office' : 'paid online'}` },
    { key: 'post', label: 'Correspondence entry', icon: Inbox, state: 'pending', detail: '' },
    { key: 'ack', label: 'Acknowledgement letter', icon: Mail, state: 'pending', detail: '' },
  ]
  const mark = (key: string, state: StepState, detail: string) => {
    const s = steps.value.find((x) => x.key === key)
    if (s) { s.state = state; s.detail = detail }
  }

  try {
    await createEntry('correspondence', {
      direction: 'in',
      logged_at: receivedIso,
      permit_application_id: permitId,
      ref_no: permit.value.dev_register_no || permit.value.tpd_reference || feeRef(fee),
      party: lodgedBy.value.trim() || permit.value.applicant_name,
      subject: `TPD application lodged — stand ${permit.value.stand_number || '—'}, ${permit.value.suburb_ward || '—'}`,
      channel: 'in_person',
      attached_doc_ref: `Receipt ${feeRef(fee)}`,
      notes: checklistNote(),
    })
    mark('post', 'done', 'Logged as received in person')
  } catch (err) {
    mark('post', 'failed', errorMessage(err, 'The correspondence entry was not written.'))
  }

  try {
    await createEntry('acknowledgements', {
      letter_no: letterNo.value.trim(),
      permit_application_id: permitId,
      ...(permit.value.dev_register_no
        ? { application_register_no: permit.value.dev_register_no } : {}),
      received_at: receivedIso,
      due_by: dueBy.value,
      determination_due_by: determinationDue.value,
      recipient: recipient.value.trim(),
    })
    mark('ack', 'done', `Due ${formatDate(dueBy.value)} · determination ${formatDate(determinationDue.value)}`)
  } catch (err) {
    mark('ack', 'failed', errorMessage(err, 'The acknowledgement was not drafted.'))
  }

  overview.invalidate()
  stamping.value = false
  finished.value = true
}

function startAnother() {
  finished.value = false
  steps.value = []
  letterNo.value = ''
  recipient.value = ''
  lodgedBy.value = ''
  receivedAt.value = toDateTimeInput(new Date().toISOString())
  checks.value = Object.fromEntries(CHECKLIST.map((c) => [c.key, false]))
  nav.openFile(null)
}


const allDone = computed(() => steps.value.length > 0 && steps.value.every((s) => s.state === 'done'))
const anyFailed = computed(() => steps.value.some((s) => s.state === 'failed'))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Front counter</span>
        <h2 class="ins-title">Application receipt</h2>
        <p class="ins-lede">
          Take a TPD over the counter in one pass: what was in the envelope,
          whether the fee is paid at the cash office, and the acknowledgement
          that starts both statutory clocks.
        </p>
      </div>
    </header>

    <!-- ── No file open ────────────────────────────────────────────────── -->
    <section v-if="!permit" class="ins-card">
      <div class="ins-card-body clk-rec-none">
        <FolderOpen :size="26" aria-hidden="true" />
        <p>
          Open the application first. Everything on this desk is written
          against a file, and the application will already exist — lodged
          through the citizen portal, or captured by an officer.
        </p>
        <UiButton variant="primary" @click="nav.go('search')">
          <template #icon><Search :size="14" /></template>
          Find the file
        </UiButton>
      </div>
    </section>

    <!-- ── Done ────────────────────────────────────────────────────────── -->
    <section v-else-if="finished" class="ins-card">
      <header class="ins-card-head">
        <h3>
          <component :is="allDone ? CheckCircle2 : AlertTriangle" :size="15" aria-hidden="true" />
          {{ allDone ? 'Receipted' : 'Partly receipted' }}
        </h3>
      </header>
      <div class="ins-card-body clk-rec-done">
        <p v-if="anyFailed" class="ins-banner t-warning">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>
            <strong>Not everything was written.</strong>
            These are three separate registers and there is no single
            transaction across them, so what succeeded is listed below exactly
            as it stands. Put the rest right in the section it belongs to —
            do not run the whole receipt again, or the money will be receipted
            twice.
          </span>
        </p>

        <ul class="clk-rec-steps">
          <li v-for="s in steps" :key="s.key" :class="`t-${s.state}`">
            <span class="clk-rec-step-icon">
              <component :is="s.state === 'failed' ? XCircle : s.icon" :size="15" aria-hidden="true" />
            </span>
            <span class="clk-rec-step-text">
              <strong>{{ s.label }}</strong>
              <small>{{ s.detail }}</small>
            </span>
            <span class="clk-rec-step-state">
              {{ s.state === 'done' ? 'Written' : s.state === 'failed' ? 'Not written' : '—' }}
            </span>
          </li>
        </ul>

        <div class="ins-actions">
          <UiButton variant="primary" @click="startAnother">
            <template #icon><FileInput :size="14" /></template>
            Take another application
          </UiButton>
          <UiButton variant="secondary" @click="nav.go('acknowledgements')">
            <template #icon><Mail :size="14" /></template>
            Acknowledgement queue
          </UiButton>
          <UiButton variant="ghost" @click="nav.go('fees')">
            <template #icon><ReceiptIcon :size="14" /></template>
            Cashbook
          </UiButton>
        </div>
      </div>
    </section>

    <!-- ── The desk ────────────────────────────────────────────────────── -->
    <template v-else>
      <section class="ins-card">
        <header class="ins-card-head">
          <h3><FolderOpen :size="15" aria-hidden="true" /> The application</h3>
        </header>
        <div class="ins-card-body">
          <dl class="ins-dl">
            <div>
              <dt>Reference</dt>
              <dd class="ins-mono">{{ permit.tpd_reference || permit.dev_register_no || '—' }}</dd>
            </div>
            <div><dt>Applicant</dt><dd>{{ permit.applicant_name }}</dd></div>
            <div>
              <dt>Stand</dt>
              <dd class="ins-mono">{{ permit.stand_number || '—' }}</dd>
            </div>
            <div><dt>Ward / suburb</dt><dd>{{ permit.suburb_ward || '—' }}</dd></div>
            <div><dt>Development</dt><dd>{{ asLabel(permit.development_type) }}</dd></div>
            <div><dt>Status</dt><dd>{{ asLabel(permit.status) }}</dd></div>
          </dl>
        </div>
      </section>

      <!-- Who the applicant is, in the council's register of persons (migration 256) -->
      <section class="ins-card" data-testid="applicant-person">
        <header class="ins-card-head">
          <h3><UserRound :size="15" aria-hidden="true" /> Applicant in the register</h3>
          <span v-if="!applicant" class="ins-count">Not yet linked</span>
        </header>
        <div class="ins-card-body">
          <p v-if="!applicant" class="ins-hint">
            The application names <strong>{{ permit.applicant_name }}</strong>. Find them in the council's register, or register them
            with the identity document they bring, so their letters, payments and other applications are on one record.
          </p>
          <PersonPicker :model-value="applicant" role="applicant" @update:model-value="chooseApplicant" />
          <p v-if="applicantError" class="ins-hint" role="alert">{{ applicantError }}</p>
        </div>
      </section>

      <!-- What was in the envelope. Evidence, not a gate. -->
      <section class="ins-card">
        <header class="ins-card-head">
          <h3><Stamp :size="15" aria-hidden="true" /> What was presented</h3>
          <span class="ins-count">
            {{ CHECKLIST.length - missing.length }} of {{ CHECKLIST.length }}
          </span>
        </header>
        <div class="ins-card-body">
          <p class="ins-hint clk-rec-hint">
            An incomplete application is still lodged — refusing to receipt it
            is not this desk’s decision. What is not ticked is written into the
            correspondence entry so the planner sees it and the council can
            show what it was given.
          </p>
          <ul class="ins-checks">
            <li v-for="c in CHECKLIST" :key="c.key">
              <label class="ins-check" :class="{ on: checks[c.key] }">
                <input v-model="checks[c.key]" type="checkbox" />
                <span>
                  <strong>{{ c.label }}</strong>
                  <small v-if="'when' in c">{{ c.when }}</small>
                  <small v-else>Required on every application</small>
                </span>
              </label>
            </li>
          </ul>
          <p v-if="missingAlways.length" class="ins-banner t-warning clk-rec-gap">
            <AlertTriangle :size="15" aria-hidden="true" />
            <span>
              {{ missingAlways.length }} item{{ missingAlways.length === 1 ? '' : 's' }}
              required on every application {{ missingAlways.length === 1 ? 'is' : 'are' }}
              not ticked. You can still receipt — it will be recorded as not presented.
            </span>
          </p>
        </div>
      </section>

      <!-- Documents already uploaded against the file, so the clerk is not
           asking for a title deed that is on the screen in front of them. -->
      <PermitDocumentsPanel :permit-id="permit.id" />

      <section class="ins-card">
        <header class="ins-card-head">
          <h3><ReceiptIcon :size="15" aria-hidden="true" /> Fee</h3>
          <UiButton size="sm" variant="ghost" :loading="checkingFee" @click="checkFee">
            <template #icon><RefreshCw :size="14" /></template>
            Check again
          </UiButton>
        </header>
        <div class="ins-card-body" data-testid="clk-rec-fee">
          <p v-if="applicationFee" class="ins-banner t-positive clk-rec-fee">
            <CheckCircle2 :size="15" aria-hidden="true" />
            <span>
              <strong>Application fee paid</strong>
              {{ formatMoney(Number(applicationFee.amount), applicationFee.currency) }}
              {{ applicationFee.source === 'counter' ? 'at the cash office' : 'online' }},
              receipt <span class="ins-mono">{{ feeRef(applicationFee) }}</span>, {{ formatDate(applicationFee.received_on) }}.
            </span>
          </p>
          <p v-else class="ins-banner t-warning clk-rec-fee">
            <AlertTriangle :size="15" aria-hidden="true" />
            <span>
              <strong>The application fee has not been paid.</strong>
              Send the applicant to the cash office with the reference
              <span class="ins-mono">{{ permit.tpd_reference || permit.dev_register_no || permit.stand_number || '—' }}</span>.
              The cashier names this application on the receipt, and it shows here at once:
              press <em>Check again</em> when they are back.
            </span>
          </p>
          <ul v-if="fees.length > (applicationFee ? 1 : 0)" class="clk-rec-otherfees">
            <li v-for="f in fees.filter((x) => x !== applicationFee)" :key="f.id">
              {{ asLabel(f.fee_kind) }}: {{ formatMoney(Number(f.amount), f.currency) }}, receipt
              <span class="ins-mono">{{ feeRef(f) }}</span>
            </li>
          </ul>
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="clk-rec-lodged">Lodged by</label>
              <input id="clk-rec-lodged" v-model="lodgedBy" class="ins-input" />
              <p class="ins-hint">The person at the counter, if not the applicant.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="ins-card">
        <header class="ins-card-head">
          <h3><Mail :size="15" aria-hidden="true" /> Acknowledgement</h3>
        </header>
        <div class="ins-card-body">
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="clk-rec-when">Received at *</label>
              <input id="clk-rec-when" v-model="receivedAt" class="ins-input"
                     type="datetime-local" required />
              <p class="ins-hint">Both statutory clocks run from this moment.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="clk-rec-letter">Letter number *</label>
              <input id="clk-rec-letter" v-model="letterNo" class="ins-input" required />
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="clk-rec-to">Addressed to *</label>
              <input id="clk-rec-to" v-model="recipient" class="ins-input" required />
            </div>
          </div>

          <!-- The two dates, computed and shown before anything is written.
               A clerk reads these onto a letter, so they should see them
               before committing rather than afterwards. -->
          <div class="clk-rec-clocks">
            <div>
              <span class="clk-rec-clock-label">Acknowledgement due</span>
              <strong class="clk-rec-clock-value">{{ formatDate(dueBy) }}</strong>
              <small>The Act allows two weeks (s.26(2)(a)); the council aims for five working days.
                Weekends are skipped; public holidays are not — move the received time if one falls inside.</small>
            </div>
            <div>
              <span class="clk-rec-clock-label">Determination due</span>
              <strong class="clk-rec-clock-value">{{ formatDate(determinationDue) }}</strong>
              <small>Three months from today’s acknowledgement, not from receipt (s.26(7)); four for a
                subdivision. Undetermined by then, the application is deemed refused.</small>
            </div>
          </div>
        </div>
      </section>

      <div class="clk-rec-commit">
        <p v-if="!canStamp" class="ins-hint">
          {{ applicationFee ? 'A letter number and an addressee are needed before this can be stamped.'
            : 'The application fee must be paid at the cash office before the application is acknowledged.' }}
        </p>
        <UiButton variant="primary" :disabled="!canStamp" :loading="stamping" @click="stamp">
          <template #icon><Stamp :size="15" /></template>
          Stamp receipt &amp; draft acknowledgement
        </UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.clk-rec-fee { margin: 0 0 var(--ent-s3); }
.clk-rec-otherfees { margin: 0 0 var(--ent-s3); padding-left: var(--ent-s4); color: var(--ent-text-2); font-size: var(--ent-fs-sm); }
.clk-rec-none, .clk-rec-done { display:flex; flex-direction:column;
  align-items:center; gap:var(--ent-s4); padding:var(--ent-s6) var(--ent-s4);
  text-align:center; }
.clk-rec-none { color:var(--ent-text-3); }
.clk-rec-none p { margin:0; max-width:44ch; font-size:var(--ent-fs-sm);
  line-height:var(--ent-lh); }
.clk-rec-done { align-items:stretch; text-align:left; }

.clk-rec-hint { margin:0 0 var(--ent-s3); max-width:70ch; }
.clk-rec-gap { margin:var(--ent-s3) 0 0; }

.clk-rec-steps { list-style:none; margin:0; padding:0; display:flex;
  flex-direction:column; gap:var(--ent-s2); }
.clk-rec-steps li { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3) var(--ent-s4); border-radius:var(--ent-r-md);
  border:1px solid var(--ent-line); background:var(--ent-surface); }
.clk-rec-steps li.t-done { border-color:var(--ent-tone-positive-line);
  background:var(--ent-tone-positive-bg); }
.clk-rec-steps li.t-failed { border-color:var(--ent-tone-negative-line);
  background:var(--ent-tone-negative-bg); }
.clk-rec-step-icon { display:inline-flex; flex-shrink:0; color:var(--ent-text-3); }
.clk-rec-steps li.t-done .clk-rec-step-icon { color:var(--ent-success); }
.clk-rec-steps li.t-failed .clk-rec-step-icon { color:var(--ent-danger); }
.clk-rec-step-text { flex:1; min-width:0; }
.clk-rec-step-text strong { display:block; font-size:var(--ent-fs-sm);
  font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.clk-rec-step-text small { display:block; margin-top:2px; font-size:var(--ent-fs-xs);
  color:var(--ent-text-2); line-height:var(--ent-lh); }
.clk-rec-step-state { flex-shrink:0; font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); letter-spacing:0.04em; text-transform:uppercase;
  color:var(--ent-text-3); }
.clk-rec-steps li.t-done .clk-rec-step-state { color:var(--ent-success); }
.clk-rec-steps li.t-failed .clk-rec-step-state { color:var(--ent-danger); }

.clk-rec-clocks { display:grid; grid-template-columns:repeat(auto-fit, minmax(16rem, 1fr));
  gap:var(--ent-s3); margin-top:var(--ent-s4); }
.clk-rec-clocks > div { padding:var(--ent-s3); border-radius:var(--ent-r);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); }
.clk-rec-clock-label { display:block; font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); letter-spacing:0.05em; text-transform:uppercase;
  color:var(--ent-text-3); }
.clk-rec-clock-value { display:block; margin:2px 0; font-size:var(--ent-fs-lg);
  font-weight:var(--ent-fw-bold); color:var(--ent-text); }
.clk-rec-clocks small { display:block; font-size:var(--ent-fs-micro);
  color:var(--ent-text-3); line-height:var(--ent-lh); }

.clk-rec-commit { display:flex; flex-direction:column; align-items:center;
  gap:var(--ent-s2); padding:var(--ent-s5) var(--ent-s4);
  background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); text-align:center; }
.clk-rec-commit .ins-hint { display:inline-flex; align-items:center;
  gap:var(--ent-s1); margin:0; max-width:52ch; }
</style>
