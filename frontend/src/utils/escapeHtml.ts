/**
 * Escape a value for safe interpolation into a raw-HTML sink such as
 * MapLibre `Popup.setHTML()` or `Element.innerHTML`.
 *
 * Vue's `{{ }}` interpolation and `v-bind` escape on their own — this helper
 * is only for the manual-HTML escape hatches where a string built from
 * database rows or user input is handed to the DOM as markup. Database- or
 * citizen-supplied fields (e.g. an applicant or owner name) rendered raw into
 * a popup are a stored-XSS vector; wrap every interpolated value with this.
 *
 * `null` / `undefined` collapse to an empty string rather than the literal
 * text "null"/"undefined".
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
