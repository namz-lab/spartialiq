<script setup lang="ts">
// ─── Step 4 — Statutory Decision & Permit Issuance Workspace ──────────────
//
// Prepares, validates, reviews and issues a development permit under s.26 of
// the RTCP Act [Chapter 29:12].
//
// What this screen is NOT: the legal authority. The council's database is.
// Everything here is usability and early feedback. The server independently
// re-checks the officer's role, the lawfulness of the status transition and the
// record version on every issue attempt — see usePermitIssuance.ts for exactly
// which requirements are server-enforced and which are advisory.
//
// Structure:
//   1. Case header + state banner
//   2. Decision readiness (from server records)
//   3. Permit core — authoritative facts (read-only) vs decision fields
//   4. Conditions of approval — structured, five-test gated
//   5. Annexure 7 — system-generated clauses + officer notes, kept distinct
//   6. Final review + authority confirmation
//   7. Issue action
// ─────────────────────────────────────────────────────────────────────────

import { computed, onMounted, ref, watch } from 'vue'
import {
  Plus, FileSignature, Download, AlertTriangle, Lock, Loader2,
  ShieldAlert, RefreshCw, Info, Send,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useConditionLibrary, type ConditionCategory } from '@/composables/useConditionLibrary'
import { useUiFeedback } from '@/composables/useUiFeedback'
import type { Role } from '@/services/types'
import { usePermitIssuance } from './permit/usePermitIssuance'
import { toDateOnly } from './permit/permitRules'
import PermitReadinessPanel from './permit/PermitReadinessPanel.vue'
import PermitConditionEditor from './permit/PermitConditionEditor.vue'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()
const auth = useAuthStore()
const { templates, addFromTemplate } = useConditionLibrary()

const role = computed(() => auth.user?.role as Role | undefined)
const officerName = computed(() => auth.user?.name || auth.user?.email || '')

const issuance = usePermitIssuance({ current, save, role, officerName })

/** An issued permit is a fixed legal record. Changes go through a separate
 *  amendment / variation workflow, not by editing the original. */
const readonly = computed(() => issuance.isIssued.value)

// ── Defaults ─────────────────────────────────────────────────────────────
// Seed only what is genuinely derivable. Notably NOT the decision date: when a
// decision was made is a fact to be recorded, not a value to quietly default
// to "today" on the officer's behalf.
function ensureDefaults() {
  const c = current.value
  if (!c || readonly.value) return
  if (!c.permit.permitNo && c.registrationNo) {
    c.permit.permitNo = `PERM-${c.registrationNo.replace(/^VR-/, '')}`
  }
  if (!c.permit.issuingOfficer && officerName.value) {
    c.permit.issuingOfficer = officerName.value
  }
  if (!c.permit.decisionAuthority && c.committeeReport.resolutionAt) {
    c.permit.decisionAuthority = 'Council committee resolution'
  }
}

onMounted(async () => {
  ensureDefaults()
  await issuance.refresh()
})
watch(() => current.value?.permitId, () => { ensureDefaults(); void issuance.refresh() })

// ── Conditions ───────────────────────────────────────────────────────────
/** Categories already used. A second setback/parking condition is usually a
 *  mis-click; 'custom' is exempt because repeats there are legitimate. */
const usedCategories = computed(
  () => new Set((current.value?.permit.conditions ?? []).map(c => c.category)))

function templateDisabled(key: ConditionCategory): boolean {
  return readonly.value || (key !== 'custom' && usedCategories.value.has(key))
}

function addCondition(key: ConditionCategory) {
  const c = current.value
  if (!c || templateDisabled(key)) return
  c.permit.conditions.push(addFromTemplate(key))
  save()
}

async function removeCondition(idx: number) {
  const c = current.value
  if (!c || readonly.value) return
  const ok = await fb.confirmAction(
    'Remove this condition?',
    `Condition ${idx + 1} will be removed from the permit.`,
    { confirmLabel: 'Remove condition', danger: true },
  )
  if (!ok) return
  c.permit.conditions.splice(idx, 1)
  save()
}

// ── Issue ────────────────────────────────────────────────────────────────
const issueAttempted = ref(false)

