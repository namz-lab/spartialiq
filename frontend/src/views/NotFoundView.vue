<script setup lang="ts">
/**
 * 404.
 *
 * This was three lines of text on a blank page with no header, no footer and
 * no way onward — which on a council site is the worst page to strand
 * somebody on, because the people who reach it are following an old link
 * from a notice board, a letter or a search result and have no idea what the
 * site is now called things.
 *
 * It now carries the site chrome and, more usefully, says what was asked for
 * and offers the handful of places it was most likely meant to be.
 */
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import { ArrowLeft, Home } from 'lucide-vue-next'

const route = useRoute()

/**
 * Shown back to the reader so they can see the typo. Rendered as text by
 * Vue, never as markup, and capped — a path is a thing someone else chose
 * and a 900-character one would otherwise break the layout.
 */
const attempted = computed(() => {
  const path = route.fullPath || '/'
  return path.length > 80 ? `${path.slice(0, 80)}…` : path
})

const SUGGESTIONS = [
  { to: '/', label: 'Home' },
  { to: '/services', label: 'Council services' },
  { to: '/explorer', label: 'District map' },
  { to: '/council/our-profile', label: 'Our profile' },
  { to: '/council/publications', label: 'Publications' },
  { to: '/contact', label: 'Contact the council' },
]
</script>

<template>
  <div class="home-view">
    <SiteHeader />

    <main id="main" class="main-stage not-found-view">
      <p class="not-found-code" aria-hidden="true">404</p>
      <h1>This page is not here</h1>
      <p>
        Nothing on the Vungu RDC portal answers to
        <strong>{{ attempted }}</strong>. It may have moved, or the link that
        brought you here may be out of date.
      </p>

      <div class="not-found-actions">
        <RouterLink to="/" class="hero-btn-primary">
          <Home :size="16" aria-hidden="true" />
          Go to the home page
        </RouterLink>
        <button type="button" class="hero-btn-secondary" @click="$router.back()">
          <ArrowLeft :size="16" aria-hidden="true" />
          Back
        </button>
      </div>

      <div class="not-found-suggest">
        <p>Or try one of these</p>
        <ul class="not-found-links">
          <li v-for="item in SUGGESTIONS" :key="item.to">
            <RouterLink :to="item.to">{{ item.label }}</RouterLink>
          </li>
        </ul>
      </div>
    </main>

    <SiteFooter />
  </div>
</template>
