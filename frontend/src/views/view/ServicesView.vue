<script setup lang="ts">
// Council Services — the online services residents and developers use,
// plus the council's public plans and notices. Public marketing page
// linked from the home navbar. Chrome via SiteHeader / SiteFooter;
// styling via the global src/styles/public-pages.css.
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import {
  ArrowRight, Building2, FileText, ClipboardList, Search,
  CreditCard, Map, ScrollText, Coins,
} from 'lucide-vue-next'
</script>

<template>
  <div class="home-view">
    <SiteHeader />

    <main class="main-stage">
      <!-- Page hero -->
      <section class="page-hero">
        <div class="page-hero-inner">
          <p class="ds-eyebrow">Online Services</p>
          <h1 class="ds-heading">Council services, online</h1>
          <p class="ds-subtext">
            Apply, submit, pay and track &mdash; the Vungu RDC services residents and
            developers use most, now available without a trip to the council offices.
          </p>
        </div>
      </section>

      <!-- Services -->
      <section class="datasets-section">
        <div class="datasets-inner">
          <div class="datasets-header section-heading">
            <p class="ds-eyebrow">What you can do here</p>
            <h2 class="ds-heading">Six things, start to finish</h2>
            <p class="ds-subtext">Every service below runs end to end in this portal</p>
          </div>
          <div class="ds-grid">
            <router-link to="/register" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Building2 :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Apply for a Stand</h3>
                  <p class="ds-card-desc">Register and apply for a residential or commercial stand in the district.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Stand allocation</span>
                <span class="ds-card-cta">Start <ArrowRight :size="12" /></span>
              </div>
            </router-link>

            <router-link :to="{ path: '/citizen', query: { section: 'new' } }" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><FileText :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Development Permit</h3>
                  <p class="ds-card-desc">Submit a development application online using Form TPD.1.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Planning &amp; Environment</span>
                <span class="ds-card-cta">Apply <ArrowRight :size="12" /></span>
              </div>
            </router-link>

            <router-link to="/plan-review" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><ClipboardList :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Submit Building Plans</h3>
                  <p class="ds-card-desc">Lodge building plans for council review, scrutiny and approval.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Plan review</span>
                <span class="ds-card-cta">Submit <ArrowRight :size="12" /></span>
              </div>
            </router-link>

            <router-link to="/login" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Search :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Track an Application</h3>
                  <p class="ds-card-desc">Sign in to follow your application through every approval stage.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Applicant account</span>
                <span class="ds-card-cta">Sign in <ArrowRight :size="12" /></span>
              </div>
            </router-link>

            <router-link to="/payments" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><CreditCard :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Pay Council Fees</h3>
                  <p class="ds-card-desc">Settle rates, application fees and other council charges online.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Finance</span>
                <span class="ds-card-cta">Pay <ArrowRight :size="12" /></span>
              </div>
            </router-link>

            <router-link to="/explorer" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Map :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Explore the District Map</h3>
                  <p class="ds-card-desc">Browse wards, zoning, roads, water points and facilities on the live map.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Spatial explorer</span>
                <span class="ds-card-cta">Open <ArrowRight :size="12" /></span>
              </div>
            </router-link>
          </div>
        </div>
      </section>

      <!-- Documents & plans -->
      <section class="datasets-section">
        <div class="datasets-inner">
          <div class="datasets-header section-heading">
            <p class="ds-eyebrow">Public Documents</p>
            <h2 class="ds-heading">Plans &amp; Notices</h2>
            <p class="ds-subtext">Key council planning and budget documents, published for residents and stakeholders</p>
          </div>
          <div class="ds-grid">
            <a href="https://vungurdc.org.zw/ova_doc/strategic-plan-2026-2030/" target="_blank" rel="noopener" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><ScrollText :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Strategic Plan 2026&ndash;2030</h3>
                  <p class="ds-card-desc">The council's five-year direction towards the 2030 vision.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Strategy</span>
                <span class="ds-card-cta">Read <ArrowRight :size="12" /></span>
              </div>
            </a>
            <a href="https://vungurdc.org.zw/ova_doc/master-plan/" target="_blank" rel="noopener" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><FileText :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Master Plan</h3>
                  <p class="ds-card-desc">The long-range spatial framework guiding land use and development.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Spatial planning</span>
                <span class="ds-card-cta">Read <ArrowRight :size="12" /></span>
              </div>
            </a>
            <a href="https://vungurdc.org.zw/ova_doc/vungu-rdc-2026-annual-plan/" target="_blank" rel="noopener" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><ClipboardList :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Annual Plan 2026</h3>
                  <p class="ds-card-desc">Council priorities and programmes for the 2026 year.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Annual plan</span>
                <span class="ds-card-cta">Read <ArrowRight :size="12" /></span>
              </div>
            </a>
            <a href="https://vungurdc.org.zw/ova_doc/budget-approval-notice-2026/" target="_blank" rel="noopener" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Coins :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Budget Approval Notice 2026</h3>
                  <p class="ds-card-desc">The approved 2026 council budget notice for public reference.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Finance notice</span>
                <span class="ds-card-cta">Read <ArrowRight :size="12" /></span>
              </div>
            </a>
          </div>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
