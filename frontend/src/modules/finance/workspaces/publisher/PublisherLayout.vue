<script setup lang="ts">
/** Publication: the portal shell with the publisher's navigation. */
import { computed } from 'vue'
import { House, LayoutTemplate, FileUp, Globe2, Wallet, FileSpreadsheet, FolderOpen, Megaphone, MonitorUp, History, Mail, GitBranch } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { publisherDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { name: 'pub-dashboard', label: 'Dashboard', icon: House },
  { name: 'pub-templates', label: 'Document Templates', icon: LayoutTemplate },
  { name: 'pub-reports', label: 'Report Publishing', icon: FileUp, badge: publisherDash.state.data?.states.approved || undefined },
  { name: 'pub-disclosures', label: 'Public Disclosures', icon: Globe2 },
  { name: 'pub-budget', label: 'Budget Publications', icon: Wallet },
  { name: 'pub-statements', label: 'Financial Statements', icon: FileSpreadsheet },
  { name: 'pub-council', label: 'Council Documents', icon: FolderOpen },
  { name: 'pub-notices', label: 'Notices & Announcements', icon: Megaphone },
  { name: 'pub-website', label: 'Website Publishing', icon: MonitorUp },
  { name: 'pub-versions', label: 'Version History', icon: GitBranch },
  { name: 'pub-log', label: 'Publication Log', icon: History },
])
const menu = [{ name: 'pub-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="publisherDash" :nav="nav" :menu="menu" home-route="pub-dashboard" home-title="Publisher Dashboard"
    :home-crumbs="['Finance Department', 'Publisher']" messages-route="pub-messages" nav-label="Publication" :yearly="false" workspace="publisher" />
</template>
