<script setup lang="ts">
/**
 * Who holds finance access, and on what terms.
 *
 * The permission catalogue deliberately separates three things: what a role gives by default
 * (`finance.role_permission`), what one person is additionally allowed or refused
 * (`finance.user_permission_override`), and which votes they may see (`finance.user_scope`). This
 * screen is the only place outside SQL where the second and third can be set.
 *
 * WHAT SAVING DOES
 * The overrides and the scope are replaced as a set, not patched one row at a time, so removing a
 * grant in the UI removes it in the database on the next save. A written reason is required and
 * lands in the audit trail with the before and after state.
 *
 * WHAT IT CANNOT DO
 * You cannot edit your own access here — losing the last administrator in the middle of a change
 * is not a recoverable mistake. Account creation and suspension remain in the staff console.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import type {
  FinanceAccessDetail, FinanceAccessUser, FinanceRoleDefaults, FinanceUserList,
} from '../../models/types'
import FinanceGuard from '../../components/FinanceGuard.vue'
import {
  AlertTriangle, Check, CheckCircle2, Minus, RefreshCw, Save, Search, ShieldCheck, Users, X,
} from 'lucide-vue-next'

const store = useFinanceStore()

const FINANCE_ROLE_LABELS: Record<string, string> = {
  finance_admin: 'Finance Administrator',
  finance_officer: 'Finance Officer',
  budget_officer: 'Budget Officer',
  dept_head: 'Departmental Head',
  finance_committee: 'Finance Committee / Treasurer',
  publisher: 'Publisher',
  auditor: 'Auditor',
}

const CATEGORY_LABELS: Record<string, string> = {
  configuration: 'Configuration',
  budget: 'Budget and revisions',
  actuals: 'Actuals and transactions',
  import: 'Data imports',
  projects: 'Projects',
  documents: 'Documents',
  reporting: 'Reports and exports',
  publication: 'Publication',
  audit: 'Audit',
  administration: 'Administration',
}

const canManage = computed(() => store.can('finance.users.manage_finance_roles'))

const list = ref<FinanceUserList | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const query = ref('')

const selected = ref<FinanceAccessUser | null>(null)
const detail = ref<FinanceAccessDetail | null>(null)
const loadingDetail = ref(false)

const roleModel = ref('')
const draftOverrides = ref<Record<string, 'grant' | 'deny'>>({})
const draftScope = ref<Set<string>>(new Set())
const reason = ref('')
const saving = ref(false)

const roles = computed<FinanceRoleDefaults[]>(() => list.value?.roles ?? [])

const filteredUsers = computed(() => {
  const term = query.value.trim().toLowerCase()
  const users = list.value?.users ?? []
  if (!term) return users
  return users.filter((u) =>
    u.name.toLowerCase().includes(term)
    || u.email.toLowerCase().includes(term)
    || (u.role ?? '').toLowerCase().includes(term),
  )
})

const categories = computed(() => {
  const groups = new Map<string, typeof store.catalogue>()
  for (const p of store.catalogue) {
    const rows = groups.get(p.category) ?? []
    rows.push(p)
    groups.set(p.category, rows)
  }
  return [...groups.entries()]
    .map(([category, permissions]) => ({
      category,
      permissions: [...permissions].sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
})

const inherited = computed<Set<string>>(() => {
  if (!detail.value) return new Set()
  const role = roleModel.value || detail.value.user.role
  const fromRole = roles.value.find((r) => r.name === role)
  if (fromRole) return new Set(fromRole.permissions)
  if (role === detail.value.user.role) return new Set(detail.value.role_permissions)
  return new Set()
})

function isEffective(code: string): boolean {
  const override = draftOverrides.value[code]
  if (override === 'deny') return false
  if (override === 'grant') return true
  return inherited.value.has(code)
}

const effectiveCount = computed(() =>
  store.catalogue.filter((p) => isEffective(p.code)).length)

/**
 * SEPARATION OF DUTIES, SHOWN BEFORE IT IS REFUSED.
 *
 * The server is the gate: `PUT /finance/users/:id/access` recomputes the resulting effective set
 * inside its transaction and answers 409 `separation_of_duties` naming the two permissions that
 * collide (migration 200, src/lib/financeSeparationOfDuties.js). Until that landed the write
 * succeeded and this screen offered the combination with no warning at all, while the Permissions
 * screen told the officer it was impossible.
 *
 * This computed is the same rule read off the catalogue flags the identity call already carries,
 * so the administrator sees the conflict as they build it rather than after pressing Save. It is
 * an EXPLANATION, not the control: the button stays disabled only because saving would be
 * refused, and the refusal is the server's.
 */
