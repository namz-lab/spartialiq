/**
 * What every role portal (Cash Office, Accounting) shares: the unread message count for the bell
 * and the sidebar badge, and small formatting helpers.
 */
import { reactive } from 'vue'
import api from '@/services/api'

const inbox = reactive({ unread: 0 })

async function loadUnread(): Promise<void> {
  try {
    const r = await api.get('/notifications/unread-count')
    inbox.unread = Number(r.data?.data?.count ?? 0)
  } catch {
    // The badge is a convenience; the Messages page reports a failed read itself.
  }
}

export function usePortalInbox() {
  return { inbox, loadUnread }
}

export function resetPortalInbox(): void {
  inbox.unread = 0
}

/** "Good evening", by the clock of the person reading it. */
export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}
