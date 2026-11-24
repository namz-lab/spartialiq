<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ClipboardList, Home, Landmark, Map as MapIcon, Megaphone, Scale,
  ScrollText, Users, FileSignature, KeyRound, AlertTriangle,
} from 'lucide-vue-next'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import { housingApi } from './api'
import HousingMap from './HousingMap.vue'
import '../../views/inspector/inspector.css'

type Section = 'overview' | 'map' | 'waiting' | 'interviews' | 'allocations' | 'cessions' | 'estates' | 'standards' | 'announce'
const SECTIONS: { id: Section; label: string; icon: any }[] = [
  { id: 'overview', label: 'At a glance', icon: Home },
  { id: 'map', label: 'Stands map', icon: MapIcon },
  { id: 'waiting', label: 'Waiting list', icon: ClipboardList },
  { id: 'interviews', label: 'Interviews', icon: Users },
  { id: 'allocations', label: 'Offers & sale', icon: FileSignature },
  { id: 'cessions', label: 'Cessions & title', icon: ScrollText },
  { id: 'estates', label: 'Leases & co-ops', icon: KeyRound },
  { id: 'standards', label: 'Standards', icon: Scale },
  { id: 'announce', label: 'Notices', icon: Megaphone },
]

const route = useRoute()
const router = useRouter()
const desk = ref<any>(null)
const can = computed(() => desk.value?.can || {})
const visibleSections = computed(() => {
  const allowed = desk.value?.sections as Section[] | undefined
  return allowed ? SECTIONS.filter((s) => allowed.includes(s.id)) : SECTIONS
})
const section = computed<Section>(() => {
  const id = route.query.section as Section
  return visibleSections.value.some((s) => s.id === id) ? id : (visibleSections.value[0]?.id || 'overview')
})
function go(id: Section) { router.replace({ path: '/housing', query: { section: id, parcel: route.query.parcel } }) }

const overview = ref<any>(null)
const waiting = ref<any[]>([])
const interviews = ref<any[]>([])
const allocations = ref<any[]>([])
const offers = ref<any[]>([])
const agreements = ref<any[]>([])
const cessions = ref<any[]>([])
const leases = ref<any[]>([])
const coops = ref<any[]>([])
const orders = ref<any[]>([])
const overcrowding = ref<any[]>([])
const occupation = ref<any[]>([])
const titles = ref<any[]>([])
const repos = ref<any[]>([])
const announcements = ref<any[]>([])
const schemes = ref<any[]>([])
const err = ref<string | null>(null)
const banner = ref<string | null>(null)
const selected = ref<string | null>((route.query.parcel as string) || null)
const stand = ref<any>(null)
const township = ref('HERTS')

const waitForm = reactive({ applicant_name: '', sought: 'stand', density: 'any', preferred_ward: '9', household_size: '4', monthly_income: '', special_needs: '', resident: true })
const allocForm = reactive({ waiting_list_id: '', parcel_id: '', committee_minute: '', purchase_price: '', deposit_due: '', waiver_reason: '' })
const cessionForm = reactive({ allocation_id: '', kind: 'ordinary', from_name: '', to_name: '', to_waiting_list_id: '', spouse_consent: true })
const sittingForm = reactive({ minute_ref: '', notes: '' })
const sittings = ref<any[]>([])
const committeeItems = ref<any[]>([])
const leaseForm = reactive({ parcel_id: '', tenant_name: '', kind: 'council_rental', rent: '' })
const orderForm = reactive({ parcel_id: '', kind: 'repair', reason: '' })
const announceForm = reactive({ title: '', body: '' })

async function run<T>(fn: () => Promise<T>) {
  err.value = null
  try { return await fn() } catch (e: any) { err.value = e?.response?.data?.message || 'That could not be saved.'; return null }
}

