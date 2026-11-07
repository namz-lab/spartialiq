// ─── useUiFeedback ────────────────────────────────────────────────────
// Shared error/feedback machinery, modelled on BuildingInspectorView.
// Provides showToast, openMessageBox, confirmAction, parseApiError.
// Consumed by operator consoles via <UiFeedback :feedback="fb" />.
// ─────────────────────────────────────────────────────────────────────

import { ref } from 'vue'

export type ToastKind   = 'info' | 'success' | 'warn' | 'warning' | 'error'
export type MsgBoxKind  = 'info' | 'success' | 'warn' | 'error'

export interface MessageBoxState {
  kind:      MsgBoxKind
  title:     string
  message:   string
  details?:  string
}

export interface ConfirmOptions {
  confirmLabel?: string
  cancelLabel?:  string
  danger?:       boolean
}

export interface ConfirmState {
  title:        string
  message:      string
  confirmLabel: string
  cancelLabel:  string
  danger:       boolean
  resolve:      (v: boolean) => void
}

const CODE_MAP: Record<string, string> = {
  cannot_flag_own_inspection:   'You cannot flag an inspection you carried out yourself.',
  expected_multipart:           'The server expected a file upload (multipart form-data).',
  bad_mime:                     'Unsupported file type. Use JPG, PNG, WebP or HEIC.',
  too_large:                    'File exceeds the size limit.',
  empty_file:                   'The selected file is empty.',
  no_file:                      'No file was attached.',
  score_required:               'Every applicable item needs a score between 0 and 10.',
  bad_photo_id:                 'A photo reference is invalid.',
  bad_id:                       'Invalid identifier.',
  inspection_not_found:         'That inspection could not be found.',
  inspection_or_item_not_found: 'The inspection or a checklist item could not be found.',
  forbidden:                    'You do not have permission to perform this action.',
  not_found:                    'The requested record could not be found.',
  unauthorized:                 'Your session has expired. Please sign in again.',
  validation_error:             'Some details are missing or invalid. Please review the form.',
  duplicate:                    'A record with these details already exists.',
  payment_required:             'Outstanding payment is required before this action.',
  permit_not_found:             'No matching permit could be found.',
  application_not_found:        'No matching application could be found.',
  stage_locked:                 'This stage is locked. Resolve the previous stage first.',
}

export function parseApiError(e: any, fallback = 'Something went wrong. Please try again.'): string {
  if (!e) return fallback
  const data = e?.response?.data
  if (data?.error && CODE_MAP[data.error]) return CODE_MAP[data.error]
  if (typeof data?.message === 'string') return data.message
  if (typeof data?.error   === 'string') return `Server: ${data.error}`
  if (e.code === 'ERR_NETWORK')          return 'Cannot reach the server. Check your internet connection and try again.'
  if (e.code === 'ECONNABORTED')         return 'The server took too long to respond. Please try again.'
  if (typeof e.message === 'string')     return e.message
  return fallback
}

export function useUiFeedback() {
  const toastMsg  = ref('')
  const toastType = ref<'info' | 'success' | 'warn' | 'error'>('info')
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function showToast(msg: string, t: ToastKind = 'info') {
    toastMsg.value  = msg
    toastType.value = (t === 'warning' ? 'warn' : t) as 'info' | 'success' | 'warn' | 'error'
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastMsg.value = '' }, 3500)
  }

  const messageBox = ref<MessageBoxState | null>(null)
  function openMessageBox(s: MessageBoxState) { messageBox.value = s }
  function closeMessageBox() { messageBox.value = null }

  const confirmState = ref<ConfirmState | null>(null)
  function confirmAction(title: string, message: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise(resolve => {
      confirmState.value = {
        title, message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel:  opts.cancelLabel  ?? 'Cancel',
        danger:       opts.danger ?? false,
        resolve,
      }
    })
  }
  function resolveConfirm(answer: boolean) {
    const c = confirmState.value
    confirmState.value = null
    c?.resolve(answer)
  }

  return {
    toastMsg, toastType, showToast,
    messageBox, openMessageBox, closeMessageBox,
    confirmState, confirmAction, resolveConfirm,
    parseApiError,
  }
}

export type UiFeedbackContext = ReturnType<typeof useUiFeedback>
