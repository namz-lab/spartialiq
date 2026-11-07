<script setup lang="ts">
defineOptions({ name: 'PlanLookupView' })
// PlanLookupView — "What can I build here?" A public page: type a stand number or a farm name, see what the
// council's plan says about that land.
//
// WHAT IT SHOWS IS THE SERVER'S ANSWER, NOT THE PAGE'S
// The server decides which plan a visitor may see (the public sees a plan only once it is gazetted). A parcel with no
// visible plan is "not published": the same answer as a parcel in no zone, so the page cannot be used to learn what is
// in preparation. The page never says "allowed" for a use the plan has not decided.
//
// Written for a phone: one column, short sentences, plain words (no codes, no jargon without a gloss).
import { computed, nextTick, ref } from 'vue'
import { ArrowLeft, Search } from 'lucide-vue-next'
import {
  planLookup, lookupProblem, MIN_QUERY,
  type LookupCandidate, type LookupResult, type LookupUse, type ParcelLookup,
} from '@/services/planLookup'

const query = ref('')
const searching = ref(false)
const problem = ref('')
const candidates = ref<LookupCandidate[] | null>(null)
const result = ref<ParcelLookup | null>(null)
const filter = ref('')
const heading = ref<HTMLElement | null>(null)

const tooShort = computed(() => query.value.trim().length < MIN_QUERY)

async function show(c: LookupCandidate) {
  searching.value = true
  problem.value = ''
  filter.value = ''
  try {
    result.value = await planLookup.lookup(c.layer, c.id)
    candidates.value = null
    await nextTick()
    heading.value?.focus()
  } catch (err) {
    result.value = null
    problem.value = lookupProblem(err, 'We could not look that up. Please try again.')
  } finally {
    searching.value = false
  }
}

async function search() {
  if (tooShort.value) { problem.value = `Enter at least ${MIN_QUERY} letters or digits.`; return }
  searching.value = true
  problem.value = ''
  result.value = null
  candidates.value = null
  try {
    const found = await planLookup.search(query.value.trim())
    if (found.length === 1) { await show(found[0]); return }
    candidates.value = found
  } catch (err) {
    problem.value = lookupProblem(err, 'The search did not work. Please try again.')
  } finally {
    searching.value = false
  }
}

const area = (ha: number | null) => (ha === null ? '' : ha >= 100 ? `${Math.round(ha).toLocaleString('en-US')} ha` : `${ha.toLocaleString('en-US', { maximumFractionDigits: 2 })} ha`)
const describe = (c: { place: string | null; area_ha: number | null }) => [c.place, area(c.area_ha)].filter(Boolean).join(' · ')

// A filter across the three lists, so a person can look for "shop" or "house" without reading them all.
const needle = computed(() => filter.value.trim().toLowerCase())
const matching = (list: LookupUse[]) => (needle.value ? list.filter((u) => `${u.description} ${u.category ?? ''}`.toLowerCase().includes(needle.value)) : list)
const matchCount = (r: LookupResult) => matching(r.uses.permitted).length + matching(r.uses.special_consent).length + matching(r.uses.prohibited).length

// More than one result: the land is split between zones, or covered by more than one plan. Say which; they mean different things.
const splitNote = computed(() => {
  const rs = result.value?.results ?? []
  if (rs.length < 2) return ''
  const plans = new Set(rs.map((r) => r.plan.id))
  return plans.size > 1
    ? 'More than one plan covers this land. The first is the one that covers most of it.'
    : 'This land lies in more than one zone. The first covers most of it. Check each, because the rules differ.'
})

