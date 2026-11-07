<script setup lang="ts">
// Overview — what needs an IT administrator's attention right now.
//
// WHAT THIS IS NOT
// It is not a hero-metric dashboard. The anti-reference in PRODUCT.md is the
// generic SaaS dashboard whose top row is four big numbers nobody acts on, and
// a council IT console is exactly where that temptation is strongest: staff
// count, session count, event count, uptime — four figures, no decisions.
//
// So the tiles here are not counts, they are QUESTIONS WITH ANSWERS. Each one
// states a condition, says whether it holds, and opens the section where it
// would be dealt with. A tile with nothing wrong says so in words rather than
// showing a zero, because "0" and "we could not check" look identical and only
// one of them is safe on a security screen.
//
// The plain counts still exist — they are the register summary at the bottom,
// in a sentence, which is where a number nobody acts on belongs.

import { computed } from 'vue'
import { useAdminOverview } from '@/admin/useAdminOverview'
import { useAdminNav } from '@/admin/useAdminConsole'
import { timeAgo } from '@/admin/console'
import {
  ShieldAlert, UserX, MailWarning, SendHorizontal, Network, Megaphone,
  CheckCircle2, ChevronRight, Wrench, ScrollText,
} from 'lucide-vue-next'

const overview = useAdminOverview()
const nav = useAdminNav()

type Tone = 'positive' | 'warning' | 'negative' | 'info'

interface Attention {
  id: string
  icon: typeof ShieldAlert
  /** The condition, in the council's words. */
  title: string
  /** What is true right now. */
  detail: string
  tone: Tone
  /** Where it would be dealt with. */
  to: () => void
  cta: string
}

const o = overview.data

/**
 * The attention list.
 *
 * Ordered by what would hurt most if ignored, not by section order: a lockout
 * in force stops an officer working today; a vacant post is a record-keeping
 * matter. Everything is included whether or not it is currently triggered —
 * a security console that hides the sign-in check when nothing is wrong
 * teaches the reader that its absence means nothing, rather than "clear".
 */
