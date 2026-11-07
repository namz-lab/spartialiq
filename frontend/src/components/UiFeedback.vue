<script setup lang="ts">
// Renders toast / message box / confirm dialog driven by a useUiFeedback() context.
// Mount once near the bottom of any view that uses the composable.
//
//   const fb = useUiFeedback()
//   <template>
//     ...
//     <UiFeedback :feedback="fb" />
//   </template>

import { AlertOctagon, AlertTriangle, CheckCircle2, ListChecks, X } from 'lucide-vue-next'
import type { UiFeedbackContext } from '@/composables/useUiFeedback'

const props = defineProps<{ feedback: UiFeedbackContext }>()

const {
  toastMsg, toastType,
  messageBox, closeMessageBox,
  confirmState, resolveConfirm,
} = props.feedback
</script>

<template>
  <Transition name="uifb-fade">
    <div v-if="toastMsg" class="uifb-toast" :class="toastType">{{ toastMsg }}</div>
  </Transition>

  <Transition name="uifb-fade">
    <div v-if="messageBox" class="uifb-overlay" @click.self="closeMessageBox()">
      <div class="uifb-modal uifb-msgbox" :class="'uifb-msgbox--' + messageBox.kind">
        <div class="uifb-modal-head">
          <component
            :is="messageBox.kind === 'error'   ? AlertOctagon
               : messageBox.kind === 'warn'    ? AlertTriangle
               : messageBox.kind === 'success' ? CheckCircle2
               :                                  ListChecks"
            :size="14"
          />
          <strong>{{ messageBox.title }}</strong>
          <button class="uifb-modal-x" @click="closeMessageBox()" aria-label="Close">
            <X :size="14" />
          </button>
        </div>
        <div class="uifb-modal-body">
          <p class="uifb-msgbox-msg">{{ messageBox.message }}</p>
          <p v-if="messageBox.details" class="uifb-msgbox-details">{{ messageBox.details }}</p>
        </div>
        <div class="uifb-modal-foot">
          <button class="uifb-btn" @click="closeMessageBox()">OK</button>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="uifb-fade">
    <div v-if="confirmState" class="uifb-overlay" @click.self="resolveConfirm(false)">
      <div class="uifb-modal uifb-msgbox"
           :class="confirmState.danger ? 'uifb-msgbox--warn' : 'uifb-msgbox--info'">
        <div class="uifb-modal-head">
          <AlertTriangle v-if="confirmState.danger" :size="14" />
          <ListChecks v-else :size="14" />
          <strong>{{ confirmState.title }}</strong>
          <button class="uifb-modal-x" @click="resolveConfirm(false)" aria-label="Cancel">
            <X :size="14" />
          </button>
        </div>
        <div class="uifb-modal-body">
          <p class="uifb-msgbox-msg">{{ confirmState.message }}</p>
        </div>
        <div class="uifb-modal-foot">
          <button class="uifb-btn" @click="resolveConfirm(false)">
            {{ confirmState.cancelLabel }}
          </button>
          <button class="uifb-btn"
                  :class="{ fail: confirmState.danger, pass: !confirmState.danger }"
                  @click="resolveConfirm(true)">
            {{ confirmState.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.uifb-fade-enter-active,
.uifb-fade-leave-active { transition: opacity 0.18s ease; }
.uifb-fade-enter-from,
.uifb-fade-leave-to     { opacity: 0; }

.uifb-toast {
  position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
  z-index: 1100;
  background: #0f172a; color: #fff;
  font-size: 0.8125rem; font-weight: 600;
  padding: 0.6rem 1rem; border-radius: 9999px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  max-width: 90vw;
}
.uifb-toast.success { background: #16a34a; }
.uifb-toast.warn    { background: #b45309; }
.uifb-toast.error   { background: #dc2626; }
.uifb-toast.info    { background: #0f172a; }

.uifb-overlay {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200; padding: 1rem;
}
.uifb-modal {
  background: #fff; border-radius: 0.75rem;
  width: 100%; max-width: 480px; max-height: 90vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 25px 60px rgba(0,0,0,0.3);
}
.uifb-modal-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
.uifb-modal-head strong { flex: 1; font-size: 0.875rem; color: #0f172a; }
.uifb-modal-x {
  background: none; border: none; cursor: pointer;
  color: #64748b; padding: 0.25rem; display: flex;
}
.uifb-modal-x:hover { color: #0f172a; }
.uifb-modal-body {
  padding: 1rem; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.uifb-modal-foot {
  display: flex; gap: 0.5rem; justify-content: flex-end;
  padding: 0.75rem 1rem;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.uifb-msgbox-msg     { font-size: 0.875rem; color: #0f172a; margin: 0 0 0.4rem; line-height: 1.45; }
.uifb-msgbox-details { font-size: 0.75rem;  color: #64748b; margin: 0; line-height: 1.4; }

.uifb-msgbox--error   .uifb-modal-head { background: #fef2f2; color: #991b1b; }
.uifb-msgbox--warn    .uifb-modal-head { background: #fffbeb; color: #92400e; }
.uifb-msgbox--success .uifb-modal-head { background: #f0fdf4; color: #166534; }
.uifb-msgbox--info    .uifb-modal-head { background: #eff6ff; color: #1e3a8a; }

.uifb-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem;
  padding: 0.45rem 0.85rem; font-size: 0.75rem; font-weight: 700;
  border-radius: 0.375rem; border: 1px solid #e2e8f0;
  background: #fff; color: #475569; cursor: pointer;
  transition: all 0.15s;
}
.uifb-btn:hover:not(:disabled) { background: #f8fafc; }
.uifb-btn:disabled             { opacity: 0.5; cursor: not-allowed; }
.uifb-btn.pass { background: #16a34a; color: #fff; border-color: #16a34a; }
.uifb-btn.pass:hover:not(:disabled) { background: #15803d; }
.uifb-btn.fail { background: #dc2626; color: #fff; border-color: #dc2626; }
.uifb-btn.fail:hover:not(:disabled) { background: #b91c1c; }
</style>