const sodConflict = computed<{ approval: string; publication: string } | null>(() => {
  if (!detail.value) return null
  const effective = store.catalogue.filter((p) => isEffective(p.code))
  const approval = effective.find((p) => p.is_approval)
  const publication = effective.find((p) => p.is_publication)
  if (!approval || !publication) return null
  return { approval: approval.label, publication: publication.label }
})

/** The technical administrator holds no authority over financial content, by construction. */
const adminAuthorityConflict = computed<string | null>(() => {
  if (!detail.value || detail.value.user.role !== 'admin') return null
  const offending = store.catalogue.find(
    (p) => isEffective(p.code) && (p.is_approval || p.is_publication || p.is_restricted),
  )
  return offending ? offending.label : null
})

const blocked = computed(() => !!sodConflict.value || !!adminAuthorityConflict.value)

const selfSelected = computed(() =>
  !!detail.value && detail.value.user.id === store.identity?.user_id)

function roleLabel(role: string): string {
  return FINANCE_ROLE_LABELS[role] ?? role
}

function effectOf(code: string): 'inherit' | 'grant' | 'deny' {
  return draftOverrides.value[code] ?? 'inherit'
}

function setEffect(code: string, effect: 'inherit' | 'grant' | 'deny'): void {
  const next = { ...draftOverrides.value }
  if (effect === 'inherit') delete next[code]
  else next[code] = effect
  draftOverrides.value = next
}

function toggleScope(id: string): void {
  const next = new Set(draftScope.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  draftScope.value = next
}

async function load(): Promise<void> {
  if (!canManage.value) return
  loading.value = true
  error.value = null
  try {
    list.value = await financeApi.financeUsers(query.value.trim() || undefined)
  } catch (err) {
    error.value = messageOf(err, 'The staff list could not be read.')
  } finally { loading.value = false }
}

async function choose(user: FinanceAccessUser): Promise<void> {
  selected.value = user
  detail.value = null
  loadingDetail.value = true
  error.value = null
  note.value = null
  try {
    const access = await financeApi.financeUserAccess(user.id)
    detail.value = access
    roleModel.value = FINANCE_ROLE_LABELS[access.user.role] ? access.user.role : ''
    draftOverrides.value = Object.fromEntries(
      access.overrides.map((o) => [o.permission_code, o.effect]),
    )
    draftScope.value = new Set(access.department_scope.map((d) => d.id))
    reason.value = ''
  } catch (err) {
    error.value = messageOf(err, 'This person’s finance access could not be read.')
  } finally { loadingDetail.value = false }
}

async function save(): Promise<void> {
  if (!detail.value || !selected.value) return
  error.value = null
  note.value = null
  if (!reason.value.trim()) {
    error.value = 'Record why this access is changing. The reason is kept in the audit trail.'
    return
  }
  saving.value = true
  try {
    const overrides = Object.entries(draftOverrides.value).map(([permission_code, effect]) => {
      const existing = detail.value?.overrides.find((o) => o.permission_code === permission_code)
      return {
        permission_code,
        effect,
        reason: existing?.reason ?? reason.value.trim(),
        expires_at: existing?.expires_at ?? null,
      }
    })
    const updated = await financeApi.updateFinanceUserAccess(selected.value.id, {
      ...(roleModel.value ? { role: roleModel.value } : {}),
      overrides,
      department_ids: [...draftScope.value],
      reason: reason.value.trim(),
    })
    detail.value = updated
    selected.value = { ...selected.value, ...updated.user, override_count: updated.overrides.length, scope_count: updated.department_scope.length }
    note.value = `${updated.user.name} now holds ${updated.permissions.length} finance permission(s)${updated.department_scope.length ? `, confined to ${updated.department_scope.map((d) => d.code).join(', ')}` : ''}.`
    await load()
  } catch (err) {
    error.value = messageOf(err, 'The access change could not be saved.')
  } finally { saving.value = false }
}

onMounted(() => { if (canManage.value) void load() })

// Search is answered by the server so it can reach staff beyond the first page. The list is also
// filtered locally while the request is in flight, which keeps typing responsive.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), 300)
})
</script>

