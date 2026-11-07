<script setup lang="ts">
// "No case is open" — the one way this console says it, in the seven sections
// that work on a single application.
//
// It is a way in, not a dead end: the register is one click away and the case
// the officer last had open is offered back, because the usual reason for
// landing here is a section change that outran the case they meant to keep.

import { useEoNav } from '@/eo-planner/useEoNav'
import { FolderOpen, Library, Search } from 'lucide-vue-next'

defineProps<{
  /** What appears here once a case is open, in a few words. */
  what: string
}>()

const nav = useEoNav()
</script>

<template>
  <div class="cr">
    <span class="cr-ico"><FolderOpen :size="22" aria-hidden="true" /></span>
    <h3>No case is open</h3>
    <p>{{ what }} appears here once you open an application.</p>
    <div class="cr-actions">
      <button type="button" class="cr-btn primary" @click="nav.go('register')">
        <Library :size="14" aria-hidden="true" /> Open the register
      </button>
      <span class="cr-or">or press</span>
      <kbd class="cr-kbd"><Search :size="11" aria-hidden="true" /> Ctrl K</kbd>
    </div>
  </div>
</template>

<style scoped>
.cr { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:var(--ent-s3); margin:var(--ent-s6) auto; padding:var(--ent-s8) var(--ent-s5);
  max-width:34rem; text-align:center;
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.cr-ico { display:inline-flex; align-items:center; justify-content:center;
  width:3rem; height:3rem; border-radius:var(--ent-r-pill);
  background:var(--ent-accent-soft); color:var(--ent-accent); }
.cr h3 { margin:0; font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.cr p { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); }
.cr-actions { display:flex; align-items:center; gap:var(--ent-s2); flex-wrap:wrap; justify-content:center; }
.cr-or { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.cr-kbd { display:inline-flex; align-items:center; gap:4px;
  font-family:var(--ent-font-mono); font-size:var(--ent-fs-micro); color:var(--ent-text-2);
  padding:3px 7px; border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  background:var(--ent-surface-2); }
.cr-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  border-radius:var(--ent-r); cursor:pointer;
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line); }
.cr-btn.primary { background:var(--ent-accent); border-color:var(--ent-accent); color:var(--ent-text-on-accent); }
.cr-btn.primary:hover { background:var(--ent-accent-hover); }
.cr-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
</style>
