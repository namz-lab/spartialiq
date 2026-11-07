<script setup lang="ts">
/**
 * IT-Admin editor for the public council pages (the content migrated off the
 * old static vungurdc.org.zw site). Lets the admin change wording, staff
 * lists, committee duties and tables that don't live anywhere else in the
 * database. Saving writes a row to the backend `site_content` table; "Reset"
 * removes it so the page falls back to the bundled default.
 *
 * Each page is edited as structured blocks. List-style fields (paragraphs,
 * duties, staff, table rows) are edited as plain text — one item per line,
 * with " | " separating columns — which is fast and forgiving.
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft, Save, RotateCcw, Plus, Trash2, ChevronUp, ChevronDown,
  FileText, ExternalLink, Check, AlertCircle,
} from 'lucide-vue-next'
import type { BlockType, CouncilPage } from '@/content/siteContent'
import {
  fetchAllCouncilPages, saveCouncilPage, resetCouncilPage,
} from '@/services/siteContent'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'

const router = useRouter()
const fb = useUiFeedback()

// ── Editable shapes ───────────────────────────────────────────────────────
// A block in edit form: structural meta + text-serialised list fields.
interface EditBlock {
  type: BlockType
  heading?: string
  note?: string
  eyebrow?: string
  text?: string          // prose-as-cta text / single field
  bodyText?: string      // paragraphs OR list items, one per line
  columnsText?: string   // table header, " | " separated
  rowsText?: string      // table rows, one per line, cells " | " separated
  primaryText?: string   // "Label | /path"
  secondaryText?: string // "Label | /path"
}
interface EditPage {
  slug: string
  title: string
  eyebrow: string
  intro: string
  blocks: EditBlock[]
}

const BLOCK_LABELS: Record<BlockType, string> = {
  prose: 'Text / paragraphs',
  numbered: 'Numbered list',
  bullets: 'Bullet list',
  staff: 'Staff list',
  table: 'Table',
  cards: 'Card links',
  attachments: 'Documents / downloads',
  stats: 'Statistics',
  cta: 'Call to action',
}
const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as BlockType[]

const pages = ref<CouncilPage[]>([])
const selectedSlug = ref<string>('')
const draft = ref<EditPage | null>(null)
const loading = ref(true)
const saving = ref(false)
const message = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
const newBlockType = ref<BlockType>('prose')

// ── Serialisation between structured page and edit form ────────────────────
function lines(arr?: string[]): string {
  return (arr || []).join('\n')
}
function rowsToText(rows?: string[][]): string {
  return (rows || []).map((r) => r.join(' | ')).join('\n')
}
function pairLines(items: { a?: string; b?: string }[]): string {
  return items.map((i) => `${i.a ?? ''} | ${i.b ?? ''}`).join('\n')
}

function toEdit(page: CouncilPage): EditPage {
  return {
    slug: page.slug,
    title: page.title,
    eyebrow: page.eyebrow ?? '',
    intro: page.intro ?? '',
    blocks: page.blocks.map((b): EditBlock => {
      switch (b.type) {
        case 'prose':
          return { type: 'prose', heading: b.heading, eyebrow: b.eyebrow, bodyText: lines(b.paragraphs) }
        case 'numbered':
        case 'bullets':
          return { type: b.type, heading: b.heading, bodyText: lines(b.items) }
        case 'staff':
          return { type: 'staff', heading: b.heading, bodyText: b.members.map((m) => `${m.name} | ${m.role}`).join('\n') }
        case 'table':
          return { type: 'table', heading: b.heading, note: b.note, columnsText: (b.columns || []).join(' | '), rowsText: rowsToText(b.rows) }
        case 'cards':
          return { type: 'cards', heading: b.heading, eyebrow: b.eyebrow, bodyText: b.items.map((c) => [c.title, c.desc ?? '', c.to ?? '', c.meta ?? ''].join(' | ')).join('\n') }
        case 'attachments':
          return { type: 'attachments', heading: b.heading, bodyText: b.items.map((a) => [a.name, a.fileType ?? '', a.size ?? '', a.url ?? ''].join(' | ')).join('\n') }
        case 'stats':
          return { type: 'stats', heading: b.heading, note: b.note, bodyText: pairLines(b.items.map((s) => ({ a: s.label, b: s.value }))) }
        case 'cta':
          return {
            type: 'cta', heading: b.heading, text: b.text,
            primaryText: b.primary ? `${b.primary.label} | ${b.primary.to}` : '',
            secondaryText: b.secondary ? `${b.secondary.label} | ${b.secondary.to}` : '',
          }
      }
    }),
  }
}

function splitLines(text?: string): string[] {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean)
}
function splitCells(line: string): string[] {
  return line.split('|').map((s) => s.trim())
}
function parsePair(text?: string): { label: string; to: string } | undefined {
  const cells = splitCells(text || '')
  if (!cells[0]) return undefined
  return { label: cells[0], to: cells[1] || '' }
}

function fromEdit(ep: EditPage): CouncilPage {
  return {
    slug: ep.slug,
    title: ep.title.trim() || ep.slug,
    eyebrow: ep.eyebrow.trim() || undefined,
    intro: ep.intro.trim() || undefined,
    blocks: ep.blocks.map((b): CouncilPage['blocks'][number] => {
      switch (b.type) {
        case 'prose':
          return { type: 'prose', heading: b.heading || undefined, eyebrow: b.eyebrow || undefined, paragraphs: splitLines(b.bodyText) }
        case 'numbered':
        case 'bullets':
          return { type: b.type, heading: b.heading || undefined, items: splitLines(b.bodyText) }
        case 'staff':
          return {
            type: 'staff', heading: b.heading || undefined,
            members: splitLines(b.bodyText).map((l) => { const c = splitCells(l); return { name: c[0] || '', role: c[1] || '' } }),
          }
        case 'table':
          return {
            type: 'table', heading: b.heading || undefined, note: b.note || undefined,
            columns: splitCells(b.columnsText || '').filter(Boolean),
            rows: splitLines(b.rowsText).map((l) => splitCells(l)),
          }
        case 'cards':
          return {
            type: 'cards', heading: b.heading || undefined, eyebrow: b.eyebrow || undefined,
            items: splitLines(b.bodyText).map((l) => { const c = splitCells(l); return { title: c[0] || '', desc: c[1] || undefined, to: c[2] || undefined, meta: c[3] || undefined } }),
          }
        case 'attachments':
          return {
            type: 'attachments', heading: b.heading || undefined,
            items: splitLines(b.bodyText).map((l) => { const c = splitCells(l); return { name: c[0] || '', fileType: c[1] || undefined, size: c[2] || undefined, url: c[3] || undefined } }),
          }
        case 'stats':
          return {
            type: 'stats', heading: b.heading || undefined, note: b.note || undefined,
            items: splitLines(b.bodyText).map((l) => { const c = splitCells(l); return { label: c[0] || '', value: c[1] || '' } }),
          }
        case 'cta':
          return { type: 'cta', heading: b.heading || undefined, text: b.text || undefined, primary: parsePair(b.primaryText), secondary: parsePair(b.secondaryText) }
      }
    }),
  }
}

// ── Loading + selection ────────────────────────────────────────────────────
async function loadAll() {
  loading.value = true
  try {
    pages.value = await fetchAllCouncilPages()
    if (!selectedSlug.value && pages.value.length) select(pages.value[0].slug)
  } catch {
    message.value = { kind: 'err', text: 'Could not load pages. Check you are signed in as an admin and the backend is running.' }
    fb.showToast('Could not load website pages.', 'error')
  } finally {
    loading.value = false
  }
}

function select(slug: string) {
  selectedSlug.value = slug
  const page = pages.value.find((p) => p.slug === slug)
  draft.value = page ? toEdit(page) : null
  message.value = null
}

// ── Block operations ───────────────────────────────────────────────────────
function addBlock() {
  if (!draft.value) return
  draft.value.blocks.push({ type: newBlockType.value, heading: '', bodyText: '' })
}
function removeBlock(i: number) {
  draft.value?.blocks.splice(i, 1)
}
function moveBlock(i: number, dir: -1 | 1) {
  if (!draft.value) return
  const j = i + dir
  const arr = draft.value.blocks
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

// ── Save / reset ───────────────────────────────────────────────────────────
async function save() {
  if (!draft.value) return
  if (!draft.value.title.trim()) {
    message.value = { kind: 'err', text: 'Enter a page title before saving.' }
    return
  }
  saving.value = true
  message.value = null
  try {
    const page = fromEdit(draft.value)
    await saveCouncilPage(page)
    await loadAll()
    select(page.slug)
    message.value = { kind: 'ok', text: 'Saved. The public page now shows your changes.' }
  } catch {
    message.value = { kind: 'err', text: 'Could not save. Check you are signed in as an admin and the backend is running.' }
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (!draft.value) return
  const ok = await fb.confirmAction(
    'Reset this page',
    'Reset this page to its built-in default. Saved edits for this page will be removed.',
    { confirmLabel: 'Reset', danger: true },
  )
  if (!ok) return
  saving.value = true
  message.value = null
  try {
    await resetCouncilPage(draft.value.slug)
    await loadAll()
    select(selectedSlug.value)
    message.value = { kind: 'ok', text: 'Reset to the built-in default.' }
  } catch {
    message.value = { kind: 'err', text: 'Could not reset. Check your connection and admin session.' }
  } finally {
    saving.value = false
  }
}

const bodyHint: Partial<Record<BlockType, string>> = {
  prose: 'One paragraph per line.',
  numbered: 'One list item per line.',
  bullets: 'One list item per line.',
  staff: 'One person per line:  Name | Role',
  cards: 'One card per line:  Title | Description | /link | Label',
  attachments: 'One document per line:  Name | Type | Size | URL',
  stats: 'One figure per line:  Label | Value',
}

onMounted(loadAll)
</script>

<template>
  <div class="cms">
    <header class="cms-top">
      <button class="cms-back" @click="router.push('/admin')"><ArrowLeft :size="16" /> Admin</button>
      <div>
        <h1 class="cms-title">Website Content</h1>
        <p class="cms-sub">Edit the public council pages. Changes go live immediately; "Reset" restores the built-in text.</p>
      </div>
    </header>

    <div class="cms-body">
      <!-- Page list -->
      <aside class="cms-list">
        <p class="cms-list-head">Pages</p>
        <button
          v-for="p in pages"
          :key="p.slug"
          class="cms-list-item"
          :class="{ active: p.slug === selectedSlug }"
          @click="select(p.slug)"
        >
          <FileText :size="14" />
          <span>{{ p.title }}</span>
        </button>
      </aside>

      <!-- Editor -->
      <section class="cms-editor">
        <p v-if="loading" class="cms-empty">Loading…</p>

        <template v-else-if="draft">
          <div class="cms-editor-head">
            <div>
              <span class="cms-slug">/council/{{ draft.slug }}</span>
            </div>
            <div class="cms-editor-actions">
              <a class="cms-btn ghost" :href="`/council/${draft.slug}`" target="_blank" rel="noopener">
                <ExternalLink :size="14" /> Preview
              </a>
              <button class="cms-btn ghost" :disabled="saving" @click="reset"><RotateCcw :size="14" /> Reset</button>
              <button class="cms-btn primary" :disabled="saving" @click="save"><Save :size="14" /> {{ saving ? 'Saving…' : 'Save changes' }}</button>
            </div>
          </div>

          <div v-if="message" class="cms-msg" :class="message.kind">
            <component :is="message.kind === 'ok' ? Check : AlertCircle" :size="15" />
            {{ message.text }}
          </div>

          <!-- Page header fields -->
          <div class="cms-card">
            <label class="cms-field">
              <span>Page title</span>
              <input v-model="draft.title" type="text" class="cms-input" />
            </label>
            <label class="cms-field">
              <span>Eyebrow (small label above the title)</span>
              <input v-model="draft.eyebrow" type="text" class="cms-input" />
            </label>
            <label class="cms-field">
              <span>Intro paragraph</span>
              <textarea v-model="draft.intro" rows="3" class="cms-input"></textarea>
            </label>
          </div>

          <!-- Blocks -->
          <div v-for="(block, i) in draft.blocks" :key="i" class="cms-card">
            <div class="cms-block-head">
              <span class="cms-block-type">{{ BLOCK_LABELS[block.type] }}</span>
              <div class="cms-block-ctrls">
                <button class="cms-icon" title="Move up" :disabled="i === 0" @click="moveBlock(i, -1)"><ChevronUp :size="15" /></button>
                <button class="cms-icon" title="Move down" :disabled="i === draft.blocks.length - 1" @click="moveBlock(i, 1)"><ChevronDown :size="15" /></button>
                <button class="cms-icon danger" title="Remove block" @click="removeBlock(i)"><Trash2 :size="15" /></button>
              </div>
            </div>

            <label v-if="block.type !== 'cta'" class="cms-field">
              <span>Heading <em>(optional)</em></span>
              <input v-model="block.heading" type="text" class="cms-input" />
            </label>

            <!-- Body: paragraphs / list items / staff / cards / attachments / stats -->
            <label
              v-if="['prose','numbered','bullets','staff','cards','attachments','stats'].includes(block.type)"
              class="cms-field"
            >
              <span>Content <em v-if="bodyHint[block.type]">— {{ bodyHint[block.type] }}</em></span>
              <textarea v-model="block.bodyText" rows="6" class="cms-input mono"></textarea>
            </label>

            <!-- Table -->
            <template v-if="block.type === 'table'">
              <label class="cms-field">
                <span>Columns <em>— separate with |</em></span>
                <input v-model="block.columnsText" type="text" class="cms-input mono" />
              </label>
              <label class="cms-field">
                <span>Rows <em>— one row per line, cells separated with |</em></span>
                <textarea v-model="block.rowsText" rows="8" class="cms-input mono"></textarea>
              </label>
              <label class="cms-field">
                <span>Note <em>(optional)</em></span>
                <input v-model="block.note" type="text" class="cms-input" />
              </label>
            </template>

            <!-- CTA -->
            <template v-if="block.type === 'cta'">
              <label class="cms-field">
                <span>Heading</span>
                <input v-model="block.heading" type="text" class="cms-input" />
              </label>
              <label class="cms-field">
                <span>Text</span>
                <textarea v-model="block.text" rows="3" class="cms-input"></textarea>
              </label>
              <label class="cms-field">
                <span>Primary button <em>— Label | /path</em></span>
                <input v-model="block.primaryText" type="text" class="cms-input mono" />
              </label>
              <label class="cms-field">
                <span>Secondary button <em>— Label | /path</em></span>
                <input v-model="block.secondaryText" type="text" class="cms-input mono" />
              </label>
            </template>

            <!-- Stats note -->
            <label v-if="block.type === 'stats'" class="cms-field">
              <span>Note <em>(optional)</em></span>
              <input v-model="block.note" type="text" class="cms-input" />
            </label>
          </div>

          <!-- Add block -->
          <div class="cms-add">
            <select v-model="newBlockType" class="cms-input cms-select">
              <option v-for="t in BLOCK_TYPES" :key="t" :value="t">{{ BLOCK_LABELS[t] }}</option>
            </select>
            <button class="cms-btn ghost" @click="addBlock"><Plus :size="14" /> Add block</button>
          </div>
        </template>

        <p v-else class="cms-empty">Select a page to edit.</p>
      </section>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.cms { min-height: var(--ent-vh); background: #f6f8fb; padding: 1.5rem; color: #0f172a; }
.cms-top { display: flex; align-items: center; gap: 1.25rem; max-width: 72rem; margin: 0 auto 1.5rem; }
.cms-back {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 0.6rem;
  padding: 0.5rem 0.85rem; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer;
}
.cms-back:hover { border-color: #cbd5e1; }
.cms-title { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
.cms-sub { font-size: 0.85rem; color: #64748b; margin: 0.15rem 0 0; }

.cms-body { display: grid; grid-template-columns: 16rem 1fr; gap: 1.25rem; max-width: 72rem; margin: 0 auto; align-items: start; }
@media (max-width: 820px) { .cms-body { grid-template-columns: 1fr; } }

.cms-list { background: #fff; border: 1px solid #e8edf3; border-radius: 0.9rem; padding: 0.75rem; position: sticky; top: 1rem; }
.cms-list-head { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; padding: 0.35rem 0.5rem 0.6rem; margin: 0; }
.cms-list-item {
  width: 100%; display: flex; align-items: center; gap: 0.5rem;
  padding: 0.55rem 0.6rem; border: none; background: none; cursor: pointer;
  font-size: 0.85rem; color: #334155; border-radius: 0.55rem; text-align: left;
}
.cms-list-item:hover { background: #f1f5f9; }
.cms-list-item.active { background: #111827; color: #fff; }
.cms-list-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cms-editor { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.cms-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.cms-slug { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #64748b; background: #eef2f7; padding: 0.25rem 0.6rem; border-radius: 0.5rem; }
.cms-editor-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

.cms-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.55rem 1rem; font-size: 0.85rem; font-weight: 600;
  border-radius: 0.6rem; border: 1px solid transparent; cursor: pointer; text-decoration: none;
}
.cms-btn.primary { background: #1a73e8; color: #fff; }
.cms-btn.primary:hover { background: #1666cf; }
.cms-btn.ghost { background: #fff; border-color: #e2e8f0; color: #334155; }
.cms-btn.ghost:hover { border-color: #cbd5e1; }
.cms-btn:disabled { opacity: 0.55; cursor: default; }

.cms-msg { display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem 0.9rem; border-radius: 0.6rem; font-size: 0.85rem; }
.cms-msg.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.cms-msg.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

.cms-card { background: #fff; border: 1px solid #e8edf3; border-radius: 0.9rem; padding: 1.1rem; display: flex; flex-direction: column; gap: 0.85rem; }
.cms-block-head { display: flex; align-items: center; justify-content: space-between; }
.cms-block-type { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #1a73e8; }
.cms-block-ctrls { display: flex; gap: 0.3rem; }
.cms-icon { width: 1.9rem; height: 1.9rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; background: #fff; border-radius: 0.5rem; cursor: pointer; color: #475569; }
.cms-icon:hover { border-color: #cbd5e1; }
.cms-icon.danger:hover { color: #dc2626; border-color: #fca5a5; }
.cms-icon:disabled { opacity: 0.4; cursor: default; }

.cms-field { display: flex; flex-direction: column; gap: 0.35rem; }
.cms-field > span { font-size: 0.8rem; font-weight: 600; color: #334155; }
.cms-field em { font-style: normal; font-weight: 400; color: #94a3b8; }
.cms-input {
  width: 100%; padding: 0.55rem 0.7rem; font-size: 0.875rem; font-family: inherit;
  color: #0f172a; background: #fff; border: 1px solid #cbd5e1; border-radius: 0.55rem; resize: vertical;
}
.cms-input:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.14); }
.cms-input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
.cms-select { cursor: pointer; }

.cms-add { display: flex; gap: 0.6rem; align-items: center; }
.cms-add .cms-select { max-width: 16rem; }
.cms-empty { color: #64748b; font-size: 0.9rem; padding: 2rem; text-align: center; }
</style>