async function onIssue() {
  issueAttempted.value = true
  const c = current.value
  if (!c) return

  if (!issuance.canIssue.value) {
    // Explain, rather than silently doing nothing.
    const reasons = [
      ...issuance.blockers.value.map(b => `• ${b.label}: ${b.detail}`),
      ...Object.values(issuance.fieldErrors.value).map(m => `• ${m}`),
      ...(issuance.confirmed.value ? [] : ['• The authority confirmation has not been ticked.']),
    ]
    fb.openMessageBox({
      kind: 'error',
      title: 'This permit cannot be issued yet',
      message: 'Resolve the following before issuing.',
      details: reasons.join('\n') || undefined,
    })
    return
  }

  const ok = await fb.confirmAction(
    `Issue permit ${c.permit.permitNo}?`,
    'This records a statutory determination against the application and cannot be '
    + 'reversed from this screen. This system has no amendment workflow yet, so a '
    + 'later variation must be processed as a new application.',
    { confirmLabel: 'Issue permit' },
  )
  if (!ok) return

  const issued = await issuance.issue()
  if (issued) {
    fb.showToast(`Permit ${c.permit.permitNo} issued`, 'success')
  } else if (issuance.issueError.value) {
    fb.openMessageBox({
      kind: 'error',
      title: 'Could not issue permit',
      message: issuance.issueError.value,
    })
  }
}

function onDownload() {
  const name = issuance.downloadDocument()
  if (name) fb.showToast(`Downloaded ${name}`, 'success')
}

/** Notify the applicant and record it, rather than just typing a date. */
async function onRecordNotification() {
  const c = current.value
  if (!c) return
  const today = toDateOnly(new Date())!
  const ok = await fb.confirmAction(
    'Record notification to the applicant?',
    `This posts a notice of the decision to the applicant on the case record, dated `
    + `${today}, and starts the appeal window. It cannot be unsent.`,
    { confirmLabel: 'Notify applicant' },
  )
  if (!ok) return
  if (await issuance.recordNotification(today)) {
    fb.showToast('Notification recorded', 'success')
  } else if (issuance.issueError.value) {
    fb.openMessageBox({
      kind: 'error',
      title: 'Could not record the notification',
      message: issuance.issueError.value,
    })
  }
}

// ── Presentation ─────────────────────────────────────────────────────────
const stateBanner = computed(() => {
  switch (issuance.state.value) {
    case 'loading':   return { tone: 'busy', title: 'Loading permit decision…',
                               body: 'Reading the council decision record.' }
    case 'issuing':   return { tone: 'busy', title: 'Issuing permit…',
                               body: 'Do not close this window.' }
    case 'issued':    return { tone: 'ok', title: 'Issued',
                               body: 'This permit is a fixed record. Changes require an amendment.' }
    case 'conflict':  return { tone: 'bad', title: 'This permit was modified by another user',
                               body: 'Reload the case to see their changes before issuing.' }
    case 'forbidden': return { tone: 'bad', title: 'You may not issue this permit',
                               body: `The role '${role.value ?? 'unknown'}' cannot record a determination.` }
    case 'error':     return { tone: 'bad', title: 'Something failed',
                               body: issuance.issueError.value || issuance.loadError.value || '' }
    case 'blocked':   return { tone: 'warn', title: 'Not ready to issue',
                               body: 'Outstanding requirements are listed below.' }
    default:          return { tone: 'ok', title: 'Ready for issuance',
                               body: 'Review the summary, confirm your authority, then issue.' }
  }
})

const USE_CLASSES = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const
const conditionsSummaryId = 'p4-conditions-summary'
</script>

