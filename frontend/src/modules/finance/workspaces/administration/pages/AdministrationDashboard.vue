<script setup lang="ts">
/**
 * The access administrator's dashboard: who holds finance access and on what terms, the personal
 * exceptions in force, and the latest changes. It holds no financial authority and shows no
 * finance figure; it says so once, at the top.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Users, KeyRound, Building2, History, ShieldAlert, AlertTriangle, Info } from 'lucide-vue-next'
import { formatDateTime } from '../../../composables/useMoney'
import { financeRoleLabel } from '../../../shell/roleLabels'
import { adminDash, byRole } from '../dashboard'
import { readChange } from '../workspacePreview'

const { state, load } = adminDash
const d = computed(() => state.data)
const users = computed(() => d.value?.list.users ?? [])
const withOverrides = computed(() => users.value.filter((u) => u.override_count > 0))
const withScope = computed(() => users.value.filter((u) => u.scope_count > 0))
const changes = computed(() => (d.value?.changes ?? []).map(readChange))
const refused = computed(() => changes.value.filter((c) => c.refused).length)
const adjusted = computed(() => users.value.filter((u) => u.override_count > 0 || u.scope_count > 0).slice(0, 10))
</script>

<template>
  <p class="cw-banner-msg cw-banner-msg--info" role="note"><Info :size="18" aria-hidden="true" />
    This workspace decides who holds finance access. It holds no financial authority: it approves, posts and publishes nothing, and shows no finance figures.</p>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load()">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'adm-users' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><Users :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Finance Accounts</p><p class="cw-tile-value num">{{ d.list.total }}</p><p class="cw-tile-sub">staff with a finance role</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'adm-effective' }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><KeyRound :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Personal Overrides</p><p class="cw-tile-value num">{{ withOverrides.length }}</p><p class="cw-tile-sub">people with an exception to their role</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'adm-effective' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Building2 :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Departmental Scopes</p><p class="cw-tile-value num">{{ withScope.length }}</p><p class="cw-tile-sub">people confined to named votes</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'adm-log' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><History :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Access Changes</p><p class="cw-tile-value num">{{ d.changesNote ? '—' : changes.length }}</p>
          <p class="cw-tile-sub">{{ d.changesNote ? 'trail not available' : `last 90 days · ${refused} refused` }}</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="ad-recent">
        <div class="cw-card-head"><h3 id="ad-recent"><History :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Access Changes</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'adm-log' }" class="cw-link">Access log</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="d.changesNote" class="cw-empty">{{ d.changesNote }}</p>
          <p v-else-if="!changes.length" class="cw-empty">No finance access was changed in the last 90 days.</p>
          <ul v-else class="dx-list">
            <li v-for="c in changes.slice(0, 8)" :key="c.id" class="dx-item">
              <ShieldAlert v-if="c.refused" :size="19" class="dx-neg" aria-hidden="true" />
              <span class="dx-grow">{{ c.lines[0] ?? (c.refused ? 'Change refused' : 'Access saved') }}
                <span class="cw-hint"> · by {{ c.actor }}<template v-if="c.reason"> · {{ c.reason }}</template></span></span>
              <span v-if="c.refused" class="cw-pill cw-pill--neg">Refused</span>
              <span class="dx-when">{{ formatDateTime(c.at) }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ad-roles">
        <div class="cw-card-head"><h3 id="ad-roles"><Users :size="24" class="cw-head-icon" aria-hidden="true" /> Accounts by Role</h3></div>
        <div class="cw-card-body cw-table-wrap">
          <p v-if="!users.length" class="cw-empty">No staff account holds a finance role.</p>
          <table v-else class="cw-table dx-compact">
            <thead><tr><th scope="col">Role</th><th scope="col" class="r">Accounts</th></tr></thead>
            <tbody><tr v-for="r in byRole(d.list)" :key="r.role"><td>{{ financeRoleLabel(r.role) }}</td><td class="r num">{{ r.n }}</td></tr></tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="cw-card" aria-labelledby="ad-adj">
      <div class="cw-card-head"><h3 id="ad-adj"><KeyRound :size="24" class="cw-head-icon" aria-hidden="true" /> Exceptions in Force</h3><span class="cw-spacer" />
        <RouterLink :to="{ name: 'adm-duties' }" class="cw-link">Check separation of duties</RouterLink></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!adjusted.length" class="cw-empty">Everyone holds exactly what their role gives. No override or scope is in force.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col" class="r">Overrides</th><th scope="col" class="r">Votes in scope</th><th scope="col" /></tr></thead>
          <tbody>
            <tr v-for="u in adjusted" :key="u.id">
              <td><strong>{{ u.name }}</strong><div class="cw-hint">{{ u.email }}</div></td>
              <td>{{ financeRoleLabel(u.role) }}</td>
              <td class="r num">{{ u.override_count }}</td>
              <td class="r num">{{ u.scope_count }}</td>
              <td><RouterLink :to="{ name: 'adm-effective', query: { user: u.id } }" class="cw-link">Effective access<span class="sr-only"> of {{ u.name }}</span></RouterLink></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
