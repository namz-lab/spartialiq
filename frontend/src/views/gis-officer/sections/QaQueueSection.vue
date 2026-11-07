<script setup lang="ts">
// Edits and QA (/gis/edits, /gis/edits/:sessionId). Approvers see the queue
// of submitted sessions; everyone who edits sees their own sessions and what
// QA decided. A session under review shows every change against the
// published version, on a map, with the topology check run again.
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import GeoMiniMap from '@/components/map/GeoMiniMap.vue'
import { useAuthStore } from '@/stores/auth'
import {
  gmsApi, GMS_CAN, type SessionRow, type EditSession, type EditIssue, type FeatureDetail, type SessionStatus,
} from '@/services/gms'

const props = defineProps<{ sessionId?: string }>()
const router = useRouter()
const auth = useAuthStore()
const isQa = computed(() => !!auth.user && GMS_CAN.approveQa.includes(auth.user.role))

const scope = ref<'queue' | 'mine'>(isQa.value ? 'queue' : 'mine')
const rows = ref<SessionRow[]>([])
const loading = ref(false)
const error = ref('')

const STATUS_TONE: Record<SessionStatus, 'info' | 'positive' | 'negative' | 'warning' | 'neutral'> = {
  open: 'neutral', submitted: 'info', approved: 'positive', rejected: 'negative', returned: 'warning', abandoned: 'neutral',
}
const columns = [
  { key: 'submitted_at', label: 'Submitted', sortable: true },
  { key: 'layer_title', label: 'Layer', sortable: true },
  { key: 'custodian_dept', label: 'Custodian', hideOnMobile: true },
  { key: 'user_email', label: 'Editor', hideOnMobile: true },
  { key: 'edit_count', label: 'Changes', align: 'right', mono: true },
  { key: 'status', label: 'Status' },
]
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

async function loadList() {
  loading.value = true
  error.value = ''
  try { rows.value = await gmsApi.sessions(scope.value) } catch { error.value = 'The list could not be loaded.' } finally { loading.value = false }
}
watch(scope, loadList)
onMounted(() => { if (!props.sessionId) loadList() })

// ── One session ───────────────────────────────────────────────────────
const s = ref<EditSession | null>(null)
const current = ref<Record<number, FeatureDetail>>({})
const issues = ref<EditIssue[]>([])
const reason = ref('')
const acting = ref(false)
const notice = ref('')

async function loadSession(id: string) {
  s.value = null
  error.value = ''
  notice.value = ''
  try {
    s.value = await gmsApi.session(id)
    const ids = s.value.edits.flatMap((e) => (e.op === 'create' ? [] : [e.feature_id]))
    const got = await Promise.all(ids.map((f) => gmsApi.feature(f).catch(() => null)))
    current.value = Object.fromEntries(got.filter(Boolean).map((f) => [f!.feature_id, f!]))
    issues.value = s.value.status === 'submitted' ? (await gmsApi.validate(id)).errors : []
  } catch {
    error.value = 'The session could not be loaded.'
  }
}
watch(() => props.sessionId, (id) => { if (id) loadSession(id); else loadList() }, { immediate: true })

const mapFeatures = computed<GeoJSON.Feature[]>(() => {
  if (!s.value) return []
  const out: GeoJSON.Feature[] = []
  s.value.edits.forEach((e, i) => {
    if (e.op !== 'create') {
      const f = current.value[e.feature_id]
      if (f) out.push({ type: 'Feature', geometry: f.geometry, properties: { role: 'current' } })
    }
    if (e.op !== 'delete' && e.geometry) out.push({ type: 'Feature', geometry: e.geometry, properties: { role: 'proposed', index: i } })
  })
  for (const x of issues.value) if (x.geometry) out.push({ type: 'Feature', geometry: x.geometry, properties: { role: 'issue' } })
  return out
})

/** Before -> after, one line per changed attribute. */
function changes(i: number): { field: string; before: unknown; after: unknown }[] {
  const e = s.value!.edits[i]
  if (e.op === 'create') return Object.entries(e.attrs).map(([field, after]) => ({ field, before: '', after }))
  const f = current.value[e.feature_id]
  if (e.op === 'delete') return []
  const out = Object.entries(e.attrs ?? {}).map(([field, after]) => ({ field, before: f?.attrs[field] ?? '', after }))
  if (e.geometry) out.push({ field: 'geometry', before: 'current shape', after: 'new shape' })
  if (e.accuracy_class && e.accuracy_class !== f?.accuracy_class) out.push({ field: 'accuracy class', before: f?.accuracy_class, after: e.accuracy_class })
  return out
}
const opLabel = (i: number) => {
  const e = s.value!.edits[i]
  return e.op === 'create' ? 'New feature' : `${e.op === 'update' ? 'Change' : 'Delete'} F-${e.feature_id}${current.value[e.feature_id] ? ` (v${current.value[e.feature_id].version})` : ''}`
}
const issuesFor = (i: number) => issues.value.filter((x) => x.index === i)

