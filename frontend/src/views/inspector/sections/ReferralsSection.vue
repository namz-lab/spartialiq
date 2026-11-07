<script setup lang="ts">
// Tasks and referrals — both directions of the inspector's desk work.
//
// Inbound: cases the planner has circulated to building control for a view.
// Outbound: a question this inspection needs another desk to answer.
import { computed } from 'vue'
import { Send } from 'lucide-vue-next'
import SpecialistReferralsInbox from '@/components/workflow/SpecialistReferralsInbox.vue'
import InspectionReferralForm from '@/components/inspector/InspectionReferralForm.vue'
import { useInspectionCase } from '@/composables/useInspectionCase'

const ic = useInspectionCase()
const permitId = computed(() => ic.current.value?.permitId ?? null)
const permit = computed(() => ic.current.value?.permit ?? null)
</script>

<template>
  <div class="ins-page ir">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Office</span>
        <h2 class="ins-title">Tasks and referrals</h2>
        <p class="ins-lede">Work sent to this desk by the planner, and questions this inspection needs another desk to answer.</p>
      </div>
    </header>

    <div class="ir-cols">
      <section class="ins-card" aria-labelledby="ir-out-h">
        <header class="ins-card-head">
          <h3 id="ir-out-h"><Send :size="16" aria-hidden="true" /> Refer from this inspection</h3>
        </header>
        <div class="ins-card-body">
          <p v-if="permit" class="ir-case">
            <span class="ins-mono">{{ permit.dev_register_no || permit.id.slice(0, 8) }}</span>
            · Stand {{ permit.stand_number }}<template v-if="permit.suburb_ward"> · {{ permit.suburb_ward }}</template>
          </p>
          <InspectionReferralForm
            :permit-id="permitId"
            :stand="permit?.stand_number"
            :disabled-reason="permitId ? undefined : 'Open an inspection from Today or Inspections first, so the referral attaches to the right case file.'"
          />
        </div>
      </section>

      <div class="ir-inbox">
        <SpecialistReferralsInbox
          :department-needles="['inspector', 'building control']"
          heading="Inbound plan referrals"
          empty-next-step="No building-control referrals in technical circulation. Files appear here when the planner circulates a case to this desk."
        />
      </div>

    </div>
  </div>
</template>

<style scoped>
.ir-cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--ent-s4); align-items: start; }
.ir-case { margin: 0 0 var(--ent-s3); padding-bottom: var(--ent-s3); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.ir-inbox { min-width: 0; }
.ir-inbox :deep(h2) { font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); }
@media (max-width: 1023px) { .ir-cols { grid-template-columns: minmax(0, 1fr); } }
</style>
