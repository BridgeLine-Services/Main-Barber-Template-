# Visual Customization System — Implementation Checklist

Baseline (2026-10-01): tsc 0 errors, production build green, test:ci 18/18 green.

## Audit findings

- `src/lib/visual-style.ts` defines 5 presets with a FIXED per-preset mapping
  (hero/services/team/imageShape/button/motion). Only the homepage reads it.
- `visualStyle` has NO database column and is NOT in the publish snapshot, so
  every tenant renders the `modern-classic` fallback — the picker does not exist.
- Draft/publish architecture exists (`WebsiteContent.draft` → `publishedContent`
  snapshot → `/dashboard/website-preview`) and is the correct vehicle.
- /services, /barbers, /gallery, /reviews, MobileBottomNav, and motion components
  do not consume any visual configuration.

## Requirements → files → status

| Req | Area | Status | Files |
|---|---|---|---|
| 3 | 5 presets, full identity | Done | lib/visual-style.ts, globals.css (data-visual-style tokens: shape/type/surface/framing sitewide) |
| 4 | 3 hero layouts | Done | (customer)/page.tsx |
| 5 | 3 service layouts | Done | (customer)/services/page.tsx |
| 6 | 3 barber layouts | Done | (customer)/barbers/*, page.tsx team |
| 7 | Gallery layouts + lightbox | Done | gallery/page.tsx, PortfolioGallery.tsx |
| 8 | Image role handling | Done | lib/image-roles.ts, home sections, BeforeAfterSlider, dashboard/media |
| 9 | Motion levels | Done | MotionProvider in (customer)/layout.tsx + data-motion CSS enforcement |
| 10 | Mobile nav modes | Done | MobileBottomNav.tsx via layout mobileNavMode |
| 11 | Live shop status | Done | ShopStatus.tsx (real hours in business timezone, real WAITING queue, honest estimateWaitMinutes; deactivated shops report closed) |
| 12 | Review presentations | Done | reviews/page.tsx (editorial/cards/strip, real records, real average) + page.tsx home variants |
| 13 | Owner settings + preview | Done | dashboard/AppearanceTab.tsx (hero + mini-site preview, per-field overrides), api |
| 14 | Config pipeline persistence | Done | schema.prisma visualPreset/visualConfig, publish snapshot keys, legacy-site fallback (modern-classic) tested |

## Build order

1. Foundation: schema fields (visualPreset/visualConfig), resolver lib, publish
   integration, API validation. [IN PROGRESS]
2. Settings UI: Appearance tab, preset previews, layout pickers, draft/publish.
3. Hero + service layouts (real compositions).
4. Barber layouts + gallery layouts + lightbox + image roles.
5. Motion enforcement + mobile nav modes + shop status + reviews.
6. Preset identity CSS (typography/surface/motion per preset).
7. Tests + regression + final report.

## Image-role system (Req 8) — implemented

`src/lib/image-roles.ts` declares the rendering contract for every image
role (aspect, fit, default position, LCP priority, fallback):

| Role | Aspect | Priority | Fed by |
|---|---|---|---|
| hero | 21:9 → 2:1 | yes | HERO |
| barber | 3:4 | no | BARBER_PHOTO |
| service | 4:3 | no | SERVICE_PHOTO |
| shop | 16:10 | no | SHOP_PHOTO |
| portfolio | 4:5 | no | BARBER_PORTFOLIO / GALLERY |
| before-after | 4:5 → 3:4 | no | BeforeAfterPair assets |

### Focal points (per-asset crop control)

- `MediaAsset.focalX/focalY` (0-100 percent, migration in place) store the
  owner's crop intent per image.
- **Dashboard**: the media manager edit modal has a click-to-set focal
  picker (crosshair preview), a11y X/Y sliders, and a reset-to-center
  control. `PATCH /api/dashboard/media` accepts `focalX`/`focalY`
  (zod-validated 0-100 integers, tenant-scoped, audit-logged).
- **Public rendering**: `focalPositionStyle()` turns focal data into an
  inline `objectPosition` style. Role default positions stay as statically
  scanned Tailwind classes; runtime focal values are inline styles because
  the Tailwind JIT cannot see runtime-generated arbitrary classes.
- **Before/after pairs** frame both images with the AFTER asset's focal so
  the comparison stays aligned — differing crops would break the reveal.
- Tests: `tests/image-roles.test.ts` (spec integrity, clamping, partial
  data handling) runs in `test:ci`.


## Sitewide preset identity audit (2026-10-01, evening session)

Audit of `main` (post 00f4927) found the preset identity CSS only fired on
the homepage (`.visual-style-*` class lives there); Services, Barbers,
Gallery and Reviews pages rendered the same baseline regardless of preset.

Fixes (commit: sitewide preset identity + reviews presentations):

- `globals.css`: per-preset design tokens scoped on the customer layout's
  `data-visual-style` attribute — `--radius` (systemic card/button/input
  shape), display-type tracking/weight, page-surface washes, article
  frame treatments, street-cut uppercase CTAs, motion-level enforcement.
  `.brand-theme` keeps owning business colors and curated fonts.
- `reviews/page.tsx`: now resolves the published visual config and renders
  the owner-selected presentation — editorial (pull-quotes + hairlines),
  cards (grid), strip (scroll-snap rail). All variants use only real
  published reviews; the rating summary is computed from actual records.
- Regression: `tests/visual-config.test.ts` now asserts every preset has
  sitewide identity CSS and every review presentation resolves (74 checks).

Verified this session: ShopStatus is honest (real hours in the business
timezone, real WAITING queue entries, honest wait estimate, deactivated
shops report closed); the social gallery is real managed media with an
owner-configured validated profile link (never a live-feed claim); the
publish snapshot includes visualPreset/visualConfig; legacy sites with no
stored config resolve to modern-classic with editorial reviews.
