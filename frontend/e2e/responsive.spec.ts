import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 28 — the responsive system checked in a real browser at real sizes.
 *
 * WHAT THIS SUITE IS FOR
 * The unit specs (src/components/ui/__tests__/responsive-ui.spec.ts) prove the
 * component contracts: that the bottom nav overflows correctly, that the sheet
 * traps focus. They cannot prove LAYOUT, because happy-dom has no layout
 * engine and every element there measures 0×0. Horizontal overflow, touch
 * target size and whether a header wraps to three rows are only knowable with
 * a real engine, which is what this file adds.
 *
 * WHICH ROUTES
 * Only the unauthenticated ones. The guard in router/index.ts redirects any
 * `meta.requiresAuth` route to /login without a session, so asking for
 * /planner here would silently test the login page nine times and report
 * green. The role consoles need a seeded session; that is a follow-up, and
 * they are listed in AUTHED_ROUTES so the gap is recorded, not forgotten.
 *
 * The backend is usually not running during these tests. That is deliberate:
 * a screen whose data fails to load must still lay out correctly, so this
 * doubles as Phase 23's error-state check.
 */

/** The nine viewports Phase 28 names, plus what each is actually for. */
const VIEWPORTS = [
  { name: '320x800  small phone',      width: 320,  height: 800,  kind: 'mobile' },
  { name: '375x812  iPhone X/11 Pro',  width: 375,  height: 812,  kind: 'mobile' },
  { name: '390x844  iPhone 12-15',     width: 390,  height: 844,  kind: 'mobile' },
  { name: '414x896  large phone',      width: 414,  height: 896,  kind: 'mobile' },
  { name: '768x1024 tablet portrait',  width: 768,  height: 1024, kind: 'tablet' },
  { name: '1024x768 tablet landscape', width: 1024, height: 768,  kind: 'desktop' },
  { name: '1280x800 laptop',           width: 1280, height: 800,  kind: 'desktop' },
  { name: '1440x900 desktop',          width: 1440, height: 900,  kind: 'wide' },
  { name: '1536x864 wide desktop',     width: 1536, height: 864,  kind: 'wide' },
] as const

/** Routes that render without a session. */
const PUBLIC_ROUTES = [
  { path: '/',          label: 'home' },
  { path: '/login',     label: 'login' },
  { path: '/register',  label: 'register' },
  { path: '/explorer',  label: 'map explorer' },
] as const

/**
 * Reachable only with a session, so not covered here. Listed so the coverage
 * gap is explicit: these are the six role consoles the responsive work
 * targeted hardest, and testing them end to end needs a seeded login.
 */
export const AUTHED_ROUTES = [
  '/planner', '/eo-planner-portal', '/env-officer-workspace',
  '/inspector-workspace', '/gis-officer-portal', '/planning-clerk-portal',
  '/gis-map', '/citizen',
] as const

/** Let fonts, the router and first paint settle before measuring. */
async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => document.fonts?.ready)
  // One rAF pair: enough for the router's initial view to commit and the
  // responsive.css cascade to apply, without an arbitrary sleep.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test.describe('no horizontal overflow at any supported viewport', () => {
  for (const vp of VIEWPORTS) {
    for (const route of PUBLIC_ROUTES) {
      test(`${route.label} @ ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await page.goto(route.path)
        await settle(page)

        // The single highest-value responsive assertion. Sideways scroll means
        // a fixed width somewhere exceeded the viewport, and it also misaligns
        // every fixed and sticky element on the page.
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(
          scrollWidth,
          `${route.path} scrolls horizontally at ${vp.width}px `
          + `(content ${scrollWidth}px vs viewport ${clientWidth}px)`,
        ).toBeLessThanOrEqual(clientWidth + 1)   // +1 absorbs sub-pixel rounding

        // Name the offenders rather than only failing, so a regression is
        // actionable from the report alone.
        const spillers = await page.evaluate((limit) => {
          const out: string[] = []
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            // Fixed elements are positioned against the viewport, not the
            // document, so a full-width fixed bar is not a spiller.
            if (getComputedStyle(el).position === 'fixed') continue
            if (r.right > limit + 1) {
              const id = el.id ? `#${el.id}` : ''
              const cls = el.className && typeof el.className === 'string'
                ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
              out.push(`${el.tagName.toLowerCase()}${id}${cls} → right:${Math.round(r.right)}px`)
            }
            if (out.length >= 5) break
          }
          return out
        }, vp.width)
        expect(spillers, `elements past the right edge at ${vp.width}px`).toEqual([])
      })
    }
  }
})

