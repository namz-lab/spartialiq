<script setup lang="ts">
// Council front desk — every counter a walk-in visitor would ask for.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  CITIZEN_SERVICES, servicesByDepartment, type CitizenService, type CitizenSectionKey,
} from '@/views/citizen/citizenServices'
import { Search, Landmark, ArrowRight, MapPin, Clock } from 'lucide-vue-next'

const emit = defineEmits<{ 'open-section': [key: CitizenSectionKey, serviceId?: string] }>()
const router = useRouter()
const q = ref('')
const deptFilter = ref('All')

const CHANNEL: Record<CitizenService['channel'], string> = {
  online: 'Online',
  counter: 'At the council office',
  both: 'Online or at the office',
}

const departments = computed(() => ['All', ...new Set(CITIZEN_SERVICES.map(s => s.department))])

const groups = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return servicesByDepartment()
    .filter(g => deptFilter.value === 'All' || g.department === deptFilter.value)
    .map(g => ({
      ...g,
      services: g.services.filter(s => {
        if (!needle) return true
        const hay = `${s.title} ${s.askFor} ${s.description} ${s.department}`.toLowerCase()
        return hay.includes(needle)
      }),
    }))
    .filter(g => g.services.length)
})

function open(s: CitizenService) {
  if (s.href) {
    router.push(s.href)
    return
  }
  if (s.section === 'service_desk') {
    emit('open-section', 'service_desk', s.id)
    return
  }
  if (s.section) emit('open-section', s.section)
}
</script>

<template>
  <div class="desk">
    <header class="desk-hero">
      <div class="desk-hero-copy">
        <p class="desk-eyebrow"><Landmark :size="14" /> Council reception</p>
        <h1>What can we help you with today?</h1>
        <p>
          This is the same list the front desk uses when you walk into Vungu RDC.
          Pick a counter, see what to bring, and start online where the service is live.
        </p>
      </div>
      <div class="desk-search">
        <Search :size="16" />
        <input v-model="q" type="search" placeholder="Search — e.g. stand, pay fee, inspection, licence…" />
      </div>
      <div class="desk-filters" role="group" aria-label="Department">
        <button
          v-for="d in departments" :key="d" type="button"
          :class="{ on: deptFilter === d }" :aria-pressed="deptFilter === d"
          @click="deptFilter = d"
        >{{ d }}</button>
      </div>
    </header>

    <section v-for="g in groups" :key="g.department" class="desk-dept">
      <header>
        <h2>{{ g.department }}</h2>
        <span>{{ g.services.length }} service{{ g.services.length === 1 ? '' : 's' }}</span>
      </header>
      <ul>
        <li v-for="s in g.services" :key="s.id">
          <button type="button" class="desk-card" :class="s.status" @click="open(s)">
            <div class="desk-card-top">
              <strong>{{ s.title }}</strong>
              <span class="desk-pill" :class="s.status">
                {{ s.status === 'live' ? 'Online' : 'Counter / soon' }}
              </span>
            </div>
            <p class="desk-ask">{{ s.askFor }}</p>
            <p class="desk-desc">{{ s.description }}</p>
            <dl>
              <div><dt>Bring</dt><dd>{{ s.documents.join(' · ') }}</dd></div>
              <div><dt>Fee</dt><dd>{{ s.feeHint }}</dd></div>
              <div><dt>Outcome</dt><dd>{{ s.outcome }}</dd></div>
              <div><dt>Where</dt><dd>{{ CHANNEL[s.channel] }}</dd></div>
            </dl>
            <span class="desk-go">
              {{ s.status === 'live' ? 'Open this service' : 'See how to apply' }}
              <ArrowRight :size="14" />
            </span>
          </button>
        </li>
      </ul>
    </section>

    <p v-if="!groups.length" class="desk-empty">
      <MapPin :size="16" /> No services match that search. Try “permit”, “pay”, or “map”.
    </p>

    <footer class="desk-foot">
      <Clock :size="14" />
      <span>Hours and phone numbers: use Talk to reception if you are unsure which counter you need.</span>
    </footer>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.desk { display:flex; flex-direction:column; gap:1.5rem; max-width:1040px; margin:0 auto; width:100%; padding:1.25rem 1rem 2rem; }
