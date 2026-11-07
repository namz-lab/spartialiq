<script setup lang="ts">
// Org structure — the council establishment, its reporting lines, its vacancies.
//
// A POST IS NOT A PERSON
// This is the whole reason the chart used to be hardcoded in AdminView.vue.
// The Vungu establishment has vacant posts, and a structure keyed on user
// accounts cannot represent one: there is no user row for "GIS Officer,
// vacant". The table behind this screen holds POSTS, each with a nullable
// holder, so a vacancy is simply a post nobody holds — which is also the thing
// an IT admin is most often asked to report on.
//
// THE ROLE MISMATCH IS THE POINT
// Each post carries the system role it SHOULD have. When the holder's account
// carries a different one — a Building Inspector post held by an account
// with `viewer` — the console flags it. That is the access problem an admin is
// asked to find after somebody says "I can't do my job", and it is invisible
// in a user list sorted by name.
//
// EDITING IS INLINE AND CONSERVATIVE
// Reparenting is a select, not a drag: a council establishment is amended a
// few times a year, and a drag target that is one row off silently reorganises
// the department.

import { computed, onMounted, ref } from 'vue'
import { useAdminNav } from '@/admin/useAdminConsole'
import { useAdminOverview } from '@/admin/useAdminOverview'
import {
  listOrg, createPosition, updatePosition, deletePosition, listStaff, errorMessage,
  type OrgPosition, type StaffUser,
} from '@/services/adminConsole'
import UiSheet from '@/components/ui/UiSheet.vue'
import AdminConfirm from '../AdminConfirm.vue'
import {
  RefreshCw, AlertTriangle, CheckCircle2, Plus, Pencil, Trash2, UserX, TriangleAlert,
} from 'lucide-vue-next'

const nav = useAdminNav()
const overview = useAdminOverview()

