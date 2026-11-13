/**
 * Builders for a workspace's child routes, so each workspace's `routes.ts` reads as its navigation.
 *
 *   section(...)   a page built on a console screen (shared/SectionPage.vue)
 *   page(...)      a page of the workspace's own
 *   notBuilt(...)  a page whose module the backend does not have yet (shared/NotBuiltPage.vue)
 *   messages(...)  the inbox behind the bell
 *
 * Icons travel in route meta, so they are marked raw (never made reactive).
 */
import { markRaw, type Component } from 'vue'
import type { RouteRecordRaw, RouteComponent } from 'vue-router'

type Lazy = RouteRecordRaw['component'] | (() => Promise<RouteComponent>)
const Section = () => import('./SectionPage.vue')
const NotBuilt = () => import('./NotBuiltPage.vue')
const Messages = () => import('./MessagesPage.vue')

export interface SectionOptions {
  props?: Record<string, unknown>
  needs?: string
  /** What the page says to someone without `needs`. */
  denied?: string
  states?: { value: string; label: string }[]
  stateParam?: string
  stateDefault?: string
}

export function routeKit(roleLabel: string, home: string) {
  const crumbs = (label: string) => [{ label: roleLabel, to: home }, { label }]
  return {
    section(path: string, name: string, embed: string, title: string, lead: string, icon: Component, o: SectionOptions = {}): RouteRecordRaw {
      return {
        path, name, component: Section,
        meta: {
          cwEmbed: embed, cwTitle: title, cwLead: lead, cwIcon: markRaw(icon), cwCrumbs: crumbs(title),
          cwProps: o.props, cwNeeds: o.needs, cwDenied: o.denied, cwStates: o.states, cwStateParam: o.stateParam, cwStateDefault: o.stateDefault,
        },
      }
    },
    page(path: string, name: string, title: string, component: Lazy, meta: Record<string, unknown> = {}): RouteRecordRaw {
      return { path, name, component, meta: { cwTitle: title, cwCrumbs: crumbs(title), ...meta } } as RouteRecordRaw
    },
    notBuilt(path: string, name: string, title: string, lead: string, icon: Component, why: string,
      see: { name: string; label: string; query?: Record<string, string> }[] = []): RouteRecordRaw {
      return { path, name, component: NotBuilt, meta: { cwTitle: title, cwLead: lead, cwIcon: markRaw(icon), cwWhy: why, cwSee: see, cwCrumbs: crumbs(title) } }
    },
    messages(name: string): RouteRecordRaw {
      return { path: 'messages', name, component: Messages, meta: { cwTitle: 'Messages', cwNav: home, cwCrumbs: crumbs('Messages') } }
    },
  }
}
