<script setup lang="ts">
/**
 * Council money attached to the application in the planner's case file.
 *
 * WHY THIS WRAPPER EXISTS — THE TWO REGISTERS
 * A planning case has two identities and they are not interchangeable:
 *
 *   • `spatial_planning.permit_application.id` (uuid) — the statutory permit case. This is what
 *     the planner workspace works in, and what `usePlannerCase().permitId` holds.
 *   • `public.development_applications.id` (varchar) — the citizen-portal application the case
 *     was raised from, recorded on the permit as `dev_app_id` (migration 070, a soft reference:
 *     the two lineages use different id types, so there is no FK and the link is enforced in
 *     application code).
 *
 * Finance records a project's link as `linked_subject_kind` + `linked_subject_id`, and for
 * `development_application` that id is the SECOND one. Handing it the permit's id instead
 * returns an empty result, which the panel would render as "no council project is attached" —
 * a statement about council spending, produced by a mistake about an identifier. That is worse
 * than showing nothing, so this component resolves the mapping first and mounts the finance
 * panel only when it has the id that register actually uses.
 *
 * WHEN THERE IS NO LINK
 * `dev_app_id` is null for a staff-captured application — an officer registering a case at the
 * counter creates the permit directly and there is no portal record to point at. That is the
 * common case today, and it is reported as what it is: the lookup cannot be made, rather than
 * made and found empty.
 *
 * The finance panel is loaded on demand so a planner opening a case that has no portal link
 * never downloads the finance module at all.
 */
import { computed, defineAsyncComponent } from 'vue'
import { Coins, Link2Off } from 'lucide-vue-next'

const LinkedFinancePanel = defineAsyncComponent(
  () => import('@/modules/finance/components/LinkedFinancePanel.vue'),
)

const props = defineProps<{
  /** `permit_application.dev_app_id` — NOT the permit's own id. Null when the case has none. */
  devAppId: string | null
  /** The case number as the planner knows it, for the panel's headings. */
  caseReference?: string
}>()

/**
 * What to call the case in the headings. A case that has not been given a Development Register
 * number or a TPD reference yet reads as "Unregistered" on the rest of the console, and
 * "application Unregistered" is not a name — so those placeholders fall back to the generic
 * phrase rather than being repeated as if they identified something.
 */
const PLACEHOLDER = /^(—|-|unregistered|not registered|none)$/i
const label = computed(() => {
  const ref = (props.caseReference ?? '').trim()
  return ref && !PLACEHOLDER.test(ref) ? `application ${ref}` : 'this application'
})
</script>

<template>
  <section v-if="!devAppId" class="cfp-absent">
    <h3><Coins :size="15" aria-hidden="true" /> Council money attached to {{ label }}</h3>
    <p>
      <Link2Off :size="14" aria-hidden="true" />
      This case has no citizen-portal application on it, so there is no record for the finance
      register to be searched by.
    </p>
    <p class="cfp-note">
      Council spending is attached to the portal application a case was raised from. A case
      registered at the counter has none, and spending recorded against it is found in the finance
      console under Projects instead. This is not a statement that nothing was spent.
    </p>
  </section>

  <LinkedFinancePanel
    v-else
    kind="development_application"
    :subject-id="devAppId"
    :record-label="label"
  />
</template>

<style scoped>
.cfp-absent {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s4); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md); background: var(--ent-surface);
}
.cfp-absent h3 {
  display: inline-flex; align-items: center; gap: var(--ent-s2); margin: 0;
  font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.cfp-absent p {
  display: flex; align-items: flex-start; gap: var(--ent-s2); margin: 0; max-width: 70ch;
  font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh);
}
.cfp-absent p svg { flex: none; margin-top: 0.15em; }
.cfp-note { color: var(--ent-text-3); }
</style>