test.describe('touch targets meet the 44px floor on touch viewports', () => {
  // Emulating touch is what makes `pointer: coarse` match, and that query is
  // what the whole density change in responsive.css hangs on. Without it the
  // page renders at desktop density and these assertions prove nothing.
  test.use({ hasTouch: true, isMobile: true })

  for (const vp of VIEWPORTS.filter(v => v.kind === 'mobile')) {
    test(`login form @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/login')
      await settle(page)

      const undersized = await page.evaluate(() => {
        const MIN = 44
        const out: string[] = []

        /**
         * The EFFECTIVE target, not the control's own box.
         *
         * For a checkbox or radio this is the union of the control and its
         * associated <label>, because clicking the label activates the
         * control — so the pair is one target. Measuring the input alone
         * would demand a 44px checkbox, which is not what any platform draws
         * and not what WCAG asks for.
         */
        const effectiveRect = (el: HTMLElement): DOMRect => {
          const own = el.getBoundingClientRect()
          const isCheck = el instanceof HTMLInputElement
            && (el.type === 'checkbox' || el.type === 'radio')
          if (!isCheck) return own

          const label = (el.id && document.querySelector<HTMLElement>(`label[for="${el.id}"]`))
            || el.closest('label')
          if (!label) return own

          const l = label.getBoundingClientRect()
          return new DOMRect(
            Math.min(own.left, l.left),
            Math.min(own.top, l.top),
            Math.max(own.right, l.right) - Math.min(own.left, l.left),
            Math.max(own.bottom, l.bottom) - Math.min(own.top, l.top),
          )
        }

        const els = document.querySelectorAll<HTMLElement>(
          'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]',
        )
        for (const el of Array.from(els)) {
          const own = el.getBoundingClientRect()
          if (own.width === 0 || own.height === 0) continue        // not rendered
          if (getComputedStyle(el).visibility === 'hidden') continue
          // Inline links inside a paragraph are held to text rules, not target
          // rules — WCAG 2.5.8 exempts them for the same reason.
          if (el.tagName === 'A' && el.closest('p')) continue

          const r = effectiveRect(el)
          if (r.height < MIN - 0.5) {
            const cls = typeof el.className === 'string'
              ? el.className.trim().split(/\s+/)[0] : ''
            out.push(`${el.tagName.toLowerCase()}.${cls} → ${Math.round(r.height)}px tall`)
          }
          if (out.length >= 8) break
        }
        return out
      })

      expect(undersized, 'controls below the 44px touch floor').toEqual([])
    })
  }
})

test.describe('viewport and safe-area configuration', () => {
  test('the viewport meta opts into the safe area and allows pinch zoom', async ({ page }) => {
    await page.goto('/')
    const content = await page.getAttribute('meta[name="viewport"]', 'content')

    // Without viewport-fit=cover, env(safe-area-inset-*) always resolves to 0
    // and the bottom navigation sits under the iOS home indicator.
    expect(content).toContain('viewport-fit=cover')
    // WCAG 1.4.4: zoom must not be suppressed.
    expect(content).not.toContain('user-scalable=no')
    expect(content).not.toContain('maximum-scale=1')
  })

  test('form controls are 16px on mobile, so iOS does not zoom on focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/login')
    await settle(page)

    const smallFields = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea'))) {
        if (el.getBoundingClientRect().height === 0) continue
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 16) out.push(`${el.tagName.toLowerCase()} → ${size}px`)
      }
      return out
    })

    // Safari zooms the viewport when a focused field computes under 16px, and
    // never zooms back out.
    expect(smallFields, 'fields that will trigger iOS zoom-on-focus').toEqual([])
  })
})

test.describe('the breakpoint system switches where it says it does', () => {
  test('the enterprise breakpoint tokens are present and correct', async ({ page }) => {
    await page.goto('/')
    await settle(page)

    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return {
        mobile:  s.getPropertyValue('--ent-bp-mobile').trim(),
        tablet:  s.getPropertyValue('--ent-bp-tablet').trim(),
        desktop: s.getPropertyValue('--ent-bp-desktop').trim(),
        wide:    s.getPropertyValue('--ent-bp-wide').trim(),
      }
    })

    // These must agree with BREAKPOINTS in src/composables/useBreakpoint.ts,
    // or CSS and JS disagree about where a layout switches and the seam shows.
    expect(tokens).toEqual({
      mobile: '767px', tablet: '768px', desktop: '1024px', wide: '1440px',
    })
  })

  test('the mobile type scale applies below 768 and not above', async ({ page }) => {
    const read = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--ent-fs-base').trim()

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    await settle(page)
    expect(await page.evaluate(read), 'body size at 375px').toBe('0.9375rem')  // 15px

    await page.setViewportSize({ width: 1280, height: 800 })
    await settle(page)
    expect(await page.evaluate(read), 'body size at 1280px').toBe('0.875rem')  // 14px
  })
})
