<script setup lang="ts">
/**
 * The public site's footer.
 *
 * On a council site the footer is not a sitemap dumped at the bottom of the
 * page — it is where someone who could not find what they came for looks
 * next, and where the statutory details (address, phone, the office hours
 * that decide whether it is worth the trip to Gweru) have to be, on every
 * page, without a click.
 *
 * Contact details come from COUNCIL_CONTACT so the footer, the contact page
 * and the council profile page cannot disagree about the council's own
 * telephone number.
 */
import { computed } from 'vue'
import { MapPin, Phone, Mail, Clock, ExternalLink } from 'lucide-vue-next'
import { COUNCIL_CONTACT } from '@/content/siteContent'

// Computed, not typed in. A hardcoded year is wrong on 1 January and nobody
// notices until a resident mentions it.
const year = computed(() => new Date().getFullYear())
</script>

<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-grid">
        <!-- Identity -->
        <div class="footer-brand">
          <div class="footer-logo">
            <span class="footer-logo-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 7.5 9 4.5l6 3 6-3v12l-6 3-6-3-6 3z" stroke-linejoin="round" />
                <path d="M9 4.5v12M15 7.5v12" stroke-linecap="round" />
              </svg>
            </span>
            <span class="footer-logo-text">Vungu Rural District Council</span>
          </div>
          <p class="footer-brand-desc">
            The development planning and spatial data portal of Vungu Rural
            District Council — Midlands Province, Zimbabwe. Nineteen wards,
            one register.
          </p>
          <p class="footer-motto">“For Sustainable Development”</p>
        </div>

        <!-- What residents come here to do -->
        <div class="footer-col">
          <p class="footer-col-heading">Do it online</p>
          <ul class="footer-links">
            <li>
              <router-link :to="{ path: '/citizen', query: { section: 'new' } }" class="footer-link">
                Apply for a development permit
              </router-link>
            </li>
            <li><router-link to="/council/stand-application" class="footer-link">Apply for a stand</router-link></li>
            <li><router-link to="/plan-review" class="footer-link">Submit building plans</router-link></li>
            <li><router-link to="/payments" class="footer-link">Pay council fees</router-link></li>
            <li>
              <router-link :to="{ path: '/citizen', query: { section: 'applications' } }" class="footer-link">
                Track an application
              </router-link>
            </li>
            <li><router-link to="/explorer" class="footer-link">Explore the district map</router-link></li>
          </ul>
        </div>

        <!-- The institution -->
        <div class="footer-col">
          <p class="footer-col-heading">The Council</p>
          <ul class="footer-links">
            <li><router-link to="/about" class="footer-link">About Vungu RDC</router-link></li>
            <li><router-link to="/council/our-profile" class="footer-link">Our profile</router-link></li>
            <li><router-link to="/council/executive-arm" class="footer-link">Executive arm</router-link></li>
            <li><router-link to="/council/deliberative-arm" class="footer-link">Deliberative arm</router-link></li>
            <li><router-link to="/council/departments" class="footer-link">Departments</router-link></li>
            <li><router-link to="/council/publications" class="footer-link">Publications &amp; documents</router-link></li>
            <li><router-link to="/contact" class="footer-link">Contact us</router-link></li>
          </ul>
        </div>

        <!-- Reach a person -->
        <div class="footer-col">
          <p class="footer-col-heading">Council offices</p>
          <ul class="footer-links">
            <li>
              <a
                class="footer-link footer-contact"
                href="https://maps.google.com/?q=19+Lincoln+Road+Light+Industrial+Site+Gweru"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MapPin :size="14" aria-hidden="true" />
                <span>{{ COUNCIL_CONTACT.address }}</span>
              </a>
            </li>
            <li>
              <a class="footer-link footer-contact" :href="COUNCIL_CONTACT.phoneHref">
                <Phone :size="14" aria-hidden="true" />
                <span>{{ COUNCIL_CONTACT.phone }}</span>
              </a>
            </li>
            <li>
              <a class="footer-link footer-contact" :href="`mailto:${COUNCIL_CONTACT.email}`">
                <Mail :size="14" aria-hidden="true" />
                <span>{{ COUNCIL_CONTACT.email }}</span>
              </a>
            </li>
            <li class="footer-contact footer-contact--static">
              <Clock :size="14" aria-hidden="true" />
              <span>{{ COUNCIL_CONTACT.hours }}</span>
            </li>
          </ul>

          <router-link to="/login" class="footer-staff-link">
            Council staff sign-in
          </router-link>
        </div>
      </div>

      <div class="footer-bottom">
        <p class="footer-copy">
          &copy; {{ year }} Vungu Rural District Council. Serving 19 wards across the Midlands.
        </p>
        <div class="footer-bottom-links">
          <router-link to="/privacy" class="footer-bottom-link">Privacy notice</router-link>
          <router-link to="/terms" class="footer-bottom-link">Terms of use</router-link>
          <router-link to="/contact" class="footer-bottom-link">Accessibility &amp; feedback</router-link>
          <a
            class="footer-bottom-link"
            href="https://vungurdc.org.zw"
            target="_blank"
            rel="noopener noreferrer"
          >
            vungurdc.org.zw
            <ExternalLink :size="12" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  </footer>
</template>