<template>
  <div v-if="current" class="step4">
    <!-- ═══ 1. Header ══════════════════════════════════════════════════ -->
    <header class="p4-head">
      <div class="p4-head-main">
        <h2>Permit issuance</h2>
        <dl class="p4-facts">
          <div><dt>File</dt><dd>{{ current.fileRef || '—' }}</dd></div>
          <div><dt>Application</dt><dd>{{ current.registrationNo || '—' }}</dd></div>
          <div><dt>Applicant</dt><dd>{{ current.applicant.name || '—' }}</dd></div>
          <div><dt>Stand</dt><dd>{{ current.property.standNo || '—' }}</dd></div>
          <div>
            <dt>Status</dt>
            <dd>{{ (issuance.permitRow.value?.status ?? current.status ?? '—').replace(/_/g, ' ') }}</dd>
          </div>
        </dl>
      </div>

      <p class="p4-banner" :class="stateBanner.tone" role="status" aria-live="polite">
        <Loader2 v-if="stateBanner.tone === 'busy'" :size="14" class="spin" aria-hidden="true" />
        <Lock v-else-if="issuance.isIssued.value" :size="14" aria-hidden="true" />
        <AlertTriangle v-else-if="stateBanner.tone !== 'ok'" :size="14" aria-hidden="true" />
        <span>
          <strong>{{ stateBanner.title }}</strong>
          <span class="p4-banner-body">{{ stateBanner.body }}</span>
        </span>
      </p>
    </header>

    <!-- Conflict must interrupt: acting on stale data overwrites another
         officer's work. -->
    <div v-if="issuance.conflict.value" class="p4-alert bad" role="alert">
      <ShieldAlert :size="15" aria-hidden="true" />
      <div>
        <strong>This permit has changed since you opened it.</strong>
        <p>Reload before issuing, so you are deciding on the current record.</p>
      </div>
      <button type="button" class="p4-btn" @click="issuance.refresh()">
        <RefreshCw :size="12" aria-hidden="true" /> Reload
      </button>
    </div>

    <!-- ═══ 2. Readiness ═══════════════════════════════════════════════ -->
    <PermitReadinessPanel
      :requirements="issuance.requirements.value"
      :loading="issuance.loading.value"
      @refresh="issuance.refresh()"
    />

    <!-- A missing record is not proof a step was done — it is proof nothing is
         known. Since the server does not gate on these, issuing anyway must be
         a deliberate, recorded act rather than a silent one. -->
    <section v-if="issuance.overrideRequired.value && !readonly"
             class="p4-card p4-override" aria-labelledby="p4-override-h">
      <header><h3 id="p4-override-h">Unverified prerequisites</h3></header>
      <div class="p4-pad p4-override-body">
        <p class="p4-override-lead">
          {{ issuance.unknowns.value.length }} statutory requirement(s) could not be
          verified from the council's records:
        </p>
        <ul class="p4-override-list">
          <li v-for="u in issuance.unknowns.value" :key="u.id">
            <strong>{{ u.label }}</strong> — {{ u.detail }}
          </li>
        </ul>
        <p class="p4-hint">
          The preferred action is to complete the missing record. If you nevertheless
          have grounds to issue, state them: your justification is sent with the
          determination and stored on the case audit trail.
        </p>
        <label class="p4-override-label" for="p4-override-reason">
          Justification for issuing without these records
        </label>
        <textarea id="p4-override-reason" v-model="issuance.overrideReason.value"
                  class="p4-notes" rows="3"
                  :aria-invalid="!issuance.overrideValid.value"
                  aria-describedby="p4-override-count"
                  placeholder="e.g. Objection period closed and verified on the paper file dated …" />
        <p id="p4-override-count" class="p4-hint">
          {{ issuance.overrideReason.value.trim().length }} / 30 characters minimum.
          <span v-if="issuance.overrideValid.value"> Recorded with the determination.</span>
        </p>
      </div>
    </section>

    <!-- ═══ 3. Permit core ═════════════════════════════════════════════ -->
    <section class="p4-card" aria-labelledby="p4-core">
      <header><h3 id="p4-core">Permit core (Annexure 6)</h3></header>

      <div class="p4-sub">
        <h4>Case information</h4>
        <p class="p4-hint">Held by the council. Not editable here.</p>
      </div>
      <dl class="p4-ro-grid">
        <div><dt>File reference</dt><dd>{{ current.fileRef || '—' }}</dd></div>
        <div><dt>Application ref</dt><dd>{{ current.registrationNo || '—' }}</dd></div>
        <div><dt>Applicant</dt><dd>{{ current.applicant.name || '—' }}</dd></div>
        <div><dt>Stand / property</dt><dd>{{ current.property.standNo || '—' }}</dd></div>
        <div><dt>Legal description</dt><dd>{{ current.property.description || '—' }}</dd></div>
        <div><dt>Application type</dt><dd>{{ current.proposal.devType.replace(/_/g, ' ') }}</dd></div>
      </dl>

      <div class="p4-sub">
        <h4>Decision information</h4>
        <p class="p4-hint">Recorded by you. Locked once the permit is issued.</p>
      </div>

      <!-- Honesty about where these values actually live. The backend stores
           only the conditions, decision date and deciding officer; the rest has
           no column yet, so it survives in this browser alone. An officer must
           know that before relying on it from another machine. -->
      <div class="p4-alert warn p4-pad" role="note">
        <Info :size="15" aria-hidden="true" />
        <div>
          <strong>Only part of this section is held by the council.</strong>
          <p>
            The conditions, decision date and deciding officer are saved to the case
            record. The permit number, use class, permitted development, commencement
            period, decision authority and Annexure&nbsp;7 notes are held in
            <em>this browser only</em> until the permit record is added to the
            database — they will not appear on another machine.
          </p>
        </div>
      </div>
      <div class="p4-grid">
        <label>
          <span>Permit number</span>
          <input v-model="current.permit.permitNo" :readonly="readonly"
                 :aria-invalid="!!issuance.fieldErrors.value.permitNo" @change="save" />
          <span v-if="issueAttempted && issuance.fieldErrors.value.permitNo"
                class="p4-err">{{ issuance.fieldErrors.value.permitNo }}</span>
        </label>

        <label>
          <span>Use class</span>
          <select v-model="current.permit.useClass" :disabled="readonly" @change="save">
            <option value="">— Select —</option>
            <option v-for="u in USE_CLASSES" :key="u" :value="u">Class {{ u }}</option>
          </select>
          <span v-if="issueAttempted && issuance.fieldErrors.value.useClass"
                class="p4-err">{{ issuance.fieldErrors.value.useClass }}</span>
        </label>

        <label class="p4-wide">
          <span>Permitted development</span>
          <textarea v-model="current.permit.permittedDescription" rows="3" :readonly="readonly"
                    :aria-invalid="!!issuance.fieldErrors.value.permittedDescription"
                    placeholder="e.g. construction of a four-bedroom dwelling and ancillary buildings"
                    @change="save" />
          <span v-if="issueAttempted && issuance.fieldErrors.value.permittedDescription"
                class="p4-err">{{ issuance.fieldErrors.value.permittedDescription }}</span>
        </label>

        <label>
          <span>Decision date</span>
          <input type="date" :value="current.permit.decisionDate ?? ''" :readonly="readonly"
                 @change="current.permit.decisionDate = ($event.target as HTMLInputElement).value || null; save()" />
          <span v-if="issueAttempted && issuance.fieldErrors.value.decisionDate"
                class="p4-err">{{ issuance.fieldErrors.value.decisionDate }}</span>
        </label>

        <label>
          <span>Applicant notified on</span>
          <input type="date" :value="current.permit.notificationDate ?? ''" readonly
                 aria-describedby="p4-notify-hint" />
          <span id="p4-notify-hint" class="p4-hint">
            Drives the appeal window. Set by recording the notification, so the date
            always has a matching record.
          </span>
          <button v-if="!current.permit.notificationDate" type="button"
                  class="p4-btn p4-btn--inline" :disabled="!current.permit.issueDate"
                  :title="current.permit.issueDate
                    ? 'Notify the applicant and record it on the case'
                    : 'Available once the permit has been issued'"
                  @click="onRecordNotification">
            <Send :size="12" aria-hidden="true" /> Record notification
          </button>
        </label>

        <label>
          <span>Commencement period (months)</span>
          <input type="number" min="1" max="120" v-model.number="current.permit.implementationPeriodMonths"
                 :readonly="readonly" @change="save" />
          <span v-if="issuance.deadlines.value.implementationDeadline" class="p4-hint">
            Lapses {{ issuance.deadlines.value.implementationDeadline }}.
          </span>
        </label>

        <label>
          <span>Decision authority</span>
          <input v-model="current.permit.decisionAuthority" :readonly="readonly"
                 placeholder="Committee resolution, or named delegated authority" @change="save" />
        </label>

        <label>
          <span>Issuing officer</span>
          <input v-model="current.permit.issuingOfficer" :readonly="readonly" @change="save" />
          <span v-if="issueAttempted && issuance.fieldErrors.value.issuingOfficer"
                class="p4-err">{{ issuance.fieldErrors.value.issuingOfficer }}</span>
        </label>
      </div>
    </section>

    <!-- ═══ 4. Conditions ══════════════════════════════════════════════ -->
    <section class="p4-card" aria-labelledby="p4-conds">
      <header>
        <h3 id="p4-conds">Conditions of approval ({{ current.permit.conditions.length }})</h3>
      </header>

      <p :id="conditionsSummaryId" class="p4-hint p4-pad">
        These structured conditions are stored on the permit and are what inspectors
        and the applicant see. The document is a rendering of them, not the record.
      </p>

      <div v-if="!readonly" class="p4-tpl-row" role="group"
           aria-label="Add a condition from the template library">
        <button v-for="t in templates" :key="t.key" type="button" class="p4-tpl"
                :disabled="templateDisabled(t.key)"
                :title="templateDisabled(t.key)
                  ? `A ${t.label.toLowerCase()} condition is already on this permit`
                  : `Add: ${t.label}`"
                @click="addCondition(t.key)">
          <Plus :size="11" aria-hidden="true" /> {{ t.label }}
        </button>
      </div>

      <p v-if="!current.permit.conditions.length" class="p4-empty">
        No conditions yet. A permit must carry at least one condition of approval.
      </p>

      <ul v-else class="p4-cond-list" :aria-describedby="conditionsSummaryId">
        <PermitConditionEditor
          v-for="(cond, i) in current.permit.conditions"
          :key="cond.id"
          :condition="cond"
          :index="i"
          :readonly="readonly"
          @change="save"
          @remove="removeCondition(i)"
        />
      </ul>

      <p v-if="issueAttempted && issuance.fieldErrors.value.conditions"
         class="p4-err p4-pad" role="alert">{{ issuance.fieldErrors.value.conditions }}</p>
    </section>

    <!-- ═══ 5. Annexure 7 ══════════════════════════════════════════════ -->
    <section class="p4-card" aria-labelledby="p4-annex">
      <header><h3 id="p4-annex">Annexure 7 — Notes attached to the permit</h3></header>

      <div class="p4-sub">
        <h4>System generated</h4>
        <p class="p4-hint">
          Derived from the council's statutory rule set. Not editable here — a change
          in the law is a change to the rule set, not to one permit.
        </p>
      </div>
      <ol class="p4-clauses">
        <li v-for="cl in issuance.annexure.value" :key="cl.ruleId">
          <p class="p4-clause-text">{{ cl.text }}</p>
          <p class="p4-clause-meta">
            <span class="p4-tag">System generated</span>
            <span>{{ cl.source }}</span>
            <span>v{{ cl.version }}</span>
            <span>effective {{ cl.effectiveFrom }}</span>
            <span v-if="cl.status === 'unverified'" class="p4-tag warn">Requires verification</span>
          </p>
          <p v-if="cl.note" class="p4-clause-note">{{ cl.note }}</p>
        </li>
      </ol>

      <div v-if="issuance.rulesNeedingConfirmation.value.length"
           class="p4-alert warn p4-pad" role="note">
        <Info :size="15" aria-hidden="true" />
        <div>
          <strong>
            {{ issuance.rulesNeedingConfirmation.value.length }} statutory rule(s)
            could not be verified from a legal source.
          </strong>
          <p>
            The permit prints neutral wording where a period is unconfirmed, rather than
            asserting a deadline. Confirm these against the Act and update the rule set.
          </p>
        </div>
      </div>

      <div class="p4-sub">
        <h4>Officer note</h4>
        <p class="p4-hint">Your own discretionary notes. Printed separately and labelled.</p>
      </div>
      <div class="p4-pad">
        <label class="sr-only" for="p4-officer-notes">Officer notes for Annexure 7</label>
        <textarea id="p4-officer-notes" v-model="current.permit.annexure7Notes" rows="4"
                  class="p4-notes" :readonly="readonly"
                  placeholder="Anything specific to this permit that is not a standard clause."
                  @change="save" />
      </div>
    </section>

    <!-- ═══ 6. Final review ════════════════════════════════════════════ -->
    <section class="p4-card" aria-labelledby="p4-review">
      <header><h3 id="p4-review">Final permit review</h3></header>
      <dl class="p4-ro-grid">
        <div><dt>Applicant</dt><dd>{{ current.applicant.name || '—' }}</dd></div>
        <div>
          <dt>Property</dt>
          <dd>{{ current.property.standNo || '—' }}{{ current.property.ward ? `, ${current.property.ward}` : '' }}</dd>
        </div>
        <div><dt>Use class</dt><dd>{{ current.permit.useClass ? `Class ${current.permit.useClass}` : '—' }}</dd></div>
        <div><dt>Development</dt><dd>{{ current.permit.permittedDescription || '—' }}</dd></div>
        <div><dt>Conditions</dt><dd>{{ current.permit.conditions.length }}</dd></div>
        <div><dt>Commencement period</dt><dd>{{ current.permit.implementationPeriodMonths }} month(s)</dd></div>
        <div><dt>Decision date</dt><dd>{{ current.permit.decisionDate ?? '—' }}</dd></div>
        <div><dt>Decision authority</dt><dd>{{ current.permit.decisionAuthority || '—' }}</dd></div>
        <div>
          <dt>Appeal</dt>
          <dd>{{ issuance.deadlines.value.appealDeadline ?? 'As prescribed by the Act (period unconfirmed)' }}</dd>
        </div>
        <div v-if="current.permit.issueDate">
          <dt>Issued</dt>
          <dd>{{ toDateOnly(current.permit.issueDate) }} by {{ current.permit.issuingOfficer }}</dd>
        </div>
        <div v-if="current.permit.documentVersion">
          <dt>Document version</dt><dd>v{{ current.permit.documentVersion }}</dd>
        </div>
      </dl>

      <div v-if="!readonly" class="p4-confirm">
        <label>
          <input type="checkbox" v-model="issuance.confirmed.value" />
          <span>
            I confirm that I have reviewed the permit details, conditions and decision
            requirements, and that I am authorised to issue this decision.
          </span>
        </label>
      </div>
    </section>

    <!-- ═══ 7. Issue ═══════════════════════════════════════════════════ -->
    <div class="p4-actions">
      <button v-if="!readonly" type="button" class="p4-issue"
              :disabled="issuance.issuing.value || issuance.conflict.value"
              :aria-busy="issuance.issuing.value"
              @click="onIssue">
        <Loader2 v-if="issuance.issuing.value" :size="14" class="spin" aria-hidden="true" />
        <FileSignature v-else :size="14" aria-hidden="true" />
        {{ issuance.issuing.value ? 'Issuing permit…' : 'Issue permit' }}
      </button>

      <p v-else class="p4-issued-note">
        <Lock :size="13" aria-hidden="true" />
        <span>
          Issued{{ current.permit.issueDate ? ` on ${toDateOnly(current.permit.issueDate)}` : '' }}.
          <!-- No amendment workflow exists in this system yet, so this must not
               tell an officer to "use" one. Say what is actually true. -->
          Amendments under s.26(12) are not yet handled in this system — a variation
          must be processed as a new application and cross-referenced to this permit.
        </span>
      </p>

      <button type="button" class="p4-btn" @click="onDownload">
        <Download :size="13" aria-hidden="true" />
        {{ readonly ? 'Download permit' : 'Download draft' }}
      </button>
    </div>
  </div>

  <p v-else class="p4-nocase">No case is open.</p>
