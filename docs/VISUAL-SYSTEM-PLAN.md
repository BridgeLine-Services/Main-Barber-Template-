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

## Preset roster (2026-10-03)

Eight identities, one architecture — every preset is data-driven from
`VISUAL_STYLE_CONFIG` + sitewide `[data-visual-style]` identity CSS:

| Preset | Character |
|---|---|
| black-label | luxury gallery, near-black, hairline frames |
| barber-heritage | vintage shop, pinstripe wash, warm frames |
| street-cut | poster energy, offset shadows, uppercase CTAs |
| clean-club | airy studio, soft elevation, accent glow |
| modern-classic | refined editorial default |
| warm-premium | coffee-house luxury, honeyed glow, soft frames |
| high-energy-urban | poster wall + voltage: hard frames, tape-stripe underline, condensed type |
| single-chair | one-person studio: journal-like, airy, personal |

Each also carries a matching dashboard palette (`PRESET_DASH`), picker
metadata (`PRESET_META`), and QA coverage in all preset matrices.

## Requirements → files → status

| Req | Area | Status | Files |
|---|---|---|---|
| 3 | 8 presets, full identity | Done | lib/visual-style.ts, globals.css (data-visual-style tokens: shape/type/surface/framing sitewide) |
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

## Phase 4 functional-gap audit (2026-10-01, night session)

Verified against the live code, with a seeded temporary barber-service link
(removed after testing):

1. **Next-available indicator — already implemented.** The booking wizard's
   barber step fetches `/api/availability/earliest?serviceId=…` (real
   `getEarliestAvailableSlot` over the next 30 days, rate-limited,
   tenant-scoped) and surfaces the genuine earliest slot. When the owner
   disables "First available", the API fails closed and the UI hides the
   option. No availability is ever invented.
2. **Barber profile → booking/services/portfolio — verified + hardened.**
   Profile links to `/book?barberId=…`, the barber's real portfolio
   (`PortfolioGallery` over their `mediaAssets`), and their services. NEW:
   each service row on the profile now deep-links to
   `/book?serviceId=…&barberId=…` (both preselected), verified live.
3. **Portfolio category filters — verified honest.** `buildPortfolioFilters`
   derives chips only from real asset→service links; unlinked assets appear
   only under "All work"; chips render only when there is a real choice.
4. **Location page — no separate route exists; /contact serves the role.**
   It presents real address, hours, phone/email and direction info, and
   inherits preset identity sitewide via the `data-visual-style` CSS. Adding
   a map embed would require an API key and is intentionally out of scope.
5. **Appearance preview vs draft/published — previously verified**
   (mini-site preview in settings, commit 00f4927; publish snapshot keys
   include visualPreset/visualConfig; draft-only changes stay private).

## Release-readiness audit (2026-10-01, third pass — full instruction)

All sections of the latest master audit instruction verified:

- **Preset distinctness (§2)**: composition defaults differ per preset
  (hero: cinematic/poster/split; services: editorial/visual-menu/cards;
  team: editorial/portrait-grid/large-profile; image shape; button shape;
  motion level) in `VISUAL_STYLE_CONFIG`, on top of the sitewide identity
  CSS (radius tokens, type treatment, surface washes, article frames).
  All five presets live-verified on every customer route (home, services,
  barbers, gallery, reviews, contact, book).
- **Owner workflow errors (§4)**: draft save failures and publish failures
  both surface destructive toasts with server error text
  (`settings/page.tsx` handleSave; `PublishWebsiteCard`). Legacy tenants
  resolve to modern-classic (re-verified live after the five-preset pass).
- **Accessibility (§6)**: gallery lightbox is keyboard-operable (Escape,
  arrow navigation, aria-labelled controls, alt fallback); BeforeAfterSlider
  implements role=slider with value text and keyboard handle control;
  focus-ring utility used across customer pages; reduced-motion enforced
  via [data-motion] CSS in addition to framer-motion gating.

No code changes were required by this pass — the audit confirmed the
implementation. The only fixes this round were in the previous commits
(overflow guard, barber service-row deep links).
