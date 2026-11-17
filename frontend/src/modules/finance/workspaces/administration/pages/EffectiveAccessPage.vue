<script setup lang="ts">
/**
 * Effective access: for one person, what they can actually do and where it comes from (their
 * role's default, a personal grant, or a personal denial, which always wins), the votes they are
 * confined to, any duty conflict, and the finance workspaces that access opens.
 *
 * Read-only. Changes are made under Finance Users, with a reason, and land in the access log.
 */
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ScanEye, AlertTriangle, ShieldAlert, Home } from 'lucide-vue-next'
import { financeAccessApi, type AccessDetail } from '../../../api/financeAccessApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatDateTime } from '../../../composables/useMoney'
import { financeRoleLabel } from '../../../shell/roleLabels'
import { WORKSPACE_META } from '../../../shell/workspaces'
import { adminDash } from '../dashboard'
import { ADMISSION, dutyConflicts, sourceOf, workspacesOf } from '../workspacePreview'

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const users = computed(() => adminDash.state.data?.list.users ?? [])
const search = ref('')
const options = computed(() => {
  const t = search.value.trim().toLowerCase()
  return t ? users.value.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(t)) : users.value
})
const userId = computed(() => (typeof route.query.user === 'string' ? route.query.user : ''))
function pick(id: string): void { void router.replace({ query: { ...route.query, user: id || undefined } }) }

const detail = ref<AccessDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
watch(userId, async (id) => {
  detail.value = null
  error.value = null
  if (!id) return
  loading.value = true
  try { detail.value = await financeAccessApi.access(id) } catch (err) { error.value = messageOf(err, 'This person’s finance access could not be read.') } finally { loading.value = false }
}, { immediate: true })

