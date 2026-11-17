/**
 * Reads the approvals inbox: the manager dashboard's pending counts, the position's payables and
 * cash-up reads, and three counts of its own (imports to commit, asset approvals, cut-overs).
 * Each read is made only with the permission that gates it, so no refusal is audited for a count.
 */
import { reactive } from 'vue'
import { financeApi } from '../../api/financeApi'
import { assetsApi } from '../../api/assetsApi'
import { migrationApi } from '../../api/migrationApi'
import { buildInbox, sortInbox, type InboxItem } from './approvals'
import { managerDash } from './dashboard'
import { position, loadPosition, dataOf } from './position'

export const inbox = reactive({ items: [] as InboxItem[], loading: false })

const counted = async (allowed: boolean, read: () => Promise<number>): Promise<number | null> => {
  if (!allowed) return null
  try { return await read() } catch { return null }
}

export async function loadInbox(yearId: string | null | undefined, can: (code: string) => boolean): Promise<void> {
  inbox.loading = true
  try {
    const needsPosition = position.payables.state === 'idle' || position.accounting.state === 'idle'
    const [importsValidated, assetRunsAwaiting, disposalsAwaiting, cutoversPreparing] = await Promise.all([
      counted(can('finance.import.commit') || can('finance.import.upload') || can('finance.import.validate'),
        async () => (await financeApi.imports({ status: 'validated', ...(yearId ? { financial_year_id: yearId } : {}) })).length),
      counted(can('finance.assets.view'), async () => (await assetsApi.runs(yearId)).filter((r) => r.status === 'awaiting_approval').length),
      counted(can('finance.assets.view'), async () => (await assetsApi.assets({ status: 'disposal_awaiting_approval' })).assets.length),
      counted(can('finance.migration.view'), async () => (await migrationApi.cutovers()).filter((c) => c.status === 'preparing').length),
      needsPosition ? loadPosition(yearId, can) : Promise.resolve(),
      managerDash.state.data ? Promise.resolve() : managerDash.load(),
    ])
    inbox.items = sortInbox(buildInbox({
      manager: managerDash.state.data,
      accounting: dataOf(position.accounting),
      payables: dataOf(position.payables),
      importsValidated, assetRunsAwaiting, disposalsAwaiting, cutoversPreparing,
    }))
  } finally {
    inbox.loading = false
  }
}