</template>

<style scoped>
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }

.step4 { display:flex; flex-direction:column; gap:1rem; padding:1rem; color:var(--sw-text); }
.p4-nocase { padding:1.5rem; font-size:0.8rem; color:var(--sw-muted); }

/* ── Header ── */
.p4-head { display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap;
  padding:0.75rem 0.85rem; border:1px solid var(--sw-border-soft);
  border-radius:var(--sw-radius); background:var(--sw-surface); box-shadow:var(--sw-shadow); }
.p4-head-main { flex:1; min-width:16rem; }
.p4-head h2 { margin:0 0 0.4rem; font-size:0.95rem; font-weight:700; }
.p4-facts { display:flex; flex-wrap:wrap; gap:0.15rem 1.1rem; margin:0; }
.p4-facts > div { display:flex; gap:0.35rem; align-items:baseline; }
.p4-facts dt { font-size:0.66rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--sw-muted); }
.p4-facts dd { margin:0; font-size:0.74rem; font-weight:600; color:var(--sw-text); }

.p4-banner { display:flex; gap:0.4rem; align-items:flex-start; margin:0;
  padding:0.45rem 0.6rem; border-radius:var(--sw-radius-sm);
  border:1px solid transparent; font-size:0.72rem; max-width:24rem; }
.p4-banner strong { display:block; }
.p4-banner-body { display:block; font-weight:400; opacity:0.9; margin-top:0.1rem; }
.p4-banner.ok   { background:var(--sw-green-bg); color:var(--sw-green); border-color:var(--sw-green-border); }
.p4-banner.bad  { background:var(--sw-red-bg);   color:var(--sw-red);   border-color:var(--ent-tone-negative-line); }
.p4-banner.warn { background:var(--sw-amber-bg); color:var(--sw-amber-text); border-color:var(--sw-amber-border); }
.p4-banner.busy { background:var(--sw-surface-3); color:var(--sw-text-2); border-color:var(--sw-border-soft); }