const places = computed(() => (detail.value ? workspacesOf(detail.value) : null))
const conflicts = computed(() => (detail.value ? dutyConflicts(detail.value.user.role, detail.value.permissions, store.catalogue) : []))
const groups = computed(() => {
  const d = detail.value
  if (!d) return []
  const held = store.catalogue.filter((p) => d.permissions.includes(p.code) || d.overrides.some((o) => o.permission_code === p.code))
  const by = new Map<string, typeof held>()
  for (const p of held) by.set(p.category, [...(by.get(p.category) ?? []), p])
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b))
})
const overrideOf = (code: string) => detail.value?.overrides.find((o) => o.permission_code === code)
const SOURCE = { role: 'Role default', granted: 'Personal grant', denied: 'Personal denial', none: '—' } as const
const tone = (s: keyof typeof SOURCE) => (s === 'denied' ? 'cw-pill--neg' : s === 'granted' ? 'cw-pill--warn' : 'cw-pill--mute')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ScanEye :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Effective Access</h2><p>What one person can actually do in finance, where each permission comes from, and which workspaces it opens.</p></div>
  </section>

  <section class="cw-card">
    <div class="cw-card-body ea-pick" style="padding-top: 16px">
      <label class="cw-field"><span class="cw-label">Find a person</span>
        <input v-model="search" class="cw-input" type="search" placeholder="Name, email or role" /></label>
      <label class="cw-field"><span class="cw-label">Person</span>
        <select class="cw-select" :value="userId" @change="pick(($event.target as HTMLSelectElement).value)">
          <option value="">Choose a person</option>
          <option v-for="u in options" :key="u.id" :value="u.id">{{ u.name }} · {{ financeRoleLabel(u.role) }}</option>
        </select></label>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <div v-if="loading" class="cw-card cw-card-body" style="padding-top: 18px"><span class="cw-skel" /><span class="cw-skel" /></div>
  <p v-else-if="!userId" class="cw-empty">Choose a person to see their effective finance access.</p>

  <template v-else-if="detail && places">
    <section class="cw-card" aria-labelledby="ea-who">
      <div class="cw-card-head"><h3 id="ea-who">{{ detail.user.name }}</h3><span class="cw-spacer" />
        <RouterLink :to="{ name: 'adm-users' }" class="cw-link">Change this access</RouterLink></div>
      <div class="cw-card-body">
        <dl class="cw-kv ea-kv">
          <div><dt>Account</dt><dd>{{ detail.user.email }}<template v-if="detail.user.job_title"> · {{ detail.user.job_title }}</template></dd></div>
          <div><dt>Role</dt><dd>{{ financeRoleLabel(detail.user.role) }}</dd></div>
          <div><dt>Status</dt><dd>{{ detail.user.active === false || detail.user.status === 'suspended' ? 'Suspended' : 'Active' }}</dd></div>
          <div><dt>Votes</dt><dd>{{ detail.department_scope.length ? detail.department_scope.map((s) => `${s.code} ${s.name}`).join(', ') : 'Not confined: council-wide where the role allows' }}</dd></div>
          <div><dt>Permissions held</dt><dd class="num">{{ detail.permissions.length }}</dd></div>
        </dl>
        <div v-for="c in conflicts" :key="c.rule" class="cw-banner-msg cw-banner-msg--warn" role="status"><ShieldAlert :size="18" aria-hidden="true" />{{ c.text }}</div>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="ea-ws">
      <div class="cw-card-head"><h3 id="ea-ws">Finance Workspaces</h3></div>
      <div class="cw-card-body">
        <p class="cw-hint" style="margin-top: 0">
          <template v-if="places.fromServer">As the server decides them for this person.</template>
          <template v-else>Preview from the published admission rules. The server decides at each sign-in, and every action is checked again when it is taken.</template>
        </p>
        <p v-if="!places.workspaces.length" class="cw-empty">This access opens no finance workspace.</p>
        <ul v-else class="ea-ws">
          <li v-for="k in places.workspaces" :key="k">
            <strong>{{ WORKSPACE_META[k].name }}</strong>
            <span v-if="k === places.home" class="cw-pill cw-pill--info"><Home :size="13" aria-hidden="true" /> Lands here</span>
            <span class="cw-hint"> · admitted because the person {{ ADMISSION[k] }}</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="ea-perm">
      <div class="cw-card-head"><h3 id="ea-perm">Permissions and Where They Come From</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!groups.length" class="cw-empty">This person holds no finance permission.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th scope="col">Permission</th><th scope="col">Source</th><th scope="col">Exception recorded</th></tr></thead>
          <tbody>
            <template v-for="[category, perms] in groups" :key="category">
              <tr class="ea-cat"><th colspan="3" scope="colgroup">{{ category }}</th></tr>
              <tr v-for="p in perms" :key="p.code">
                <td class="dx-wrap">{{ p.label }}<div class="cw-hint"><code>{{ p.code }}</code><template v-if="p.is_approval"> · approval</template><template v-if="p.is_publication"> · publication</template><template v-if="p.is_restricted"> · restricted</template></div></td>
                <td><span class="cw-pill" :class="tone(sourceOf(p.code, detail))">{{ SOURCE[sourceOf(p.code, detail)] }}</span></td>
                <td class="dx-wrap">
                  <template v-if="overrideOf(p.code)">{{ overrideOf(p.code)?.reason ?? 'No reason recorded' }}
                    <div class="cw-hint">{{ formatDateTime(overrideOf(p.code)?.granted_at) }}<template v-if="overrideOf(p.code)?.expires_at"> · expires {{ formatDate(overrideOf(p.code)?.expires_at) }}</template></div></template>
                  <template v-else>—</template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.ea-pick { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.ea-kv { max-width: 760px; }
.ea-kv dt { color: var(--cw-ink-2); padding-right: 20px; }
.ea-ws { list-style: none; margin: 0; padding: 0; }
.ea-ws li { padding: 8px 0; border-bottom: 1px solid var(--cw-line); display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.ea-cat th { text-align: left; text-transform: capitalize; background: var(--cw-canvas, #f6f7f9); }
</style>
