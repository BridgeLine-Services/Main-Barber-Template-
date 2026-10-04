# Homepage modules

The customer homepage is a stack of toggleable sections. Owners reorder and
enable/disable them from the dashboard (`HomeModulesCard`); the public site
renders exactly the enabled set, in the stored order, from the published
content snapshot (see docs/DRAFT-PUBLISH.md).

One registry — `src/lib/home-modules.ts` — defines every module, its
defaults, and how a stored configuration resolves. The homepage never
improvises its section list.

## Modules (default order)

| # | id | Ships on for never-configured sites | Notes |
|---|----|----|-------|
| 1 | `hero` | always on | Structural: cannot be disabled or unseated from slot 1 |
| 2 | `quickBook` | yes | "Find a time that works" finder (see below) |
| 3 | `shopStatus` | yes | Live open/closed + queue state |
| 4 | `featuredWork` | no | Curated portfolio strip |
| 5 | `services` | yes (legacy `showServices`) | Service menu with deep-link booking |
| 6 | `team` | yes (legacy `showTeam`) | Barber cards with rating, years of experience, live next-available chip, specialty, and a View Profile link to the full barber profile |
| 7 | `beforeAfter` | no | Before/after proof gallery |
| 8 | `reviews` | yes (legacy `showReviews`) | Featured reviews |
| 9 | `socialGallery` | no | Configurable handle/heading social strip |
| 10 | `shopExperience` | no | Shop-experience showcase |
| 11 | `visit` | yes (legacy `showVisit`) | Hours, location, parking |
| 12 | `faq` | yes | Stored FAQ accordion (renders nothing when no FAQs exist) |
| 13 | `finalCta` | yes (legacy `showFinalCta`) | Closing call-to-action |

## Resolution rules

- **Never configured** (`homeModules` absent): modules derive from the legacy
  `showServices`/`showTeam`/`showReviews`/`showVisit`/`showFinalCta` toggles
  (undefined toggles default ON — pre-launch parity). Newer modules keep
  their ship-on/ship-off defaults from the table above.
- **Explicitly configured**: the stored list is the source of truth, honored
  in the owner's order. Missing modules append after it in default order,
  **OFF** — an explicit configuration is a deliberate section set and never
  silently gains new sections.
- **Unknown/duplicate/junk entries** are dropped on parse; hero is always
  forced enabled and first.
- Settings are bounded at save time (`validateHomeModulesInput`): counts
  clamped, headings/blurbs trimmed, unsafe `profileUrl` values rejected.

## Quick-book finder (`quickBook`)

Honest availability search, not a fake booking widget: the visitor picks a
service (and optionally a barber) plus a date, the section calls
`/api/availability`, and shows the count of genuinely open slots plus the
earliest one with its barber. "Book" deep-links to
`/book?serviceId=…&barberId=…&date=YYYY-MM-DD`, which preselects all three
(strict date parse — anything malformed is ignored, never guessed). The
panel renders nothing when the shop has no bookable setup (no services or no
active barbers): an empty panel would be worse than no panel.

## FAQ section (`faq`)

Renders the business's real FAQ records (same store as the standalone `/faq`
page) as a details/summary accordion grouped by category. With no FAQ
records it renders nothing — no invented questions.

## Tests

`tests/home-modules.test.ts` (50 checks): legacy derivation, explicit
round-trips, ship-on defaults, append semantics, settings clamping, and
malformed-input recovery.

## Featured work (`featuredWork`)

Real published portfolio assets (BARBER_PORTFOLIO / GALLERY media) in an
editorial grid, newest first, clamped to the module's `count` setting.

- **Attribution** — each asset carries its linked barber and service
  (existing `MediaAsset` relations, no duplicate models). Tiles show the
  caption, barber, service name and service price when available.
- **Category chips** — derived from the business's own published content:
  the linked service name (Haircut / Fade / Beard / Lineup / Kids /
  Specialty via keyword mapping in `src/lib/portfolio.ts`) plus published
  Before/After pair membership (`before-after`). A chip only appears when
  at least one published asset maps to it; chips scroll horizontally on
  mobile and wrap on desktop.
- **Lightbox** — tiles open the shared gallery lightbox (`GalleryGrid`)
  directly, with "Book This Service" and "Book With This Barber" deep links
  that preserve the selected barber/service into `/book` preselection.
- No published images → the module renders nothing.

## Reviews (`reviews`)

All three presentation modes (editorial / cards / strip) show the review
date and a "Google Review" source badge when the data exists
(`Review.isGoogleReview`). Names shown are the configured author names;
nothing is invented.

## Visit (`visit`)

Hours, address, map and directions. When the business sets
**Parking Available** (Dashboard → Settings → Business → Location), the
location card shows a parking note — data-driven, no invented details.

## Hero status indicator

All three hero layouts show a subtle Open Now / Closed pill next to the
eyebrow, computed by the same shared calculation (`src/lib/shop-status.ts`)
that powers the customer `ShopStatus` card. It only renders when the shop
has real configured weekly hours; by-appointment shops show no pill.
