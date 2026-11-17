/**
 * S2: one always-mounted polite and one assertive live region (rendered by PortalShell), fed through
 * `announce()`. A region that exists before its text arrives is what screen readers actually speak;
 * a `role="status"` node created together with its text is often skipped. The visible banners keep no
 * live role of their own when they call this. Messages are cleared and set on the next tick so that the
 * same sentence said twice is spoken twice.
 */
import { ref } from 'vue'

const polite = ref('')
const assertive = ref('')

export function announce(text: string, level: 'polite' | 'assertive' = 'polite'): void {
  const target = level === 'assertive' ? assertive : polite
  target.value = ''
  setTimeout(() => { target.value = text }, 30)
}

export function usePortalAnnouncer() {
  return { polite, assertive, announce }
}
