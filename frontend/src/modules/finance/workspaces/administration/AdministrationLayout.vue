<script setup lang="ts">
/** Finance Access Administration: the portal shell with the access administrator's navigation. */
import { computed } from 'vue'
import { House, Users, ScanEye, Scale, KeyRound, History, Mail } from 'lucide-vue-next'
import PortalLayout from '../shared/PortalLayout.vue'
import type { PortalNavItem } from '../shared/PortalShell.vue'
import { adminDash } from './dashboard'
import '../shared/dash.css'

const nav = computed<PortalNavItem[]>(() => [
  { group: 'Access', name: 'adm-dashboard', label: 'Dashboard', icon: House },
  { group: 'Access', name: 'adm-users', label: 'Finance Users', icon: Users },
  { group: 'Access', name: 'adm-effective', label: 'Effective Access', icon: ScanEye },
  { group: 'Control', name: 'adm-duties', label: 'Separation of Duties', icon: Scale },
  { group: 'Control', name: 'adm-roles', label: 'Role Catalogue', icon: KeyRound },
  { group: 'Control', name: 'adm-log', label: 'Access Log', icon: History },
])
const menu = [{ name: 'adm-messages', label: 'Messages', icon: Mail }]
</script>

<template>
  <PortalLayout :dash="adminDash" :nav="nav" :menu="menu" home-route="adm-dashboard" home-title="Finance Access Administration"
    :home-crumbs="['Finance Department', 'Access Administration']" messages-route="adm-messages" nav-label="Finance Access Administration" :yearly="false" workspace="administration" />
</template>