.spin { animation:p4-spin 1s linear infinite; flex-shrink:0; }
@keyframes p4-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation:none; } }

/* ── Cards ── */
.p4-card { border:1px solid var(--sw-border-soft); border-radius:var(--sw-radius);
  background:var(--sw-surface); box-shadow:var(--sw-shadow); overflow:hidden; }
.p4-card > header { padding:0.55rem 0.8rem; background:var(--sw-surface-2);
  border-bottom:1px solid var(--sw-border-soft); }
.p4-card > header h3 { margin:0; font-size:0.8rem; font-weight:700; }

.p4-sub { padding:0.6rem 0.8rem 0.2rem; }
.p4-sub h4 { margin:0; font-size:0.66rem; font-weight:700; text-transform:uppercase;
  letter-spacing:0.06em; color:var(--sw-text-2); }
.p4-hint { margin:0.15rem 0 0; font-size:0.68rem; line-height:1.45; color:var(--sw-muted); }
.p4-pad { padding-left:0.8rem; padding-right:0.8rem; }

.p4-ro-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(13rem, 1fr));
  gap:0.5rem 1rem; margin:0; padding:0.5rem 0.8rem 0.75rem; }
.p4-ro-grid > div { display:flex; flex-direction:column; gap:0.1rem; min-width:0; }
.p4-ro-grid dt { font-size:0.64rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--sw-muted); }
.p4-ro-grid dd { margin:0; font-size:0.76rem; color:var(--sw-text); word-break:break-word; }