const items = computed<Attention[]>(() => {
  const d = o.value
  if (!d) return []
  return [
    {
      id: 'maintenance',
      icon: Wrench,
      title: 'Maintenance mode',
      detail: overview.maintenanceMode.value
        ? 'On. Every officer except you is being refused any change to council records.'
        : 'Off. The portal is accepting work normally.',
      tone: overview.maintenanceMode.value ? 'warning' : 'positive',
      to: () => nav.go('settings'),
      cta: overview.maintenanceMode.value ? 'End the window' : 'Open settings',
    },
    {
      id: 'signin',
      icon: ShieldAlert,
      title: 'Sign-in attempts',
      detail: d.security.failedLogins24h === 0
        ? 'No failed sign-in in the last 24 hours.'
        : `${d.security.failedLogins24h} failed sign-in${d.security.failedLogins24h === 1 ? '' : 's'} in the last 24 hours.`,
      tone: d.security.failedLogins24h === 0 ? 'positive'
        : d.security.failedLogins24h > 20 ? 'negative' : 'warning',
      // Arrives pre-filtered to failures: the tile named a number, so the
      // screen it opens should be showing that number's rows.
      to: () => nav.go('signin', { status: 'failures' }),
      cta: 'Review sign-ins',
    },
    {
      id: 'suspended',
      icon: UserX,
      title: 'Suspended accounts',
      detail: d.staff.suspended === 0
        ? 'No staff account is currently suspended.'
        : `${d.staff.suspended} staff account${d.staff.suspended === 1 ? ' is' : 's are'} suspended.`,
      tone: d.staff.suspended === 0 ? 'positive' : 'info',
      to: () => nav.go('employees', { status: 'suspended' }),
      cta: 'Open the register',
    },
    {
      id: 'invites',
      icon: MailWarning,
      title: 'Invitations',
      detail: d.invites.expired === 0
        ? `${d.invites.open} invitation${d.invites.open === 1 ? '' : 's'} outstanding, none expired.`
        : `${d.invites.expired} invitation${d.invites.expired === 1 ? ' has' : 's have'} expired unused.`,
      tone: d.invites.expired === 0 ? 'positive' : 'warning',
      to: () => nav.go('invitations'),
      cta: 'Open invitations',
    },
    {
      id: 'outbox',
      icon: SendHorizontal,
      title: 'Outgoing messages',
      detail: d.outbox.failed === 0
        ? `${d.outbox.pending} message${d.outbox.pending === 1 ? '' : 's'} waiting to send, none failed.`
        : `${d.outbox.failed} message${d.outbox.failed === 1 ? '' : 's'} failed to send and ${d.outbox.failed === 1 ? 'is' : 'are'} not being retried.`,
      tone: d.outbox.failed === 0 ? 'positive' : 'negative',
      to: () => nav.go('jobs', { status: 'failed' }),
      cta: 'Open the queue',
    },
    {
      id: 'audit',
      icon: ScrollText,
      title: 'Notable changes',
      detail: d.audit.events24h === 0
        ? 'Nothing recorded in the last 24 hours. If officers have been working, the trail is not being written.'
        : `${d.audit.events24h} change${d.audit.events24h === 1 ? '' : 's'} recorded in 24 hours, ${d.security.notable7d} of them significant this week.`,
      // A silent trail is the failure this console exists to make visible, so
      // zero is a warning here and not a clean result.
      tone: d.audit.events24h === 0 ? 'warning' : 'info',
      to: () => nav.go('audit'),
      cta: 'Open the trail',
    },
    {
      id: 'org',
      icon: Network,
      title: 'Establishment',
      detail: d.org.vacancies === 0
        ? 'Every post on the establishment has a holder.'
        : `${d.org.vacancies} post${d.org.vacancies === 1 ? ' is' : 's are'} vacant.`,
      tone: d.org.vacancies === 0 ? 'positive' : 'info',
      to: () => nav.go('org'),
      cta: 'Open the structure',
    },
    {
      id: 'announcements',
      icon: Megaphone,
      title: 'Service announcements',
      detail: d.announcements.live === 0
        ? 'Nothing is being shown to staff or citizens.'
        : `${d.announcements.live} announcement${d.announcements.live === 1 ? ' is' : 's are'} live.`,
      tone: 'info',
      to: () => nav.go('announcements'),
      cta: 'Open announcements',
    },
  ]
})

/** Triggered conditions first, so the screen leads with the work. */
const sorted = computed(() => {
  const rank: Record<Tone, number> = { negative: 0, warning: 1, info: 2, positive: 3 }
  return [...items.value].sort((a, b) => rank[a.tone] - rank[b.tone])
})

