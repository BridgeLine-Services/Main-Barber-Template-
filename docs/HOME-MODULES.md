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
| 6 | `team` | yes (legacy `showTeam`) | Barber cards |
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
