<script setup lang="ts">
// Generic public council page. The route /council/:slug resolves the slug to a
// page (bundled default overlaid with any IT-Admin override), then renders its
// content blocks. Shares chrome (SiteHeader / SiteFooter) and the page-hero
// styling with the existing About / Services pages.
import { ref, watch, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import CouncilBlocks from '@/components/council/CouncilBlocks.vue'
import { fetchCouncilPage } from '@/services/siteContent'
import type { CouncilPage } from '@/content/siteContent'

const props = defineProps<{ slug?: string }>()
const route = useRoute()

const page = ref<CouncilPage | null>(null)
const loading = ref(true)
const notFound = ref(false)

function currentSlug(): string {
  return props.slug || (route.params.slug as string) || ''
}

async function load() {
  loading.value = true
  notFound.value = false
  const slug = currentSlug()
  const result = await fetchCouncilPage(slug)
  page.value = result
  notFound.value = !result
  loading.value = false
  if (result) document.title = `${result.title} — Vungu RDC`
}

onMounted(load)
watch(() => currentSlug(), load)
</script>

<template>
  <div class="home-view">
    <SiteHeader />

    <main id="main" class="main-stage">
      <template v-if="page">
        <section class="page-hero">
          <div class="page-hero-inner">
            <p v-if="page.eyebrow" class="ds-eyebrow" v-reveal>{{ page.eyebrow }}</p>
            <h1 class="ds-heading" v-reveal.up="60">{{ page.title }}</h1>
            <p v-if="page.intro" class="ds-subtext" v-reveal.up="120">{{ page.intro }}</p>
          </div>
        </section>

        <CouncilBlocks :blocks="page.blocks" />
      </template>

      <section v-else-if="!loading && notFound" class="page-hero">
        <div class="page-hero-inner">
          <p class="ds-eyebrow">Not found</p>
          <h1 class="ds-heading">Page not available</h1>
          <p class="ds-subtext">
            This council page could not be found. Use the navigation above to
            find what you are looking for.
          </p>
          <div class="not-found-actions" style="justify-content:flex-start">
            <RouterLink to="/council/our-profile" class="hero-btn-primary">Our profile</RouterLink>
            <RouterLink to="/about" class="hero-btn-secondary">About the council</RouterLink>
            <RouterLink to="/" class="hero-btn-secondary">Home</RouterLink>
          </div>
        </div>
      </section>

      <!-- Skeleton, not a spinner: the override request is usually a few
           tens of milliseconds and a spinner that flashes for 40ms reads as
           a glitch. This holds the page's shape so nothing jumps when the
           real content replaces it. -->
      <section v-else class="page-hero" aria-busy="true">
        <div class="page-hero-inner">
          <span class="sr-only">Loading this council page</span>
          <p class="figure-skeleton" style="width:7rem;height:0.9rem" aria-hidden="true"></p>
          <p class="figure-skeleton" style="width:min(22rem,80%);height:2.25rem;margin-top:1rem" aria-hidden="true"></p>
          <p class="figure-skeleton" style="width:min(40rem,100%);height:1rem;margin-top:1.25rem" aria-hidden="true"></p>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