<template>
  <div class="fin-section">
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <section class="ins-card">
      <div class="ins-card-head">
        <h3><Users :size="15" aria-hidden="true" /> Finance access</h3>
        <span v-if="list" class="ins-count">{{ list.total }} staff</span>
      </div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">
          A role sets the defaults. An override is a deliberate exception for one person, and a
          departmental scope confines them to named votes. Denials always win over grants.
        </p>

        <div class="fin-section-actions">
          <label class="fin-search">
            <Search :size="14" aria-hidden="true" />
            <input v-model="query" class="ins-input" type="search"
                   placeholder="Search name, email or role" aria-label="Search staff" />
          </label>
          <button type="button" class="fin-btn small" :disabled="loading" @click="load">
            <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
          </button>
        </div>

        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">Person</th><th scope="col">Role</th>
                <th scope="col">Overrides</th><th scope="col">Scope</th><th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in filteredUsers" :key="u.id" :class="{ 'is-selected': selected?.id === u.id }">
                <td>
                  <span class="emphasis">{{ u.name }}</span>
                  <span class="fin-sub fin-block">{{ u.email }}</span>
                </td>
                <td>{{ roleLabel(u.role) }}</td>
                <td>{{ u.override_count }}</td>
                <td>{{ u.scope_count ? `${u.scope_count} vote(s)` : 'Council-wide' }}</td>
                <td class="fin-right">
                  <button type="button" class="fin-btn small" @click="choose(u)">Manage</button>
                </td>
              </tr>
              <tr v-if="!loading && filteredUsers.length === 0">
                <td colspan="5" class="fin-sub">No staff account matches that search.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="list && list.total > list.users.length" class="fin-sub">
          Showing {{ list.users.length }} of {{ list.total }} staff. Search narrows the server-side list.
        </p>
      </div>
    </section>

    <section v-if="selected" class="ins-card">
      <div class="ins-card-head">
        <h3><ShieldCheck :size="15" aria-hidden="true" /> {{ selected.name }}</h3>
        <span v-if="detail" class="ins-count">{{ effectiveCount }} permission(s)</span>
      </div>
      <div class="ins-card-body">
        <p v-if="loadingDetail" class="fin-sub">Reading this person’s access…</p>

        <template v-else-if="detail">
          <p v-if="selfSelected" class="ins-banner t-warning" role="status">
            <AlertTriangle :size="15" aria-hidden="true" />
            <span>This is your own account. Another administrator must change it.</span>
          </p>

          <p v-if="sodConflict" class="ins-banner t-negative" role="alert">
            <AlertTriangle :size="15" aria-hidden="true" />
            <span>
              This combination cannot be saved. It would leave one person holding both
              <strong>{{ sodConflict.approval }}</strong> and
              <strong>{{ sodConflict.publication }}</strong> — approving a dataset and releasing it
              are separate duties. Set one of the two to Deny, or give it to someone else. The
              server refuses this write and records the attempt in the audit trail.
            </span>
          </p>
          <p v-else-if="adminAuthorityConflict" class="ins-banner t-negative" role="alert">
            <AlertTriangle :size="15" aria-hidden="true" />
            <span>
              This cannot be saved. The technical administrator provisions access and reads the
              audit trail; it approves nothing, publishes nothing and sees no restricted data, and
              <strong>{{ adminAuthorityConflict }}</strong> is one of those. Give it to a finance
              role instead.
            </span>
          </p>

          <div class="fin-access-grid">
            <label class="fin-field">
              <span>Finance role</span>
              <select v-model="roleModel" class="ins-input" :disabled="selfSelected">
                <option v-if="!FINANCE_ROLE_LABELS[detail.user.role]" value="" disabled>
                  {{ detail.user.role }} (current — not a finance role)
                </option>
                <option v-for="r in roles" :key="r.name" :value="r.name">{{ FINANCE_ROLE_LABELS[r.name] ?? r.name }}</option>
              </select>
              <span class="fin-sub">Changing the role changes the inherited permissions immediately.</span>
            </label>

            <div class="fin-field">
              <span>Department scope</span>
              <p v-if="store.activeDepartments.length === 0" class="fin-sub">No departments configured.</p>
              <div v-else class="fin-scope-list">
                <label v-for="d in store.activeDepartments" :key="d.id" class="ins-check">
                  <input type="checkbox" :checked="draftScope.has(d.id)" :disabled="selfSelected"
                         @change="toggleScope(d.id)" />
                  {{ d.code }} {{ d.name }}
                </label>
              </div>
              <span class="fin-sub">
                Nothing ticked means council-wide. A scope narrows what this person can read and act on.
              </span>
            </div>
          </div>

          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Effective</th><th scope="col">Permission</th>
                  <th scope="col">Inherited</th><th scope="col">This person</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="group in categories" :key="group.category">
                  <tr class="fin-group-row">
                    <td colspan="4">{{ CATEGORY_LABELS[group.category] ?? group.category }}</td>
                  </tr>
                  <tr v-for="p in group.permissions" :key="p.code">
                    <td>
                      <component :is="isEffective(p.code) ? Check : X" :size="15" aria-hidden="true"
                                 :class="isEffective(p.code) ? 'fin-yes' : 'fin-no'" />
                      <span class="sr-only">{{ isEffective(p.code) ? 'Effective' : 'Not effective' }}</span>
                    </td>
                    <td>
                      <span :class="{ emphasis: isEffective(p.code) }">{{ p.label }}</span>
                      <span class="fin-sub fin-block ins-mono">{{ p.code }}</span>
                    </td>
                    <td>
                      <Check v-if="inherited.has(p.code)" :size="14" class="fin-yes" aria-label="Inherited" />
                      <Minus v-else :size="14" class="fin-no" aria-label="Not inherited" />
                    </td>
                    <td>
                      <div class="fin-effect" role="group" :aria-label="`Access for ${p.label}`">
                        <button type="button" class="fin-effect-btn" :class="{ active: effectOf(p.code) === 'inherit' }"
                                :disabled="selfSelected" @click="setEffect(p.code, 'inherit')">Inherit</button>
                        <button type="button" class="fin-effect-btn" :class="{ active: effectOf(p.code) === 'grant' }"
                                :disabled="selfSelected" @click="setEffect(p.code, 'grant')">Grant</button>
                        <button type="button" class="fin-effect-btn" :class="{ active: effectOf(p.code) === 'deny' }"
                                :disabled="selfSelected" @click="setEffect(p.code, 'deny')">Deny</button>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div class="fin-access-save">
            <label class="fin-field fin-grow">
              <span>Reason for this change</span>
              <input v-model="reason" class="ins-input" type="text" maxlength="2000"
                     placeholder="e.g. Appointed budget officer for the 2027 cycle"
                     :disabled="selfSelected" />
            </label>
            <FinanceGuard requires="finance.users.manage_finance_roles" surface="Changing finance access">
              <button type="button" class="fin-btn"
                      :disabled="saving || selfSelected || blocked || !reason.trim()" @click="save">
                <Save :size="14" aria-hidden="true" /> {{ saving ? 'Saving…' : 'Save access' }}
              </button>
            </FinanceGuard>
          </div>

          <p class="fin-ccy-note">
            The reason, the actor and the before/after state are written to the admin audit trail.
            Scope is evaluated on the server for every request; it is not a UI filter. No person
            can be left holding both an approval permission and the publication permission, however
            the grant is written: the server recomputes the resulting permissions and refuses the
            change, naming the pair.
          </p>
        </template>
      </div>
    </section>

    <section v-if="!canManage" class="ins-card">
      <div class="ins-card-body">
        <p class="fin-sub">Managing finance access requires the administration permission.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-block { display: block; }
