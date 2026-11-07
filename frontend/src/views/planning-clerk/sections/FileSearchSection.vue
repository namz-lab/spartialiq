<script setup lang="ts">
// Find a file — the counter lookup.
//
// This is the console's most-used screen and it did not exist. Somebody is
// standing at the desk asking about their application, and they have exactly
// one of: the TPD reference, the Development Register number, their stand
// number, or their own name. The server takes any of them
// (GET /planning-clerk/search).
//
// Opening a result puts it in the bar at the top of the console, where it
// stays across every section — so the clerk can then log the letter that
// came with it, receipt the fee and sign the file out without finding it
// again three times.
//
// WHAT EACH RESULT ANSWERS WITHOUT A SECOND CLICK
// The two questions asked at a counter, every time:
//   "where is it up to"    the status, and whether it was acknowledged
//   "where is the file"    who physically has the paper, if it is signed out
// Both come back on the search row, because a clerk who has to open the file
// to answer either one keeps somebody waiting for no reason.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useClerkNav } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { asLabel, formatDate, formatMoney } from '@/planning-clerk/console'
import { searchFiles, errorMessage, type SearchHit } from '@/services/planningClerk'
import UiButton from '@/components/ui/UiButton.vue'
import {
  Search, FolderOpen, AlertTriangle, CheckCircle2, Clock, User,
  MapPin, FileText, Inbox, Mail, Receipt as ReceiptIcon, Send,
  Megaphone, Users, FolderInput, Eye, X,
} from 'lucide-vue-next'

const nav = useClerkNav()
const overview = useClerkOverview()

