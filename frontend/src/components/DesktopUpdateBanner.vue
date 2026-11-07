<script setup lang="ts">
/**
 * Wireless updates for the Tauri desktop shell.
 * Checks GitHub Releases (latest.json) on launch; offers Install & restart.
 */
import { onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

const visible = ref(false)
const version = ref('')
const notes = ref('')
const busy = ref(false)
const error = ref('')
const progress = ref('')

onMounted(async () => {
  if (!isTauri()) return
  try {
    const update = await check()
    if (!update) return
    version.value = update.version
    notes.value = update.body || ''
    visible.value = true
  } catch (e) {
    // Offline / no release yet — silent in normal use
    console.debug('[desktop-updater]', e)
  }
})

async function install() {
  busy.value = true
  error.value = ''
  progress.value = 'Downloading update…'
  try {
    const update = await check()
    if (!update) {
      error.value = 'Update no longer available.'
      busy.value = false
      return
    }
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') progress.value = 'Download started…'
      else if (event.event === 'Progress') progress.value = 'Downloading…'
      else if (event.event === 'Finished') progress.value = 'Installing…'
    })
    progress.value = 'Restarting…'
    await relaunch()
  } catch (e) {
    error.value = String(e)
    busy.value = false
  }
}

function dismiss() {
  visible.value = false
}
</script>

<template>
  <div v-if="visible" class="du-banner" role="status" data-testid="desktop-update-banner">
    <div class="du-text">
      <strong>Update available</strong>
      <span>Version {{ version }} is ready to install over the network.</span>
      <span v-if="notes" class="du-notes">{{ notes }}</span>
      <span v-if="progress" class="du-progress">{{ progress }}</span>
      <span v-if="error" class="du-err">{{ error }}</span>
    </div>
    <div class="du-actions">
      <button type="button" class="du-btn primary" :disabled="busy" data-testid="du-install" @click="install">
        {{ busy ? 'Updating…' : 'Install & restart' }}
      </button>
      <button type="button" class="du-btn" :disabled="busy" data-testid="du-later" @click="dismiss">Later</button>
    </div>
  </div>
</template>

<style scoped>
.du-banner {
  position: fixed;
  z-index: 10000;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  width: min(36rem, calc(100vw - 2rem));
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  background: #0b5f4b;
  color: #f4faf7;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  font: 14px/1.35 "Source Sans 3", "Segoe UI", sans-serif;
}
.du-text { display: flex; flex-direction: column; gap: 0.2rem; min-width: 12rem; flex: 1; }
.du-text strong { font-size: 0.95rem; }
.du-notes, .du-progress { opacity: 0.9; font-size: 0.85rem; }
.du-err { color: #ffd7d0; font-size: 0.85rem; }
.du-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
.du-btn {
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font: inherit;
  cursor: pointer;
}
.du-btn.primary { background: #fff; color: #0b5f4b; border-color: #fff; font-weight: 600; }
.du-btn:disabled { opacity: 0.6; cursor: wait; }
</style>
