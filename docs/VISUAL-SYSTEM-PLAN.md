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
| 3 | 5 presets, full identity | Partial stub | lib/visual-style.ts, globals.css |
| 4 | 3 hero layouts | Class-level only | (customer)/page.tsx |
| 5 | 3 service layouts | Missing | (customer)/services/page.tsx |
| 6 | 3 barber layouts | Missing | (customer)/barbers/*, page.tsx team |
| 7 | Gallery layouts + lightbox | Missing | gallery/page.tsx, PortfolioGallery.tsx |
| 8 | Image role handling | Done | lib/image-roles.ts, home sections, BeforeAfterSlider, dashboard/media |
| 9 | Motion levels | Missing enforcement | motion/reveal.tsx |
| 10 | Mobile nav modes | Missing | MobileBottomNav.tsx |
| 11 | Live shop status | Missing | new lib + component |
| 12 | Review presentations | Missing | reviews/page.tsx, page.tsx |
| 13 | Owner settings + preview | Done | dashboard/AppearanceTab.tsx (hero + mini-site preview, per-field overrides), api |
| 14 | Config pipeline persistence | Missing column/snapshot | schema.prisma, publish route |

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
