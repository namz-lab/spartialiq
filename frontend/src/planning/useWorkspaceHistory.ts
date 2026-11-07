// src/planning/useWorkspaceHistory.ts
// ─────────────────────────────────────────────────────────────────────────
// Undo/redo + autosave for the Planning Studio. History is a bounded stack of
// full project snapshots (simple + correct at single-project scale; a command
// bus is the V2 upgrade when audit/collaboration arrive — see the plan). Autosave
// debounces the engine's existing `dirty` flag → `save()`.
// ─────────────────────────────────────────────────────────────────────────
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { PlanningToolsApi } from './usePlanningTools'

const MAX_HISTORY = 50
const COMMIT_DEBOUNCE_MS = 400
const AUTOSAVE_DEBOUNCE_MS = 30000

export function useWorkspaceHistory(planning: PlanningToolsApi) {
  const stack = ref<any[]>([])
  const index = ref(-1)
  const saving = ref(false)
  let restoring = false
  let commitTimer: ReturnType<typeof setTimeout> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const canUndo = computed(() => index.value > 0)
  const canRedo = computed(() => index.value < stack.value.length - 1)

  /** Push the current design as a new history entry (truncating any redo tail). */
  function commit() {
    if (restoring) return
    const snap = JSON.parse(JSON.stringify(planning.snapshot()))
    stack.value = stack.value.slice(0, index.value + 1)
    stack.value.push(snap)
    if (stack.value.length > MAX_HISTORY) stack.value.shift()
    index.value = stack.value.length - 1
  }

  function applyAt(i: number) {
    if (i < 0 || i >= stack.value.length) return
    restoring = true
    index.value = i
    planning.restore(stack.value[i])
    // release the guard after the reactive flush
    setTimeout(() => { restoring = false }, 0)
  }
  function undo() { if (canUndo.value) applyAt(index.value - 1) }
  function redo() { if (canRedo.value) applyAt(index.value + 1) }

  // Seed the initial snapshot once a planning area exists.
  watch(() => planning.planningArea.value?.id, (id, prev) => {
    if (id && !prev && stack.value.length === 0) commit()
  }, { immediate: true })

  // Debounced commit on design changes (skipped while restoring).
  watch(
    [() => planning.roads.value, () => planning.lots.value, () => planning.openSpace.value, () => planning.constraints.value],
    () => {
      if (restoring || !planning.planningArea.value) return
      if (commitTimer) clearTimeout(commitTimer)
      commitTimer = setTimeout(commit, COMMIT_DEBOUNCE_MS)
    },
    { deep: false },
  )

  // Debounced autosave on the engine's dirty flag.
  watch(() => planning.dirty.value, (d) => {
    if (!d) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      if (!planning.planningArea.value) return
      saving.value = true
      try { await planning.save() } finally { saving.value = false }
    }, AUTOSAVE_DEBOUNCE_MS)
  })

  async function saveNow(extra?: Parameters<PlanningToolsApi['save']>[0]) {
    if (!planning.planningArea.value) return { ok: false as const }
    saving.value = true
    try { return await planning.save(extra) } finally { saving.value = false }
  }

  onBeforeUnmount(() => {
    if (commitTimer) clearTimeout(commitTimer)
    if (saveTimer) clearTimeout(saveTimer)
  })

  return { undo, redo, canUndo, canRedo, commit, saveNow, saving }
}