async function loadOverview() { overview.value = await housingApi.overview() }
async function loadWaiting() { waiting.value = ((await housingApi.waitingList()) as any).entries || [] }
async function loadAlloc() {
  allocations.value = ((await housingApi.allocations()) as any).allocations || []
  offers.value = ((await housingApi.offers()) as any).offers || []
  agreements.value = ((await housingApi.agreements()) as any).agreements || []
}
async function loadAll() {
  err.value = null
  try {
    const [d, o, s, w, i, a, c, l, co, or, ov, oc, t, r, an, ct] = await Promise.all([
      housingApi.desk(), housingApi.overview(), housingApi.schemes(), housingApi.waitingList(), housingApi.interviews(),
      housingApi.allocations(), housingApi.cessions(), housingApi.leases(), housingApi.cooperatives(),
      housingApi.orders(), housingApi.overcrowding(), housingApi.occupation(), housingApi.title(),
      housingApi.repossessions(), housingApi.announcements(), housingApi.committee(),
    ])
    desk.value = d
    overview.value = o
    schemes.value = (s as any).schemes || []
    waiting.value = (w as any).entries || []
    interviews.value = (i as any).interviews || []
    allocations.value = (a as any).allocations || []
    cessions.value = (c as any).cessions || []
    leases.value = (l as any).leases || []
    coops.value = (co as any).cooperatives || []
    orders.value = (or as any).orders || []
    overcrowding.value = (ov as any).notices || []
    occupation.value = (oc as any).certificates || []
    titles.value = (t as any).requests || []
    repos.value = (r as any).repossessions || []
    announcements.value = (an as any).announcements || []
    sittings.value = (ct as any).sittings || []
    committeeItems.value = (ct as any).items || []
    await loadAlloc()
  } catch { err.value = 'Housing could not be read. Try again in a moment.' }
}
onMounted(loadAll)

watch(selected, async (id) => {
  if (!id) { stand.value = null; return }
  router.replace({ path: '/housing', query: { ...route.query, parcel: id, section: section.value } })
  try { stand.value = await housingApi.stand(id) } catch { stand.value = null }
})

function onSelect(id: string) { selected.value = id; allocForm.parcel_id = id; leaseForm.parcel_id = id; orderForm.parcel_id = id }

async function addWait() {
  const r = await run(() => housingApi.addWaiting({ ...waitForm, preferred_ward: Number(waitForm.preferred_ward) || null, household_size: Number(waitForm.household_size) || null }))
  if (r) { banner.value = `Waiting-list ${(r as any).entry.list_no} written.`; await loadWaiting(); await loadOverview() }
}
async function allocate() {
  const r = await run(() => housingApi.allocate(allocForm))
  if (r) { banner.value = 'Stand reserved from the waiting list.'; await loadAll() }
}
async function openSitting() {
  if (await run(() => housingApi.openSitting(sittingForm))) { banner.value = 'Committee sitting opened.'; await loadAll() }
}
async function offer(id: string) { if (await run(() => housingApi.issueOffer(id))) { banner.value = 'Offer letter issued.'; await loadAlloc() } }
async function accept(id: string) { if (await run(() => housingApi.acceptOffer(id))) await loadAlloc() }
async function agreement(id: string) { if (await run(() => housingApi.signAgreement({ allocation_id: id }))) { banner.value = 'Agreement of sale signed.'; await loadAlloc() } }
async function interview(id: string) {
  if (await run(() => housingApi.addInterview({ waiting_list_id: id, capacity_ok: true, documents_complete: true, recommendation: 'allocate' }))) {
    banner.value = 'Interview recorded; recommended for allocation.'; await loadAll()
  }
}
async function lodgeCession() {
  if (await run(() => housingApi.lodgeCession(cessionForm))) { banner.value = 'Cession lodged.'; cessions.value = ((await housingApi.cessions()) as any).cessions }
}
async function addLease() {
  if (await run(() => housingApi.addLease(leaseForm))) { banner.value = 'Lease written.'; leases.value = ((await housingApi.leases()) as any).leases }
}
async function addOrder() {
  if (await run(() => housingApi.addOrder(orderForm))) { banner.value = 'Housing-standards order served.'; orders.value = ((await housingApi.orders()) as any).orders }
}
async function publish() {
  if (await run(() => housingApi.publishAnnouncement(announceForm))) { banner.value = 'Allocation notice published.'; announcements.value = ((await housingApi.announcements()) as any).announcements }
}

const k = computed(() => overview.value?.kpis || {})
</script>

