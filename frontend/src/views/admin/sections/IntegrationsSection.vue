<script setup lang="ts">
// Integrations — the other consoles, the QGIS bridge, and the documentation.
//
// WHY A HUB AND NOT FIFTEEN MORE SECTIONS
// Four of the IT Admin's responsibilities already have their own substantial
// consoles on their own routes: the public website, the land-use configuration,
// the GIS symbology registry, and the QGIS plugin. Each is hundreds of lines
// of purpose-built screen. Duplicating them here would be the wrong kind of
// completeness; what was missing was a place that says they exist and what
// each is for, so an administrator who has not opened one in six months does
// not have to remember its URL.
//
// THE API TOKEN IS MINTED HERE
// POST /auth/generate-api-token is admin-only, because minting a year-long
// bearer token is provisioning. It is shown exactly once. Not because that is
// clever, but because the server does not store a copy it could show again —
// the token is signed, not recorded, and saying so is more useful than a
// "copy it now!" warning with no explanation behind it.
//
// THE DOCUMENTATION REPLACES A VIDEO PORTAL THAT HAD NO VIDEOS
// The old /admin/video-tutorials listed six tutorials whose videoUrl was null,
// with thumbnails loaded from via.placeholder.com — an external CDN this
// project does not use. The real material is the markdown in public/, and
// linking it honestly is worth more than six cards that play nothing.

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { errorMessage } from '@/services/adminConsole'
import UiSheet from '@/components/ui/UiSheet.vue'
import {
  Globe, Map as MapIcon, Palette, Layers, BookOpen, KeyRound, Copy,
  ExternalLink, AlertTriangle, CheckCircle2, ChevronRight,
} from 'lucide-vue-next'

const router = useRouter()

/**
 * The consoles that live on their own routes.
 *
 * Each entry says what the console DECIDES, not what it displays — an
 * administrator choosing between them is choosing a decision to make.
 */
const CONSOLES = [
  {
    icon: Globe,
    title: 'Website content',
    path: '/admin/content',
    what: 'The public council pages — services, notices, contact details and the text citizens read before they apply.',
    who: 'IT Administrator only.',
  },
  {
    icon: MapIcon,
    title: 'Land-use configuration',
    path: '/admin/land-use',
    what: 'Zones, land-use groups and the development-control matrix: what may be built where, and under what conditions.',
    who: 'IT Administrator and planners. A change here alters what the planning workflow permits.',
  },
  {
    icon: MapIcon,
    title: 'Plan workbench',
    path: '/admin/plan-workbench',
    what: 'Onboard an authority: give it a plan from a template, load its decisions, sign it off and take it to gazetted, with a record of every step.',
    who: 'IT Administrator and planners. Approval needs a current sign-off; an approved plan can only change as a new version.',
  },
  {
    icon: Palette,
    title: 'GIS symbology registry',
    path: '/admin/gis-symbology',
    what: 'Which approved style version each map layer renders with, across QGIS Server and the web, with rollback.',
    who: 'IT Administrator and the GIS Officer, who is the cartographic author. Publishing changes what every client renders.',
  },
  {
    icon: Layers,
    title: 'QGIS plugin',
    path: '/admin/qgis-plugin',
    what: 'The desktop bridge: installation, the connection settings officers need, and the plugin package itself.',
    who: 'IT Administrator. Officers install it on their own workstations.',
  },
]

/**
 * The system documentation that actually exists, in public/.
 *
 * Linked rather than embedded: these are long reference documents and a
 * browser renders a markdown file perfectly well in its own tab, where it can
 * be searched, printed and bookmarked.
 */
const DOCUMENTS = [
  { file: 'Vungu_RDC_GIS_System_Documentation.md', title: 'System documentation', what: 'How the platform fits together, end to end.' },
  { file: 'PHASE2_ADMIN_GUIDE.md', title: 'Administrator guide', what: 'Day-to-day administration procedures.' },
  { file: 'PHASE2_USER_MANUAL.md', title: 'User manual', what: 'What officers see, by role.' },
  { file: 'PHASE2_QUICK_START_GUIDE.md', title: 'Quick start', what: 'The short version, for a new officer on their first day.' },
  { file: 'PHASE2_TROUBLESHOOTING_GUIDE.md', title: 'Troubleshooting', what: 'Known failures and what to do about them.' },
  { file: 'PHASE2_API_REFERENCE.md', title: 'API reference', what: 'The endpoints, for anyone integrating against this system.' },
  { file: 'QGIS_PLUGIN_INSTALLATION_GUIDE.md', title: 'QGIS plugin installation', what: 'Installing the desktop bridge on a workstation.' },
]