.p4-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(14rem, 1fr));
  gap:0.6rem 1rem; padding:0.5rem 0.8rem 0.85rem; }
.p4-grid label { display:flex; flex-direction:column; gap:0.2rem; min-width:0; }
.p4-grid label > span:first-child { font-size:0.68rem; font-weight:600; color:var(--sw-text-2); }
.p4-grid label.p4-wide { grid-column:1 / -1; }
.p4-grid :is(input, select, textarea) { font:inherit; font-size:0.75rem;
  padding:0.35rem 0.5rem; border:1px solid var(--sw-border); border-radius:0.3rem;
  background:var(--sw-surface); color:var(--sw-text); width:100%; box-sizing:border-box; }
.p4-grid textarea { resize:vertical; line-height:1.5; }
.p4-grid :is(input, textarea):read-only,
.p4-grid select:disabled { background:var(--sw-surface-3); color:var(--sw-text-2); }

.p4-err { font-size:0.68rem; font-weight:600; color:var(--sw-red); }

.p4-tpl-row { display:flex; flex-wrap:wrap; gap:0.3rem; padding:0.4rem 0.8rem 0.2rem; }
.p4-tpl { display:inline-flex; align-items:center; gap:0.2rem; cursor:pointer;
  font-size:0.66rem; font-weight:600; padding:0.25rem 0.45rem;
  border:1px solid var(--sw-border); border-radius:0.3rem;
  background:var(--sw-surface); color:var(--sw-primary); }