const positions = ref<OrgPosition[]>([])
const staff = ref<StaffUser[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref(false)

const ROLES = [
  { id: '', label: 'No system role' },
  { id: 'admin', label: 'IT Administrator' },
  { id: 'eo', label: 'Executive Officer' },
  { id: 'planner', label: 'Town Planning Officer' },
  { id: 'planning_clerk', label: 'Planning Clerk' },
  { id: 'building_inspector', label: 'Building Inspector' },
  { id: 'env_officer', label: 'Environmental Health Officer' },
  { id: 'surveyor', label: 'Surveyor' },
  { id: 'gis_officer', label: 'GIS Officer' },
]
const roleLabel = (id: string | null) => ROLES.find(r => r.id === (id ?? ''))?.label ?? id ?? '—'

async function load() {
  loading.value = true
  error.value = null
  try {
    const [org, people] = await Promise.all([listOrg(), listStaff(true)])
    positions.value = org
    staff.value = people
  } catch (err) {
    positions.value = []
    error.value = errorMessage(err, 'The establishment could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

interface Node extends OrgPosition { children: Node[]; depth: number }

/**
 * The establishment as a tree, flattened for rendering.
 *
 * Built defensively: a post whose parent has been deleted, or a cycle
 * introduced by two edits racing, must still render. Orphans are promoted to
 * the top rather than disappearing, and a cycle is broken by the `seen` set
 * rather than recursing until the stack goes.
 */
const tree = computed<Node[]>(() => {
  const byId = new Map(positions.value.map(p => [p.id, { ...p, children: [], depth: 0 } as Node]))
  const roots: Node[] = []

  for (const node of byId.values()) {
    const parent = node.reports_to ? byId.get(node.reports_to) : null
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }

  const order = (a: Node, b: Node) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)
  const flat: Node[] = []
  const seen = new Set<string>()

  function walk(nodes: Node[], depth: number) {
    for (const node of [...nodes].sort(order)) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      node.depth = depth
      flat.push(node)
      walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)

  // Anything a cycle kept out of the walk is appended rather than lost: an
  // invisible post is worse than an oddly placed one.
  for (const node of byId.values()) {
    if (!seen.has(node.id)) { node.depth = 0; flat.push(node) }
  }
  return flat
})

const vacancies = computed(() => positions.value.filter(p => !p.holder_id))
const mismatches = computed(() => positions.value.filter(p => p.roleMismatch))

// ── Editing ─────────────────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<OrgPosition | null>(null)
const form = ref({ title: '', department: '', systemRole: '', holderId: '', reportsTo: '', sortOrder: 0 })
const formError = ref<string | null>(null)

function openNew() {
  editing.value = null
  form.value = { title: '', department: '', systemRole: '', holderId: '', reportsTo: '', sortOrder: 0 }
  formError.value = null
  formOpen.value = true
}

function openEdit(p: OrgPosition) {
  editing.value = p
  form.value = {
    title: p.title,
    department: p.department ?? '',
    systemRole: p.system_role ?? '',
    holderId: p.holder_id ?? '',
    reportsTo: p.reports_to ?? '',
    sortOrder: p.sort_order,
  }
  formError.value = null
  formOpen.value = true
}

/**
 * Posts this one may report to.
 *
 * Itself is excluded, and so is every post beneath it — reparenting a post
 * under its own subordinate makes a cycle that the tree builder would have to
 * paper over. The database CHECK only catches the self-reference case, so the
 * deeper one is prevented here, where the shape is known.
 */
const parentChoices = computed(() => {
  if (!editing.value) return positions.value
  const banned = new Set<string>([editing.value.id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of positions.value) {
      if (p.reports_to && banned.has(p.reports_to) && !banned.has(p.id)) {
        banned.add(p.id)
        grew = true
      }
    }
  }
  return positions.value.filter(p => !banned.has(p.id))
})

async function save() {
  if (!form.value.title.trim()) {
    formError.value = 'A post title is required.'
    return
  }
  busy.value = true
  formError.value = null
  try {
    const payload = {
      title: form.value.title.trim(),
      department: form.value.department.trim() || null,
      systemRole: form.value.systemRole || null,
      holderId: form.value.holderId || null,
      reportsTo: form.value.reportsTo || null,
      sortOrder: Number(form.value.sortOrder) || 0,
    }
    if (editing.value) {
      await updatePosition(editing.value.id, payload)
      note.value = `${payload.title} updated.`
    } else {
      await createPosition(payload)
      note.value = `${payload.title} added to the establishment.`
    }
    formOpen.value = false
    await load()
    overview.invalidate()
  } catch (err) {
    formError.value = errorMessage(err, 'The post could not be saved.')
  } finally {
    busy.value = false
  }
}

const removing = ref<OrgPosition | null>(null)

async function remove() {
  const p = removing.value
  if (!p) return
  busy.value = true
  try {
    await deletePosition(p.id)
    note.value = `${p.title} removed from the establishment.`
    removing.value = null
    await load()
    overview.invalidate()
  } catch (err) {
    error.value = errorMessage(err, 'The post could not be removed.')
    removing.value = null
  } finally {
    busy.value = false
  }
}

const childCount = computed(() => {
  const p = removing.value
  if (!p) return 0
  return positions.value.filter(x => x.reports_to === p.id).length
})
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">People &amp; access</span>
        <h2 class="ins-title">Org structure</h2>
        <p class="ins-lede">
          The council establishment: which posts exist, who reports to whom, and who
          holds each one. A post with no holder is a vacancy, not a missing record.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="og-btn og-btn-primary" @click="openNew">
          <Plus :size="14" aria-hidden="true" /> Add a post
        </button>
        <button type="button" class="og-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="og-btn" @click="load">Retry</button>
    </div>

    <p v-if="note" class="og-note" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /> {{ note }}
    </p>

    <!-- The access problem an admin is asked to find. Above the chart, because
         it is the thing on this screen that needs doing. -->
    <div v-if="mismatches.length" class="ins-banner t-warning">
      <TriangleAlert :size="16" aria-hidden="true" />
      <div>
        <strong>
          {{ mismatches.length }} post{{ mismatches.length === 1 ? '' : 's' }}
          held by an account with a different system role
        </strong>
        <p>
          The holder will not have the access the post needs. Amend the account's role
          under Employee accounts, or change what the post expects here.
        </p>
      </div>
      <button type="button" class="og-btn" @click="nav.go('employees')">Open the register</button>
    </div>

    <p class="og-summary">
      {{ positions.length }} post{{ positions.length === 1 ? '' : 's' }} on the establishment ·
      {{ vacancies.length }} vacant.
    </p>

    <section class="ins-card">
      <div class="ins-card-head"><h3>The establishment</h3></div>
      <ul v-if="tree.length" class="og-tree">
        <li v-for="p in tree" :key="p.id" class="og-row"
            :class="{ vacant: !p.holder_id, mismatch: p.roleMismatch }"
            :style="{ '--depth': p.depth }">
          <span class="og-rule" aria-hidden="true" />
          <div class="og-post">
            <strong class="og-title">{{ p.title }}</strong>
            <span class="og-meta">
              {{ p.department || 'No department' }} · {{ roleLabel(p.system_role) }}
            </span>
          </div>

          <div class="og-holder">
            <template v-if="p.holder_id">
              <strong>{{ p.holder_name }}</strong>
              <small>{{ p.holder_email }}</small>
              <small v-if="p.roleMismatch" class="og-warn">
                <TriangleAlert :size="12" aria-hidden="true" />
                Account holds “{{ roleLabel(p.holder_role) }}”
              </small>
            </template>
            <span v-else class="og-vacant">
              <UserX :size="14" aria-hidden="true" /> Vacant
            </span>
          </div>

          <div class="og-row-actions">
            <button type="button" class="ins-iconbtn" :aria-label="`Amend ${p.title}`" @click="openEdit(p)">
              <Pencil :size="14" aria-hidden="true" />
            </button>
            <button type="button" class="ins-iconbtn og-danger"
                    :aria-label="`Remove ${p.title}`" @click="removing = p">
              <Trash2 :size="14" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>
      <div v-else class="ins-card-body">
        <p class="og-empty">
          {{ loading ? 'Reading the establishment…' : 'No post has been recorded. Add the first one.' }}
        </p>
      </div>
    </section>

    <!-- ── Post form ──────────────────────────────────────────────────── -->
    <UiSheet :open="formOpen" :title="editing ? 'Amend this post' : 'Add a post'"
             :subtitle="editing?.title" width="32rem"
             @close="formOpen = false" @update:open="formOpen = $event">
      <form class="ins-form" @submit.prevent="save">
        <div class="ins-field full">
          <label class="ins-label" for="og-title">Post title</label>
          <input id="og-title" v-model="form.title" class="ins-input" placeholder="Town Planning Officer" />
        </div>

        <div class="ins-field">
          <label class="ins-label" for="og-dept">Department</label>
          <input id="og-dept" v-model="form.department" class="ins-input" placeholder="Planning &amp; Environment" />
        </div>

        <div class="ins-field">
          <label class="ins-label" for="og-order">Order among peers</label>
          <input id="og-order" v-model.number="form.sortOrder" type="number" class="ins-input" min="0" />
        </div>

        <div class="ins-field">
          <label class="ins-label" for="og-role">System role the post carries</label>
          <select id="og-role" v-model="form.systemRole" class="ins-input">
            <option v-for="r in ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
          <p class="ins-hint">
            Advisory. It is what the post should have; the console flags a holder whose
            account disagrees. Changing it here does not change anyone's access.
          </p>
        </div>

        <div class="ins-field">
          <label class="ins-label" for="og-holder">Holder</label>
          <select id="og-holder" v-model="form.holderId" class="ins-input">
            <option value="">Vacant</option>
            <option v-for="u in staff" :key="u.id" :value="u.id">{{ u.name }} — {{ u.email }}</option>
          </select>
        </div>

        <div class="ins-field full">
          <label class="ins-label" for="og-parent">Reports to</label>
          <select id="og-parent" v-model="form.reportsTo" class="ins-input">
            <option value="">Nobody — top of the structure</option>
            <option v-for="p in parentChoices" :key="p.id" :value="p.id">{{ p.title }}</option>
          </select>
          <p v-if="editing" class="ins-hint">
            This post and everything beneath it are left out of the list, because a post
            cannot report to its own subordinate.
          </p>
        </div>

        <p v-if="formError" class="og-error" role="alert">{{ formError }}</p>

        <div class="og-form-actions">
          <button type="button" class="og-btn" @click="formOpen = false">Cancel</button>
          <button type="submit" class="og-btn og-btn-primary" :disabled="busy">
            {{ busy ? 'Saving…' : editing ? 'Save the change' : 'Add the post' }}
          </button>
        </div>
      </form>
    </UiSheet>

    <AdminConfirm
      :open="removing !== null"
      title="Remove this post"
      :message="`${removing?.title} will be removed from the establishment.`"
      :consequence="childCount
        ? `${childCount} post${childCount === 1 ? '' : 's'} reporting to it will move to the top of the structure. No user account is affected.`
        : 'No user account is affected — this removes the post, not the person.'"
      confirm-label="Remove the post"
      destructive
      :busy="busy"
      @confirm="remove"
      @cancel="removing = null"
    />
  </div>
</template>

<style scoped>
.og-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.og-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.og-btn:disabled { opacity:0.55; cursor:not-allowed; }
.og-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.og-btn-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.og-btn-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.og-danger { color:var(--ent-danger); }

.og-summary { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.og-note { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm);
  color:var(--ent-success); background:var(--ent-success-soft);
  border:1px solid var(--ent-tone-positive-line); border-radius:var(--ent-r); }

.og-tree { list-style:none; margin:0; padding:0; }
/* Indentation by depth, capped so a deep structure cannot push the holder
   column off a tablet. */
.og-row { position:relative; display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3) var(--ent-s4);
  padding-left:calc(var(--ent-s4) + min(var(--depth), 4) * var(--ent-s5));
  border-top:1px solid var(--ent-line); }
.og-row:first-child { border-top:0; }
.og-row:hover { background:var(--ent-surface-2); }
.og-row.vacant { background:var(--ent-surface-2); }
.og-row.mismatch { box-shadow:inset 3px 0 0 var(--ent-warning); }

.og-rule { position:absolute; left:calc(var(--ent-s4) + (min(var(--depth), 4) - 0.6) * var(--ent-s5));
  top:0; bottom:0; width:1px; background:var(--ent-line); }
.og-row[style*='--depth: 0'] .og-rule { display:none; }

.og-post { flex:1; min-width:0; }
.og-title { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.og-meta { display:block; margin-top:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.og-holder { width:18rem; min-width:0; flex-shrink:0; }
.og-holder strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.og-holder small { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.og-warn { display:inline-flex !important; align-items:center; gap:3px; margin-top:2px; color:var(--ent-warning) !important; }
.og-vacant { display:inline-flex; align-items:center; gap:var(--ent-s1);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-text-3); }

.og-row-actions { display:inline-flex; gap:var(--ent-s1); flex-shrink:0; }

.og-empty { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.og-form-actions { grid-column:1 / -1; display:flex; justify-content:flex-end; gap:var(--ent-s2); }
.og-error { grid-column:1 / -1; margin:0; font-size:var(--ent-fs-sm); color:var(--ent-danger); }

@media (max-width: 1023px) {
  .og-holder { width:12rem; }
}
@media (max-width: 767px) {
  .og-row { flex-wrap:wrap; padding-left:calc(var(--ent-s3) + min(var(--depth), 3) * var(--ent-s4)); }
  .og-holder { width:100%; padding-left:0; }
  .og-rule { display:none; }
}
</style>
