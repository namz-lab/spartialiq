<script setup lang="ts">
// File movement register — where the paper is.
//
// WHY A DIGITAL SYSTEM STILL NEEDS THIS
// The workflow is digital; the file is not. The signed plans, the certified
// title deed, the bondholder's consent and the original TPD form with the
// applicant's signature on it are paper, they live in one folder, and that
// folder goes to the planner, to committee, to the Chief Executive for
// signature and sometimes out of the building to the Department. A planning
// office with no movement register loses days a month to files nobody can
// find, and the person who gets asked is the clerk.
//
// ONE OPEN MOVEMENT PER FILE
// A file is in one place at a time. The partial unique index in migration 125
// refuses a second sign-out while the first is open, and the server says so
// in words: "This file is already signed out and has not come back."

import { computed, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import {
  asLabel, deadlineTone, formatDate, toDateInput, toDateTimeInput,
} from '@/planning-clerk/console'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { updateEntry, errorMessage, num } from '@/services/planningClerk'
import UiButton from '@/components/ui/UiButton.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import { AlertTriangle, FolderInput, FolderCheck, CheckCircle2 } from 'lucide-vue-next'

const overview = useClerkOverview()

const DESTINATIONS = [
  { value: 'planner', label: 'Planner' },
  { value: 'eo_planner', label: 'Executive Officer (Planning)' },
  { value: 'gis_officer', label: 'GIS Officer' },
  { value: 'building_inspector', label: 'Building Inspector' },
  { value: 'env_officer', label: 'Environmental Health Officer' },
  { value: 'committee', label: 'Committee' },
  { value: 'legal', label: 'Legal' },
  { value: 'treasury', label: 'Treasury' },
  { value: 'registry', label: 'Registry' },
  { value: 'chief_executive', label: 'Chief Executive' },
  { value: 'external', label: 'Outside the council' },
  { value: 'other', label: 'Other' },
] as const

const CONDITIONS = [
  { value: 'intact', label: 'Intact — everything is there' },
  { value: 'incomplete', label: 'Incomplete — something is missing' },
  { value: 'damaged', label: 'Damaged' },
] as const

const columns = computed<ClerkColumn[]>(() => [
  {
    key: 'tpd_reference', label: 'File', mono: true,
    value: (r) => (r.tpd_reference as string) || (r.stand_number as string) || '—',
  },
  { key: 'holder_name', label: 'Held by' },
  { key: 'destination', label: 'Where', value: (r) => asLabel(r.destination as string) },
  { key: 'issued_at', label: 'Signed out', nowrap: true, value: (r) => formatDate(r.issued_at as string) },
  {
    key: 'due_back_on',
    label: 'Status',
    nowrap: true,
    value: (r) => (r.returned_at
      ? `Back ${formatDate(r.returned_at as string)}`
      : deadlineTone(r.due_back_on as string).label),
    tone: (r) => {
      const t = deadlineTone(r.due_back_on as string, r.returned_at as string | null).tone
      return t === 'done' ? 'positive'
        : t === 'overdue' ? 'negative'
        : t === 'today' || t === 'soon' ? 'warning'
        : 'neutral'
    },
  },
  { key: 'purpose', label: 'Why', secondary: true },
  {
    key: 'returned_condition', label: 'Condition back',
    value: (r) => asLabel(r.returned_condition as string),
    // A file that came back incomplete or damaged is a problem that outlives
    // the movement, so it stays coloured after the row is closed.
    tone: (r) => (['incomplete', 'damaged'].includes(r.returned_condition as string)
      ? 'negative' : null),
    secondary: true,
  },
  { key: 'issued_by_name', label: 'Issued by', secondary: true },
])

const fields = computed<ClerkField[]>(() => {
  const now = new Date()
  const twoWeeks = new Date(now.getTime() + 14 * 86_400_000)
  return [
    { name: 'holder_name', label: 'Signed out to', type: 'text', required: true,
      placeholder: 'The person taking the file, not the department' },
    { name: 'destination', label: 'Where it is going', type: 'select', required: true,
      options: DESTINATIONS, initial: 'planner' },
    { name: 'issued_at', label: 'Signed out at', type: 'datetime',
      initial: () => toDateTimeInput(now.toISOString()) },
    { name: 'due_back_on', label: 'Due back', type: 'date', required: true,
      initial: () => toDateInput(twoWeeks.toISOString()),
      hint: 'A movement with no return date is how a file is lost politely.' },
    { name: 'purpose', label: 'What it is for', type: 'text', required: true, full: true,
      placeholder: 'e.g. Committee report for the 14 October meeting' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true },
  ]
})

// ── Record a return ─────────────────────────────────────────────────────
// The condition is asked for because it is the only moment anybody checks.
// A file that comes back without its title-deed copy is a problem the clerk
// needs to raise while the person who had it is still standing there.

const returnTarget = ref<Record<string, unknown> | null>(null)
const returnCondition = ref<string>('intact')
const returnAt = ref('')
const returning = ref(false)
const returnError = ref<string | null>(null)
let reloadRegister: (() => Promise<void>) | null = null

function askReturn(row: Record<string, unknown>, reload: () => Promise<void>) {
  returnTarget.value = row
  returnCondition.value = 'intact'
  returnAt.value = toDateTimeInput(new Date().toISOString())
  returnError.value = null
  reloadRegister = reload
}

async function confirmReturn() {
  if (!returnTarget.value) return
  returning.value = true
  returnError.value = null
  try {
    await updateEntry('movements', returnTarget.value.id as string, {
      returned_at: new Date(returnAt.value).toISOString(),
      returned_condition: returnCondition.value,
    })
    returnTarget.value = null
    overview.invalidate()
    await reloadRegister?.()
  } catch (err) {
    returnError.value = errorMessage(err, 'The return was not recorded.')
  } finally {
    returning.value = false
  }
}

const out = computed(() => num(overview.data.value?.movements.files_out))
const late = computed(() => num(overview.data.value?.movements.files_overdue))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Registers</span>
        <h2 class="ins-title">File movement</h2>
        <p class="ins-lede">
          The workflow is digital; the file is not. Signed plans, the title deed
          copy and the original signed TPD form travel as paper, and this is
          where they are. One open movement per file — a file is in one place
          at a time.
        </p>
      </div>
    </header>

    <p v-if="late" class="ins-banner t-negative" role="status">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>
        <strong>{{ late }} file{{ late === 1 ? '' : 's' }} past the return date.</strong>
        {{ out }} out in total.
      </span>
    </p>
    <p v-else-if="out" class="ins-banner t-info" role="status">
      <FolderInput :size="15" aria-hidden="true" />
      <span>{{ out }} file{{ out === 1 ? ' is' : 's are' }} signed out, all within date.</span>
    </p>
    <p v-else class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" />
      <span>Every file is in registry.</span>
    </p>

    <ClerkRegister
      register="movements"
      title="File movements"
      add-label="Sign a file out"
      search-hint="Holder name or purpose"
      requires-file
      :columns="columns"
      :fields="fields"
    >
      <template #row-actions="{ row, reload }">
        <UiButton v-if="!row.returned_at && !row.voided_at" size="sm" variant="secondary"
                  @click="askReturn(row, reload)">
          <template #icon><FolderCheck :size="13" /></template>
          Record return
        </UiButton>
      </template>
    </ClerkRegister>

    <UiSheet :open="!!returnTarget" title="Record the file’s return"
             subtitle="Check it before the person who had it leaves"
             width="30rem" @close="returnTarget = null" @update:open="returnTarget = null">
      <form class="clk-ret" @submit.prevent="confirmReturn">
        <p class="ins-banner t-info">
          <FolderCheck :size="15" aria-hidden="true" />
          <span>
            <strong class="ins-mono">{{ returnTarget?.tpd_reference || 'File' }}</strong>
            back from {{ returnTarget?.holder_name }}.
          </span>
        </p>

        <p v-if="returnError" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ returnError }}</span>
        </p>

        <div class="ins-form">
          <div class="ins-field">
            <label class="ins-label" for="clk-mv-when">Returned at</label>
            <input id="clk-mv-when" v-model="returnAt" type="datetime-local" class="ins-input" required />
          </div>
          <div class="ins-field">
            <label class="ins-label" for="clk-mv-cond">Condition</label>
            <select id="clk-mv-cond" v-model="returnCondition" class="ins-input" required>
              <option v-for="c in CONDITIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
            <p class="ins-hint">
              This is the only moment anybody checks. If something is missing,
              say so now while the person who had it is still here.
            </p>
          </div>
        </div>

        <div class="clk-ret-foot">
          <UiButton variant="ghost" type="button" @click="returnTarget = null">Cancel</UiButton>
          <UiButton variant="primary" type="submit" :loading="returning">Record return</UiButton>
        </div>
      </form>
    </UiSheet>
  </div>
</template>

<style scoped>
.clk-ret { display:flex; flex-direction:column; gap:var(--ent-s4); }
.clk-ret-foot { display:flex; justify-content:flex-end; gap:var(--ent-s2);
  padding-top:var(--ent-s3); border-top:1px solid var(--ent-line); }
</style>