.p4-tpl:hover:not(:disabled) { background:var(--sw-primary-tint); }
.p4-tpl:disabled { opacity:0.45; cursor:not-allowed; color:var(--sw-muted); }
.p4-cond-list { list-style:none; margin:0; padding:0.5rem 0.8rem 0.8rem;
  display:flex; flex-direction:column; gap:0.5rem; }
.p4-empty { margin:0; padding:0.6rem 0.8rem 0.85rem; font-size:0.72rem; color:var(--sw-muted); }

.p4-clauses { margin:0; padding:0.35rem 0.8rem 0.6rem 1.9rem;
  display:flex; flex-direction:column; gap:0.6rem; }
.p4-clauses li { font-size:0.74rem; }
.p4-clause-text { margin:0; line-height:1.5; color:var(--sw-text); }
.p4-clause-meta { display:flex; flex-wrap:wrap; gap:0.3rem 0.6rem; margin:0.2rem 0 0;
  font-size:0.63rem; color:var(--sw-muted); }
.p4-clause-note { margin:0.25rem 0 0; font-size:0.66rem; line-height:1.45; color:var(--sw-amber-text); }
.p4-tag { font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
  padding:0.05rem 0.3rem; border-radius:0.2rem;
  background:var(--sw-surface-3); color:var(--sw-text-2); border:1px solid var(--sw-border-soft); }
