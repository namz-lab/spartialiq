<script setup lang="ts">
// Correspondence log — every letter, email, fax, phone call and counter visit
// coming into or going out of the Planning office.
//
// This register used to live in localStorage, which meant the office's post
// book existed on exactly one machine and vanished with the browser cache.
// It is now spatial_planning.clerk_correspondence (migration 125).
//
// The file link is OPTIONAL here and required on most of the other registers,
// because a great deal of a planning office's post arrives before there is an
// application to attach it to — a pre-application enquiry, a complaint about
// a stand, a letter from the Department. A log that refused those is a log the
// clerk keeps on paper instead.

import { computed } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import { asLabel, formatWhen, toDateTimeInput } from '@/planning-clerk/console'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-vue-next'

const CHANNELS = [
  { value: 'letter', label: 'Letter' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telephone' },
  { value: 'in_person', label: 'In person at the counter' },
  { value: 'fax', label: 'Fax' },
] as const

const columns = computed<ClerkColumn[]>(() => [
  {
    key: 'direction',
    label: 'Dir.',
    nowrap: true,
    value: (r) => (r.direction === 'in' ? 'In' : 'Out'),
    // Incoming post is something the office must answer; outgoing is
    // something it has already done. Two tones, not two colours for decoration.
    tone: (r) => (r.direction === 'in' ? 'warning' : 'info'),
  },
  { key: 'logged_at', label: 'Date', nowrap: true, value: (r) => formatWhen(r.logged_at as string) },
  { key: 'ref_no', label: 'Reference', mono: true },
  { key: 'party', label: 'From / to' },
  { key: 'subject', label: 'Subject' },
  { key: 'channel', label: 'Channel', value: (r) => asLabel(r.channel as string), secondary: true },
  {
    key: 'tpd_reference',
    label: 'File',
    mono: true,
    value: (r) => (r.tpd_reference as string) || (r.dev_register_no as string) || 'No file',
    secondary: true,
  },
  { key: 'attached_doc_ref', label: 'Attachment', mono: true, secondary: true },
  { key: 'logged_by_name', label: 'Logged by', secondary: true },
])

const fields: ClerkField[] = [
  {
    name: 'direction', label: 'Direction', type: 'select', required: true,
    options: [{ value: 'in', label: 'Incoming' }, { value: 'out', label: 'Outgoing' }],
    initial: 'in',
  },
  {
    name: 'logged_at', label: 'Date and time', type: 'datetime',
    initial: () => toDateTimeInput(new Date().toISOString()),
    hint: 'When it arrived or went out, not when you are typing it.',
  },
  {
    name: 'ref_no', label: 'Reference', type: 'text', required: true,
    placeholder: 'File ref, register number, or their reference',
  },
  {
    name: 'party', label: 'From (incoming) or to (outgoing)', type: 'text', required: true,
    placeholder: 'Person, firm or department',
  },
  {
    name: 'channel', label: 'Channel', type: 'select', required: true,
    options: CHANNELS, initial: 'letter',
  },
  {
    name: 'attached_doc_ref', label: 'Attachment reference', type: 'text',
    hint: 'Where the physical document is filed, if there is one.',
  },
  { name: 'subject', label: 'Subject', type: 'text', required: true, full: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
]
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Registers</span>
        <h2 class="ins-title">Correspondence log</h2>
        <p class="ins-lede">
          Everything in and out of the Planning office. Post that arrives before
          there is a file is logged without one — attach it later by opening the
          file and logging against it.
        </p>
      </div>
    </header>

    <ClerkRegister
      register="correspondence"
      title="Correspondence"
      add-label="Log correspondence"
      search-hint="Reference, party, subject or attachment"
      :columns="columns"
      :fields="fields"
    >
      <template #summary="{ rows }">
        <div v-if="rows.length" class="clk-corr-tally">
          <span class="clk-corr-stat">
            <ArrowDownLeft :size="14" aria-hidden="true" />
            {{ rows.filter(r => r.direction === 'in' && !r.voided_at).length }} in
          </span>
          <span class="clk-corr-stat">
            <ArrowUpRight :size="14" aria-hidden="true" />
            {{ rows.filter(r => r.direction === 'out' && !r.voided_at).length }} out
          </span>
          <span class="clk-corr-note">on this page</span>
        </div>
      </template>
    </ClerkRegister>
  </div>
</template>

<style scoped>
.clk-corr-tally { display:flex; align-items:center; gap:var(--ent-s4);
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r);
  background:var(--ent-surface-2); font-size:var(--ent-fs-sm); }
.clk-corr-stat { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-weight:var(--ent-fw-semibold); color:var(--ent-text-2);
  font-variant-numeric:tabular-nums; }
.clk-corr-note { margin-left:auto; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
</style>
