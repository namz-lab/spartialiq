// src/composables/useEditSession.ts
// ---------------------------------------------------------------------------
// One GMS edit session in the browser: the list of edits, undo/redo, and
// autosave that survives a power cut.
//
// Every change is mirrored to localStorage at once and sent to the server a
// moment later. If the power or the link goes before the server has it, the
// mirror is newer than the server copy when the session is reopened and wins.
// The mirror is the fallback, never the record: it is cleared as soon as the
// server acknowledges the save.
// ---------------------------------------------------------------------------
import { ref, computed, onUnmounted } from 'vue'
import { gmsApi, type Edit, type EditSession, type AccuracyClass } from '@/services/gms'

const SAVE_DELAY_MS = 1200
const mirrorKey = (id: string) => `gms-session:${id}`

function readMirror(id: string): { edits: Edit[]; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(mirrorKey(id))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeMirror(id: string, edits: Edit[]) {
  try { localStorage.setItem(mirrorKey(id), JSON.stringify({ edits, savedAt: Date.now() })) } catch { /* storage full or blocked */ }
}
function clearMirror(id: string) {
  try { localStorage.removeItem(mirrorKey(id)) } catch { /* ignore */ }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline'

export function useEditSession() {
  const session = ref<EditSession | null>(null)
  const edits = ref<Edit[]>([])
  const saveState = ref<SaveState>('idle')
  const savedAt = ref<Date | null>(null)
  const recovered = ref(false)
  const past = ref<Edit[][]>([])
  const future = ref<Edit[][]>([])
  let timer: ReturnType<typeof setTimeout> | undefined

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)
  const editable = computed(() => !!session.value && ['open', 'returned'].includes(session.value.status))

  async function save() {
    clearTimeout(timer)
    const s = session.value
    if (!s || !editable.value) return
    saveState.value = 'saving'
    try {
      await gmsApi.saveEdits(s.session_id, edits.value)
      clearMirror(s.session_id)
      saveState.value = 'saved'
      savedAt.value = new Date()
    } catch {
      // Kept on this device; the next change, or the link returning, retries.
      saveState.value = 'offline'
    }
  }
  const onOnline = () => { if (saveState.value === 'offline') save() }
  window.addEventListener('online', onOnline)
  onUnmounted(() => {
    window.removeEventListener('online', onOnline)
    if (saveState.value === 'saving' || timer) save()
  })

  function commit(next: Edit[]) {
    if (!editable.value) return
    past.value.push(clone(edits.value))
    future.value = []
    edits.value = next
    writeMirror(session.value!.session_id, next)
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }

  function undo() {
    if (!past.value.length) return
    future.value.push(clone(edits.value))
    edits.value = past.value.pop()!
    writeMirror(session.value!.session_id, edits.value)
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  function redo() {
    if (!future.value.length) return
    past.value.push(clone(edits.value))
    edits.value = future.value.pop()!
    writeMirror(session.value!.session_id, edits.value)
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }

  /** Open (or resume) the caller's session on a layer. */
  async function open(layerId: string) {
    const s = await gmsApi.openSession(layerId)
    load(s)
    return s
  }
  function load(s: EditSession) {
    session.value = s
    past.value = []
    future.value = []
    const local = readMirror(s.session_id)
    recovered.value = !!local && local.savedAt > Date.parse(s.updated_at)
    edits.value = recovered.value ? local!.edits : s.edits
    saveState.value = recovered.value ? 'offline' : 'saved'
    if (recovered.value) save()
  }
  function close() {
    clearTimeout(timer)
    session.value = null
    edits.value = []
    past.value = []
    future.value = []
    saveState.value = 'idle'
  }

  // ── Edit helpers. Each is one undo step. ───────────────────────────────
  function addCreate(geometry: GeoJSON.Geometry, attrs: Record<string, unknown>, accuracy_class: AccuracyClass, source: string) {
    commit([...edits.value, { op: 'create', geometry, attrs, accuracy_class, source }])
    return edits.value.length - 1
  }

  /** Change a pending edit in place (attributes, geometry). */
  function patchEdit(index: number, patch: Partial<Edit>) {
    const next = clone(edits.value)
    next[index] = { ...next[index], ...patch } as Edit
    commit(next)
  }

  /** Change a published feature. Folds into an existing update of it. */
  function updateFeature(featureId: number, baseVersion: number, patch: { geometry?: GeoJSON.Geometry; attrs?: Record<string, unknown>; accuracy_class?: AccuracyClass; source?: string }) {
    const next = clone(edits.value)
    const i = next.findIndex((e) => e.op !== 'create' && e.feature_id === featureId)
    if (i >= 0 && next[i].op === 'delete') return
    if (i >= 0) {
      const cur = next[i] as Extract<Edit, { op: 'update' }>
      next[i] = { ...cur, ...patch, attrs: patch.attrs ? { ...cur.attrs, ...patch.attrs } : cur.attrs }
    } else {
      next.push({ op: 'update', feature_id: featureId, base_version: baseVersion, ...patch })
    }
    commit(next)
  }

  /** Retire a published feature; replaces any pending update of it. */
  function deleteFeature(featureId: number, baseVersion: number) {
    const next = edits.value.filter((e) => e.op === 'create' || e.feature_id !== featureId)
    commit([...clone(next), { op: 'delete', feature_id: featureId, base_version: baseVersion }])
  }

  function removeEdit(index: number) {
    commit(edits.value.filter((_, i) => i !== index))
  }

  return {
    session, edits, saveState, savedAt, recovered, editable, canUndo, canRedo,
    open, load, close, save, undo, redo,
    addCreate, patchEdit, updateFeature, deleteFeature, removeEdit,
    /** Replace the whole list as one undo step (split, merge). */
    setEdits: commit,
  }
}
