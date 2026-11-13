/**
 * A prompt that belongs to the finance console, not to the browser.
 *
 * Every finance mutation that needs a spoken reason — returning a line, refusing a revision,
 * abandoning an import, overriding a reconciliation — used to go through `window.prompt`, which
 * blocks the page, cannot validate what was typed, is styled by the operating system rather than
 * the console, and cannot be reached by a keyboard-only or screen-reader user reliably. This
 * composable offers the same contract — `ask(spec)` resolves to the trimmed string, or `null` when
 * cancelled — behind a real dialog (`FinancePromptDialog.vue`) that validates before the promise
 * resolves, so a reason that would be refused by the server is refused by the form.
 *
 * The amount check is the same one `useMoney`'s formatter uses: a plain decimal string. Money in
 * this module never passes through a JavaScript number, and the dialog does not introduce the first
 * exception.
 */
import { ref, type Ref } from 'vue'

export type FinancePromptKind = 'text' | 'textarea' | 'amount' | 'select'

export interface FinancePromptOption {
  value: string
  label: string
}

export interface FinancePromptSpec {
  /** The dialog's heading: the act being performed, e.g. "Refuse this release". */
  title: string
  /** Context under the heading: which line or batch, and where the answer goes. */
  message?: string
  /** The field's visible label. */
  label: string
  kind?: FinancePromptKind
  /** `select` only: the choices, in the order they should be read out. */
  options?: FinancePromptOption[]
  placeholder?: string
  initial?: string
  /** Minimum trimmed length. `0` (the default) accepts an empty answer. */
  minLength?: number
  /**
   * `amount` only: allow a leading `-`. A supplementary allocation and a reduction are the same
   * field with a sign (the budget section's own rule), so this defaults to true there and is
   * switched off where the caller knows the figure must be positive.
   */
  allowNegative?: boolean
  submitLabel?: string
  /** Show the confirming button as the destructive one — refusals and abandonments. */
  danger?: boolean
}

export interface FinancePromptRequest extends FinancePromptSpec {
  resolve: (value: string | null) => void
}

/** A decimal string the money formatter would accept, optionally signed. */
export function isValidAmount(text: string, allowNegative = true): boolean {
  const pattern = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/
  return pattern.test(text.trim())
}

export function useFinancePrompt(): {
  request: Ref<FinancePromptRequest | null>
  ask: (spec: FinancePromptSpec) => Promise<string | null>
  /** Resolve and clear the pending request, if any. The dialog's only way out. */
  settle: (answer: string | null) => void
} {
  const request = ref<FinancePromptRequest | null>(null)

  /**
   * Open the dialog and wait. Resolves with the trimmed answer, or `null` if it was cancelled —
   * the `window.prompt` contract, so call sites keep their existing early returns.
   *
   * A native prompt blocked the page, so a second trigger click while one was open was impossible.
   * This dialog does not block, so that guard is made explicit: a new `ask()` while one is pending
   * resolves the pending one with `null` — the first flow takes its existing cancelled path instead
   * of hanging on a promise nothing will ever settle.
   */
  function ask(spec: FinancePromptSpec): Promise<string | null> {
    return new Promise((resolve) => {
      request.value?.resolve(null)
      request.value = { ...spec, resolve }
    })
  }

  /** Resolve the pending request (if any) and close the dialog. */
  function settle(answer: string | null): void {
    const pending = request.value
    request.value = null
    pending?.resolve(answer)
  }

  return { request, ask, settle }
}