async function approve() {
  acting.value = true
  try {
    const r = await gmsApi.approve(s.value!.session_id)
    if (r.success) { notice.value = 'Approved and published.'; await loadSession(s.value!.session_id) }
    else if (r.error === 'edit_conflict') { notice.value = 'Someone else changed one of these features since. The session went back to its editor.'; await loadSession(s.value!.session_id) }
    else if (r.errors) { issues.value = r.errors; notice.value = 'The topology check failed. Return it with a reason.' }
    else notice.value = r.message || 'Not approved.'
  } finally { acting.value = false }
}
async function decide(action: 'reject' | 'return') {
  if (!reason.value.trim()) { notice.value = 'Give a reason; the editor sees it.'; return }
  acting.value = true
  try {
    await gmsApi.decide(s.value!.session_id, action, reason.value.trim())
    reason.value = ''
    await loadSession(s.value!.session_id)
  } finally { acting.value = false }
}
const ownSession = computed(() => s.value?.user_id === auth.user?.id)
</script>

<template>
  <div class="qa">
    <template v-if="!sessionId">
      <div v-if="isQa" class="qa-scope" role="tablist" aria-label="Which sessions">
        <button type="button" role="tab" :aria-selected="scope === 'queue'" :class="{ on: scope === 'queue' }" @click="scope = 'queue'">QA queue</button>
        <button type="button" role="tab" :aria-selected="scope === 'mine'" :class="{ on: scope === 'mine' }" @click="scope = 'mine'">My sessions</button>
      </div>
      <p v-if="error" class="qa-err" role="alert">{{ error }}</p>
      <UiPanel :title="scope === 'queue' ? 'Waiting for QA' : 'My edit sessions'"
               :subtitle="scope === 'queue' ? 'Oldest first. Approved edits are published to every department.' : 'Open, submitted and decided in the last 30 days.'" flush>
        <UiDataTable :columns="columns" :rows="rows" row-key="session_id" :loading="loading" clickable dense
                     :empty-message="scope === 'queue' ? 'Nothing is waiting for QA.' : 'No sessions. Start one in the map workspace.'"
                     mobile-primary="layer_title" mobile-secondary="user_email" mobile-status="status"
                     @row-click="(r: SessionRow) => router.push(`/gis/edits/${r.session_id}`)">
          <template #cell-submitted_at="{ row }">{{ when(row.submitted_at || row.updated_at) }}</template>
          <template #cell-status="{ value }"><UiStatusBadge :tone="STATUS_TONE[value as SessionStatus]" :label="value" /></template>
        </UiDataTable>
      </UiPanel>
    </template>

    <template v-else>
      <UiButton size="sm" variant="ghost" class="qa-back" @click="router.push('/gis/edits')">
        <template #icon><ArrowLeft :size="14" aria-hidden="true" /></template>Edits and QA
      </UiButton>
      <p v-if="error" class="qa-err" role="alert">{{ error }}</p>
      <UiEmptyState v-else-if="!s" message="Loading session…" />
      <template v-else>
        <header class="qa-head">
          <div>
            <h2 class="qa-title">{{ s.layer?.title }} · {{ s.edits.length }} change{{ s.edits.length === 1 ? '' : 's' }}</h2>
            <p class="qa-sub">{{ s.user_name || s.user_email }} · submitted {{ when(s.submitted_at) }}</p>
          </div>
          <UiStatusBadge :tone="STATUS_TONE[s.status]" :label="s.status" />
        </header>
        <p v-if="s.decision_note" class="qa-note">QA: {{ s.decision_note }} <span v-if="s.decided_by_email">— {{ s.decided_by_email }}, {{ when(s.decided_at) }}</span></p>
        <p v-if="notice" class="qa-note" role="status">{{ notice }}</p>

        <div class="qa-grid">
          <GeoMiniMap :features="mapFeatures" label="Proposed changes (dashed) over the published features (grey); problems in red" height="420px" />
          <UiPanel title="Changes">
            <ol class="qa-list">
              <li v-for="(e, i) in s.edits" :key="i" :class="{ bad: issuesFor(i).length }">
                <strong>{{ opLabel(i) }}</strong>
                <table v-if="changes(i).length" class="qa-diff">
                  <tr v-for="c in changes(i)" :key="c.field"><th scope="row">{{ c.field }}</th><td class="qa-before">{{ c.before }}</td><td>{{ c.after }}</td></tr>
                </table>
                <p v-if="e.op === 'create'" class="qa-meta">Class {{ e.accuracy_class }} · {{ e.source }}</p>
                <p v-for="(x, n) in issuesFor(i)" :key="n" class="qa-issue">{{ x.code }}{{ x.field ? `: ${x.field}` : '' }}{{ x.overlap_m2 ? ` (${x.overlap_m2.toFixed(1)} m²)` : '' }}</p>
              </li>
            </ol>
          </UiPanel>
        </div>

        <UiPanel v-if="isQa && s.status === 'submitted'" title="Decision">
          <p v-if="ownSession" class="qa-note">This is your own session. Someone else approves it.</p>
          <p v-else-if="issues.length" class="qa-note">The topology check finds {{ issues.length }} problem{{ issues.length === 1 ? '' : 's' }}. Return it for correction.</p>
          <label class="qa-reason">
            <span>Reason (for return or rejection)</span>
            <textarea v-model="reason" rows="2" />
          </label>
          <div class="qa-actions">
            <UiButton variant="primary" :disabled="ownSession || !!issues.length" :loading="acting" @click="approve">Approve and publish</UiButton>
            <UiButton :disabled="acting" @click="decide('return')">Return for correction</UiButton>
            <UiButton variant="danger" :disabled="acting" @click="decide('reject')">Reject</UiButton>
          </div>
        </UiPanel>
      </template>
    </template>
  </div>
