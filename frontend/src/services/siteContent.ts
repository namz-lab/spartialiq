/**
 * Client for the editable council-page content (CMS).
 *
 * The public pages always have a bundled default (see `content/siteContent.ts`),
 * so every getter falls back to that default and never throws — the site keeps
 * working when the backend is offline or a page has no override yet. Admin
 * mutations (save / reset) require the backend and surface errors normally.
 */
import api from './api'
import { SITE_CONTENT, seedPage, type CouncilPage } from '@/content/siteContent'

/** A stored override row as returned by the backend. */
interface OverrideRow {
  slug: string
  title: string
  body: { eyebrow?: string; intro?: string; blocks?: CouncilPage['blocks'] }
  updatedAt?: string
}

function mergePage(slug: string, row: OverrideRow | null): CouncilPage | null {
  const seed = seedPage(slug)
  if (!row) return seed
  // A stored override fully describes the page body; fall back to the seed
  // only for a slug the seed never knew about (admin-authored new page).
  return {
    slug,
    title: row.title ?? seed?.title ?? slug,
    eyebrow: row.body?.eyebrow ?? seed?.eyebrow,
    intro: row.body?.intro ?? seed?.intro,
    blocks: row.body?.blocks ?? seed?.blocks ?? [],
  }
}

/**
 * Resolve one page: bundled default, overlaid with any saved override.
 * Returns null only when neither a seed nor an override exists.
 */
export async function fetchCouncilPage(slug: string): Promise<CouncilPage | null> {
  try {
    const res = await api.get(`/site-content/${slug}`)
    return mergePage(slug, res.data as OverrideRow)
  } catch {
    // 404 (no override) or network error → bundled default.
    return seedPage(slug)
  }
}

/**
 * For the admin editor: every editable page, each as the seed merged with its
 * override so the admin sees current live content. Works offline (seed only).
 */
export async function fetchAllCouncilPages(): Promise<CouncilPage[]> {
  const overrides = new Map<string, OverrideRow>()
  try {
    const res = await api.get('/site-content')
    for (const row of (res.data as OverrideRow[]) || []) overrides.set(row.slug, row)
  } catch {
    /* offline → seed only */
  }
  // Seed slugs first (stable order), then any admin-authored extras.
  const slugs = [
    ...Object.keys(SITE_CONTENT),
    ...[...overrides.keys()].filter((s) => !(s in SITE_CONTENT)),
  ]
  return slugs
    .map((slug) => mergePage(slug, overrides.get(slug) ?? null))
    .filter((p): p is CouncilPage => p != null)
}

/** Persist a page override (admin only). */
export async function saveCouncilPage(page: CouncilPage): Promise<void> {
  await api.put(`/site-content/${page.slug}`, {
    title: page.title,
    body: {
      eyebrow: page.eyebrow ?? '',
      intro: page.intro ?? '',
      blocks: page.blocks,
    },
  })
}

/** Remove the override so the page falls back to its bundled default. */
export async function resetCouncilPage(slug: string): Promise<void> {
  await api.delete(`/site-content/${slug}`)
}