.desk-hero { display:flex; flex-direction:column; gap:0.85rem; }
.desk-eyebrow {
  margin:0; display:inline-flex; align-items:center; gap:0.35rem;
  font-size:0.72rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--cp-muted);
}
.desk-hero h1 { margin:0.2rem 0 0; font-size:1.5rem; font-weight:700; letter-spacing:-0.02em; color:var(--cp-text); }
.desk-hero-copy p:last-child { margin:0.35rem 0 0; font-size:0.9rem; line-height:1.5; color:var(--cp-text-2); max-width:40rem; }
.desk-search {
  display:flex; align-items:center; gap:0.5rem; background:var(--cp-surface); color:var(--cp-text);
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.55rem 0.75rem;
}
.desk-search :deep(svg) { color:var(--cp-faint); }
.desk-search:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.desk-search input { border:0; outline:0; flex:1; background:transparent; font-size:0.88rem; color:var(--cp-text); }
.desk-filters { display:flex; flex-wrap:wrap; gap:0.35rem; }
.desk-filters button {
  border:1px solid var(--cp-border); background:var(--cp-surface); color:var(--cp-text-2);
  border-radius:var(--cp-radius-pill); padding:0.35rem 0.8rem; font-size:0.76rem; font-weight:600; cursor:pointer;
}
.desk-filters button.on { background:var(--cp-primary); color:var(--cp-on-primary); border-color:var(--cp-primary); }
.desk-dept header { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.6rem; }
.desk-dept h2 { margin:0; font-size:0.98rem; font-weight:600; color:var(--cp-text); }
.desk-dept header span { font-size:0.72rem; color:var(--cp-muted); }
.desk-dept ul { list-style:none; margin:0; padding:0; display:grid; gap:0.65rem; }
.desk-card {
  width:100%; text-align:left; border:1px solid var(--cp-border); background:var(--cp-surface);
  border-radius:var(--cp-radius); padding:0.95rem 1rem; cursor:pointer; color:inherit;
  transition:border-color var(--cp-dur) var(--cp-ease);
}
.desk-card:hover { border-color:var(--cp-border-strong); }
.desk-card-top { display:flex; justify-content:space-between; gap:0.75rem; align-items:flex-start; }
.desk-card-top strong { font-size:0.92rem; color:var(--cp-text); }
.desk-pill {
  flex:none; font-size:0.62rem; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
  padding:0.15rem 0.5rem; border-radius:var(--cp-radius-pill);
}
.desk-pill.live { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.desk-pill.coming_soon { background:var(--cp-amber-bg); color:var(--cp-amber-fg); }
.desk-ask { margin:0.35rem 0 0.25rem; font-size:0.82rem; color:var(--cp-text-2); }
.desk-desc { margin:0; font-size:0.84rem; color:var(--cp-text-2); line-height:1.45; }
.desk-card dl { margin:0.75rem 0 0; display:grid; grid-template-columns:1fr 1fr; gap:0.5rem 0.75rem; }
.desk-card dt { font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--cp-muted); }
.desk-card dd { margin:0.1rem 0 0; font-size:0.78rem; color:var(--cp-text); }
.desk-go {
  display:inline-flex; align-items:center; gap:0.3rem; margin-top:0.75rem;
  font-size:0.8rem; font-weight:600; color:var(--cp-primary);
}
.desk-empty, .desk-foot { display:flex; align-items:center; gap:0.45rem; margin:0; color:var(--cp-muted); font-size:0.82rem; }
@media (max-width: 720px) { .desk-card dl { grid-template-columns:1fr; } }
@media (min-width: 1024px) { .desk { padding:1.75rem 1.5rem 2.5rem; } }
</style>
