<script setup lang="ts">
// Roles & permissions — what each role may do.
//
// WHY THIS IS SERVED, NOT WRITTEN HERE
// The console used to draw a "Role Access Legend" from a list hand-written in
// AdminView.vue, maintained separately from the role arrays in the forty-odd
// route files that actually decide. Two copies of an access rule is one copy
// plus a lie, and the lie is the one the admin reads before granting somebody
// a role.
//
// This matrix comes from GET /admin/permissions, which is built from
// src/config/permissions.js in the backend — one description, in the same
// repository as the routes it describes, next to the role constants they
// import.
//
// IT IS STILL A DESCRIPTION, AND THE PAGE SAYS SO
// Fastify enforces per route; no registry can change that. The honest framing
// is "this is what the server is built to allow", not "this is the switchboard".
// The console shows the route prefixes behind each capability so a reviewer can
// check the claim rather than take it.
//
// READ-ONLY, DELIBERATELY
// There is no toggle. A permission that could be granted from a web console
// would be a permission that could be granted by anyone who reached this
// console, and role membership — which IS editable, on the Employees screen —
// is the correct grain for that decision.

import { computed, onMounted, ref } from 'vue'
import { useAdminNav } from '@/admin/useAdminConsole'
import { getPermissions, errorMessage, type CapabilityRow, type RoleDescription } from '@/services/adminConsole'
import { AlertTriangle, Check, Minus, KeyRound, Users, Info } from 'lucide-vue-next'

const nav = useAdminNav()

const roles = ref<RoleDescription[]>([])
const capabilities = ref<CapabilityRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Which role's column is emphasised. Reading a 9 × 22 grid unaided is the
// failure mode of every permission matrix; picking a role dims the rest.
const focus = computed(() => nav.param('user'))

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await getPermissions()
    roles.value = result.roles
    capabilities.value = result.capabilities
  } catch (err) {
    roles.value = []
    capabilities.value = []
    error.value = errorMessage(err, 'The permission matrix could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** Capabilities in the groups the backend declared, in first-seen order. */
const groups = computed(() => {
  const map = new Map<string, CapabilityRow[]>()
  for (const c of capabilities.value) {
    const list = map.get(c.group) ?? []
    list.push(c)
    map.set(c.group, list)
  }
  return [...map.entries()].map(([name, rows]) => ({ name, rows }))
})

const focusedRole = computed(() => roles.value.find(r => r.id === focus.value) ?? null)
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">People &amp; access</span>
        <h2 class="ins-title">Roles &amp; permissions</h2>
        <p class="ins-lede">
          What each system role may do, as the server is built to allow it. Read this
          before granting a role — it is the same description the API routes are written
          against.
        </p>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="rl-btn" @click="load">Retry</button>
    </div>

    <p v-if="loading && !roles.length" class="rl-loading" role="status">Reading the matrix…</p>

    <template v-else-if="roles.length">
      <!-- ── The roles ─────────────────────────────────────────────────── -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h3><KeyRound :size="15" aria-hidden="true" /> Roles you can grant
            <span class="ins-count">{{ roles.length }}</span></h3>
        </div>
        <div class="ins-card-body">
          <ul class="rl-roles">
            <li v-for="r in roles" :key="r.id">
              <button type="button" class="rl-role" :class="{ on: focus === r.id }"
                      :aria-pressed="focus === r.id"
                      @click="nav.setParam('user', focus === r.id ? null : r.id)">
                <strong>{{ r.name }}</strong>
                <small>{{ r.summary }}</small>
                <span class="rl-count">
                  {{ r.capabilities.length }} of {{ capabilities.length }} capabilities
                </span>
              </button>
            </li>
          </ul>
          <p class="ins-hint rl-hint">
            Select a role to highlight its column below. Select it again to clear.
          </p>
        </div>
      </section>

      <p v-if="focusedRole" class="rl-focused" role="status">
        <Users :size="15" aria-hidden="true" />
        <span>
          Showing <strong>{{ focusedRole.name }}</strong> against every other role.
          To grant it to somebody, open
          <button type="button" class="rl-link" @click="nav.go('employees')">Employee accounts</button>.
        </span>
      </p>

      <!-- ── The matrix ────────────────────────────────────────────────── -->
      <section v-for="group in groups" :key="group.name" class="ins-card">
        <div class="ins-card-head"><h3>{{ group.name }}</h3></div>
        <!-- A horizontal scroller, not a mobile card stack: in a matrix the
             column alignment IS the information, and a per-row card loses the
             comparison the screen exists to make. -->
        <div class="rl-scroll">
          <table class="rl-table">
            <thead>
              <tr>
                <th scope="col" class="rl-cap-head">Capability</th>
                <th v-for="r in roles" :key="r.id" scope="col"
                    class="rl-role-head" :class="{ dim: focus && focus !== r.id }">
                  <span :title="r.name">{{ r.short }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in group.rows" :key="c.id">
                <th scope="row" class="rl-cap">
                  <span class="rl-cap-label">{{ c.label }}</span>
                  <span class="rl-cap-routes ins-mono" :title="c.routes.join('  ')">
                    {{ c.routes.join(' · ') }}
                  </span>
                </th>
                <td v-for="r in roles" :key="r.id"
                    class="rl-cell" :class="{ dim: focus && focus !== r.id, yes: c.granted[r.id] }">
                  <!-- Never colour alone: a tick and a dash differ in shape as
                       well as in tone (WCAG 1.4.1). -->
                  <Check v-if="c.granted[r.id]" :size="14" aria-hidden="true" />
                  <Minus v-else :size="14" aria-hidden="true" />
                  <span class="ent-sr-only">
                    {{ r.short }} {{ c.granted[r.id] ? 'may' : 'may not' }} {{ c.label.toLowerCase() }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p class="rl-caveat">
        <Info :size="15" aria-hidden="true" />
        <span>
          This is a description of what the API is built to allow, not a switchboard.
          Each route enforces its own role list; the table is generated from the same
          registry those lists are written against, so the two cannot drift silently.
          Permissions are not editable from a web console — role membership is, on the
          Employee accounts screen, which is the right grain for that decision.
        </span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.rl-btn { min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text);
  background:var(--ent-surface); border:1px solid var(--ent-line-strong);
  border-radius:var(--ent-r); cursor:pointer; }
.rl-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.rl-loading { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }

.rl-roles { list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fit, minmax(16rem, 1fr)); gap:var(--ent-s2); }
.rl-role { display:block; width:100%; text-align:left; padding:var(--ent-s3);
  font-family:var(--ent-font); background:var(--ent-surface-2);
  border:1px solid var(--ent-line); border-radius:var(--ent-r); cursor:pointer;
  transition:border-color var(--ent-dur) var(--ent-ease), background-color var(--ent-dur) var(--ent-ease); }
.rl-role:hover { border-color:var(--ent-line-strong); }
.rl-role:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.rl-role.on { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); }
.rl-role strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.rl-role small { display:block; margin-top:2px; font-size:var(--ent-fs-xs); line-height:var(--ent-lh); color:var(--ent-text-2); }
.rl-count { display:block; margin-top:var(--ent-s2); font-size:var(--ent-fs-micro);
  color:var(--ent-text-3); font-variant-numeric:tabular-nums; }
.rl-hint { margin-top:var(--ent-s3); }

.rl-focused { display:flex; align-items:flex-start; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-sm); line-height:var(--ent-lh);
  color:var(--ent-accent); background:var(--ent-accent-soft);
  border:1px solid var(--ent-accent-line); border-radius:var(--ent-r); }