const term = ref(nav.param('q'))
const hits = ref<SearchHit[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const hasSearched = ref(false)

let timer: ReturnType<typeof setTimeout> | undefined

async function run(q: string) {
  const text = q.trim()
  if (text.length < 2) {
    hits.value = []
    hasSearched.value = false
    return
  }
  searching.value = true
  searchError.value = null
  try {
    hits.value = await searchFiles(text, 40)
    hasSearched.value = true
  } catch (err) {
    searchError.value = errorMessage(err, 'The search could not be run.')
    hits.value = []
  } finally {
    searching.value = false
  }
}

watch(term, (value) => {
  clearTimeout(timer)
  // Debounced before the router AND the server: typing a stand number should
  // not be six history entries or six round trips on a rural link.
  timer = setTimeout(() => {
    nav.setParam('q', value.trim() || null)
    void run(value)
  }, 260)
})

// A link with ?q= already on it searches on arrival, which is what makes a
// pasted search worth sending to a colleague.
onMounted(() => { if (term.value) void run(term.value) })
onBeforeUnmount(() => clearTimeout(timer))

const searchInput = ref<HTMLInputElement | null>(null)
onMounted(() => searchInput.value?.focus())

/** What the file's registers hold, once one is open. */
const holdings = computed(() => {
  const f = overview.file.value
  if (!f) return []
  const r = f.registers
  return [
    { key: 'correspondence', label: 'Correspondence', icon: Inbox, n: r.correspondence.length, section: 'correspondence' as const },
    { key: 'receipts', label: 'Fee receipts', icon: ReceiptIcon, n: r.receipts.length, section: 'fees' as const },
    { key: 'acknowledgements', label: 'Acknowledgement', icon: Mail, n: r.acknowledgements.length, section: 'acknowledgements' as const },
    { key: 'certificates', label: 'Notice certificates', icon: Megaphone, n: r.certificates.length, section: 'notices' as const },
    { key: 'abutters', label: 'Neighbours served', icon: Users, n: r.abutters.length, section: 'notices' as const },
    { key: 'dispatches', label: 'Dispatch', icon: Send, n: r.dispatches.length, section: 'dispatch' as const },
    { key: 'refusals', label: 'Refusal', icon: FileText, n: r.refusals.length, section: 'refusals' as const },
    { key: 'movements', label: 'File movements', icon: FolderInput, n: r.movements.length, section: 'movements' as const },
    { key: 'inspections', label: 'Public inspections', icon: Eye, n: r.inspections.length, section: 'public_inspection' as const },
  ]
})

/** The money taken against this file, per currency — never summed across. */
const fileTakings = computed(() => {
  const rows = overview.file.value?.registers.receipts ?? []
  const live = rows.filter((r) => !r.voided_at)
  return (['USD', 'ZWG'] as const)
    .map((ccy) => ({
      ccy,
      total: live.filter((r) => r.currency === ccy)
        .reduce((sum, r) => sum + Number(r.amount || 0), 0),
    }))
    .filter((t) => t.total > 0)
})

const openHolder = computed(() => {
  const open = overview.file.value?.registers.movements.find(
    (m) => !m.returned_at && !m.voided_at)
  return open ?? null
})
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Front counter</span>
        <h2 class="ins-title">Find a file</h2>
        <p class="ins-lede">
          TPD reference, Development Register number, stand number, applicant
          name or ward — whichever the person at the counter has. Opening a
          file keeps it open across every section.
        </p>
      </div>
    </header>

    <label class="ins-search clk-find-box">
      <Search :size="18" aria-hidden="true" />
      <span class="ent-sr-only">Search applications</span>
      <input ref="searchInput" v-model="term" type="search"
             placeholder="TPD/VUN/2026/0900, Stand 4412, or Chikonzo" />
      <button v-if="term" type="button" class="clk-find-clear"
              @click="term = ''; hits = []; hasSearched = false">
        <X :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Clear the search</span>
      </button>
    </label>

    <p v-if="searchError" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ searchError }}</span>
    </p>

    <!-- ── The open file ───────────────────────────────────────────────── -->
    <section v-if="nav.permit.value" class="ins-card">
      <header class="ins-card-head">
        <h3>
          <FolderOpen :size="15" aria-hidden="true" />
          Open file
        </h3>
        <UiButton size="sm" variant="ghost" @click="nav.openFile(null)">Close</UiButton>
      </header>

      <div class="ins-card-body clk-file">
        <div v-if="overview.fileLoading.value" class="clk-file-load" aria-busy="true">
          <span v-for="n in 4" :key="n" class="ins-skel" />
          <span class="ent-sr-only">Opening the file</span>
        </div>

        <p v-else-if="overview.fileError.value" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span>{{ overview.fileError.value }}</span>
        </p>

        <template v-else-if="overview.file.value">
          <dl class="ins-dl">
            <div>
              <dt>TPD reference</dt>
              <dd class="ins-mono">{{ overview.file.value.permit.tpd_reference || '—' }}</dd>
            </div>
            <div>
              <dt>Register number</dt>
              <dd class="ins-mono">{{ overview.file.value.permit.dev_register_no || '—' }}</dd>
            </div>
            <div>
              <dt>Applicant</dt>
              <dd>{{ overview.file.value.permit.applicant_name }}</dd>
            </div>
            <div>
              <dt>Stand</dt>
              <dd class="ins-mono">
                {{ overview.file.value.permit.stand_number || '—' }}
                <span class="clk-file-ward">{{ overview.file.value.permit.suburb_ward || '' }}</span>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{{ asLabel(overview.file.value.permit.status) }}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{{ formatDate(overview.file.value.permit.received_at) }}</dd>
            </div>
            <div>
              <dt>Development</dt>
              <dd>{{ asLabel(overview.file.value.permit.development_type) }}</dd>
            </div>
            <div>
              <dt>Determination due</dt>
              <dd>{{ formatDate(overview.file.value.permit.statutory_due_date) }}</dd>
            </div>
          </dl>

          <!-- Where the paper is. The single most-asked counter question the
               digital record could not previously answer. -->
          <p v-if="openHolder" class="ins-banner t-warning">
            <FolderInput :size="15" aria-hidden="true" />
            <span>
              <strong>The paper file is with {{ openHolder.holder_name }}</strong>
              ({{ asLabel(openHolder.destination) }}), signed out
              {{ formatDate(openHolder.issued_at) }}, due back
              {{ formatDate(openHolder.due_back_on) }}.
            </span>
          </p>
          <p v-else class="ins-banner t-positive">
            <CheckCircle2 :size="15" aria-hidden="true" />
            <span>The paper file is in registry.</span>
          </p>

          <div v-if="fileTakings.length" class="clk-file-money">
            <span class="clk-file-money-label">Receipted against this file</span>
            <span v-for="t in fileTakings" :key="t.ccy" class="ins-mono clk-file-money-value">
              {{ formatMoney(t.total, t.ccy) }}
            </span>
          </div>

          <!-- Every register at once: what the council holds for this file,
               and one click into each. -->
          <ul class="clk-hold">
            <li v-for="h in holdings" :key="h.key">
              <button type="button" class="clk-hold-btn" :class="{ empty: !h.n }"
                      @click="nav.go(h.section)">
                <component :is="h.icon" :size="15" aria-hidden="true" />
                <span class="clk-hold-label">{{ h.label }}</span>
                <span class="clk-hold-n">{{ h.n }}</span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </section>

    <!-- ── Results ─────────────────────────────────────────────────────── -->
    <section v-if="searching || hits.length || hasSearched" class="ins-card">
      <header class="ins-card-head">
        <h3>
          Matches
          <span class="ins-count">{{ hits.length }}</span>
        </h3>
      </header>

      <div v-if="searching && !hits.length" class="ins-card-body clk-file-load" aria-busy="true">
        <span v-for="n in 4" :key="n" class="ins-skel" />
        <span class="ent-sr-only">Searching</span>
      </div>

      <ul v-else-if="hits.length" class="ins-rows">
        <li v-for="h in hits" :key="h.id" class="ins-row"
            :class="{ open: nav.permit.value === h.id }">
          <div class="ins-row-main">
            <span class="ins-row-title ins-mono">
              {{ h.tpd_reference || h.dev_register_no || 'Unreferenced' }}
            </span>
            <span class="ins-row-meta">
              <User :size="11" aria-hidden="true" /> {{ h.applicant_name }}
              · <MapPin :size="11" aria-hidden="true" /> Stand {{ h.stand_number || '—' }},
              {{ h.suburb_ward || '—' }}
              · {{ asLabel(h.status) }}
            </span>
            <span class="clk-find-flags">
              <span class="clk-flag" :class="h.acknowledged ? 't-positive' : 't-warning'">
                <component :is="h.acknowledged ? CheckCircle2 : Clock" :size="11" aria-hidden="true" />
                {{ h.acknowledged ? 'Acknowledged' : 'Not acknowledged' }}
              </span>
              <span v-if="h.file_held_by" class="clk-flag t-warning">
                <FolderInput :size="11" aria-hidden="true" />
                File with {{ h.file_held_by }}
              </span>
              <span v-else class="clk-flag t-neutral">
                <FolderInput :size="11" aria-hidden="true" />
                File in registry
              </span>
              <span v-if="h.received_at" class="clk-flag t-neutral">
                Received {{ formatDate(h.received_at) }}
              </span>
            </span>
          </div>
          <UiButton v-if="nav.permit.value !== h.id" size="sm" variant="primary"
                    @click="nav.openFile(h.id)">
            <template #icon><FolderOpen :size="13" /></template>
            Open
          </UiButton>
          <span v-else class="clk-find-here">
            <CheckCircle2 :size="14" aria-hidden="true" />
            Open
          </span>
        </li>
      </ul>

      <div v-else class="ins-card-body clk-find-empty">
        <Inbox :size="22" aria-hidden="true" />
        <p>
          No application matches “{{ term }}”. Files are searched by TPD
          reference, register number, stand number, applicant name, ward and
          street address.
        </p>
      </div>
    </section>

    <div v-else-if="!nav.permit.value" class="clk-find-idle">
      <Search :size="26" aria-hidden="true" />
      <p>
        Type at least two characters. Whatever the person at the counter has —
        a reference, a stand number, or just their name — will find the file.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* A deliberately large search box: this is the screen's whole purpose, and a
   13px input among a dozen other controls does not read as the thing to use. */
