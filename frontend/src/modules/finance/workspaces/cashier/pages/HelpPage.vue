<script setup lang="ts">
/** How the Cash Office works, the keyboard shortcuts, and whom to ask. */
import { CircleHelp, Keyboard } from 'lucide-vue-next'
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><CircleHelp :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Help &amp; Support</h2>
      <p>How a day at the counter runs, and whom to ask when something stops you.</p>
    </div>
  </section>

  <div class="hp-grid">
    <section class="cw-card">
      <div class="cw-card-head"><h3>A day at the counter</h3></div>
      <div class="cw-card-body">
        <ol class="hp-steps">
          <li><strong>Open your till.</strong> On Daily Cash Up, choose your cash point and enter the float in each currency.</li>
          <li><strong>Serve the queue.</strong> Select the next person in the Service Queue, or start Take Payment.</li>
          <li><strong>Take the payment.</strong> Find the customer, tick the bills they are paying, choose how they pay, and confirm. A service with no bill goes through Issue Receipt.</li>
          <li><strong>Give the receipt.</strong> Print it or save it as PDF. Reprints are marked COPY.</li>
          <li><strong>Step away safely.</strong> Suspend your till; nobody else can take payments in it, and you resume when you return.</li>
          <li><strong>Cash up.</strong> Count everything in the drawer, float included, and declare it. The expected figure and any variance are shown after you declare. A difference is explained in writing.</li>
        </ol>
      </div>
    </section>

    <section class="cw-card">
      <div class="cw-card-head"><h3><Keyboard :size="22" class="cw-head-icon" aria-hidden="true" /> Shortcuts</h3></div>
      <div class="cw-card-body">
        <dl class="cw-kv">
          <div><dt><kbd>Ctrl</kbd> + <kbd>N</kbd></dt><dd>New payment</dd></div>
          <div><dt><kbd>Enter</kbd> in a search box</dt><dd>Search</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Close a dialog or menu</dd></div>
        </dl>
      </div>
    </section>

    <section class="cw-card">
      <div class="cw-card-head"><h3>Who to ask</h3></div>
      <div class="cw-card-body">
        <dl class="cw-kv">
          <div><dt>Every drawer is held</dt><dd>Cash supervisor</dd></div>
          <div><dt>A receipt was issued in error</dt><dd>Cancel it from Receipts while your till is open; a rates receipt, the revenue office</dd></div>
          <div><dt>A customer's bill looks wrong</dt><dd>Revenue office</dd></div>
          <div><dt>The year or period is closed</dt><dd>Accountant</dd></div>
          <div><dt>Your count needs verifying</dt><dd>Accountant or cash supervisor</dd></div>
          <div><dt>You cannot sign in or see a page</dt><dd>Finance administrator</dd></div>
        </dl>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 18px; align-items: start; }
.hp-steps { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 10px; }
kbd { padding: 2px 7px; border: 1px solid var(--cw-line-2); border-bottom-width: 2px; border-radius: 6px; background: #f9fbfe; font: inherit; font-size: 13px; }
.cw-kv dd { font-weight: 500; }
</style>
