<script setup lang="ts">
/**
 * What your role may do, and which duties are deliberately held apart.
 *
 * WHY THIS SCREEN EXISTS
 * A finance officer who cannot commit an import, or a committee member who cannot publish their
 * own approval, will assume the system is broken unless something tells them otherwise. This page
 * is that something. It reads the permission catalogue from the server — the same catalogue the
 * route guards use — so it cannot drift from what is actually enforced.
 *
 * It is informational. Nothing on it changes anything, and the permissions it lists are granted by
 * a system administrator through user provisioning, which confers no authority over financial
 * content in its own right.
 */
import { computed } from 'vue'
import { useFinanceStore } from '../../stores/finance'
import type { FinancePermission } from '../../models/types'
import { KeyRound, Check, X, ShieldAlert, EyeOff, Info } from 'lucide-vue-next'

const store = useFinanceStore()

const held = computed(() => new Set(store.identity?.permissions ?? []))

const byCategory = computed(() => {
  const groups = new Map<string, FinancePermission[]>()
  for (const p of store.catalogue) {
    const list = groups.get(p.category) ?? []
    list.push(p)
    groups.set(p.category, list)
  }
  return [...groups.entries()]
    .map(([category, permissions]) => ({
      category,
      permissions: permissions.sort((a, b) => a.code.localeCompare(b.code)),
      heldCount: permissions.filter((p) => held.value.has(p.code)).length,
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
})

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

const myApprovals = computed(() => store.catalogue.filter((p) => p.is_approval && held.value.has(p.code)))
const myPublications = computed(() => store.catalogue.filter((p) => p.is_publication && held.value.has(p.code)))
const myRestricted = computed(() => store.catalogue.filter((p) => p.is_restricted && held.value.has(p.code)))
</script>

<template>
  <div class="fin-section">
    <section class="ins-card">
      <div class="ins-card-head">
        <h3><KeyRound :size="15" aria-hidden="true" /> Your finance role</h3>
      </div>
      <div class="ins-card-body">
        <dl class="ins-dl">
          <div><dt>Role</dt><dd class="emphasis">{{ store.identity?.role ?? 'unknown' }}</dd></div>
          <div><dt>Permissions held</dt><dd>{{ held.size }} of {{ store.catalogue.length }}</dd></div>
          <div>
            <dt>Data scope</dt>
            <dd>
              <template v-if="store.isScoped">
                {{ store.departmentScope.map((d) => `${d.code} ${d.name}`).join(', ') }}
              </template>
              <template v-else>Council-wide</template>
            </dd>
          </div>
        </dl>

        <div class="fin-duty-summary">
          <p>
            <ShieldAlert :size="14" aria-hidden="true" />
            <strong>Approval:</strong>
            <template v-if="myApprovals.length">
              you may approve {{ myApprovals.map((p) => p.label.toLowerCase()).join(', ') }}.
              You cannot approve your own request — that is refused by the route and by the database.
            </template>
            <template v-else>you hold no approval permission. Your role prepares and submits; someone else decides.</template>
          </p>
          <p>
            <Info :size="14" aria-hidden="true" />
            <strong>Publication:</strong>
            <template v-if="myPublications.length">
              you may {{ myPublications.map((p) => p.label.toLowerCase()).join(' and ') }}.
            </template>
            <template v-else>you cannot release data to the public portal.</template>
          </p>
          <p>
            <EyeOff :size="14" aria-hidden="true" />
            <strong>Restricted data:</strong>
            <template v-if="myRestricted.length">
              you may see {{ myRestricted.map((p) => p.label.toLowerCase()).join(', ') }}.
            </template>
            <template v-else>
              supplier and beneficiary identities, and documents classified private, are not shown
              to you. The fields are absent rather than blank, so an empty cell is never mistaken
              for an absent supplier.
            </template>
          </p>
        </div>

        <!--
          This claim used to be true of ROLES and false of PEOPLE. Role defaults were asserted by
          the migration that seeds the grants, but one person's effective set is role defaults plus
          grant overrides minus denies, and the access API wrote those overrides with no equivalent
          check — so a single officer could be given an approval permission and the publication
          permission together (production-readiness audit, BLOCKER-1/2 set). Migration 200 closed
          that: the rule is now applied to the effective set, by the access route and by a deferred
          constraint trigger on the override table, so it holds for a person however the grant was
          written. The wording below says exactly that, and no more than that.
        -->
        <p class="fin-ccy-note">
          No role holds both an approval and the publication permission, and
          <strong>no person can be given both either</strong>. The role defaults are asserted by
          the migration that seeds the grants: if an edit ever gave one role both, the migration
          fails rather than quietly weakening the control. The same rule is applied to an
          individual's effective permissions — role defaults plus any grant, minus any denial — so
          an access change that would leave one officer able to approve a dataset and release it is
          refused, naming the two permissions that collide, and the refusal is recorded in the
          audit trail. A technical administrator holds no permission that approves, publishes,
          commits an import or discloses restricted data, and cannot be granted one.
        </p>
      </div>
    </section>

    <!--
      WHAT IS NOT ON YOUR RAIL, AND WHY.

      Two absences read as defects from the inside and are neither. A finance administrator holds
      most of the permission catalogue and cannot administer finance access, because
      provisioning accounts and holding financial authority are deliberately separate duties — so
      the Finance access section renders for one role out of eight and, until this panel, said
      nothing to the other seven. And a technical administrator has no finance map, because
      `finance.map.view` was granted to the seven finance roles only. Each is answered with a
      sentence. Neither is answered with a control that would produce a 403.
    -->
    <section v-if="store.absenceNotes.length" class="ins-card">
      <div class="ins-card-head">
        <h3><EyeOff :size="15" aria-hidden="true" /> What is not on your rail, and why</h3>
      </div>
      <div class="ins-card-body">
        <ul class="fin-absence-list">
          <li v-for="note in store.absenceNotes" :key="note">{{ note }}</li>
        </ul>
      </div>
    </section>

    <!-- What this person is here to do, in the preset's own words, so the rail's two bands are
         explained on the page that explains the role. -->
    <section class="ins-card">
      <div class="ins-card-head">
        <h3><KeyRound :size="15" aria-hidden="true" /> How your workspace is arranged</h3>
      </div>
      <div class="ins-card-body">
        <p class="fin-ccy-note" style="margin-top: 0">{{ store.rolePreset.summary }}</p>
        <p class="fin-ccy-note">
          Your rail opens on
          <strong>{{ store.rolePreset.landing }}</strong>
          and puts
          {{ store.rolePreset.foreground.length }} section{{ store.rolePreset.foreground.length === 1 ? '' : 's' }}
          under “Your work”. The rest stay under “Also available to you”: they are ordered
          differently, not withheld. Every section your permissions allow remains open to you, a
          link with a section in it always wins over this arrangement, and the server re-checks
          every action inside either band regardless of where it sits.
        </p>
      </div>
    </section>

    <section v-for="group in byCategory" :key="group.category" class="ins-card">
      <div class="ins-card-head">
        <h3>
          {{ CATEGORY_LABELS[group.category] ?? group.category }}
          <span class="ins-count">{{ group.heldCount }} of {{ group.permissions.length }}</span>
        </h3>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">You</th><th scope="col">Permission</th>
                <th scope="col">Code</th><th scope="col">What it covers</th><th scope="col">Kind</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in group.permissions" :key="p.code" :class="{ 'is-held': held.has(p.code) }">
                <td>
                  <component :is="held.has(p.code) ? Check : X" :size="15" aria-hidden="true"
                             :class="held.has(p.code) ? 'fin-yes' : 'fin-no'" />
                  <span class="sr-only">{{ held.has(p.code) ? 'Held' : 'Not held' }}</span>
                </td>
                <td :class="{ emphasis: held.has(p.code) }">{{ p.label }}</td>
                <td class="ins-mono fin-sub">{{ p.code }}</td>
                <td>{{ p.description ?? '—' }}</td>
                <td>
                  <span v-if="p.is_approval" class="fin-pill tone-warning">approval</span>
                  <span v-if="p.is_publication" class="fin-pill tone-info">publication</span>
                  <span v-if="p.is_restricted" class="fin-pill tone-negative">restricted</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-yes { color: var(--ent-success); }
.fin-no { color: var(--ent-text-3); }
.is-held td { background: var(--ent-tone-positive-bg); }
.fin-duty-summary { margin-top: var(--ent-s4); display: flex; flex-direction: column; gap: var(--ent-s2); }
.fin-duty-summary p { margin: 0; display: flex; align-items: flex-start; gap: var(--ent-s2); font-size: var(--ent-fs-sm); line-height: var(--ent-lh); color: var(--ent-text-2); max-width: 80ch; }
.fin-duty-summary strong { color: var(--ent-text); }
.fin-ccy-note { max-width: 80ch; }
.fin-absence-list { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: var(--ent-s2); }
.fin-absence-list li { max-width: 80ch; font-size: var(--ent-fs-sm); line-height: var(--ent-lh); color: var(--ent-text-2); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
