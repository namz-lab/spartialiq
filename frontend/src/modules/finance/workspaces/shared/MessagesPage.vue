<script setup lang="ts">
/** The cashier's messages: notifications addressed to them or their role, newest first. */
import { onMounted, ref } from 'vue'
import { Mail, AlertTriangle, CheckCheck, Inbox } from 'lucide-vue-next'
import api from '@/services/api'
import { messageOf } from '../../stores/finance'
import { formatDateTime } from '../../composables/useMoney'
import { usePortalInbox } from './usePortal'

interface Note { id: string; title: string; message: string; kind: string; read_at: string | null; created_at: string }

const { loadUnread } = usePortalInbox()
const notes = ref<Note[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const unreadOnly = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const r = await api.get('/notifications', { params: { limit: 100, ...(unreadOnly.value ? { unread_only: true } : {}) } })
    notes.value = (r.data?.data ?? []) as Note[]
  } catch (err) {
    error.value = messageOf(err, 'Your messages could not be read.')
  } finally {
    loading.value = false
  }
}

async function markRead(n: Note): Promise<void> {
  if (n.read_at) return
  try {
    await api.patch(`/notifications/${n.id}/read`, {})
    n.read_at = new Date().toISOString()
    void loadUnread()
  } catch (err) {
    error.value = messageOf(err, 'The message could not be marked read.')
  }
}

async function markAll(): Promise<void> {
  try {
    await api.patch('/notifications/read-all', {})
    await load()
    void loadUnread()
  } catch (err) {
    error.value = messageOf(err, 'The messages could not be marked read.')
  }
}

onMounted(load)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Mail :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Messages</h2>
      <p>Notices from the finance office and the system, addressed to you or to cashiers.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card">
    <div class="cw-card-head">
      <label style="display: flex; align-items: center; gap: 8px"><input v-model="unreadOnly" type="checkbox" class="cw-check" @change="load" /> Unread only</label>
      <span class="cw-spacer" />
      <button type="button" class="cw-btn cw-btn--small" :disabled="!notes.some((n) => !n.read_at)" @click="markAll"><CheckCheck :size="16" aria-hidden="true" /> Mark all read</button>
    </div>
    <div class="cw-card-body">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <div v-else-if="!notes.length" class="cw-empty"><Inbox :size="36" aria-hidden="true" style="color: var(--cw-ink-3)" /><strong>No messages.</strong>Notices addressed to you appear here.</div>
      <ul v-else class="ms-list">
        <li v-for="n in notes" :key="n.id" :class="{ 'is-unread': !n.read_at }">
          <button type="button" @click="markRead(n)">
            <span class="ms-dot" aria-hidden="true" />
            <span class="ms-text">
              <strong>{{ n.title }}</strong>
              <span>{{ n.message }}</span>
              <small>{{ formatDateTime(n.created_at) }}<template v-if="!n.read_at"> · Unread — select to mark read</template></small>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.ms-list { list-style: none; margin: 0; padding: 0; }
.ms-list li + li { border-top: 1px solid var(--cw-line); }
.ms-list button { display: flex; gap: 12px; width: 100%; padding: 14px 8px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 10px; }
.ms-list button:hover { background: var(--cw-accent-softer); }
.ms-dot { width: 10px; height: 10px; margin-top: 7px; border-radius: 50%; background: transparent; flex: none; }
.is-unread .ms-dot { background: var(--cw-accent); }
.ms-text { display: flex; flex-direction: column; gap: 3px; }
.ms-text span { color: var(--cw-ink-2); }
.ms-text small { color: var(--cw-ink-3); }
.is-unread strong { color: var(--cw-accent-ink); }
</style>
