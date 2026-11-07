<script setup lang="ts">
// Renders an array of content blocks for a council page. Every block sits in
// its own .datasets-section so the alternating background + spacing match the
// existing About / Services pages exactly (shared classes from
// src/styles/public-pages.css). New block-specific styling (tables, lists,
// staff, documents) is appended to that same stylesheet.
import { RouterLink } from 'vue-router'
import { FileText, Download, ArrowRight } from 'lucide-vue-next'
import type { Block } from '@/content/siteContent'

defineProps<{ blocks: Block[] }>()

function isExternal(href?: string): boolean {
  return !!href && /^https?:\/\//.test(href)
}
</script>

<template>
  <section
    v-for="(block, i) in blocks"
    :key="i"
    class="datasets-section"
  >
    <div class="datasets-inner">
      <!-- Prose -->
      <template v-if="block.type === 'prose'">
        <div v-if="block.heading || block.eyebrow" class="council-block-head">
          <p v-if="block.eyebrow" class="ds-eyebrow">{{ block.eyebrow }}</p>
          <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
        </div>
        <div class="council-prose">
          <p v-for="(p, pi) in block.paragraphs" :key="pi">{{ p }}</p>
        </div>
      </template>

      <!-- Numbered list -->
      <template v-else-if="block.type === 'numbered'">
        <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
        <ol class="council-list council-list--numbered">
          <li v-for="(item, ii) in block.items" :key="ii">{{ item }}</li>
        </ol>
      </template>

      <!-- Bullet list -->
      <template v-else-if="block.type === 'bullets'">
        <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
        <ul class="council-list">
          <li v-for="(item, ii) in block.items" :key="ii">{{ item }}</li>
        </ul>
      </template>

      <!-- Staff grid -->
      <template v-else-if="block.type === 'staff'">
        <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
        <div class="council-staff-grid">
          <div v-for="(m, mi) in block.members" :key="mi" class="council-staff-card">
            <div class="council-staff-avatar" aria-hidden="true">
              {{ m.name.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/, '').charAt(0) }}
            </div>
            <div class="council-staff-text">
              <p class="council-staff-name">{{ m.name }}</p>
              <p class="council-staff-role">{{ m.role }}</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Table -->
      <template v-else-if="block.type === 'table'">
        <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
        <div class="council-table-wrap">
          <table class="council-table">
            <thead>
              <tr>
                <th v-for="(col, ci) in block.columns" :key="ci" scope="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in block.rows" :key="ri">
                <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="block.note" class="stats-note">{{ block.note }}</p>
      </template>

      <!-- Card grid (index pages) -->
      <template v-else-if="block.type === 'cards'">
        <div v-if="block.heading || block.eyebrow" class="datasets-header section-heading">
          <p v-if="block.eyebrow" class="ds-eyebrow">{{ block.eyebrow }}</p>
          <h2 v-if="block.heading" class="ds-heading">{{ block.heading }}</h2>
        </div>
        <div class="ds-grid">
          <component
            :is="card.to ? RouterLink : 'div'"
            v-for="(card, ci) in block.items"
            :key="ci"
            :to="card.to"
            class="dataset-card"
            :class="{ 'ds-card-link': !!card.to }"
          >
            <div class="ds-card-accent"></div>
            <div class="ds-card-body">
              <div class="ds-card-text">
                <h3 class="ds-card-title">{{ card.title }}</h3>
                <p v-if="card.desc" class="ds-card-desc">{{ card.desc }}</p>
              </div>
            </div>
            <div class="ds-card-footer">
              <span class="ds-card-meta">{{ card.meta || 'Council' }}</span>
              <span v-if="card.to" class="ds-card-cta">View <ArrowRight :size="12" /></span>
            </div>
          </component>
        </div>
      </template>

      <!-- Attachments / downloads -->
      <template v-else-if="block.type === 'attachments'">
        <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
        <ul class="council-docs">
          <li v-for="(doc, di) in block.items" :key="di">
            <a
              class="council-doc"
              :href="doc.url || '#'"
              :target="isExternal(doc.url) ? '_blank' : undefined"
              :rel="isExternal(doc.url) ? 'noopener' : undefined"
            >
              <span class="council-doc-icon" aria-hidden="true"><FileText :size="20" /></span>
              <span class="council-doc-text">
                <span class="council-doc-name">{{ doc.name }}</span>
                <span class="council-doc-meta">
                  <template v-if="doc.fileType">{{ doc.fileType }}</template>
                  <template v-if="doc.fileType && doc.size"> · </template>
                  <template v-if="doc.size">{{ doc.size }}</template>
                </span>
              </span>
              <span class="council-doc-dl" aria-hidden="true"><Download :size="16" /></span>
            </a>
          </li>
        </ul>
      </template>

      <!-- Stats -->
      <template v-else-if="block.type === 'stats'">
        <div v-if="block.heading" class="datasets-header section-heading">
          <h2 class="stats-heading"><span>{{ block.heading }}</span></h2>
        </div>
        <dl class="stats-grid grid grid-cols-2 md:grid-cols-3 gap-6">
          <div v-for="(s, si) in block.items" :key="si" class="stat-card">
            <dt>{{ s.label }}</dt>
            <dd>{{ s.value }}</dd>
          </div>
        </dl>
        <p v-if="block.note" class="stats-note">{{ block.note }}</p>
      </template>

      <!-- Call to action -->
      <template v-else-if="block.type === 'cta'">
        <div class="council-cta">
          <h2 v-if="block.heading" class="council-block-title">{{ block.heading }}</h2>
          <p v-if="block.text" class="council-prose"><span>{{ block.text }}</span></p>
          <div class="hero-buttons" style="justify-content:flex-start">
            <RouterLink v-if="block.primary" :to="block.primary.to" class="hero-btn-primary">
              {{ block.primary.label }}
            </RouterLink>
            <RouterLink v-if="block.secondary" :to="block.secondary.to" class="hero-btn-secondary">
              {{ block.secondary.label }}
            </RouterLink>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