// ── API token ───────────────────────────────────────────────────────────
const tokenOpen = ref(false)
const pluginName = ref('vungu-qgis-plugin')
const minting = ref(false)
const token = ref<string | null>(null)
const tokenError = ref<string | null>(null)
const copied = ref(false)

async function mint() {
  minting.value = true
  tokenError.value = null
  token.value = null
  copied.value = false
  try {
    const response = await api.post('/auth/generate-api-token', { pluginName: pluginName.value.trim() || undefined })
    const value = response.data?.data?.apiToken
    if (!value) {
      tokenError.value = 'The server returned no token.'
      return
    }
    token.value = value
  } catch (err) {
    tokenError.value = errorMessage(err, 'The token could not be created.')
  } finally {
    minting.value = false
  }
}

async function copyToken() {
  if (!token.value) return
  try {
    await navigator.clipboard.writeText(token.value)
    copied.value = true
  } catch {
    copied.value = false
    tokenError.value = 'The clipboard is not available here. Select the token and copy it manually.'
  }
}

function closeToken() {
  tokenOpen.value = false
  // Cleared on close rather than left in memory: it is a year-long credential
  // and there is no reason for it to survive the dialog.
  token.value = null
  tokenError.value = null
  copied.value = false
}

const docBase = computed(() => window.location.origin)
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Configuration</span>
        <h2 class="ins-title">Integrations</h2>
        <p class="ins-lede">
          The configuration consoles that live on their own screens, the desktop GIS
          bridge, and the system documentation.
        </p>
      </div>
    </header>

    <!-- ── Consoles ───────────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head"><h3>Configuration consoles</h3></div>
      <ul class="ig-list">
        <li v-for="c in CONSOLES" :key="c.path">
          <button type="button" class="ig-item" @click="router.push(c.path)">
            <span class="ig-icon"><component :is="c.icon" :size="18" aria-hidden="true" /></span>
            <span class="ig-text">
              <strong>{{ c.title }}</strong>
              <small>{{ c.what }}</small>
              <em>{{ c.who }}</em>
            </span>
            <ChevronRight :size="16" class="ig-chevron" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>

    <!-- ── API token ──────────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head"><h3><KeyRound :size="15" aria-hidden="true" /> QGIS API token</h3></div>
      <div class="ins-card-body">
        <p class="ig-para">
          The desktop QGIS plugin authenticates with a long-lived signed token rather
          than a session cookie. Minting one is provisioning, so only an IT Administrator
          can do it — and the token carries the rights of the account that created it.
        </p>
        <button type="button" class="ig-btn ig-btn-primary" @click="tokenOpen = true">
          Create a token
        </button>
      </div>
    </section>

    <!-- ── Documentation ──────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head"><h3><BookOpen :size="15" aria-hidden="true" /> System documentation</h3></div>
      <div class="ins-card-body">
        <p class="ig-para">
          Reference material held with the application, so it is available on the
          council's own network without reaching anything outside it.
        </p>
        <ul class="ig-docs">
          <li v-for="d in DOCUMENTS" :key="d.file">
            <a class="ig-doc" :href="`${docBase}/${d.file}`" target="_blank" rel="noopener">
              <span class="ig-doc-text">
                <strong>{{ d.title }}</strong>
                <small>{{ d.what }}</small>
              </span>
              <ExternalLink :size="14" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </div>
    </section>

    <!-- ── Token dialog ───────────────────────────────────────────────── -->
    <UiSheet :open="tokenOpen" title="QGIS API token"
             subtitle="Shown once — the server keeps no copy" width="34rem"
             @close="closeToken" @update:open="$event || closeToken()">
      <div class="ig-token">
        <template v-if="!token">
          <div class="ins-field full">
            <label class="ins-label" for="ig-plugin">What is this token for?</label>
            <input id="ig-plugin" v-model="pluginName" class="ins-input" placeholder="vungu-qgis-plugin" />
            <p class="ins-hint">
              Recorded in the token so a later reader can tell one from another. It does
              not restrict what the token can do.
            </p>
          </div>

          <p class="ins-banner t-warning">
            <AlertTriangle :size="16" aria-hidden="true" />
            <span>
              The token carries your own access for a year. Anyone holding it can act as
              you against this API. Put it in the workstation's plugin settings and
              nowhere else.
            </span>
          </p>

          <p v-if="tokenError" class="ig-error" role="alert">{{ tokenError }}</p>

          <div class="ig-token-actions">
            <button type="button" class="ig-btn" @click="closeToken">Cancel</button>
            <button type="button" class="ig-btn ig-btn-primary" :disabled="minting" @click="mint">
              {{ minting ? 'Creating…' : 'Create the token' }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="ins-banner t-positive">
            <CheckCircle2 :size="16" aria-hidden="true" />
            <span>Token created. Copy it now.</span>
          </p>

          <label class="ins-label" for="ig-token">Token</label>
          <textarea id="ig-token" class="ins-input ins-mono ig-token-value" rows="4" readonly
                    :value="token" @focus="($event.target as HTMLTextAreaElement).select()"></textarea>

          <button type="button" class="ig-btn" @click="copyToken">
            <Copy :size="14" aria-hidden="true" /> {{ copied ? 'Copied' : 'Copy the token' }}
          </button>

          <!-- The reason, not just the instruction. A warning an operator
               understands is one they follow the next time too. -->
          <p class="ins-hint">
            This is the only time it will be shown. The token is cryptographically
            signed rather than stored, so the server has nothing to show you again — if
            it is lost, create another and remove this one from the workstation.
          </p>

          <p v-if="tokenError" class="ig-error" role="alert">{{ tokenError }}</p>

          <div class="ig-token-actions">
            <button type="button" class="ig-btn ig-btn-primary" @click="closeToken">Done</button>
          </div>
        </template>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
.ig-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer; }
.ig-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.ig-btn:disabled { opacity:0.55; cursor:not-allowed; }
.ig-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ig-btn-primary { color:var(--ent-text-on-accent); background:var(--ent-accent); border-color:var(--ent-accent); }
.ig-btn-primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.ig-para { margin:0 0 var(--ent-s3); max-width:80ch;
  font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2); }