.rl-focused > svg { flex-shrink:0; margin-top:2px; }
.rl-link { font-family:var(--ent-font); font-size:inherit; color:inherit;
  background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; font-weight:var(--ent-fw-semibold); }
.rl-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); border-radius:2px; }

.rl-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.rl-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.rl-table th, .rl-table td { padding:var(--ent-s2) var(--ent-s3); border-top:1px solid var(--ent-line); }
.rl-table thead th { border-top:0; position:sticky; top:0; background:var(--ent-surface-2);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.04em; text-transform:uppercase; color:var(--ent-text-3); }

.rl-cap-head { text-align:left; min-width:18rem; }
.rl-role-head { text-align:center; width:5.5rem; white-space:nowrap; }

.rl-cap { text-align:left; font-weight:var(--ent-fw-normal); }
.rl-cap-label { display:block; color:var(--ent-text); }
.rl-cap-routes { display:block; margin-top:2px; font-size:var(--ent-fs-micro); color:var(--ent-text-3);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:24rem; }

.rl-cell { text-align:center; color:var(--ent-text-3); }
.rl-cell.yes { color:var(--ent-success); background:var(--ent-success-soft); }
.rl-cell > svg { vertical-align:middle; }

/* Dimming the other columns rather than hiding them: the comparison is the
   point, so the rest stay legible and simply recede. */
.rl-cell.dim, .rl-role-head.dim { opacity:0.38; }

.rl-caveat { display:flex; align-items:flex-start; gap:var(--ent-s2); margin:0;
  padding:var(--ent-s4); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.rl-caveat > svg { flex-shrink:0; margin-top:2px; color:var(--ent-text-3); }

@media (max-width: 767px) {
  .rl-cap-head { min-width:12rem; }
  .rl-cap-routes { display:none; }
}
</style>
