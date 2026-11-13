// TEMPORARY — created to run the dev server on a workstation whose inotify watch
// limit is exhausted (`ENOSPC: System limit for number of file watchers reached`).
// Identical to vite.config.ts except that the watcher polls instead of using
// inotify. Delete this file; it is not part of the project.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(
  base,
  defineConfig({
    server: {
      watch: {
        usePolling: true,
        interval: 2000,
        ignored: [
          '**/node_modules/**',
          '**/dist/**',
          '**/.git/**',
          '**/src-tauri/**',
          '**/INSTALLERS/**',
          '**/docs/**',
          '**/public/**',
        ],
      },
    },
  }),
)