</template>

<style scoped>
.qa { display:flex; flex-direction:column; gap:var(--ent-s4); padding:var(--ent-s4); max-width:1400px; }
.qa-scope { display:flex; gap:var(--ent-s1); border-bottom:1px solid var(--ent-line); }
.qa-scope button { padding:var(--ent-s2) var(--ent-s3); background:none; border:0; border-bottom:2px solid transparent; margin-bottom:-1px;
  font:inherit; font-size:var(--ent-fs-sm); color:var(--ent-text-2); cursor:pointer; }
.qa-scope button.on { color:var(--ent-accent); border-bottom-color:var(--ent-accent); }
.qa-scope button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.qa-back { align-self:flex-start; }
.qa-head { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--ent-s3); }
.qa-title { margin:0; font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-semibold); }
.qa-sub { margin:var(--ent-s1) 0 0; color:var(--ent-text-2); font-size:var(--ent-fs-sm); }
.qa-note { margin:0; padding:var(--ent-s2) var(--ent-s3); background:var(--ent-info-soft); border-radius:var(--ent-r-sm); font-size:var(--ent-fs-sm); }
.qa-err { margin:0; color:var(--ent-danger); }
.qa-grid { display:grid; grid-template-columns:minmax(0, 3fr) minmax(300px, 2fr); gap:var(--ent-s4); align-items:start; }
.qa-list { margin:0; padding-left:1.2rem; display:flex; flex-direction:column; gap:var(--ent-s3); font-size:var(--ent-fs-sm); }
.qa-list li.bad strong { color:var(--ent-danger); }
.qa-diff { margin-top:var(--ent-s1); border-collapse:collapse; font-size:var(--ent-fs-xs); }
.qa-diff th { text-align:left; font-weight:var(--ent-fw-medium); color:var(--ent-text-3); padding:1px var(--ent-s2) 1px 0; }
.qa-diff td { padding:1px var(--ent-s2); }
.qa-before { color:var(--ent-text-3); text-decoration:line-through; }
.qa-meta { margin:2px 0 0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.qa-issue { margin:2px 0 0; font-size:var(--ent-fs-xs); color:var(--ent-danger); }
.qa-reason { display:flex; flex-direction:column; gap:var(--ent-s1); font-size:var(--ent-fs-xs); color:var(--ent-text-2); margin:var(--ent-s2) 0; }
.qa-reason textarea { font:inherit; font-size:var(--ent-fs-sm); padding:var(--ent-s2); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); background:var(--ent-surface); color:var(--ent-text); }
.qa-actions { display:flex; flex-wrap:wrap; gap:var(--ent-s2); }
@media (max-width: 1023px) { .qa-grid { grid-template-columns:1fr; } }
</style>