.clk-find-box { min-height:calc(var(--ent-control-h) + var(--ent-s3));
  font-size:var(--ent-fs-lg); }
.clk-find-box input { font-size:var(--ent-fs-md); }
/* Chrome draws its own clear affordance on type="search" once the field has
   focus, which sat beside ours as a second, differently-styled ✕. Ours stays
   because it is the one that is visible before focus and in browsers that
   draw nothing. */
.clk-find-box input::-webkit-search-cancel-button { display:none; }
.clk-find-clear { display:inline-flex; align-items:center; justify-content:center;
  width:26px; height:26px; flex-shrink:0; color:var(--ent-text-3);
  background:none; border:0; border-radius:var(--ent-r-sm); cursor:pointer; }
.clk-find-clear:hover { color:var(--ent-text); background:var(--ent-surface-2); }
.clk-find-clear:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.clk-file { display:flex; flex-direction:column; gap:var(--ent-s4); }
.clk-file-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-file-load .ins-skel:nth-child(even) { width:72%; }
.clk-file-ward { color:var(--ent-text-3); font-family:var(--ent-font);
  font-size:var(--ent-fs-xs); margin-left:var(--ent-s2); }

.clk-file-money { display:flex; align-items:baseline; gap:var(--ent-s3); flex-wrap:wrap;
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r);
  background:var(--ent-surface-2); }