.p4-tag.warn { background:var(--sw-amber-bg); color:var(--sw-amber-text); border-color:var(--sw-amber-border); }

.p4-notes { width:100%; box-sizing:border-box; font:inherit; font-size:0.75rem;
  line-height:1.5; padding:0.4rem 0.5rem; resize:vertical; margin-bottom:0.8rem;
  border:1px solid var(--sw-border); border-radius:0.3rem;
  background:var(--sw-surface); color:var(--sw-text); }
.p4-notes:read-only { background:var(--sw-surface-3); color:var(--sw-text-2); }

.p4-alert { display:flex; gap:0.5rem; align-items:flex-start;
  padding:0.6rem 0.7rem; border-radius:var(--sw-radius-sm);
  border:1px solid transparent; font-size:0.72rem; }
.p4-alert p { margin:0.15rem 0 0; line-height:1.45; }
.p4-alert.bad  { background:var(--sw-red-bg); color:var(--sw-red); border-color:var(--ent-tone-negative-line); }
.p4-alert.warn { background:var(--sw-amber-bg); color:var(--sw-amber-text);
  border-color:var(--sw-amber-border); margin-bottom:0.6rem; }
.p4-alert > div { flex:1; min-width:0; }

.p4-confirm { padding:0 0.8rem 0.85rem; }
.p4-confirm label { display:flex; gap:0.5rem; align-items:flex-start;
  padding:0.55rem 0.65rem; cursor:pointer;
  border:1px solid var(--sw-border); border-radius:var(--sw-radius-sm);
  background:var(--sw-surface-2); font-size:0.73rem; line-height:1.5; }
.p4-confirm input { margin-top:0.15rem; width:0.95rem; height:0.95rem;
  accent-color:var(--sw-primary); flex-shrink:0; }

.p4-actions { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; }
.p4-issue { display:inline-flex; align-items:center; justify-content:center; gap:0.35rem;
  padding:0.55rem 1.1rem; border:none; border-radius:var(--sw-radius-sm);
  background:var(--sw-primary); color:var(--sw-on-primary);
  font-size:0.78rem; font-weight:700; cursor:pointer; }
.p4-issue:hover:not(:disabled) { background:var(--sw-primary-container); }
.p4-issue:disabled { background:var(--sw-muted); cursor:not-allowed; }
.p4-btn { display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.45rem 0.75rem; border:1px solid var(--sw-border); border-radius:0.3rem;
  background:var(--sw-surface); color:var(--sw-text-2);
  font-size:0.72rem; font-weight:600; cursor:pointer; }
.p4-btn:hover { background:var(--sw-surface-3); color:var(--sw-text); }
.p4-issued-note { display:flex; align-items:flex-start; gap:0.35rem; margin:0;
  font-size:0.73rem; font-weight:600; color:var(--sw-green); max-width:38rem; line-height:1.5; }
.p4-issued-note svg { flex-shrink:0; margin-top:0.15rem; }

/* Unverified-prerequisite override */
.p4-override { border-color:var(--sw-amber-border); }
.p4-override > header { background:var(--sw-amber-bg); border-color:var(--sw-amber-border); }
.p4-override > header h3 { color:var(--sw-amber-text); }
.p4-override-body { padding-top:0.6rem; padding-bottom:0.2rem; }
.p4-override-lead { margin:0; font-size:0.74rem; font-weight:600; color:var(--sw-text); }
.p4-override-list { margin:0.35rem 0 0.5rem; padding-left:1.1rem;
  font-size:0.72rem; line-height:1.5; color:var(--sw-text-2); }
.p4-override-label { display:block; margin:0.5rem 0 0.2rem;
  font-size:0.68rem; font-weight:600; color:var(--sw-text-2); }

.p4-btn--inline { align-self:flex-start; margin-top:0.3rem; }
.p4-btn--inline:disabled { opacity:0.5; cursor:not-allowed; }

/* Visible focus (WCAG 2.2 AA, 2.4.7) */
.step4 :is(input, select, textarea, button):focus-visible {
  outline:2px solid var(--sw-primary); outline-offset:2px;
}

@media (max-width: 700px) {
  .step4 { padding:0.75rem; gap:0.75rem; }
  .p4-banner { max-width:none; }
  .p4-actions { flex-direction:column; align-items:stretch; }
  .p4-issue, .p4-btn { justify-content:center; }
}
</style>
