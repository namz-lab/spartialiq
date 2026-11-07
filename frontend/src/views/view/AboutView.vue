<script setup lang="ts">
// About the Council — profile, governance, district figures, economy and
// departments. One of the public marketing pages linked from the home
// navbar. Shared chrome via SiteHeader / SiteFooter; styling via the
// global src/styles/public-pages.css.
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import {
  ArrowRight, Target, Compass, Landmark, TrendingUp,
  Sprout, Mountain, Trees, Store,
  ClipboardList, Route, HeartPulse, Coins, Users, Briefcase,
} from 'lucide-vue-next'
</script>

<template>
  <div class="home-view">
    <SiteHeader />

    <main class="main-stage">
      <!-- Page hero -->
      <section class="page-hero">
        <div class="page-hero-inner">
          <p class="ds-eyebrow">Your Council</p>
          <h1 class="ds-heading">About Vungu Rural District Council</h1>
          <p class="ds-subtext">
            The local authority for 609,589 hectares of Zimbabwe's Midlands Province &mdash; 19 wards
            across natural farming regions 3 and 4, bordered by Kwekwe, Chirumanzu, Shurugwi, Insiza
            and Inyati.
          </p>
        </div>
      </section>

      <!-- Profile: vision / mission / governance -->
      <section class="datasets-section">
        <div class="datasets-inner">
          <div class="datasets-header section-heading">
            <p class="ds-eyebrow">Who We Are</p>
            <h2 class="ds-heading">Vision, mission &amp; governance</h2>
            <p class="ds-subtext">Vungu RDC maintains the district's roads, allocates residential and commercial stands, and delivers health, water, planning and social services to its communities.</p>
          </div>
          <div class="ds-grid">
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Target :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Our Vision</h3>
                  <p class="ds-card-desc">A well-developed Vungu community with a high quality of life for its people by the year 2030.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Strategic Plan 2026&ndash;2030</span>
              </div>
            </div>
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Compass :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Our Mission</h3>
                  <p class="ds-card-desc">To provide and maintain social and economic facilities and services to the people of Vungu in an environmentally friendly and sustainable way.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Mandate of the council</span>
              </div>
            </div>
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Landmark :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Governance</h3>
                  <p class="ds-card-desc">Led by 19 ward councillors and 6 women's-quota councillors, working with 4 chiefs, 9 headmen and 215 village heads across the district.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Deliberative &amp; executive arms</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- District at a glance -->
      <section class="datasets-section stats-section" aria-label="Vungu district at a glance">
        <div class="datasets-inner">
          <div class="datasets-header section-heading">
            <h2 class="stats-heading">
              <TrendingUp :size="24" color="#111827" aria-hidden="true" />
              <span>Vungu District at a Glance</span>
            </h2>
            <p class="ds-subtext">The scale of the area Vungu RDC serves</p>
          </div>
          <dl class="stats-grid grid grid-cols-2 md:grid-cols-3 gap-6">
            <div class="stat-card"><dt>Administrative Wards</dt><dd>19</dd></div>
            <div class="stat-card"><dt>Hectares of Land</dt><dd>609,589</dd></div>
            <div class="stat-card"><dt>Households Served</dt><dd>24,127</dd></div>
            <div class="stat-card"><dt>Health Facilities</dt><dd>22</dd></div>
            <div class="stat-card"><dt>Water Points</dt><dd>360</dd></div>
            <div class="stat-card"><dt>Kilometres of Roads</dt><dd>1,521</dd></div>
          </dl>
          <p class="stats-note">
            Figures from the Vungu RDC profile. Natural farming regions 3 and 4; catchment areas Gwai and Sanyati.
          </p>
        </div>
      </section>

      <!-- Economy & investment -->
      <section class="datasets-section">
        <div class="datasets-inner">
          <div class="datasets-header section-heading">
            <p class="ds-eyebrow">Economy &amp; Investment</p>
            <h2 class="ds-heading">A district open for business</h2>
            <p class="ds-subtext">Vungu RDC promotes investment opportunities across agriculture, mining, tourism and enterprise</p>
          </div>
          <div class="ds-grid">
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Sprout :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Agriculture</h3>
                  <p class="ds-card-desc">Horticultural production and maize grain value addition across the district's farming communities.</p>
                </div>
              </div>
              <div class="ds-card-footer"><span class="ds-card-meta">Value addition</span></div>
            </div>
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Mountain :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Mining</h3>
                  <p class="ds-card-desc">The SINO mine produces quarry stone and cement products &mdash; a key district industry.</p>
                </div>
              </div>
              <div class="ds-card-footer"><span class="ds-card-meta">Quarry &amp; cement</span></div>
            </div>
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Trees :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Tourism &amp; Safaris</h3>
                  <p class="ds-card-desc">Linton Safari and Antelope Park draw visitors to the district's wildlife and conservation areas.</p>
                </div>
              </div>
              <div class="ds-card-footer"><span class="ds-card-meta">Linton &amp; Antelope Park</span></div>
            </div>
            <div class="dataset-card">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Store :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Trade &amp; Enterprise</h3>
                  <p class="ds-card-desc">Retailing, petty trading, welding services and accommodation sustain local livelihoods, supported by the council's Local Economic Development unit.</p>
                </div>
              </div>
              <div class="ds-card-footer"><span class="ds-card-meta">Local Economic Development</span></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Departments -->
      <section class="datasets-section">
        <div class="datasets-inner">
          <div class="datasets-header section-heading">
            <p class="ds-eyebrow">Inside the Council</p>
            <h2 class="ds-heading">Departments &amp; Services</h2>
            <p class="ds-subtext">The teams that keep Vungu district running, from planning approvals to roads, health and finance</p>
          </div>
          <div class="ds-grid">
            <router-link to="/council/planning-environment" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><ClipboardList :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Planning &amp; Environment</h3>
                  <p class="ds-card-desc">Development control, layout planning and environmental scrutiny.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/roads-works" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Route :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Roads &amp; Works</h3>
                  <p class="ds-card-desc">Maintaining 1,521 km of district roads, bridges and council works.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/health-facilities" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><HeartPulse :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Health Services</h3>
                  <p class="ds-card-desc">22 health facilities including 11 static clinics and mobile outreach.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/finance" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Coins :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Finance</h3>
                  <p class="ds-card-desc">Rates, billing, budgeting and the council's financial administration.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/social-services" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Users :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Social Services</h3>
                  <p class="ds-card-desc">Community welfare, education support and social-service delivery.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/hr-admin" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Briefcase :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Human Resources &amp; Administration</h3>
                  <p class="ds-card-desc">Staffing, capacity development and council administration.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/environment-agriculture" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><Sprout :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Environment &amp; Agriculture</h3>
                  <p class="ds-card-desc">Natural-resource stewardship, agriculture, culture and recreation.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Department</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
            <router-link to="/council/led" class="dataset-card ds-card-link">
              <div class="ds-card-accent"></div>
              <div class="ds-card-body">
                <div class="ds-card-icon"><TrendingUp :size="24" color="#111827" /></div>
                <div class="ds-card-text">
                  <h3 class="ds-card-title">Local Economic Development</h3>
                  <p class="ds-card-desc">Investment promotion, value addition and economic opportunity.</p>
                </div>
              </div>
              <div class="ds-card-footer">
                <span class="ds-card-meta">Service unit</span>
                <span class="ds-card-cta">View <ArrowRight :size="12" /></span>
              </div>
            </router-link>
          </div>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