.clk-file-money-label { font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.05em; text-transform:uppercase; color:var(--ent-text-3); }
.clk-file-money-value { font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); font-variant-numeric:tabular-nums; }

/* What the council holds for this file, all nine registers at a glance. */
.clk-hold { list-style:none; margin:0; padding:0; display:grid;
  grid-template-columns:repeat(auto-fit, minmax(11rem, 1fr)); gap:var(--ent-s2); }
.clk-hold-btn { display:flex; align-items:center; gap:var(--ent-s2); width:100%;
  min-height:var(--ent-control-h); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line); border-radius:var(--ent-r);
  text-align:left; cursor:pointer;
  transition:border-color var(--ent-dur) var(--ent-ease), background-color var(--ent-dur) var(--ent-ease); }
.clk-hold-btn:hover { background:var(--ent-surface-2); border-color:var(--ent-line-strong); }
.clk-hold-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
/* An empty register is still worth showing — "no acknowledgement on this
   file" is exactly the thing the clerk needs to notice — but it recedes. */
.clk-hold-btn.empty { color:var(--ent-text-3); }
.clk-hold-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.clk-hold-n { flex-shrink:0; min-width:1.5rem; text-align:center;
  font-variant-numeric:tabular-nums; font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); }
.clk-hold-btn.empty .clk-hold-n { color:var(--ent-text-3); }

.ins-row.open { background:var(--ent-accent-soft); }
.clk-find-here { display:inline-flex; align-items:center; gap:var(--ent-s2);
  flex-shrink:0; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); }

.clk-find-flags { display:flex; flex-wrap:wrap; gap:var(--ent-s1);
  margin-top:var(--ent-s2); }
.clk-flag { display:inline-flex; align-items:center; gap:4px;
  padding:1px var(--ent-s2); border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-medium);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg);
  border:1px solid var(--ent-tone-neutral-line); }
.clk-flag.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); border-color:var(--ent-tone-positive-line); }
.clk-flag.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); border-color:var(--ent-tone-warning-line); }

.clk-find-empty, .clk-find-idle { display:flex; flex-direction:column;
  align-items:center; gap:var(--ent-s3); padding:var(--ent-s7) var(--ent-s4);
  text-align:center; color:var(--ent-text-3); }
.clk-find-empty p, .clk-find-idle p { margin:0; font-size:var(--ent-fs-sm);
  max-width:42ch; line-height:var(--ent-lh); }

.ins-row-meta svg { vertical-align:-1px; }
</style>