<template>
  <div class="hsg-shell">
    <header class="hsg-top">
      <div>
        <span class="hsg-eyebrow">Housing and Estates</span>
        <h1>{{ desk?.title || 'The waiting list, on the map' }}</h1>
        <p>Stands, receipts and planning files are the same parcel. This desk shows the work this post may do; Finance and Planning read the same stand file.</p>
      </div>
      <ProfileDropdown />
    </header>
    <nav class="hsg-rail" aria-label="Housing sections">
      <button v-for="s in visibleSections" :key="s.id" type="button" :class="{ on: section === s.id }" @click="go(s.id)">
        <component :is="s.icon" :size="16" />{{ s.label }}
      </button>
    </nav>
    <p v-if="err" class="hsg-banner neg" role="alert">{{ err }}</p>
    <p v-else-if="banner" class="hsg-banner" role="status">{{ banner }}</p>

    <section v-if="section === 'overview'" class="hsg-main">
      <div class="hsg-kpis">
        <article><span>On the waiting list</span><strong>{{ k.waiting ?? '—' }}</strong></article>
        <article><span>Vacant stands (HERTS / Layout)</span><strong>{{ k.vacant ?? '—' }}</strong></article>
        <article><span>Allocated</span><strong>{{ k.allocated ?? '—' }}</strong></article>
        <article><span>Due for renewal</span><strong>{{ k.due_renewal ?? '—' }}</strong></article>
        <article><span>Open cessions</span><strong>{{ k.cessions_open ?? '—' }}</strong></article>
        <article><span>Standards orders</span><strong>{{ k.orders_open ?? '—' }}</strong></article>
      </div>
      <div class="hsg-split">
        <div class="hsg-card">
          <h2><Landmark :size="16" /> Schemes</h2>
          <table>
            <thead><tr><th>Scheme</th><th>Kind</th><th>Vacant</th><th>Taken</th><th>Ha</th></tr></thead>
            <tbody>
              <tr v-for="s in overview?.schemes || []" :key="s.id">
                <td>{{ s.name }}</td><td>{{ s.kind.replaceAll('_',' ') }}</td>
                <td class="num">{{ s.vacant }}</td><td class="num">{{ s.taken }}</td>
                <td class="num">{{ Number(s.area_ha || 0).toFixed(1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="hsg-card">
          <h2>Demand by preferred ward</h2>
          <p v-if="!(overview?.demand_by_ward || []).length" class="mute">Nobody on the list has named a ward yet.</p>
          <ul class="hsg-wards">
            <li v-for="w in overview?.demand_by_ward || []" :key="w.ward"><span>Ward {{ w.ward }}</span><strong>{{ w.n }}</strong></li>
          </ul>
        </div>
      </div>
    </section>

    <section v-else-if="section === 'map'" class="hsg-main hsg-map-sec">
      <div class="hsg-map-tools">
        <label>Township
          <select v-model="township">
            <option value="HERTS">Hertfordshire</option>
            <option value="LAYOUT">Layout</option>
          </select>
        </label>
        <p class="mute">Click a stand. Vacant parcels can be reserved only for someone already on the waiting list.</p>
      </div>
      <HousingMap :township="township" :selected="selected" @select="onSelect" />
      <aside v-if="stand" class="hsg-file">
        <h2>Stand {{ stand.stand.stand_no }}</h2>
        <p>{{ stand.stand.township_code }} · {{ stand.stand.map_status }} · {{ Number(stand.stand.area_m2).toFixed(0) }} m²</p>
        <p v-if="stand.stand.allottee_name">Allottee {{ stand.stand.allottee_name }}</p>
        <p>Services: water {{ stand.stand.water ? 'yes' : 'no' }} · sewer {{ stand.stand.sewer ? 'yes' : 'no' }} · road {{ stand.stand.road ? 'yes' : 'no' }} · power {{ stand.stand.electricity ? 'yes' : 'no' }}</p>
        <p v-if="stand.cross">Rates {{ stand.cross.rates_account || 'none' }} · {{ stand.cross.rates_band || 'unbilled' }} · deposit {{ stand.cross.deposit_receipt_no || 'unpaid' }} · {{ stand.cross.planning_files }} planning file(s)</p>
        <ul v-if="stand.permits?.length">
          <li v-for="p in stand.permits" :key="p.id">{{ p.tpd_reference || p.stand_number }} · {{ p.status }} · {{ p.applicant_name }}</li>
        </ul>
        <button v-if="can.allocate" type="button" class="hsg-btn" @click="allocForm.parcel_id = stand.stand.parcel_id; go('allocations')">Allocate this stand</button>
      </aside>
    </section>

    <section v-else-if="section === 'waiting'" class="hsg-main">
      <form v-if="can.waiting" class="hsg-card hsg-form" @submit.prevent="addWait">
        <h2>Register on the waiting list</h2>
        <label>Applicant<input v-model="waitForm.applicant_name" required /></label>
        <label>Seeking
          <select v-model="waitForm.sought">
            <option value="stand">Stand</option><option value="rental">Rental</option>
            <option value="staff">Staff housing</option><option value="cooperative">Cooperative</option>
            <option value="pay_scheme">Pay scheme</option>
          </select>
        </label>
        <label>Ward<input v-model="waitForm.preferred_ward" type="number" min="1" max="19" /></label>
        <label>Household<input v-model="waitForm.household_size" type="number" min="1" /></label>
        <label>Income USD<input v-model="waitForm.monthly_income" /></label>
        <label>Special needs<input v-model="waitForm.special_needs" /></label>
        <button class="hsg-btn" type="submit">Write the entry</button>
      </form>
      <div class="hsg-card">
        <h2>The list</h2>
        <table>
          <thead><tr><th>No.</th><th>Applicant</th><th>Seeking</th><th>Score</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="w in waiting" :key="w.id">
              <td class="mono">{{ w.list_no }}</td><td>{{ w.applicant_name }}</td>
              <td>{{ w.sought }}</td><td class="num">{{ w.score ?? '—' }}</td><td>{{ w.status }}</td>
              <td>
                <button v-if="can.interview" type="button" class="link" @click="interview(w.id)">Interview</button>
                <button v-if="can.allocate" type="button" class="link" @click="allocForm.waiting_list_id = w.id; go('allocations')">Allocate</button>
                <button v-if="can.waiting" type="button" class="link" @click="housingApi.renew(w.id).then(loadWaiting)">Renew</button>
                <button v-if="can.committee && sittings[0]" type="button" class="link" @click="housingApi.addCommitteeItem(sittings[0].id, { waiting_list_id: w.id, recommendation: 'allocate' }).then(loadAll)">Recommend</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="section === 'interviews'" class="hsg-main">
      <div class="hsg-card">
        <h2>Capacity interviews</h2>
        <p class="mute">Eligibility, documents, dual-ownership search and a recommendation to the allocations committee.</p>
        <table>
          <thead><tr><th>List</th><th>Applicant</th><th>Held</th><th>Capacity</th><th>Dual ownership</th><th>Recommendation</th></tr></thead>
          <tbody>
            <tr v-for="i in interviews" :key="i.id">
              <td class="mono">{{ i.list_no }}</td><td>{{ i.applicant_name }}</td>
              <td>{{ i.held_on }}</td><td>{{ i.capacity_ok ? 'yes' : 'no' }}</td>
              <td>{{ i.dual_ownership ? 'found' : 'clear' }}</td><td>{{ i.recommendation || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="section === 'allocations'" class="hsg-main">
      <form v-if="can.committee" class="hsg-card hsg-form" @submit.prevent="openSitting">
        <h2>Allocations committee sitting</h2>
        <label>Minute ref<input v-model="sittingForm.minute_ref" /></label>
        <label class="full">Notes<input v-model="sittingForm.notes" /></label>
        <button class="hsg-btn" type="submit">Open sitting</button>
        <p class="mute full">{{ sittings.length }} sitting(s). Recommend names from the waiting list; only a recommended entry can take a stand.</p>
      </form>
      <form v-if="can.allocate" class="hsg-card hsg-form" @submit.prevent="allocate">
        <h2>Reserve a stand from the list</h2>
        <label>Waiting-list entry
          <select v-model="allocForm.waiting_list_id" required>
            <option value="" disabled>Choose</option>
            <option v-for="w in waiting.filter(x => x.status === 'recommended')" :key="w.id" :value="w.id">
              {{ w.list_no }} · {{ w.applicant_name }}
            </option>
          </select>
        </label>
        <label>Parcel id<input v-model="allocForm.parcel_id" required placeholder="P-0000907" /></label>
        <label>Committee minute<input v-model="allocForm.committee_minute" /></label>
        <label>Price USD<input v-model="allocForm.purchase_price" /></label>
        <label>Deposit<input v-model="allocForm.deposit_due" /></label>
        <label class="full">Written waiver (only if the committee authorised an exception)<input v-model="allocForm.waiver_reason" /></label>
        <button class="hsg-btn" type="submit">Allocate</button>
      </form>
      <div class="hsg-card">
        <h2>Allocations, offers, agreements</h2>
        <table>
          <thead><tr><th>Stand</th><th>Allottee</th><th>List</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in allocations" :key="a.id">
              <td class="mono">{{ a.stand_no || a.parcel_id }}</td>
              <td>{{ a.allottee_name }}</td><td class="mono">{{ a.list_no }}</td><td>{{ a.status }}</td>
              <td>
                <button v-if="can.offer" type="button" class="link" @click="offer(a.id)">Offer letter</button>
                <button v-if="can.agreement" type="button" class="link" @click="agreement(a.id)">Agreement of sale</button>
              </td>
            </tr>
          </tbody>
        </table>
        <h3>Open offers</h3>
        <ul>
          <li v-for="o in offers" :key="o.id">
            {{ o.offer_no }} · {{ o.allottee_name }} · expires {{ o.expires_on }}
            <button v-if="can.offer" type="button" class="link" @click="accept(o.id)">Accept</button>
          </li>
        </ul>
      </div>
    </section>

    <section v-else-if="section === 'cessions'" class="hsg-main">
      <form v-if="can.cession_lodge" class="hsg-card hsg-form" @submit.prevent="lodgeCession">
        <h2>Lodge a cession</h2>
        <label>Allocation
          <select v-model="cessionForm.allocation_id" required>
            <option value="" disabled>Choose</option>
            <option v-for="a in allocations" :key="a.id" :value="a.id">{{ a.stand_no || a.parcel_id }} · {{ a.allottee_name }}</option>
          </select>
        </label>
        <label>Kind
          <select v-model="cessionForm.kind">
            <option value="ordinary">Ordinary</option>
            <option value="deceased_estate">Deceased estate</option>
            <option value="court_order">Court order</option>
          </select>
        </label>
        <label>From<input v-model="cessionForm.from_name" required /></label>
        <label>To<input v-model="cessionForm.to_name" required /></label>
        <label v-if="cessionForm.kind === 'ordinary'">Cessionary on the waiting list
          <select v-model="cessionForm.to_waiting_list_id" required>
            <option value="" disabled>Choose</option>
            <option v-for="w in waiting.filter(x => ['active','recommended','interviewed'].includes(x.status))" :key="w.id" :value="w.id">
              {{ w.list_no }} · {{ w.applicant_name }}
            </option>
          </select>
        </label>
        <button class="hsg-btn" type="submit">Lodge</button>
      </form>
      <div class="hsg-card">
        <table>
          <thead><tr><th>No.</th><th>Kind</th><th>From → to</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in cessions" :key="c.id">
              <td class="mono">{{ c.cession_no }}</td><td>{{ c.kind }}</td>
              <td>{{ c.from_name }} → {{ c.to_name }}</td><td>{{ c.status }}</td>
              <td>
                <button v-if="can.cession_decide" type="button" class="link" @click="housingApi.decideCession(c.id,'approved').then(loadAll)">Approve</button>
                <button v-if="can.cession_decide" type="button" class="link" @click="housingApi.decideCession(c.id,'completed').then(loadAll)">Complete</button>
              </td>
            </tr>
          </tbody>
        </table>
        <h3>Title</h3>
        <ul>
          <li v-for="t in titles" :key="t.id">{{ t.allottee_name }} · {{ t.status }} · {{ t.deed_ref || 'no deed yet' }}</li>
        </ul>
        <button v-if="can.title && allocations[0]" type="button" class="hsg-btn" @click="housingApi.lodgeTitle({ allocation_id: allocations[0].id }).then(loadAll)">Lodge title for latest allocation</button>
      </div>
    </section>

    <section v-else-if="section === 'estates'" class="hsg-main">
      <form v-if="can.lease" class="hsg-card hsg-form" @submit.prevent="addLease">
        <h2>Council lease or staff housing</h2>
        <label>Parcel<input v-model="leaseForm.parcel_id" required /></label>
        <label>Tenant<input v-model="leaseForm.tenant_name" required /></label>
        <label>Kind
          <select v-model="leaseForm.kind">
            <option value="council_rental">Council rental</option>
            <option value="staff">Staff housing</option>
            <option value="institutional">Institutional</option>
          </select>
        </label>
        <label>Rent<input v-model="leaseForm.rent" /></label>
        <button class="hsg-btn" type="submit">Write the lease</button>
      </form>
      <div class="hsg-card">
        <h2>Leases</h2>
        <table>
          <thead><tr><th>No.</th><th>Stand</th><th>Tenant</th><th>Kind</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="l in leases" :key="l.id">
              <td class="mono">{{ l.lease_no }}</td><td>{{ l.stand_no }}</td><td>{{ l.tenant_name }}</td><td>{{ l.kind }}</td><td>{{ l.status }}</td>
            </tr>
          </tbody>
        </table>
        <h3>Cooperatives</h3>
        <button v-if="can.lease" type="button" class="hsg-btn" @click="housingApi.addCooperative({ name: 'Hertfordshire Housing Cooperative', scheme_id: schemes[0]?.id }).then(loadAll)">Register a cooperative</button>
        <ul>
          <li v-for="c in coops" :key="c.id">{{ c.name }} · {{ c.members }} members · {{ c.status }}</li>
        </ul>
      </div>
    </section>

    <section v-else-if="section === 'standards'" class="hsg-main">
      <form v-if="can.standards" class="hsg-card hsg-form" @submit.prevent="addOrder">
        <h2>Housing Standards Control Act order</h2>
        <label>Parcel<input v-model="orderForm.parcel_id" required /></label>
        <label>Kind
          <select v-model="orderForm.kind">
            <option value="repair">Repair</option>
            <option value="demolition">Demolition</option>
            <option value="closure">Closure</option>
            <option value="clearance">Clearance</option>
          </select>
        </label>
        <label class="full">Reason<input v-model="orderForm.reason" required /></label>
        <button class="hsg-btn" type="submit">Serve</button>
      </form>
      <div class="hsg-card">
        <h2><AlertTriangle :size="16" /> Open orders</h2>
        <ul>
          <li v-for="o in orders" :key="o.id">{{ o.order_no }} · {{ o.kind }} · stand {{ o.stand_no }} · {{ o.status }}</li>
        </ul>
        <h3>Occupation certificates</h3>
        <ul><li v-for="o in occupation" :key="o.id">{{ o.certificate_no }} · {{ o.kind }} · {{ o.parcel_id }}</li></ul>
        <h3>Repossessions</h3>
        <ul>
          <li v-for="r in repos" :key="r.id">
            {{ r.allottee_name }} · {{ r.reason }} · {{ r.status }}
            <button v-if="can.repossess && r.status === 'noticed'" type="button" class="link" @click="housingApi.completeRepossession(r.id).then(loadAll)">Complete</button>
          </li>
        </ul>
        <h3>Overcrowding</h3>
        <ul><li v-for="n in overcrowding" :key="n.id">{{ n.parcel_id }} · {{ n.occupants }} occupants · {{ n.status }}</li></ul>
      </div>
    </section>

    <section v-else class="hsg-main">
      <form v-if="can.announce" class="hsg-card hsg-form" @submit.prevent="publish">
        <h2><Megaphone :size="16" /> Public allocation notice</h2>
        <label class="full">Title<input v-model="announceForm.title" required /></label>
        <label class="full">Body<textarea v-model="announceForm.body" rows="5" required /></label>
        <button class="hsg-btn" type="submit">Publish</button>
      </form>
      <div class="hsg-card">
        <article v-for="a in announcements" :key="a.id">
          <h3>{{ a.title }}</h3>
          <p>{{ a.body }}</p>
          <p class="mute">{{ a.published_on }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hsg-shell { min-height: 100vh; background: #f4efe6; color: #2c241c; display: grid; grid-template-rows: auto auto 1fr; }
.hsg-top { display: flex; justify-content: space-between; gap: 1rem; padding: 1.4rem 1.6rem 0.6rem; align-items: flex-start; }
.hsg-eyebrow { letter-spacing: .12em; text-transform: uppercase; font-size: .7rem; color: #8c2f0d; font-weight: 700; }
.hsg-top h1 { margin: .2rem 0; font-family: Cambria, 'Palatino Linotype', serif; font-size: 1.7rem; }
.hsg-top p { margin: 0; max-width: 40rem; color: #5c5148; }
.hsg-rail { display: flex; gap: .35rem; padding: .4rem 1.4rem 0.8rem; overflow-x: auto; }
.hsg-rail button { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid #e4d9cc; background: #fffaf3; color: #4a3f35; border-radius: 999px; padding: .35rem .8rem; cursor: pointer; white-space: nowrap; }
.hsg-rail button.on { background: #8c2f0d; color: #fffaf3; border-color: #8c2f0d; }
.hsg-main { padding: 0 1.4rem 2.5rem; display: grid; gap: 1rem; }
.hsg-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .7rem; }
.hsg-kpis article { background: #fffaf3; border: 1px solid #e4d9cc; border-radius: .9rem; padding: .9rem 1rem; display: flex; flex-direction: column; gap: .35rem; }
.hsg-kpis span { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #7a6e64; }
.hsg-kpis strong { font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.hsg-card { background: #fffaf3; border: 1px solid #e4d9cc; border-radius: 1rem; padding: 1.1rem 1.2rem; box-shadow: 0 1px 0 rgba(44,36,28,.04); }
.hsg-card h2 { display: flex; gap: .4rem; align-items: center; margin: 0 0 .8rem; font-size: 1.05rem; }
.hsg-split { display: grid; gap: 1rem; }
@media (min-width: 60rem) { .hsg-split { grid-template-columns: 1.4fr .8fr; } }
table { width: 100%; border-collapse: collapse; font-size: .88rem; }
th, td { text-align: left; padding: .4rem .3rem; border-bottom: 1px solid #efe6da; vertical-align: top; }
.num, .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, Consolas, monospace; }
.hsg-form { display: grid; gap: .7rem; }
@media (min-width: 40rem) { .hsg-form { grid-template-columns: 1fr 1fr; } .hsg-form h2, .hsg-form .full, .hsg-form .hsg-btn { grid-column: 1 / -1; } }
.hsg-form label { display: flex; flex-direction: column; gap: .25rem; font-size: .78rem; color: #5c5148; }
.hsg-form input, .hsg-form select, .hsg-form textarea { border: 1px solid #d7cbbd; border-radius: .4rem; padding: .45rem .55rem; background: #fff; }
.hsg-btn { background: #8c2f0d; color: #fffaf3; border: 0; border-radius: .55rem; padding: .55rem 1rem; cursor: pointer; justify-self: start; }
.link { background: none; border: 0; color: #8c2f0d; cursor: pointer; padding: 0 .4rem 0 0; }
.mute { color: #7a6e64; }
.hsg-banner { margin: 0 1.4rem .6rem; padding: .6rem .8rem; border-radius: .5rem; background: #e7f0e6; }
.hsg-banner.neg { background: #f8e6dc; }
.hsg-map-sec { grid-template-rows: auto minmax(28rem, 1fr) auto; }
.hsg-map-tools { display: flex; gap: 1rem; align-items: center; }
.hsg-file { background: #fffaf3; border: 1px solid #e4d9cc; border-radius: 1rem; padding: 1rem 1.2rem; }
.hsg-wards { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; }
.hsg-wards li { display: flex; justify-content: space-between; border-bottom: 1px solid #efe6da; padding: .3rem 0; }
</style>