const allClear = computed(() =>
  items.value.length > 0 && items.value.every(i => i.tone === 'positive' || i.tone === 'info'))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">IT Administration</span>
        <h2 class="ins-title">Overview</h2>
        <p class="ins-lede">
          Every check this console can make, with its current answer. Each one opens
          the screen where it would be dealt with.
        </p>
      </div>
    </header>

    <div v-if="overview.loading.value && !o" class="ov-loading" role="status">
      <span v-for="n in 6" :key="n" class="ins-skel ov-skel" />
      <span class="ent-sr-only">Reading the console counters</span>
    </div>

    <!-- A failure is the shell's toast to report; here the list simply stays
         absent rather than rendering every check as a reassuring zero. -->
    <p v-else-if="!o" class="ov-unknown">
      The counters could not be read, so nothing below can be shown as checked.
      Use the Refresh control in the header to try again.
    </p>

    <template v-else>
      <p v-if="allClear" class="ov-clear">
        <CheckCircle2 :size="16" aria-hidden="true" />
        Nothing is currently waiting on you.
      </p>

      <ul class="ov-grid">
        <li v-for="item in sorted" :key="item.id" class="ov-item" :class="`t-${item.tone}`">
          <span class="ov-icon"><component :is="item.icon" :size="17" aria-hidden="true" /></span>
          <div class="ov-text">
            <h3 class="ov-title">{{ item.title }}</h3>
            <p class="ov-detail">{{ item.detail }}</p>
          </div>
          <button type="button" class="ov-cta" @click="item.to()">
            {{ item.cta }}
            <ChevronRight :size="14" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <!-- The plain counts, in a sentence. This is where a number nobody acts
           on belongs — not in a tile that implies it is a decision. -->
      <section class="ins-card">
        <div class="ins-card-head"><h3>The register, in one line</h3></div>
        <div class="ins-card-body">
          <p class="ov-summary">
            {{ o.staff.total }} staff account{{ o.staff.total === 1 ? '' : 's' }}
            ({{ o.staff.active }} active, {{ o.staff.pending }} pending, {{ o.staff.suspended }} suspended)
            and {{ o.citizens.toLocaleString() }} registered citizen{{ o.citizens === 1 ? '' : 's' }}.
            {{ o.sessions.live }} session{{ o.sessions.live === 1 ? '' : 's' }} open
            across {{ o.sessions.users }} {{ o.sessions.users === 1 ? 'person' : 'people' }}.
            {{ o.security.ipBlocks }} network block{{ o.security.ipBlocks === 1 ? '' : 's' }} in force.
          </p>
          <p class="ov-stamp">
            Counted {{ timeAgo(new Date().toISOString()) }}; re-read whenever you change section.
          </p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ov-loading { display:grid; grid-template-columns:repeat(auto-fit, minmax(20rem, 1fr)); gap:var(--ent-s3); }
.ov-skel { height:5.25rem; border-radius:var(--ent-r-md); }

.ov-unknown { margin:0; padding:var(--ent-s5); max-width:60ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }

.ov-clear { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-success); }

.ov-grid { list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fit, minmax(21rem, 1fr)); gap:var(--ent-s3); }

/* Two rows, not one: with the call to action as a flex sibling of the text, a
   long label ("Open announcements") squeezed the heading into a three-line
   wrap at three columns across. The text now owns the full width and the
   action sits beneath it, which also removes the need for a mobile override. */
.ov-item { display:grid; grid-template-columns:auto minmax(0, 1fr);
  gap:var(--ent-s1) var(--ent-s3); align-items:start;
  padding:var(--ent-s4); min-width:0;
  background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); }

/* The ICON carries the tone, and nothing else needs to. A tinted left rule
   here said the same thing a second time — and a signal repeated is a signal
   the eye stops reading as information. The tile also states its condition in
   words, and the list is sorted so anything triggered is already at the top,
   so the tone is the third-weakest cue on the screen rather than the first. */
.ov-icon { display:inline-flex; flex-shrink:0; margin-top:1px; color:var(--ent-text-3); }
.ov-item.t-negative .ov-icon { color:var(--ent-danger); }
.ov-item.t-warning  .ov-icon { color:var(--ent-warning); }
.ov-item.t-positive .ov-icon { color:var(--ent-success); }
.ov-item.t-info     .ov-icon { color:var(--ent-accent); }

.ov-text { flex:1; min-width:0; }
.ov-title { margin:0; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.ov-detail { margin:2px 0 0; font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2); }

.ov-cta { grid-column:2; justify-self:start; margin-top:var(--ent-s2);
  display:inline-flex; align-items:center; gap:2px;
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3) 0 var(--ent-s2);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); background:transparent;
  border:1px solid transparent; border-radius:var(--ent-r); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.ov-cta:hover { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); }
.ov-cta:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.ov-summary { margin:0; font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text); max-width:80ch; }
.ov-stamp { margin:var(--ent-s2) 0 0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

</style>