.ig-list { list-style:none; margin:0; padding:0; }
.ig-item { display:flex; align-items:flex-start; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s4); text-align:left; font-family:var(--ent-font);
  background:none; border:0; border-top:1px solid var(--ent-line); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.ig-list li:first-child .ig-item { border-top:0; }
.ig-item:hover { background:var(--ent-surface-2); }
.ig-item:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.ig-icon { display:inline-flex; flex-shrink:0; margin-top:2px; color:var(--ent-accent); }
.ig-text { flex:1; min-width:0; }
.ig-text strong { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.ig-text small { display:block; margin-top:2px; font-size:var(--ent-fs-sm); line-height:var(--ent-lh); color:var(--ent-text-2); }
.ig-text em { display:block; margin-top:var(--ent-s2); font-style:normal;
  font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.ig-chevron { flex-shrink:0; align-self:center; color:var(--ent-text-3); }

.ig-docs { list-style:none; margin:0; padding:0; display:grid;
  grid-template-columns:repeat(auto-fit, minmax(18rem, 1fr)); gap:var(--ent-s2); }
.ig-doc { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3); text-decoration:none;
  background:var(--ent-surface-2); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); color:var(--ent-text-3);
  transition:border-color var(--ent-dur) var(--ent-ease); }
.ig-doc:hover { border-color:var(--ent-line-strong); }
.ig-doc:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ig-doc-text { flex:1; min-width:0; }
.ig-doc-text strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.ig-doc-text small { display:block; margin-top:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }

.ig-token { display:flex; flex-direction:column; gap:var(--ent-s3); }
.ig-token-value { resize:vertical; overflow-wrap:anywhere; font-size:var(--ent-fs-xs); }
.ig-token-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); }
.ig-error { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-danger); }
</style>
