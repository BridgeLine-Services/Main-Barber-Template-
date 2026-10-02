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
| 8 | Image role handling | Missing | new lib |
| 9 | Motion levels | Missing enforcement | motion/reveal.tsx |
| 10 | Mobile nav modes | Missing | MobileBottomNav.tsx |
| 11 | Live shop status | Missing | new lib + component |
| 12 | Review presentations | Missing | reviews/page.tsx, page.tsx |
| 13 | Owner settings + preview | Missing | settings/page.tsx, api |
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