const STATUS_WORDS: Record<string, string> = {
  gazetted: 'in force', approved: 'approved', public_notice: 'out for public notice', draft: 'a draft', unknown: 'not yet confirmed',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
</script>

<template>
  <div class="pl-page">
    <header class="pl-top">
      <router-link to="/" class="pl-back" aria-label="Back to home">
        <ArrowLeft :size="14" aria-hidden="true" />
        <span>Vungu Portal</span>
      </router-link>
    </header>

    <main class="pl-stage">
      <header class="pl-head">
        <p class="pl-eyebrow">Vungu Rural District Council</p>
        <h1 class="pl-title">What can I build here?</h1>
        <p class="pl-lead">
          Enter a stand number or the name of a farm. We will show what the council's plan says about that land.
        </p>
      </header>

      <form class="pl-form" role="search" @submit.prevent="search">
        <label for="pl-q" class="pl-label">Stand number or farm name</label>
        <div class="pl-row">
          <input
            id="pl-q" v-model="query" class="pl-input" type="search" inputmode="text" autocomplete="off" maxlength="64"
            placeholder="For example 1234, or Dorset Farm" />
          <button class="pl-go" type="submit" :disabled="searching">
            <Search :size="16" aria-hidden="true" />
            <span>{{ searching ? 'Looking…' : 'Look up' }}</span>
          </button>
        </div>
      </form>

      <p v-if="problem" class="pl-problem" role="alert">{{ problem }}</p>

      <div aria-live="polite">
        <!-- Several matches: choose one -->
        <section v-if="candidates && candidates.length" class="pl-pick" aria-label="Matching land">
          <h2 class="pl-h2">Which one do you mean?</h2>
          <ul class="pl-cands">
            <li v-for="c in candidates" :key="`${c.layer}:${c.id}`">
              <button type="button" class="pl-cand" @click="show(c)">
                <strong>{{ c.label }}</strong>
                <span v-if="describe(c)">{{ describe(c) }}</span>
              </button>
            </li>
          </ul>
        </section>

        <p v-else-if="candidates && !candidates.length" class="pl-note" data-testid="none-found">
          We could not find any land with that number or name. Check it, or try just part of the name.
        </p>

        <!-- One parcel -->
        <section v-if="result" class="pl-result" aria-label="What the plan says">
          <h2 ref="heading" class="pl-h2 pl-parcel" tabindex="-1">
            {{ result.parcel.label ?? 'This land' }}
          </h2>
          <p v-if="describe(result.parcel)" class="pl-meta">{{ describe(result.parcel) }}</p>

          <div v-if="!result.published" class="pl-card" data-testid="not-published">
            <h3 class="pl-h3">No plan has been published for this land yet</h3>
            <p>
              The council has not published a plan that covers this land, so there is nothing to show here.
              Speak to the council's planning office before you build.
            </p>
          </div>

          <template v-else>
            <p v-if="result.provisional" class="pl-draft" role="status" data-testid="draft-banner">
              <strong>Draft rules, not council policy.</strong>
              You can see this because you are signed in as council staff. The public cannot see it, and it may change.
            </p>
            <p v-if="splitNote" class="pl-note" data-testid="split-note">{{ splitNote }}</p>

            <div class="pl-find">
              <label for="pl-f" class="pl-label">Look for a kind of building or use</label>
              <input id="pl-f" v-model="filter" class="pl-input" type="search" autocomplete="off" placeholder="For example shop, house, workshop" />
            </div>

            <article v-for="r in result.results" :key="r.zone.id" class="pl-zone" :data-zone="r.zone.name">
              <h3 class="pl-zonename">{{ r.zone.name }}</h3>
              <p v-if="result.results.length > 1 && r.share_pct !== null" class="pl-share">About {{ Math.round(r.share_pct) }}% of this land</p>
              <p class="pl-planline">
                {{ r.plan.title }}<template v-if="r.plan.authority">, {{ r.plan.authority }}</template>.
                This plan is {{ STATUS_WORDS[r.plan.status] ?? r.plan.status }}<template v-if="r.plan.gazette_ref">
                  (gazette reference {{ r.plan.gazette_ref }}<template v-if="r.plan.effective_from">, from {{ when(r.plan.effective_from) }}</template>)</template>.
              </p>

              <p v-if="needle && matchCount(r) === 0" class="pl-note" data-testid="no-match">
                Nothing in this zone's list matches "{{ filter.trim() }}".
              </p>

              <details class="pl-list ok" open>
                <summary>Allowed <span class="pl-n">{{ matching(r.uses.permitted).length }}</span></summary>
                <ul>
                  <li v-for="u in matching(r.uses.permitted)" :key="u.code">{{ u.description }}</li>
                </ul>
                <p v-if="!r.uses.permitted.length" class="pl-none">The plan allows nothing outright in this zone.</p>
              </details>

              <details class="pl-list consent" open>
                <summary>Allowed only with the council's consent <span class="pl-n">{{ matching(r.uses.special_consent).length }}</span></summary>
                <p class="pl-gloss">You must ask first. The council may say yes, with conditions, or no.</p>
                <ul>
                  <li v-for="u in matching(r.uses.special_consent)" :key="u.code">
                    {{ u.description }}
                    <span v-if="u.conditions" class="pl-cond">Conditions: {{ u.conditions }}</span>
                  </li>
                </ul>
                <p v-if="!r.uses.special_consent.length" class="pl-none">Nothing in this zone needs special consent.</p>
              </details>

              <details class="pl-list no">
                <summary>Not allowed <span class="pl-n">{{ matching(r.uses.prohibited).length }}</span></summary>
                <ul>
                  <li v-for="u in matching(r.uses.prohibited)" :key="u.code">{{ u.description }}</li>
                </ul>
              </details>

              <p v-if="r.not_decided" class="pl-note">
                The plan has not decided {{ r.not_decided }} {{ r.not_decided === 1 ? 'use' : 'uses' }} for this zone.
                If yours is not listed above, ask the planning office.
              </p>
            </article>
          </template>

          <div class="pl-next">
            <p>{{ result.notice }}</p>
            <router-link to="/development-application" class="pl-apply">Start an application</router-link>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.pl-page {
  min-height: 100dvh;
  background: radial-gradient(900px 500px at 10% -10%, rgba(30, 107, 74, 0.06), transparent 60%), #fbfbf8;
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  color: #0b1220;
  display: flex; flex-direction: column;
}
.pl-top { padding: 1rem 1.5rem; }
.pl-back { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 500; color: #404a59; text-decoration: none; }
.pl-back:hover { color: #0b1220; }
.pl-stage {
  flex: 1; width: 100%; max-width: 44rem; margin: 0 auto;
  padding: clamp(0.5rem, 3vw, 2rem) clamp(1rem, 4vw, 2rem) 4rem;
  display: flex; flex-direction: column; gap: 1.25rem;
}
.pl-eyebrow { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #5b6473; margin: 0 0 0.6rem; }
.pl-title { font-family: 'Fraunces', ui-serif, Georgia, serif; font-weight: 600; font-size: clamp(1.75rem, 3vw + 0.5rem, 2.5rem); letter-spacing: -0.02em; margin: 0 0 0.5rem; line-height: 1.1; text-wrap: balance; }
.pl-lead { margin: 0; color: #404a59; max-width: 38rem; line-height: 1.55; }
.pl-label { display: block; font-size: 0.8125rem; font-weight: 500; color: #404a59; margin-bottom: 0.35rem; }
.pl-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.pl-input {
  flex: 1 1 14rem; min-width: 0; font: inherit; font-size: 1rem; padding: 0.65rem 0.8rem;
  border: 1px solid #c9ced6; border-radius: 6px; background: #fff; color: #0b1220;
}
.pl-input:focus-visible, .pl-go:focus-visible, .pl-cand:focus-visible, .pl-apply:focus-visible, .pl-list summary:focus-visible { outline: 2px solid #1e6b4a; outline-offset: 2px; }
.pl-go {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; font: inherit; font-weight: 500;
  padding: 0.65rem 1.1rem; border: 0; border-radius: 6px; background: #1e6b4a; color: #fff; cursor: pointer;
}
.pl-go:disabled { opacity: 0.6; cursor: progress; }
.pl-problem { margin: 0; padding: 0.7rem 0.9rem; border-radius: 6px; background: #fbe9e7; color: #8a2a1f; font-size: 0.9rem; }
.pl-note { margin: 0.5rem 0 0; font-size: 0.9rem; color: #404a59; max-width: 40rem; }
.pl-h2 { font-family: 'Fraunces', ui-serif, Georgia, serif; font-size: 1.35rem; margin: 0.5rem 0 0.25rem; font-weight: 600; }
.pl-parcel:focus { outline: none; }
.pl-meta { margin: 0; color: #5b6473; font-size: 0.9rem; }
.pl-cands { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.pl-cand {
  width: 100%; text-align: left; font: inherit; padding: 0.7rem 0.9rem; border: 1px solid #c9ced6; border-radius: 6px;
  background: #fff; cursor: pointer; display: flex; flex-direction: column; gap: 0.1rem; color: inherit;
}
.pl-cand:hover { border-color: #1e6b4a; }
.pl-cand span { font-size: 0.85rem; color: #5b6473; }
.pl-card { margin-top: 0.75rem; padding: 1rem 1.1rem; border: 1px solid #d8dce3; border-radius: 8px; background: #fff; max-width: 40rem; }
.pl-h3 { margin: 0 0 0.4rem; font-size: 1.05rem; }
.pl-card p { margin: 0; color: #404a59; line-height: 1.55; }
.pl-draft { margin: 0.75rem 0 0; padding: 0.7rem 0.9rem; border-radius: 6px; background: #fff3d6; color: #6b4a00; font-size: 0.9rem; border: 1px solid #e2c36b; max-width: 40rem; }
.pl-zone { margin-top: 1rem; padding: 1.1rem; border: 1px solid #d8dce3; border-radius: 8px; background: #fff; display: flex; flex-direction: column; gap: 0.75rem; }
.pl-zonename { margin: 0; font-family: 'Fraunces', ui-serif, Georgia, serif; font-size: 1.3rem; font-weight: 600; }
.pl-share { margin: -0.4rem 0 0; font-size: 0.85rem; font-weight: 500; color: #1e6b4a; }
.pl-planline { margin: 0; font-size: 0.9rem; color: #5b6473; }
.pl-find { display: flex; flex-direction: column; }
.pl-list { border-top: 1px solid #e6e9ee; padding-top: 0.6rem; }
.pl-list summary { cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
.pl-n { font-weight: 500; font-size: 0.8rem; padding: 0 0.45rem; border-radius: 999px; background: #eef1f4; color: #404a59; font-variant-numeric: tabular-nums; }
.pl-list.ok summary { color: #1e6b4a; }
.pl-list.consent summary { color: #8a5a00; }
.pl-list.no summary { color: #8a2a1f; }
.pl-list ul { margin: 0.5rem 0 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.3rem; }
.pl-cond { display: block; font-size: 0.85rem; color: #5b6473; }
.pl-gloss, .pl-none { margin: 0.4rem 0 0; font-size: 0.85rem; color: #5b6473; }
.pl-next { margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; max-width: 40rem; }
.pl-next p { margin: 0; font-size: 0.85rem; color: #5b6473; line-height: 1.5; }
.pl-apply {
  align-self: flex-start; padding: 0.6rem 1rem; border-radius: 6px; border: 1px solid #1e6b4a; color: #1e6b4a;
  text-decoration: none; font-weight: 500; background: #fff;
}
.pl-apply:hover { background: #f0f7f3; }
@media (prefers-reduced-motion: no-preference) { .pl-cand, .pl-apply { transition: border-color 160ms ease, background 160ms ease; } }
</style>