.fin-yes { color: var(--ent-success); }
.fin-no { color: var(--ent-text-3); }
.fin-right { text-align: right; }
.is-selected td { background: var(--ent-tone-info-bg); }
.fin-section-actions { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; margin-bottom: var(--ent-s3); }
.fin-search { display: flex; align-items: center; gap: var(--ent-s2); flex: 1 1 240px; }
.fin-search .ins-input { width: 100%; }
.fin-access-grid { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(260px, 2fr); gap: var(--ent-s4); margin-bottom: var(--ent-s4); }
.fin-field { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-sm); }
.fin-field > span:first-child { font-weight: 600; color: var(--ent-text); }
.fin-scope-list { display: flex; flex-wrap: wrap; gap: var(--ent-s2); }
.fin-group-row td { background: var(--ent-surface-2, rgba(127, 127, 127, 0.08)); font-weight: 600; font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: 0.04em; }
.fin-effect { display: inline-flex; border: 1px solid var(--ent-border); border-radius: var(--ent-radius-sm, 4px); overflow: hidden; }
.fin-effect-btn { border: 0; background: transparent; padding: 2px 8px; font-size: var(--ent-fs-micro); cursor: pointer; color: var(--ent-text-3); }
.fin-effect-btn + .fin-effect-btn { border-left: 1px solid var(--ent-border); }
.fin-effect-btn.active { background: var(--ent-accent, #2563eb); color: #fff; }
.fin-effect-btn:disabled { cursor: not-allowed; opacity: 0.55; }
.fin-access-save { display: flex; align-items: flex-end; gap: var(--ent-s3); margin-top: var(--ent-s4); flex-wrap: wrap; }
.fin-grow { flex: 1 1 320px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 760px) {
  .fin-access-grid { grid-template-columns: 1fr; }
}
</style>
