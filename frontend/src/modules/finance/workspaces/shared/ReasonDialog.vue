<script setup lang="ts">
/** Ask for a written reason before an act that is kept on the record (cancel, remove). */
import { computed, nextTick, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  title: string; message?: string; label?: string; minLength?: number; submitLabel?: string
  danger?: boolean; busy?: boolean; error?: string | null
}>(), { label: 'Reason', minLength: 5, submitLabel: 'Confirm', message: '', danger: false, busy: false, error: null })
const emit = defineEmits<{ (e: 'submit', reason: string): void; (e: 'close'): void }>()

const text = ref('')
const el = ref<HTMLTextAreaElement | null>(null)
const ok = computed(() => text.value.trim().length >= props.minLength)
onMounted(() => { void nextTick(() => el.value?.focus()) })
</script>

<template>
  <div class="cw-dialog-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="cw-dialog" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="ok && emit('submit', text.trim())">
      <header>
        <h3>{{ title }}</h3>
        <button type="button" class="cw-icon-btn" aria-label="Close" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="cw-dialog-body">
        <p v-if="message" style="margin: 0; color: var(--cw-ink-2)">{{ message }}</p>
        <label class="cw-field">
          <span class="cw-label">{{ label }}</span>
          <textarea ref="el" v-model="text" class="cw-textarea" :minlength="minLength" required />
          <span class="cw-hint">At least {{ minLength }} characters. Kept on the record with your name.</span>
        </label>
        <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="emit('close')">Back</button>
        <button type="submit" class="cw-btn" :class="danger ? 'cw-btn--danger' : 'cw-btn--primary'" :disabled="!ok || busy">{{ busy ? 'Working…' : submitLabel }}</button>
      </footer>
    </form>
  </div>
</template>
