<script setup lang="ts">
/**
 * Separation of duties: the rules, a check of everyone whose access departs from their role, and
 * the changes the server refused for breaking a rule.
 *
 * Role defaults are asserted free of conflict by the database (migration 188), so a conflict can
 * only arise from personal overrides, or from finance authority given to the IT administrator. The
 * check therefore reads the access of exactly those people. The server refuses a conflicting save
 * (migration 200); this page is the administrator's view of the result, not the control.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Scale, ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { financeAccessApi } from '../../../api/financeAccessApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { financeRoleLabel } from '../../../shell/roleLabels'
import { adminDash } from '../dashboard'
import { dutyConflicts, readChange, type DutyConflict } from '../workspacePreview'

const store = useFinanceStore()
const users = computed(() => adminDash.state.data?.list.users ?? [])
const candidates = computed(() => users.value.filter((u) => u.override_count > 0 || u.role === 'admin'))

const findings = ref<{ id: string; name: string; email: string; role: string; conflicts: DutyConflict[] }[]>([])
const failed = ref<string[]>([])
const checking = ref(false)
const error = ref<string | null>(null)
const checked = ref(false)

async function check(): Promise<void> {
  checking.value = true
  error.value = null
  failed.value = []
  try {
    const results = await Promise.all(candidates.value.map(async (u) => {
      try {
        const a = await financeAccessApi.access(u.id)
        return { id: u.id, name: u.name, email: u.email, role: a.user.role, conflicts: dutyConflicts(a.user.role, a.permissions, store.catalogue) }
      } catch { failed.value.push(u.name); return null }
    }))
    findings.value = results.filter((r): r is NonNullable<typeof r> => !!r && r.conflicts.length > 0)
    checked.value = true
  } catch (err) { error.value = messageOf(err, 'The check could not be completed.') } finally { checking.value = false }
}
onMounted(() => { if (adminDash.state.data) void check() })
watch(() => adminDash.state.data, (d, old) => { if (d && !old) void check() })

const refusals = computed(() => (adminDash.state.data?.changes ?? []).map(readChange).filter((c) => c.refused && c.status === 409))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Scale :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Separation of Duties</h2><p>Which duties must not meet in one person, whether anyone's access breaks that, and the changes that were refused for it.</p></div>
  </section>

  <section class="cw-card" aria-labelledby="sd-rules">
    <div class="cw-card-head"><h3 id="sd-rules">The Rules</h3></div>
    <div class="cw-card-body">
      <ul class="sd-rules">
        <li><strong>Approving a release and publishing it</strong> are held by different people. Enforced when access is saved: a change that would give one person both is refused and recorded.</li>
        <li><strong>The IT administrator holds no financial authority</strong>: no approval, publication or restricted permission. Shown here as a warning.</li>
        <li><strong>Preparer is not approver.</strong> Whoever submits a budget line, revision, project or tariff cannot approve it. Enforced on each decision, whatever the person's access.</li>
        <li><strong>Nobody changes their own access.</strong> Another administrator must do it.</li>
      </ul>
    </div>
  </section>

  <section class="cw-card" aria-labelledby="sd-check">
    <div class="cw-card-head"><h3 id="sd-check">Access Checked Now</h3><span class="cw-spacer" />
      <button type="button" class="cw-btn cw-btn--small" :aria-disabled="checking || undefined" @click="!checking && check()">
        <RefreshCw :size="15" aria-hidden="true" /> {{ checking ? 'Checking…' : 'Check again' }}</button></div>
    <div class="cw-card-body">
      <p class="cw-hint" style="margin-top: 0">Role defaults cannot conflict, so the {{ candidates.length }} people with a personal override, or with the IT administrator role, are checked.</p>
      <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
      <p v-if="failed.length" class="cw-banner-msg cw-banner-msg--warn" role="status">Could not read the access of {{ failed.join(', ') }}; they are not checked.</p>
      <div v-if="checking && !checked"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="checked && !findings.length" class="cw-banner-msg cw-banner-msg--pos" role="status"><CheckCircle2 :size="18" aria-hidden="true" />No conflict found in anyone's access.</p>
      <table v-else-if="findings.length" class="cw-table dx-compact">
        <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Conflict</th><th scope="col" /></tr></thead>
        <tbody>
          <tr v-for="f in findings" :key="f.id">
            <td><strong>{{ f.name }}</strong><div class="cw-hint">{{ f.email }}</div></td>
            <td>{{ financeRoleLabel(f.role) }}</td>
            <td class="dx-wrap"><div v-for="c in f.conflicts" :key="c.rule"><ShieldAlert :size="15" class="dx-neg" aria-hidden="true" /> {{ c.text }}</div></td>
            <td><RouterLink :to="{ name: 'adm-effective', query: { user: f.id } }" class="cw-link">Effective access</RouterLink></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="cw-card" aria-labelledby="sd-ref">
    <div class="cw-card-head"><h3 id="sd-ref">Changes Refused for a Conflict (90 days)</h3></div>
    <div class="cw-card-body">
      <p v-if="adminDash.state.data?.changesNote" class="cw-empty">{{ adminDash.state.data?.changesNote }}</p>
      <p v-else-if="!refusals.length" class="cw-empty">No access change was refused for a conflict.</p>
      <ul v-else class="dx-list">
        <li v-for="r in refusals" :key="r.id" class="dx-item">
          <span class="dx-grow">{{ r.refusal ?? 'Refused' }}<span class="cw-hint"> · attempted by {{ r.actor }}<template v-if="r.reason"> · “{{ r.reason }}”</template></span></span>
          <span class="dx-when">{{ formatDateTime(r.at) }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.sd-rules { margin: 0; padding-left: 20px; max-width: 75ch; }
.sd-rules li { margin-bottom: 8px; }
</style>
